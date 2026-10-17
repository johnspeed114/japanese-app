import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyGrade,
  createSession,
  pinContentForSession,
  resolveReviewContent,
  saveContentSnapshot,
  selectNextCard,
} from "../src/engine";
import {
  appendRecordingChunk,
  closeDatabase,
  createRecording,
  database,
  DATABASE_NAME,
  finishRecording,
  getProgress,
  getRecording,
  getRecordingBlob,
  initialize,
  recoverStorage,
  setRestoreLock,
  updateProgress,
} from "../src/storage";
import type { Catalog, RecordingMeta } from "../src/types";

const meta = (id = "recording"): RecordingMeta => ({
  id,
  sessionId: "session",
  taskId: "task",
  mimeType: "audio/webm",
  startedAt: 1000,
  durationMs: 0,
  size: 0,
  chunks: 0,
  status: "recording",
  interrupted: false,
});
async function reset() {
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
beforeEach(async () => {
  await reset();
  vi.stubGlobal("navigator", {});
});
afterEach(async () => {
  await closeDatabase();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transactional study storage", () => {
  it("loads edited plan-file defaults and creates independent settings objects", async () => {
    vi.resetModules();
    vi.doMock("../src/content/plan.json", () => ({
      default: {
        startDate: "2026-10-15",
        targetDate: "2027-01-15",
        dailyMinutes: 20,
        phaseWeights: [10, 20, 30, 40],
        timezone: "Asia/Tokyo",
      },
    }));
    try {
      const { initialProgress } = await import("../src/storage");
      const first = initialProgress();
      expect(first.settings.plan).toEqual({
        startDate: "2026-10-15",
        targetDate: "2027-01-15",
        dailyMinutes: 20,
        phaseWeights: [10, 20, 30, 40],
        timezone: "Asia/Tokyo",
      });
      first.settings.plan.phaseWeights[0] = 99;
      expect(initialProgress().settings.plan.phaseWeights[0]).toBe(10);
    } finally {
      vi.doUnmock("../src/content/plan.json");
      vi.resetModules();
    }
  });

  it("persists an active answer and its historical revision across later content edits", async () => {
    const oldCard = {
      id: "card",
      revision: 1,
      kind: "card" as const,
      prompt: "Original prompt",
      answer: "以前の答え",
      alternatives: [],
      notes: "",
      register: "polite" as const,
      phaseTags: ["trip" as const],
      skillTags: ["vocabulary" as const],
      tripRelevant: true,
      issueTags: [],
      review: {
        status: "ai-reviewed" as const,
        reviewer: "Reviewer",
        date: "2026-10-12",
      },
    };
    const revised = {
      ...oldCard,
      revision: 2,
      prompt: "Updated prompt",
      answer: "変更した答え",
    };
    const catalog: Catalog = {
      version: "1",
      cards: [oldCard],
      keigoDrills: [],
      diagnostic: [],
      scenarios: [],
      passages: [],
    };
    let sessionId = "";
    await updateProgress((data) => {
      data.diagnosticComplete = true;
      const session = createSession(data, "2026-10-12", 1000, catalog);
      sessionId = session.id;
      pinContentForSession(data, session, oldCard);
      session.drafts["card:card"] = "途中の答え";
    });
    await updateProgress((data) => {
      saveContentSnapshot(data, revised);
    });
    const loaded = await getProgress();
    const session = loaded.sessions.find((item) => item.id === sessionId)!;
    expect(
      selectNextCard(
        loaded,
        session,
        { ...catalog, cards: [revised] },
        2000,
        500,
      )?.answer,
    ).toBe(oldCard.answer);
    expect(session.drafts["card:card"]).toBe("途中の答え");
    await updateProgress((data) => {
      applyGrade(data, revised, 3, sessionId, 2000);
    });
    const graded = await getProgress();
    expect(graded.reviewEvents[0].contentRevision).toBe(1);
    expect(resolveReviewContent(graded, graded.reviewEvents[0])?.answer).toBe(
      oldCard.answer,
    );
    expect(graded.snapshots.card.revision).toBe(2);
  });

  it("serializes concurrent grades so the same answer is scheduled only once", async () => {
    const card = {
      id: "card",
      revision: 1,
      kind: "card" as const,
      prompt: "Produce",
      answer: "答え",
      alternatives: [],
      notes: "",
      register: "polite" as const,
      phaseTags: ["trip" as const],
      skillTags: ["vocabulary" as const],
      tripRelevant: true,
      issueTags: [],
      review: {
        status: "ai-reviewed" as const,
        reviewer: "Reviewer",
        date: "2026-10-12",
      },
    };
    const catalog: Catalog = {
      version: "1",
      cards: [card],
      keigoDrills: [],
      diagnostic: [],
      scenarios: [],
      passages: [],
    };
    let sessionId = "";
    await updateProgress((data) => {
      data.diagnosticComplete = true;
      sessionId = createSession(data, "2026-10-12", 1000, catalog).id;
    });
    await Promise.all([
      updateProgress((data) => {
        applyGrade(data, card, 1, sessionId, 2000);
      }),
      updateProgress((data) => {
        applyGrade(data, card, 4, sessionId, 3000);
      }),
    ]);
    const progress = await getProgress();
    expect(progress.reviewEvents).toHaveLength(1);
    expect(progress.cardStates.card.reps).toBe(1);
    expect(progress.reviewEvents[0].rating).toBe(1);
    expect(progress.snapshots.card.id).toBe("card");
  });
  it("preserves the existing grade and schedule when an update throws", async () => {
    await updateProgress((data) => {
      data.settings.voiceURI = "original";
    });
    await expect(
      updateProgress((data) => {
        data.settings.voiceURI = "changed";
        throw new Error("Simulated interruption");
      }),
    ).rejects.toThrow("Simulated interruption");
    expect((await getProgress()).settings.voiceURI).toBe("original");
  });
  it("saves duplicate chunk deliveries once and preserves authoritative byte counts", async () => {
    await createRecording(meta());
    await appendRecordingChunk("recording", 0, new Blob(["one"]));
    await appendRecordingChunk("recording", 0, new Blob(["different"]));
    await appendRecordingChunk("recording", 1, new Blob(["two"]));
    await finishRecording("recording", {
      status: "complete",
      size: 999,
      chunks: 999,
      durationMs: 1234,
    });
    expect(await getRecording("recording")).toMatchObject({
      status: "complete",
      chunks: 2,
      size: 6,
      durationMs: 1234,
    });
    expect(await (await getRecordingBlob("recording"))?.text()).toBe("onetwo");
  });
  it("saves emitted audio as ArrayBuffer when IndexedDB rejects native Blob values", async () => {
    const bytes = new Uint8Array([0, 255, 128, 1, 10, 13]);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "chunks" && value instanceof Blob)
        throw new DOMException("Blob values unsupported", "DataCloneError");
      return originalPut.call(this, value, key);
    });
    await createRecording({ ...meta(), mimeType: "audio/mp4" });
    await appendRecordingChunk("recording", 0, new Blob([bytes]));
    await finishRecording("recording", { status: "complete" });

    const pointers = await initialize();
    const stored = await (await database()).get("chunks", [
      pointers.audio,
      "recording",
      0,
    ]);
    expect(stored).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(stored as ArrayBuffer)).toEqual(bytes);
    expect(await getRecording("recording")).toMatchObject({
      chunks: 1,
      size: bytes.byteLength,
      mimeType: "audio/mp4",
    });
    const restored = await getRecordingBlob("recording");
    expect(restored?.type).toBe("audio/mp4");
    expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(bytes);
  });
  it("finishes asynchronous chunk conversion before opening its write transaction", async () => {
    await createRecording(meta());
    const bytes = new Uint8Array([1, 128, 255]);
    const chunk = new Blob([bytes]);
    let completeRead!: (value: ArrayBuffer) => void;
    let markReading!: () => void;
    const reading = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    vi.spyOn(chunk, "arrayBuffer").mockImplementation(() => {
      markReading();
      return new Promise<ArrayBuffer>((resolve) => {
        completeRead = resolve;
      });
    });
    const db = await database();
    const transactions = vi.spyOn(db, "transaction");
    const append = appendRecordingChunk("recording", 0, chunk);
    await reading;
    expect(transactions).not.toHaveBeenCalled();
    completeRead(bytes.buffer);
    await append;
    expect(await getRecording("recording")).toMatchObject({
      chunks: 1,
      size: bytes.byteLength,
    });
    expect(
      new Uint8Array(await (await getRecordingBlob("recording"))!.arrayBuffer()),
    ).toEqual(bytes);
  });
  it("reads legacy Blob chunks in order alongside newly appended binary audio", async () => {
    const pointers = await initialize();
    const db = await database();
    await db.put(
      "recordings",
      { ...meta(), mimeType: "audio/ogg", size: 4, chunks: 2 },
      [pointers.audio, "recording"],
    );
    await db.put("chunks", new Blob([new Uint8Array([128, 255])]), [
      pointers.audio,
      "recording",
      1,
    ]);
    await db.put("chunks", new Blob([new Uint8Array([0, 1])]), [
      pointers.audio,
      "recording",
      0,
    ]);
    await appendRecordingChunk(
      "recording",
      2,
      new Blob([new Uint8Array([2, 3])]),
    );
    const restored = await getRecordingBlob("recording");
    expect(restored?.type).toBe("audio/ogg");
    expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 128, 255, 2, 3]),
    );
    expect(await getRecording("recording")).toMatchObject({
      chunks: 3,
      size: 6,
    });
  });
  it("blocks grading and another recording while restore is staging", async () => {
    await setRestoreLock(true);
    await expect(
      updateProgress((data) => {
        data.settings.voiceURI = "changed";
      }),
    ).rejects.toThrow("restore");
    await expect(createRecording(meta())).rejects.toThrow("restore");
    expect((await getProgress()).settings.voiceURI).toBe("");
  });
  it("does not unlock or clean another tab’s active restore", async () => {
    const old = await setRestoreLock(true);
    const db = await database();
    await db.put(
      "progress",
      { ...(await getProgress()), catalogVersion: "staged" },
      "staged",
    );
    vi.stubGlobal("navigator", {
      locks: {
        query: async () => ({ held: [{ name: "japanese-restore" }] }),
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: null) => unknown,
        ) => callback(null),
      },
    });
    await recoverStorage();
    expect(await db.get("meta", "active")).toEqual({ ...old, restoring: true });
    expect(await db.get("progress", "staged")).toBeDefined();
  });
  it("recovers stale audio and its original session reference without disturbing active capture", async () => {
    await updateProgress((data) => {
      data.sessions.push({
        id: "session",
        studyDate: "2026-10-12",
        phase: "trip",
        kind: "daily",
        createdAt: 1000,
        completedAt: null,
        stage: 0,
        reviewElapsed: 0,
        readingMode: "reading",
        scenarioId: "",
        passageId: "",
        passageRepeated: false,
        drafts: {},
        ratings: {},
        completedTasks: [],
        recordingIds: {},
        lookedUp: [],
        externalLookups: 0,
        assisted: false,
        startedTasks: {},
        finishedTasks: {},
        summary: "",
      });
    });
    await createRecording(meta());
    await appendRecordingChunk(
      "recording",
      0,
      new Blob(["saved before crash"]),
    );
    vi.stubGlobal("navigator", {
      locks: {
        query: async () => ({ held: [] }),
        request: async (
          _name: string,
          options: unknown,
          callback?: (lock: { name: string }) => unknown,
        ) =>
          (callback ?? (options as (lock: { name: string }) => unknown))({
            name: _name,
          }),
      },
    });
    await recoverStorage();
    expect(await getRecording("recording")).toMatchObject({
      interrupted: true,
      status: "interrupted",
    });
    expect((await getProgress()).sessions[0].recordingIds.task).toBe(
      "recording",
    );
  });
  it("rejects concurrent recording creation even without Web Locks", async () => {
    await createRecording(meta("first"));
    await expect(createRecording(meta("second"))).rejects.toThrow("recording");
  });
  it("leaves another tab’s active capture and existing reference alone during startup", async () => {
    await createRecording(meta());
    vi.stubGlobal("navigator", {
      locks: {
        query: async () => ({ held: [{ name: "japanese-recording" }] }),
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: { name: string }) => unknown,
        ) => callback({ name: _name }),
      },
    });
    await recoverStorage();
    expect(await getRecording("recording")).toMatchObject({
      status: "recording",
      interrupted: false,
    });
  });
  it("initializes stable active-generation pointers", async () => {
    expect(await initialize()).toEqual(await initialize());
  });
});
