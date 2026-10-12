import "fake-indexeddb/auto";
import catalogFixture from "../src/content/catalog.json";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportFull,
  exportProgress,
  inspectBackup,
  restoreBackup,
} from "../src/backup";
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
  listRecordings,
  updateProgress,
} from "../src/storage";
import type { RecordingMeta, Session } from "../src/types";
import { applyGrade } from "../src/engine";

const session: Session = {
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
  drafts: { answer: "元の答え" },
  ratings: {},
  completedTasks: [],
  recordingIds: {},
  lookedUp: [],
  externalLookups: 0,
  assisted: false,
  startedTasks: {},
  finishedTasks: {},
  summary: "",
};
async function reset() {
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function recording(id: string, blob = new Blob(["original audio"])) {
  const meta: RecordingMeta = {
    id,
    sessionId: "session",
    taskId: id,
    mimeType: "audio/webm",
    startedAt: 1000,
    durationMs: 1000,
    size: 0,
    chunks: 0,
    status: "recording",
    interrupted: false,
  };
  await createRecording(meta);
  await appendRecordingChunk(id, 0, blob);
  await finishRecording(id, { status: "complete" });
  await updateProgress((data) => {
    data.sessions[0].recordingIds[id] = id;
  });
}
async function jsonEnvelope() {
  return JSON.parse(await (await exportProgress()).text());
}
async function zip(
  manifest: unknown,
  files: { name: string; blob: Blob }[] = [],
) {
  const writer = new ZipWriter(new BlobWriter("application/zip"), {
    useWebWorkers: false,
    level: 0,
  });
  await writer.add("manifest.json", new TextReader(JSON.stringify(manifest)));
  for (const file of files)
    await writer.add(file.name, new BlobReader(file.blob));
  return new File([await writer.close()], "backup.zip", {
    type: "application/zip",
  });
}
beforeEach(async () => {
  await reset();
  vi.stubGlobal("navigator", {});
  await updateProgress((data) => {
    data.sessions.push(structuredClone(session));
  });
});
afterEach(async () => {
  await closeDatabase();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("backup restoration", () => {
  it("restores progress JSON while retaining recordings already on the destination", async () => {
    await recording("clip");
    const file = await exportProgress();
    await updateProgress((data) => {
      data.sessions[0].drafts.answer = "変更";
    });
    await restoreBackup(file);
    expect((await getProgress()).sessions[0].drafts.answer).toBe("元の答え");
    expect(await (await getRecordingBlob("clip"))?.text()).toBe(
      "original audio",
    );
  });
  it("round-trips binary audio into a fresh database and records missing references", async () => {
    await recording("clip");
    await updateProgress((data) => {
      data.sessions[0].recordingIds.missing = "missing";
    });
    const file = await exportFull();
    expect(await inspectBackup(file)).toMatchObject({
      kind: "full",
      recordings: 1,
      missing: 1,
    });
    await reset();
    await restoreBackup(file);
    expect(await (await getRecordingBlob("clip"))?.text()).toBe(
      "original audio",
    );
    expect(await getRecording("missing")).toBeUndefined();
    expect((await getProgress()).sessions[0].recordingIds.missing).toBe(
      "missing",
    );
  });
  it("exports legacy Blob chunks and restores their exact bytes and original MIME type", async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13, 1, 2]);
    const pointers = await initialize();
    const db = await database();
    await db.put(
      "recordings",
      {
        id: "legacy",
        sessionId: "session",
        taskId: "legacy",
        mimeType: "audio/mp4",
        startedAt: 1000,
        durationMs: 1234,
        size: bytes.byteLength,
        chunks: 2,
        status: "complete",
        interrupted: false,
      },
      [pointers.audio, "legacy"],
    );
    await db.put("chunks", new Blob([bytes.slice(0, 3)]), [
      pointers.audio,
      "legacy",
      0,
    ]);
    await db.put("chunks", new Blob([bytes.slice(3)]), [
      pointers.audio,
      "legacy",
      1,
    ]);
    await updateProgress((data) => {
      data.sessions[0].recordingIds.legacy = "legacy";
    });
    const file = await exportFull();
    const reader = new ZipReader(new BlobReader(file), {
      useWebWorkers: false,
    });
    try {
      const entry = (await reader.getEntries()).find(
        (entry) => entry.filename === "recordings/legacy.bin",
      )!;
      if (entry.directory || !entry.getData)
        throw new Error("Missing exported audio");
      const exported = await entry.getData(new BlobWriter("audio/mp4"));
      expect(new Uint8Array(await exported.arrayBuffer())).toEqual(bytes);
    } finally {
      await reader.close();
    }
    await reset();
    await restoreBackup(file);
    const restored = await getRecordingBlob("legacy");
    expect(restored?.type).toBe("audio/mp4");
    expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(bytes);
    expect(await getRecording("legacy")).toMatchObject({
      mimeType: "audio/mp4",
      durationMs: 1234,
      size: bytes.byteLength,
      chunks: 1,
    });
  });
  it("restores a recording in bounded binary chunks when IndexedDB rejects Blob values", async () => {
    const oneMiB = 1024 * 1024;
    const bytes = Uint8Array.from(
      { length: 2 * oneMiB + 17 },
      (_, index) => index % 256,
    );
    await recording("clip", new Blob([bytes]));
    const file = await exportFull();
    await reset();
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
    await restoreBackup(file);
    const pointers = await initialize();
    const db = await database();
    const chunks = await db.getAll("chunks");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk instanceof ArrayBuffer)).toBe(true);
    for (const chunk of chunks) {
      expect((chunk as ArrayBuffer).byteLength).toBeGreaterThan(0);
      expect((chunk as ArrayBuffer).byteLength).toBeLessThanOrEqual(oneMiB);
    }
    expect(await db.getAllKeys("chunks")).toEqual(
      chunks.map((_, index) => [pointers.audio, "clip", index]),
    );
    expect(await getRecording("clip")).toMatchObject({
      chunks: chunks.length,
      size: bytes.byteLength,
      mimeType: "audio/webm",
    });
    const restored = await getRecordingBlob("clip");
    expect(restored?.type).toBe("audio/webm");
    expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(bytes);
  });
  it("retains FSRS state and retired content snapshots across catalog-version changes", async () => {
    const card = {
      id: "retired-card",
      revision: 3,
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
    await updateProgress((data) => {
      data.catalogVersion = "previous-catalog";
      applyGrade(data, card, 3, "session", 2000);
    });
    const before = await getProgress();
    const file = await exportProgress();
    await reset();
    await restoreBackup(file);
    const after = await getProgress();
    expect(after.catalogVersion).toBe("previous-catalog");
    expect(after.cardStates).toEqual(before.cardStates);
    expect(after.reviewEvents).toEqual(before.reviewEvents);
    expect(after.snapshots).toEqual(before.snapshots);
  });
  it("restores retained review history after the user resets a card’s learning schedule", async () => {
    const card = {
      id: "reset-card",
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
    await updateProgress((data) => {
      applyGrade(data, card, 3, "session", 2000);
      delete data.cardStates[card.id];
    });
    const file = await exportProgress();
    await reset();
    await restoreBackup(file);
    const restored = await getProgress();
    expect(restored.cardStates["reset-card"]).toBeUndefined();
    expect(restored.reviewEvents).toHaveLength(1);
    expect(restored.snapshots["reset-card"].id).toBe("reset-card");
  });
  it.each([
    "snapshot-id",
    "diagnostic-sequence",
    "current-card",
    "review-revision",
  ])(
    "rejects a broken %s reference without replacing progress",
    async (corruption) => {
      const card = {
        id: "reference-card",
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
      await updateProgress((data) => {
        applyGrade(data, card, 3, "session", 2000);
      });
      const data = await jsonEnvelope();
      if (corruption === "snapshot-id")
        data.progress.sessions[0].contentSnapshots["reference-card"].id =
          "other-card";
      if (corruption === "diagnostic-sequence")
        data.progress.sessions[0].diagnosticIds = ["reference-card"];
      if (corruption === "current-card")
        data.progress.sessions[0].currentCardId = "missing-card";
      if (corruption === "review-revision")
        data.progress.reviewEvents[0].contentRevision = 99;
      await updateProgress((progress) => {
        progress.settings.voiceURI = "destination";
      });
      await expect(
        restoreBackup(new File([JSON.stringify(data)], "bad.json")),
      ).rejects.toThrow();
      expect((await getProgress()).settings.voiceURI).toBe("destination");
    },
  );
  it("preserves legacy history when an old backup no longer has its historical model revision", async () => {
    const card = {
      id: "legacy-card",
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
    await updateProgress((data) => {
      applyGrade(data, card, 3, "session", 2000);
    });
    const data = await jsonEnvelope();
    delete data.progress.sessions[0].contentSnapshots;
    data.progress.snapshots["legacy-card"].revision = 2;
    await restoreBackup(new File([JSON.stringify(data)], "legacy.json"));
    expect((await getProgress()).reviewEvents[0].contentRevision).toBe(1);
    expect((await getProgress()).snapshots["legacy-card"].revision).toBe(2);
  });
  it("rejects a legacy active-card reference that has no saved definition", async () => {
    const data = await jsonEnvelope();
    data.progress.sessions[0].currentCardId = "absent";
    await expect(
      restoreBackup(new File([JSON.stringify(data)], "bad.json")),
    ).rejects.toThrow("missing its content definition");
  });
  it("accepts progress-only metadata for omitted audio larger than the ZIP clip limit", async () => {
    await recording("clip");
    const data = await jsonEnvelope();
    data.recordings[0].meta.size = 65 * 1024 * 1024;
    const file = new File([JSON.stringify(data)], "progress.json");
    expect(await inspectBackup(file)).toMatchObject({
      kind: "progress",
      recordings: 0,
      missing: 1,
    });
    await restoreBackup(file);
    expect(await (await getRecordingBlob("clip"))?.text()).toBe(
      "original audio",
    );
  });
  it.each([
    "unsupported-version",
    "invalid-date",
    "missing-reference",
    "missing-card",
  ])("rejects %s before replacing existing progress", async (corruption) => {
    const data = await jsonEnvelope();
    if (corruption === "unsupported-version") data.version = 2;
    if (corruption === "invalid-date")
      data.progress.sessions[0].studyDate = "2026-02-30";
    if (corruption === "missing-reference")
      data.progress.sessions[0].recordingIds.task = "absent";
    if (corruption === "missing-card")
      data.progress.cardStates.absent = {
        due: 1000,
        stability: 1,
        difficulty: 1,
        elapsed_days: 0,
        scheduled_days: 1,
        reps: 1,
        lapses: 0,
        state: 2,
        learning_steps: 0,
      };
    await updateProgress((progress) => {
      progress.settings.voiceURI = "keep me";
    });
    await expect(
      restoreBackup(new File([JSON.stringify(data)], "bad.json")),
    ).rejects.toThrow();
    expect((await getProgress()).settings.voiceURI).toBe("keep me");
    expect((await (await database()).get("meta", "active"))?.restoring).toBe(
      false,
    );
  });
  it("rejects an archive whose inventory declares an audio file that is missing", async () => {
    await recording("clip");
    const manifest = await jsonEnvelope();
    manifest.kind = "full";
    manifest.recordings[0].included = true;
    manifest.recordings[0].file = "recordings/clip.bin";
    const before = await initialize();
    await expect(restoreBackup(await zip(manifest))).rejects.toThrow(
      "manifest",
    );
    expect(await initialize()).toEqual(before);
  });
  it("rejects a JSON file that claims to replace audio like a full archive", async () => {
    const manifest = await jsonEnvelope();
    manifest.kind = "full";
    const before = await initialize();
    await expect(
      restoreBackup(new File([JSON.stringify(manifest)], "bad.json")),
    ).rejects.toThrow("progress only");
    expect(await initialize()).toEqual(before);
  });
  it("rejects recording metadata pointing to another task before replacing data", async () => {
    await recording("clip");
    const manifest = await jsonEnvelope();
    manifest.recordings[0].meta.taskId = "other-task";
    const before = await initialize();
    await expect(
      restoreBackup(new File([JSON.stringify(manifest)], "bad.json")),
    ).rejects.toThrow("different study session or task");
    expect(await initialize()).toEqual(before);
  });
  it("leaves original data active when staging hits a storage quota error", async () => {
    const file = await exportProgress();
    await updateProgress((data) => {
      data.settings.voiceURI = "original";
    });
    const db = await database();
    const originalPut = db.put.bind(db);
    vi.spyOn(db, "put").mockImplementation(
      (...args: Parameters<typeof db.put>) =>
        args[0] === "progress"
          ? Promise.reject(new DOMException("Full", "QuotaExceededError"))
          : originalPut(...args),
    );
    await expect(restoreBackup(file)).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect((await getProgress()).settings.voiceURI).toBe("original");
    expect((await db.get("meta", "active"))?.restoring).toBe(false);
  });
  it("rolls back staged progress and audio when cancellation arrives during restore", async () => {
    await recording("clip");
    const file = await exportFull();
    await updateProgress((data) => {
      data.settings.voiceURI = "destination";
    });
    const before = await initialize();
    const abort = new AbortController();
    await expect(
      restoreBackup(file, {
        signal: abort.signal,
        onProgress: (label) => {
          if (label === "Restoring recordings") abort.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await initialize()).toEqual(before);
    expect((await getProgress()).settings.voiceURI).toBe("destination");
    expect(await (await getRecordingBlob("clip"))?.text()).toBe(
      "original audio",
    );
  });
  it.each(["quota", "cancellation"] as const)(
    "preserves the original snapshot and cleans partial multi-chunk audio after %s",
    async (failure) => {
      const oneMiB = 1024 * 1024;
      await recording("incoming", new Blob([new Uint8Array(2 * oneMiB + 17)]));
      const file = await exportFull();
      await reset();
      await updateProgress((data) => {
        data.sessions.push(structuredClone(session));
        data.settings.voiceURI = "destination";
      });
      await recording("original", new Blob(["destination audio"]));
      const before = await initialize();
      const progressBefore = await getProgress();
      const abort = new AbortController();
      const originalPut = IDBObjectStore.prototype.put;
      let attemptedChunks = 0;
      let savedChunks = 0;
      let stagedMetadata = 0;
      const stagedSizes: number[] = [];
      vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        const staging = Array.isArray(key) && key[0] !== before.audio;
        if (this.name === "recordings" && staging) stagedMetadata++;
        if (this.name === "chunks" && staging) {
          attemptedChunks++;
          if (failure === "quota" && attemptedChunks === 2)
            throw new DOMException("Full", "QuotaExceededError");
          stagedSizes.push(
            value instanceof ArrayBuffer ? value.byteLength : -1,
          );
          const request = originalPut.call(this, value, key);
          this.transaction.addEventListener("complete", () => {
            savedChunks++;
            if (failure === "cancellation") abort.abort();
          });
          return request;
        }
        return originalPut.call(this, value, key);
      });
      await expect(
        restoreBackup(file, { signal: abort.signal }),
      ).rejects.toMatchObject({
        name: failure === "quota" ? "QuotaExceededError" : "AbortError",
      });
      expect(savedChunks).toBe(1);
      expect(stagedSizes).toHaveLength(1);
      expect(stagedSizes[0]).toBeGreaterThan(0);
      expect(stagedSizes[0]).toBeLessThanOrEqual(oneMiB);
      expect(stagedMetadata).toBe(0);
      expect(await initialize()).toEqual(before);
      expect(await getProgress()).toEqual(progressBefore);
      expect(await (await getRecordingBlob("original"))?.text()).toBe(
        "destination audio",
      );
      const db = await database();
      expect(await db.getAllKeys("progress")).toEqual([before.progress]);
      expect(await db.getAllKeys("recordings")).toEqual([
        [before.audio, "original"],
      ]);
      expect(await db.getAllKeys("chunks")).toEqual([
        [before.audio, "original", 0],
      ]);
    },
  );
  it("reports durable restore success even if a final progress callback throws", async () => {
    const file = await exportProgress();
    await updateProgress((data) => {
      data.sessions[0].drafts.answer = "destination";
    });
    await expect(
      restoreBackup(file, {
        onProgress: (label) => {
          if (label === "Restore complete")
            throw new Error("UI callback failed");
        },
      }),
    ).resolves.toBeUndefined();
    expect((await getProgress()).sessions[0].drafts.answer).toBe("元の答え");
  });
  it("rejects export while a capture is active", async () => {
    const meta: RecordingMeta = {
      id: "active",
      sessionId: "session",
      taskId: "active",
      mimeType: "audio/webm",
      startedAt: 1000,
      durationMs: 0,
      size: 0,
      chunks: 0,
      status: "recording",
      interrupted: false,
    };
    await createRecording(meta);
    await expect(exportProgress()).rejects.toThrow("recording");
    await expect(exportFull()).rejects.toThrow("recording");
  });
  it("accepts a representative 120 MiB archive without reading the whole archive as an ArrayBuffer", async () => {
    const oneMiB = new Uint8Array(1024 * 1024);
    const large = new Blob(Array.from({ length: 60 }, () => oneMiB));
    await recording("first", large);
    await recording("second", large);
    const file = await exportFull();
    expect(file.size).toBeGreaterThan(120 * 1024 * 1024);
    const readWholeFile = vi
      .spyOn(file, "arrayBuffer")
      .mockImplementation(() => {
        throw new Error("Whole archive materialized");
      });
    await reset();
    await restoreBackup(file);
    expect(readWholeFile).not.toHaveBeenCalled();
    expect((await listRecordings()).map((meta) => meta.size)).toEqual([
      60 * 1024 * 1024,
      60 * 1024 * 1024,
    ]);
    expect((await getRecordingBlob("first"))?.size).toBe(large.size);
  }, 60_000);
  it("rejects corrupt audio CRC without replacing active data", async () => {
    await recording("clip", new Blob(["UNIQUE_CORRUPTION_TARGET"]));
    const file = await exportFull();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const target = new TextEncoder().encode("UNIQUE_CORRUPTION_TARGET");
    let found = -1;
    for (let i = 0; i < bytes.length - target.length; i++)
      if (target.every((value, offset) => bytes[i + offset] === value)) {
        found = i;
        break;
      }
    expect(found).toBeGreaterThan(0);
    bytes[found] ^= 1;
    const before = await initialize();
    await expect(
      restoreBackup(new File([bytes], "corrupt.zip")),
    ).rejects.toThrow();
    expect(await initialize()).toEqual(before);
    expect(await (await getRecordingBlob("clip"))?.text()).toBe(
      "UNIQUE_CORRUPTION_TARGET",
    );
  });
  it("writes a manifest with a catalog version and binary rather than encoded audio", async () => {
    await recording("clip");
    const file = await exportFull();
    const reader = new ZipReader(new BlobReader(file), {
      useWebWorkers: false,
    });
    const entries = await reader.getEntries();
    expect(entries.map((entry) => entry.filename)).toEqual([
      "manifest.json",
      "recordings/clip.bin",
    ]);
    const progress = await getProgress();
    expect(progress.catalogVersion).toBe(catalogFixture.version);
    const manifest = entries.find(
      (entry) => entry.filename === "manifest.json",
    )!;
    if (manifest.directory || !manifest.getData)
      throw new Error("Missing manifest data");
    const envelope = JSON.parse(await manifest.getData(new TextWriter()));
    expect(envelope.progress.catalogVersion).toBe(catalogFixture.version);
    await reader.close();
  });
});
