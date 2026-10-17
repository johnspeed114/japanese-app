import {
  appendRecordingChunk,
  createRecording,
  finishRecording,
} from "./storage";
import type { RecordingMeta } from "./types";

export type CaptureState = {
  status: "recording" | "saving" | "idle";
  elapsedMs: number;
};
export type CaptureController = {
  stop: () => Promise<void>;
  interrupt: () => Promise<void>;
};
export type CaptureOptions = {
  sessionId: string;
  taskId: string;
  onSaved: (id: string) => void;
  onError: (message: string) => void;
  onState?: (state: CaptureState) => void;
};

let captureActive = false;
export const isRecordingActive = () => captureActive;
const MAX_RECORDING_MS = 15 * 60 * 1000;

export function recordingError(error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was denied. Allow it in your browser settings, or use the typed response.";
  if (name === "NotFoundError")
    return "No microphone was found. Connect one, or use the typed response.";
  if (name === "NotReadableError")
    return "The microphone is busy or unavailable. Close other recording apps and try again, or use the typed response.";
  if (name === "QuotaExceededError")
    return "There is not enough device storage to save this recording. Export a backup and free some space before trying again.";
  return error instanceof Error
    ? error.message
    : "Recording failed. Your typed response remains available.";
}

export function preferredRecordingType(): string | undefined {
  return [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ].find((type) => MediaRecorder.isTypeSupported(type));
}

/** Saves emitted chunks in order; interrupted partial recordings may not be playable. */
export async function startCapture(
  options: CaptureOptions,
): Promise<CaptureController> {
  if (captureActive)
    throw new Error(
      "Another recording is already running. Stop it before starting this one.",
    );
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    const error = new Error(
      "Recording is unavailable here. Open the HTTPS app in a supported browser, or use the typed response.",
    );
    options.onError(error.message);
    throw error;
  }
  captureActive = true;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let recordingId: string | undefined;
  let startedAt = 0;
  let endedAt = 0;
  let interrupted = false;
  let closing = false;
  let finished = false;
  let errorReported = false;
  let saveFailure: unknown;
  let chunks = 0;
  let size = 0;
  let chunkIndex = 0;
  let chain = Promise.resolve();
  let clock: ReturnType<typeof setInterval> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;
  let wakeLock: WakeLockSentinel | undefined;
  let releaseCaptureLock: (() => void) | undefined;
  let complete!: () => void;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const elapsed = () => Math.max(0, (endedAt || Date.now()) - startedAt);
  const report = (error: unknown) => {
    if (!errorReported) {
      errorReported = true;
      options.onError(recordingError(error));
    }
  };
  const clean = () => {
    clearInterval(clock);
    clearTimeout(limit);
    document.removeEventListener("visibilitychange", hidden);
    stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", trackInterrupted);
      track.removeEventListener("mute", trackInterrupted);
      track.stop();
    });
    void wakeLock?.release().catch(() => undefined);
  };
  const finalize = async () => {
    if (finished) return completion;
    finished = true;
    closing = true;
    endedAt ||= Date.now();
    options.onState?.({ status: "saving", elapsedMs: elapsed() });
    clean();
    await chain;
    try {
      if (recordingId) {
        const noAudio = chunks === 0;
        const patch: Partial<RecordingMeta> = {
          status:
            interrupted || saveFailure || noAudio ? "interrupted" : "complete",
          interrupted: interrupted || Boolean(saveFailure) || noAudio,
          durationMs: elapsed(),
          size,
          chunks,
          mimeType: recorder?.mimeType || "",
        };
        await finishRecording(recordingId, patch);
        if (noAudio && !saveFailure)
          report(
            new Error(
              "No audio was captured. Try again, or use the typed response.",
            ),
          );
        options.onSaved(recordingId);
      }
    } catch (error) {
      report(error);
    } finally {
      releaseCaptureLock?.();
      captureActive = false;
      options.onState?.({ status: "idle", elapsedMs: elapsed() });
      complete();
    }
  };
  const stop = (wasInterrupted = false) => {
    interrupted ||= wasInterrupted;
    if (!closing) {
      closing = true;
      endedAt = Date.now();
      clearInterval(clock);
      clearTimeout(limit);
      options.onState?.({ status: "saving", elapsedMs: elapsed() });
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch (error) {
          report(error);
          void finalize();
        }
      } else void finalize();
    }
    return completion;
  };
  function hidden() {
    if (document.visibilityState === "hidden") void stop(true);
  }
  function trackInterrupted() {
    void stop(true);
  }

  try {
    if (navigator.locks) {
      const hold = new Promise<void>((resolve) => {
        releaseCaptureLock = resolve;
      });
      const acquired = await new Promise<boolean>((resolve, reject) => {
        void navigator.locks
          .request(
            "japanese-recording",
            { ifAvailable: true },
            async (lock) => {
              resolve(Boolean(lock));
              if (lock) await hold;
            },
          )
          .catch(reject);
      });
      if (!acquired)
        throw new Error(
          "Another recording or backup is running. Wait for it to finish before starting this one.",
        );
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
      video: false,
    });
    const mimeType = preferredRecordingType();
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32_000,
    });
    recordingId = crypto.randomUUID();
    startedAt = Date.now();
    await createRecording({
      id: recordingId,
      sessionId: options.sessionId,
      taskId: options.taskId,
      mimeType: recorder.mimeType,
      startedAt,
      durationMs: 0,
      size: 0,
      chunks: 0,
      status: "recording",
      interrupted: false,
    });
    const id = recordingId;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size === 0) return;
      const index = chunkIndex++;
      const blob = event.data;
      chain = chain
        .then(async () => {
          if (saveFailure) return;
          await appendRecordingChunk(id, index, blob);
          chunks++;
          size += blob.size;
        })
        .catch((error) => {
          saveFailure = error;
          report(error);
          void stop(true);
        });
    });
    recorder.addEventListener("stop", () => {
      void finalize();
    });
    recorder.addEventListener("error", () => {
      interrupted = true;
      report(
        new Error(
          "Recording was interrupted. Any saved audio is marked as incomplete; you can try again or use the typed response.",
        ),
      );
      // MediaRecorder emits its final dataavailable and stop after an error.
    });
    recorder.start(5_000);
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", trackInterrupted);
      track.addEventListener("mute", trackInterrupted);
    });
    document.addEventListener("visibilitychange", hidden);
    options.onState?.({ status: "recording", elapsedMs: 0 });
    clock = setInterval(
      () => options.onState?.({ status: "recording", elapsedMs: elapsed() }),
      250,
    );
    limit = setTimeout(() => {
      void stop();
    }, MAX_RECORDING_MS);
    if (navigator.wakeLock?.request) {
      void navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (closing || finished) void lock.release().catch(() => undefined);
          else wakeLock = lock;
        })
        .catch(() => undefined);
    }
    if (document.visibilityState === "hidden") void stop(true);
    return { stop: () => stop(), interrupt: () => stop(true) };
  } catch (error) {
    report(error);
    clean();
    if (recordingId) {
      try {
        await finishRecording(recordingId, {
          status: "interrupted",
          interrupted: true,
          durationMs: startedAt ? elapsed() : 0,
        });
      } catch (saveError) {
        report(saveError);
      }
    }
    captureActive = false;
    releaseCaptureLock?.();
    complete();
    throw error;
  }
}
