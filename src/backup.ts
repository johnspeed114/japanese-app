import {
  BlobReader,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { z } from "zod";
import {
  announceChange,
  cleanupGenerations,
  database,
  getProgress,
  getRecordingBlob,
  initialize,
  listRecordings,
  setRestoreLock,
  updateProgress,
  withRecordingIdle,
} from "./storage";
import { parseProgress, recordingSchema } from "./validation";
import type { ProgressData } from "./types";
import { resolveReviewContent } from "./engine";
const MAX_CLIP = 64 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
const RESTORE_CHUNK_BYTES = 1024 * 1024;
const inventorySchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  included: z.boolean(),
  meta: recordingSchema
    .extend({ size: z.number().finite().int().nonnegative() })
    .optional(),
  file: z.string().optional(),
});
const envelopeSchema = z.object({
  format: z.literal("japanese-reactivation"),
  version: z.literal(1),
  kind: z.enum(["progress", "full"]),
  exportedAt: z.string(),
  progress: z.unknown(),
  recordings: z.array(inventorySchema).max(10000),
});
type Envelope = Omit<z.infer<typeof envelopeSchema>, "progress"> & {
  progress: ProgressData;
};
export type BackupSummary = {
  kind: "progress" | "full";
  cards: number;
  sessions: number;
  recordings: number;
  missing: number;
  bytes: number;
  exportedAt: string;
};
export type JobOptions = {
  signal?: AbortSignal;
  onProgress?: (label: string, current: number, total: number) => void;
};
function readJSON(text: string): unknown {
  return JSON.parse(text, (key, value: unknown) => {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("This backup contains an unsupported field.");
    return value;
  });
}
function parseEnvelope(input: unknown): Envelope {
  const raw = envelopeSchema.parse(input);
  const progress = parseProgress(raw.progress);
  const sessions = new Set(progress.sessions.map((s) => s.id));
  if (sessions.size !== progress.sessions.length)
    throw new Error("Duplicate study sessions in backup.");
  const ids = new Set<string>();
  for (const row of raw.recordings) {
    if (ids.has(row.id)) throw new Error("Duplicate recording IDs in backup.");
    ids.add(row.id);
    if (row.meta && row.meta.id !== row.id)
      throw new Error("Recording metadata does not match its ID.");
    if (row.included && (!row.meta || row.file !== `recordings/${row.id}.bin`))
      throw new Error("Invalid audio entry.");
    if (row.included && row.meta!.size > MAX_CLIP)
      throw new Error(
        "An included recording exceeds the supported 64 MiB size.",
      );
    if (raw.kind === "progress" && row.included)
      throw new Error("Progress JSON cannot contain audio.");
  }
  const knownCards = new Set(progress.userCards.map((c) => c.id));
  if (knownCards.size !== progress.userCards.length)
    throw new Error("Duplicate manually added cards in backup.");
  for (const [id, item] of Object.entries(progress.snapshots)) {
    if (id !== item.id) throw new Error("Content snapshot ID mismatch.");
    if ("kind" in item) knownCards.add(id);
  }
  for (const id of Object.keys(progress.cardStates))
    if (!knownCards.has(id))
      throw new Error(`A card is missing its content snapshot: ${id}`);
  const eventIds = new Set<string>();
  const graded = new Set<string>();
  for (const event of progress.reviewEvents) {
    const gradeKey = JSON.stringify([event.cardId, event.sessionId]);
    if (eventIds.has(event.id) || graded.has(gradeKey))
      throw new Error("Duplicate grades in backup.");
    eventIds.add(event.id);
    graded.add(gradeKey);
    if (!knownCards.has(event.cardId) || !sessions.has(event.sessionId))
      throw new Error("A review refers to missing card or session data.");
    const session = progress.sessions.find(
      (session) => session.id === event.sessionId,
    )!;
    if (
      session.contentSnapshots !== undefined &&
      !resolveReviewContent(progress, event)
    )
      throw new Error("A review is missing its recorded content revision.");
  }
  for (const session of progress.sessions)
    if (session.currentCardId && session.contentSnapshots === undefined) {
      const card =
        progress.snapshots[session.currentCardId] ??
        progress.userCards.find((card) => card.id === session.currentCardId);
      if (!card || !("kind" in card) || card.kind === "diagnostic")
        throw new Error("The active card is missing its content definition.");
    }
  for (const [id, mistake] of Object.entries(progress.mistakes))
    if (id !== mistake.cardId || !knownCards.has(id))
      throw new Error("A mistake refers to missing card data.");
  for (const observation of progress.observations)
    if (!sessions.has(observation.sessionId))
      throw new Error("A mistake observation refers to a missing session.");
  const inventory = new Map(raw.recordings.map((row) => [row.id, row]));
  for (const session of progress.sessions)
    for (const [taskId, id] of Object.entries(session.recordingIds)) {
      if (!ids.has(id))
        throw new Error("A recording reference is missing from the inventory.");
      const recording = inventory.get(id)?.meta;
      if (
        recording &&
        (recording.sessionId !== session.id || recording.taskId !== taskId)
      )
        throw new Error(
          "A recording refers to a different study session or task.",
        );
    }
  return { ...raw, progress };
}
async function envelope(kind: "progress" | "full"): Promise<Envelope> {
  const progress = await getProgress();
  const local = await listRecordings();
  const referenced = new Set(
    progress.sessions.flatMap((s) => Object.values(s.recordingIds)),
  );
  const recordings: Envelope["recordings"] = local.map((meta) => ({
    id: meta.id,
    meta:
      meta.status === "recording"
        ? { ...meta, status: "interrupted", interrupted: true }
        : meta,
    included: kind === "full",
    ...(kind === "full" ? { file: `recordings/${meta.id}.bin` } : {}),
  }));
  const localIds = new Set(local.map((m) => m.id));
  for (const id of referenced)
    if (!localIds.has(id)) recordings.push({ id, included: false });
  return {
    format: "japanese-reactivation",
    version: 1,
    kind,
    exportedAt: new Date().toISOString(),
    progress,
    recordings,
  };
}
function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException("Backup cancelled.", "AbortError");
}
export async function exportProgress(options: JobOptions = {}): Promise<File> {
  return withRecordingIdle(async () => {
    abortIfNeeded(options.signal);
    const data = await envelope("progress");
    abortIfNeeded(options.signal);
    const file = new File(
      [JSON.stringify(data)],
      `japanese-progress-${new Date().toISOString().slice(0, 10)}.json`,
      { type: "application/json" },
    );
    options.onProgress?.("Progress backup ready", 1, 1);
    return file;
  });
}
export async function exportFull(options: JobOptions = {}): Promise<File> {
  return withRecordingIdle(() => prepareFull(options));
}
async function prepareFull(options: JobOptions): Promise<File> {
  const data = await envelope("full");
  const parts: Blob[] = [];
  const writer = new ZipWriter(
    new WritableStream<Uint8Array>({
      write(chunk) {
        abortIfNeeded(options.signal);
        parts.push(new Blob([new Uint8Array(chunk).buffer]));
      },
    }),
    { level: 0, useWebWorkers: false },
  );
  const audio = data.recordings.filter((r) => r.included);
  let done = 0;
  try {
    await writer.add("manifest.json", new TextReader(JSON.stringify(data)), {
      signal: options.signal,
    });
    for (const row of audio) {
      abortIfNeeded(options.signal);
      options.onProgress?.("Adding recordings", done, audio.length);
      const blob = await getRecordingBlob(row.id);
      if (!blob || blob.size !== row.meta?.size)
        throw new Error(
          "A recording changed during export. Stop recording and try again.",
        );
      if (blob.size > MAX_CLIP)
        throw new Error(
          "An individual recording exceeds the supported 64 MiB size.",
        );
      await writer.add(row.file!, new BlobReader(blob), {
        signal: options.signal,
      });
      done++;
    }
    await writer.close();
    abortIfNeeded(options.signal);
    options.onProgress?.("Full backup ready", done, audio.length);
    return new File(
      parts,
      `japanese-full-${new Date().toISOString().slice(0, 10)}.zip`,
      { type: "application/zip" },
    );
  } catch (error) {
    parts.length = 0;
    throw error;
  }
}
async function openBackup(file: File) {
  if (file.name.toLowerCase().endsWith(".json")) {
    if (file.size > MAX_MANIFEST)
      throw new Error("Progress JSON is too large.");
    const data = parseEnvelope(readJSON(await file.text()));
    if (data.kind !== "progress")
      throw new Error("A JSON backup must contain progress only.");
    return { data, reader: null, entries: [] };
  }
  const reader = new ZipReader(new BlobReader(file), {
    checkCrc32: true,
    useWebWorkers: false,
  });
  try {
    const entries = await reader.getEntries();
    if (entries.length > 10001)
      throw new Error("Too many files in this backup.");
    const filenames = new Set<string>();
    for (const entry of entries) {
      if (filenames.has(entry.filename))
        throw new Error("Duplicate files in backup.");
      filenames.add(entry.filename);
      if (
        entry.directory ||
        entry.filename.startsWith("/") ||
        entry.filename.includes("..") ||
        entry.uncompressedSize > MAX_CLIP
      )
        throw new Error("Unsupported file or oversized recording in backup.");
    }
    const manifest = entries.find((e) => e.filename === "manifest.json");
    if (
      !manifest ||
      manifest.directory ||
      !manifest.getData ||
      manifest.uncompressedSize > MAX_MANIFEST
    )
      throw new Error("Missing or oversized backup manifest.");
    const data = parseEnvelope(
      readJSON(await manifest.getData(new TextWriter())),
    );
    if (data.kind !== "full")
      throw new Error("A ZIP backup must be a full backup.");
    const wanted = new Set([
      "manifest.json",
      ...data.recordings.filter((r) => r.included).map((r) => r.file!),
    ]);
    if (
      entries.some((e) => !wanted.has(e.filename)) ||
      entries.length !== wanted.size
    )
      throw new Error("Backup files do not match the manifest.");
    for (const row of data.recordings.filter((r) => r.included)) {
      const entry = entries.find((e) => e.filename === row.file);
      if (!entry || entry.uncompressedSize !== row.meta!.size)
        throw new Error(
          "A declared audio file is missing or has a different size.",
        );
    }
    return { data, reader, entries };
  } catch (error) {
    await reader.close();
    throw error;
  }
}
export async function inspectBackup(file: File): Promise<BackupSummary> {
  const source = await openBackup(file);
  try {
    return {
      kind: source.data.kind,
      cards: Object.keys(source.data.progress.cardStates).length,
      sessions: source.data.progress.sessions.length,
      recordings: source.data.recordings.filter((r) => r.included).length,
      missing: source.data.recordings.filter((r) => !r.included).length,
      bytes: file.size,
      exportedAt: source.data.exportedAt,
    };
  } finally {
    await source.reader?.close();
  }
}
async function performRestore(file: File, options: JobOptions) {
  await initialize();
  const old = await setRestoreLock(true);
  const progressGen = crypto.randomUUID();
  const audioGen = crypto.randomUUID();
  let source: Awaited<ReturnType<typeof openBackup>> | undefined;
  let committed = false;
  try {
    source = await openBackup(file);
    abortIfNeeded(options.signal);
    const db = await database();
    await db.put("progress", source.data.progress, progressGen);
    const audio = source.data.recordings.filter((r) => r.included);
    let index = 0;
    if (source.data.kind === "full")
      for (const row of audio) {
        abortIfNeeded(options.signal);
        options.onProgress?.("Restoring recordings", index, audio.length);
        const entry = source.entries.find((e) => e.filename === row.file)!;
        if (entry.directory || !entry.getData)
          throw new Error("An audio file cannot be read.");
        let chunks = 0;
        let size = 0;
        await entry.getData(
          new WritableStream<Uint8Array>({
            async write(decoded) {
              abortIfNeeded(options.signal);
              size += decoded.byteLength;
              if (size > MAX_CLIP || size > row.meta!.size)
                throw new Error("Audio size failed validation.");
              for (
                let offset = 0;
                offset < decoded.byteLength;
                offset += RESTORE_CHUNK_BYTES
              ) {
                abortIfNeeded(options.signal);
                const bytes = new Uint8Array(
                  decoded.subarray(offset, offset + RESTORE_CHUNK_BYTES),
                ).buffer;
                const tx = db.transaction("chunks", "readwrite");
                void tx.done.catch(() => undefined);
                await tx.store.put(bytes, [audioGen, row.id, chunks]);
                await tx.done;
                chunks++;
              }
            },
          }),
          { signal: options.signal },
        );
        if (size !== row.meta!.size)
          throw new Error("Audio size failed validation.");
        abortIfNeeded(options.signal);
        await db.put("recordings", { ...row.meta!, chunks }, [
          audioGen,
          row.id,
        ]);
        index++;
      }
    abortIfNeeded(options.signal);
    const tx = db.transaction("meta", "readwrite");
    void tx.done.catch(() => undefined);
    const current = (await tx.store.get("active"))!;
    if (
      current.progress !== old.progress ||
      current.audio !== old.audio ||
      !current.restoring
    ) {
      tx.abort();
      throw new Error("Study data changed during restore. Please try again.");
    }
    await tx.store.put(
      {
        progress: progressGen,
        audio: source.data.kind === "full" ? audioGen : old.audio,
        restoring: false,
      },
      "active",
    );
    await tx.done;
    committed = true;
    announceChange();
    options.onProgress?.("Restore complete", 1, 1);
    await cleanupGenerations();
  } catch (error) {
    if (committed) return;
    await setRestoreLock(false);
    await cleanupGenerations();
    throw error;
  } finally {
    await source?.reader?.close().catch(() => undefined);
  }
}
export async function restoreBackup(file: File, options: JobOptions = {}) {
  const restore = () => withRecordingIdle(() => performRestore(file, options));
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(
      "japanese-restore",
      { signal: options.signal },
      restore,
    );
  return restore();
}
export async function markExported() {
  await updateProgress((draft) => {
    draft.settings.lastExportAt = Date.now();
  });
}
export async function shareBackup(file: File) {
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Japanese study backup" });
    await markExported();
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  await markExported();
}
