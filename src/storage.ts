import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { ProgressData, RecordingMeta } from "./types";
import planDefaults from "./content/plan.json";
import { settingsSchema } from "./validation";
import { catalog } from "./content";
export const DATABASE_NAME = "japanese-reactivation";
export type Pointers = { progress: string; audio: string; restoring: boolean };
interface StudyDB extends DBSchema {
  meta: { key: string; value: Pointers };
  progress: { key: string; value: ProgressData };
  recordings: { key: [string, string]; value: RecordingMeta };
  chunks: { key: [string, string, number]; value: Blob | ArrayBuffer };
}
let pending: Promise<IDBPDatabase<StudyDB>> | undefined;
let channel: BroadcastChannel | undefined;
export function announceChange() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("study-change"));
  channel?.postMessage("change");
}
export async function database() {
  if (!pending)
    pending = openDB<StudyDB>(DATABASE_NAME, 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("progress");
        db.createObjectStore("recordings");
        db.createObjectStore("chunks");
      },
      blocking() {
        void pending?.then((db) => db.close());
        pending = undefined;
      },
    });
  if (
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined" &&
    !channel
  ) {
    channel = new BroadcastChannel("japanese-study");
    channel.onmessage = () => window.dispatchEvent(new Event("study-change"));
  }
  return pending;
}
export function initialProgress(): ProgressData {
  const settings = settingsSchema.parse({
    plan: {
      ...planDefaults,
      timezone:
        planDefaults.timezone === "device"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
          : planDefaults.timezone,
    },
    furigana: false,
    baselineRegister: "polite",
    voiceURI: "",
    lastExportAt: null,
    installAcknowledged: false,
  });
  return {
    settings,
    catalogVersion: catalog.version,
    cardStates: {},
    reviewEvents: [],
    sessions: [],
    userCards: [],
    mistakes: {},
    observations: [],
    diagnosticGrades: {},
    diagnosticComplete: false,
    snapshots: {},
  };
}
export async function initialize() {
  const db = await database();
  const tx = db.transaction(["meta", "progress"], "readwrite");
  void tx.done.catch(() => undefined);
  let meta = await tx.objectStore("meta").get("active");
  if (!meta) {
    meta = {
      progress: crypto.randomUUID(),
      audio: crypto.randomUUID(),
      restoring: false,
    };
    await tx.objectStore("progress").put(initialProgress(), meta.progress);
    await tx.objectStore("meta").put(meta, "active");
  }
  await tx.done;
  return meta;
}
export async function getProgress() {
  await initialize();
  const db = await database();
  const tx = db.transaction(["meta", "progress"]);
  void tx.done.catch(() => undefined);
  const meta = (await tx.objectStore("meta").get("active"))!;
  const value = (await tx.objectStore("progress").get(meta.progress))!;
  await tx.done;
  return value;
}
export async function updateProgress(change: (draft: ProgressData) => void) {
  await initialize();
  const db = await database();
  const tx = db.transaction(["meta", "progress"], "readwrite");
  void tx.done.catch(() => undefined);
  const meta = (await tx.objectStore("meta").get("active"))!;
  if (meta.restoring) {
    tx.abort();
    throw new Error("A restore is in progress. Please wait.");
  }
  const value = (await tx.objectStore("progress").get(meta.progress))!;
  change(value);
  await tx.objectStore("progress").put(value, meta.progress);
  await tx.done;
  announceChange();
  return value;
}
export async function createRecording(meta: RecordingMeta) {
  await initialize();
  const db = await database();
  const tx = db.transaction(["meta", "recordings"], "readwrite");
  void tx.done.catch(() => undefined);
  const pointers = (await tx.objectStore("meta").get("active"))!;
  if (pointers.restoring) {
    tx.abort();
    throw new Error("Wait for the restore to finish before recording.");
  }
  const existing = await tx
    .objectStore("recordings")
    .getAll(
      IDBKeyRange.bound([pointers.audio, ""], [pointers.audio, "\uffff"]),
    );
  if (existing.some((recording) => recording.status === "recording")) {
    tx.abort();
    throw new Error(
      "Another recording is already running. Stop it before starting this one.",
    );
  }
  await tx.objectStore("recordings").add(meta, [pointers.audio, meta.id]);
  await tx.done;
  announceChange();
}
export async function appendRecordingChunk(
  id: string,
  index: number,
  chunk: Blob,
) {
  // Convert before opening the transaction: Blob persistence is unreliable in WebKit.
  const bytes = await chunk.arrayBuffer();
  const db = await database();
  const tx = db.transaction(["meta", "recordings", "chunks"], "readwrite");
  void tx.done.catch(() => undefined);
  const pointers = (await tx.objectStore("meta").get("active"))!;
  if (pointers.restoring) {
    tx.abort();
    throw new Error("Cannot record during a restore.");
  }
  const meta = await tx.objectStore("recordings").get([pointers.audio, id]);
  if (!meta) {
    tx.abort();
    throw new Error("Recording no longer exists.");
  }
  const key: [string, string, number] = [pointers.audio, id, index];
  if (!(await tx.objectStore("chunks").getKey(key))) {
    await tx.objectStore("chunks").put(bytes, key);
    meta.size += bytes.byteLength;
    meta.chunks = Math.max(meta.chunks, index + 1);
    await tx.objectStore("recordings").put(meta, [pointers.audio, id]);
  }
  await tx.done;
}
export async function finishRecording(
  id: string,
  patch: Partial<RecordingMeta>,
) {
  const db = await database();
  const tx = db.transaction(["meta", "recordings"], "readwrite");
  void tx.done.catch(() => undefined);
  const pointers = (await tx.objectStore("meta").get("active"))!;
  const old = await tx.objectStore("recordings").get([pointers.audio, id]);
  if (old) {
    await tx
      .objectStore("recordings")
      .put({ ...old, ...patch, id, size: old.size, chunks: old.chunks }, [
        pointers.audio,
        id,
      ]);
  }
  await tx.done;
  announceChange();
}
export async function getRecording(id: string) {
  await initialize();
  const db = await database();
  const tx = db.transaction(["meta", "recordings"]);
  void tx.done.catch(() => undefined);
  const meta = (await tx.objectStore("meta").get("active"))!;
  const value = await tx.objectStore("recordings").get([meta.audio, id]);
  await tx.done;
  return value;
}
export async function listRecordings() {
  await initialize();
  const db = await database();
  const tx = db.transaction(["meta", "recordings"]);
  void tx.done.catch(() => undefined);
  const meta = (await tx.objectStore("meta").get("active"))!;
  const records = await tx
    .objectStore("recordings")
    .getAll(IDBKeyRange.bound([meta.audio, ""], [meta.audio, "\uffff"]));
  await tx.done;
  return records.sort((a, b) => b.startedAt - a.startedAt);
}
export async function getRecordingBlob(id: string) {
  await initialize();
  const db = await database();
  const tx = db.transaction(["meta", "recordings", "chunks"]);
  void tx.done.catch(() => undefined);
  const pointers = (await tx.objectStore("meta").get("active"))!;
  const meta = await tx.objectStore("recordings").get([pointers.audio, id]);
  if (!meta) {
    await tx.done;
    return undefined;
  }
  const parts = await tx
    .objectStore("chunks")
    .getAll(
      IDBKeyRange.bound(
        [pointers.audio, id, 0],
        [pointers.audio, id, Number.MAX_SAFE_INTEGER],
      ),
    );
  await tx.done;
  return new Blob(parts, { type: meta.mimeType });
}
export async function deleteRecording(id: string) {
  const db = await database();
  const tx = db.transaction(["meta", "recordings", "chunks"], "readwrite");
  void tx.done.catch(() => undefined);
  const pointers = (await tx.objectStore("meta").get("active"))!;
  if (pointers.restoring) {
    tx.abort();
    throw new Error("Please wait for the restore to finish.");
  }
  await tx.objectStore("recordings").delete([pointers.audio, id]);
  await tx
    .objectStore("chunks")
    .delete(
      IDBKeyRange.bound(
        [pointers.audio, id, 0],
        [pointers.audio, id, Number.MAX_SAFE_INTEGER],
      ),
    );
  await tx.done;
  announceChange();
}
export async function setRestoreLock(locked: boolean) {
  await initialize();
  const db = await database();
  const tx = db.transaction("meta", "readwrite");
  void tx.done.catch(() => undefined);
  const meta = (await tx.store.get("active"))!;
  if (locked && meta.restoring) {
    tx.abort();
    throw new Error("Another restore is already in progress.");
  }
  meta.restoring = locked;
  await tx.store.put(meta, "active");
  await tx.done;
  announceChange();
  return meta;
}
export async function cleanupGenerations() {
  const db = await database();
  const tx = db.transaction(
    ["meta", "progress", "recordings", "chunks"],
    "readwrite",
  );
  void tx.done.catch(() => undefined);
  const pointers = await tx.objectStore("meta").get("active");
  if (!pointers || pointers.restoring) {
    await tx.done;
    return;
  }
  for await (const cursor of tx.objectStore("progress"))
    if (cursor.key !== pointers.progress) await cursor.delete();
  for await (const cursor of tx.objectStore("recordings"))
    if (cursor.key[0] !== pointers.audio) await cursor.delete();
  for await (const cursor of tx.objectStore("chunks"))
    if (cursor.key[0] !== pointers.audio) await cursor.delete();
  await tx.done;
}
export async function withRecordingIdle<T>(job: () => Promise<T>): Promise<T> {
  const run = async () => {
    const pointers = await initialize();
    if (pointers.restoring)
      throw new Error("A restore is in progress. Please wait.");
    if (
      (await listRecordings()).some(
        (recording) => recording.status === "recording",
      )
    )
      throw new Error(
        "Stop the active recording before preparing or restoring a backup.",
      );
    return job();
  };
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(
      "japanese-recording",
      { ifAvailable: true },
      (lock) => {
        if (!lock)
          throw new Error(
            "Stop the active recording or wait for the other backup to finish.",
          );
        return run();
      },
    );
  return run();
}
async function recoverInactiveStorage() {
  await initialize();
  const db = await database();
  const tx = db.transaction(["meta", "progress", "recordings"], "readwrite");
  void tx.done.catch(() => undefined);
  const pointers = (await tx.objectStore("meta").get("active"))!;
  if (pointers.restoring) {
    pointers.restoring = false;
    await tx.objectStore("meta").put(pointers, "active");
  }
  const progress = (await tx.objectStore("progress").get(pointers.progress))!;
  const records = await tx
    .objectStore("recordings")
    .getAll(
      IDBKeyRange.bound([pointers.audio, ""], [pointers.audio, "\uffff"]),
    );
  const byId = new Map(records.map((recording) => [recording.id, recording]));
  for (const recording of records.sort((a, b) => a.startedAt - b.startedAt)) {
    if (recording.status === "recording") {
      recording.status = "interrupted";
      recording.interrupted = true;
      await tx
        .objectStore("recordings")
        .put(recording, [pointers.audio, recording.id]);
    }
    const session = progress.sessions.find(
      (session) => session.id === recording.sessionId,
    );
    const previous = session?.recordingIds[recording.taskId];
    if (
      session &&
      recording.size > 0 &&
      (!previous || recording.startedAt > (byId.get(previous)?.startedAt ?? -1))
    )
      session.recordingIds[recording.taskId] = recording.id;
  }
  await tx.objectStore("progress").put(progress, pointers.progress);
  await tx.done;
  await cleanupGenerations();
  announceChange();
}
export async function recoverStorage() {
  await initialize();
  if (typeof navigator !== "undefined" && navigator.locks) {
    const locks = navigator.locks;
    await locks.request(
      "japanese-restore",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return;
        const snapshot = await locks.query();
        if (snapshot.held?.some((held) => held.name === "japanese-recording"))
          return;
        await locks.request(
          "japanese-recording",
          { ifAvailable: true },
          async (captureLock) => {
            if (captureLock) await recoverInactiveStorage();
          },
        );
      },
    );
    return;
  }
  // Without Web Locks, another tab's operation cannot safely be identified as stale.
  const pointers = await initialize();
  if (!pointers.restoring) await cleanupGenerations();
}
export async function closeDatabase() {
  const db = await pending;
  db?.close();
  pending = undefined;
  channel?.close();
  channel = undefined;
}
