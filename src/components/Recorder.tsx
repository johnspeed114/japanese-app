import { useEffect, useRef, useState } from "react";
import {
  startCapture,
  recordingError,
  type CaptureController,
  type CaptureState,
} from "../audio";
import { getRecording, getRecordingBlob } from "../storage";
import type { RecordingMeta } from "../types";

type RecorderProps = {
  sessionId: string;
  taskId: string;
  recordingId?: string;
  onSaved: (id: string) => void;
  onUnavailable?: () => void;
  onAvailabilityChange?: (available: boolean) => void;
  disabled?: boolean;
  targetSeconds?: number;
};
const time = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function Recorder({
  sessionId,
  taskId,
  recordingId,
  onSaved,
  onUnavailable,
  onAvailabilityChange,
  disabled,
  targetSeconds,
}: RecorderProps) {
  const [state, setState] = useState<CaptureState>({
    status: "idle",
    elapsedMs: 0,
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [currentId, setCurrentId] = useState(recordingId);
  const [meta, setMeta] = useState<RecordingMeta>();
  const [url, setUrl] = useState("");
  const [unplayable, setUnplayable] = useState(false);
  const controller = useRef<CaptureController | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const callbacks = useRef({ onSaved, onUnavailable, onAvailabilityChange });
  useEffect(() => {
    callbacks.current = { onSaved, onUnavailable, onAvailabilityChange };
  }, [onSaved, onUnavailable, onAvailabilityChange]);
  useEffect(() => {
    generation.current++;
    alive.current = true;
    setState({ status: "idle", elapsedMs: 0 });
    setStarting(false);
    return () => {
      alive.current = false;
      generation.current++;
      void controller.current?.interrupt();
      controller.current = null;
    };
  }, [sessionId, taskId]);
  useEffect(() => {
    setCurrentId(recordingId);
  }, [recordingId, sessionId, taskId]);
  useEffect(() => {
    let live = true;
    let objectUrl = "";
    let loadedMeta: RecordingMeta | undefined;
    let request = 0;
    setMeta(undefined);
    setUrl("");
    setUnplayable(false);
    callbacks.current.onAvailabilityChange?.(false);
    const unavailable = (message: string) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      loadedMeta = undefined;
      setMeta(undefined);
      setUrl("");
      setError(message);
      callbacks.current.onAvailabilityChange?.(false);
    };
    const load = async () => {
      if (!currentId) return;
      const attempt = ++request;
      try {
        const recording = await getRecording(currentId);
        if (!live || attempt !== request) return;
        if (!recording || recording.size === 0) {
          unavailable(
            "This recording has no available audio. Record another attempt, or use your typed response.",
          );
          return;
        }
        // Draft autosaves announce changes too. Avoid rebuilding an unchanged audio URL.
        if (
          objectUrl &&
          loadedMeta &&
          recording.size === loadedMeta.size &&
          recording.chunks === loadedMeta.chunks &&
          recording.status === loadedMeta.status
        ) {
          callbacks.current.onAvailabilityChange?.(true);
          return;
        }
        const blob = await getRecordingBlob(currentId);
        if (!live || attempt !== request) return;
        if (!blob || blob.size === 0) {
          unavailable(
            "This recording has no available audio. Record another attempt, or use your typed response.",
          );
          return;
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        loadedMeta = recording;
        setMeta(recording);
        setUrl(objectUrl);
        setError("");
        callbacks.current.onAvailabilityChange?.(true);
      } catch (error) {
        if (live && attempt === request) unavailable(recordingError(error));
      }
    };
    const refresh = () => {
      void load();
    };
    void load();
    window.addEventListener("study-change", refresh);
    return () => {
      live = false;
      window.removeEventListener("study-change", refresh);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentId]);

  const start = async () => {
    const token = generation.current;
    const current = () => alive.current && token === generation.current;
    const savedCallback = callbacks.current.onSaved;
    const unavailableCallback = callbacks.current.onUnavailable;
    setError("");
    setStarting(true);
    try {
      const capture = await startCapture({
        sessionId,
        taskId,
        onState: (next) => {
          if (current()) setState(next);
        },
        onError: (message) => {
          if (current()) setError(message);
        },
        onSaved: (id) => {
          if (current()) {
            controller.current = null;
            setCurrentId(id);
          }
          savedCallback(id);
        },
      });
      if (current()) controller.current = capture;
      else void capture.interrupt();
    } catch (error) {
      if (current()) {
        setError(recordingError(error));
        unavailableCallback?.();
      }
    } finally {
      if (current()) setStarting(false);
    }
  };
  const busy = starting || state.status !== "idle";
  return (
    <div className="recorder panel">
      <div className="recorder-controls">
        {state.status === "recording" ? (
          <button
            className="button"
            type="button"
            onClick={() => {
              void controller.current?.stop();
            }}
          >
            Stop and save
          </button>
        ) : (
          <button
            className="button"
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              void start();
            }}
          >
            {starting
              ? "Opening microphone…"
              : state.status === "saving"
                ? "Saving audio…"
                : currentId
                  ? "Record another attempt"
                  : "Record response"}
          </button>
        )}
        <span aria-live="off">
          {time(
            state.status === "idle" && meta ? meta.durationMs : state.elapsedMs,
          )}
          {targetSeconds ? ` / target ${time(targetSeconds * 1000)}` : ""}
        </span>
      </div>
      {state.status === "recording" && (
        <p className="muted">
          Keep this app open while recording. Recordings stop after 15 minutes.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {meta?.interrupted && (
        <p className="muted">
          Interrupted recording. Saved portions may not play; record another
          attempt if needed.
        </p>
      )}
      {url && (
        <>
          <audio
            controls
            preload="metadata"
            src={url}
            onError={() => setUnplayable(true)}
            aria-label="Your recorded response"
          />
          {unplayable && (
            <p className="error">
              This device cannot play this recording format. Try the device that
              recorded it, or download the audio for another player.
            </p>
          )}
          <a
            className="button secondary"
            href={url}
            download={`${taskId}.${meta?.mimeType.includes("mp4") ? "m4a" : meta?.mimeType.includes("ogg") ? "ogg" : "webm"}`}
          >
            Download this recording
          </a>
        </>
      )}
    </div>
  );
}
