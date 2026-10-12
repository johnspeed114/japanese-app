import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRecordingActive,
  preferredRecordingType,
  startCapture,
} from "../src/audio";
import { japaneseVoice, speechSentences } from "../src/components/SpeechButton";

const storage = vi.hoisted(() => ({
  createRecording: vi.fn(),
  appendRecordingChunk: vi.fn(),
  finishRecording: vi.fn(),
}));
vi.mock("../src/storage", () => storage);

class Track extends EventTarget {
  stop = vi.fn();
}
class Recorder extends EventTarget {
  static last: Recorder;
  static isTypeSupported = vi.fn((type: string) => Boolean(type));
  state: RecordingState = "inactive";
  mimeType: string;
  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    super();
    this.mimeType = options.mimeType ?? "audio/webm";
    Recorder.last = this;
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  data(value = "chunk") {
    this.dispatchEvent(
      Object.assign(new Event("dataavailable"), {
        data: new Blob([value], { type: this.mimeType }),
      }),
    );
  }
  stop() {
    this.state = "inactive";
    this.data("final");
    this.dispatchEvent(new Event("stop"));
  }
}

let track: Track;
let documentMock: EventTarget & { visibilityState: string };
let getUserMedia: ReturnType<typeof vi.fn>;
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const options = () => ({
  sessionId: "session",
  taskId: "task",
  onSaved: vi.fn(),
  onError: vi.fn(),
  onState: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  storage.createRecording.mockResolvedValue(undefined);
  storage.appendRecordingChunk.mockResolvedValue(undefined);
  storage.finishRecording.mockResolvedValue(undefined);
  Recorder.isTypeSupported.mockReturnValue(true);
  track = new Track();
  documentMock = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("MediaRecorder", Recorder);
});
afterEach(async () => {
  if (isRecordingActive()) {
    Recorder.last.stop();
    await flush();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recording lifecycle", () => {
  it("waits for every chunk including the final data before finishing metadata", async () => {
    const writes: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    storage.appendRecordingChunk.mockImplementation(
      async (_id, index: number) => {
        writes.push(`begin ${index}`);
        if (index === 0) await blocked;
        writes.push(`saved ${index}`);
      },
    );
    storage.finishRecording.mockImplementation(async () => {
      writes.push("finished");
    });
    const config = options();
    const capture = await startCapture(config);
    Recorder.last.data("one");
    await flush();
    const stopping = capture.stop();
    await flush();
    expect(storage.finishRecording).not.toHaveBeenCalled();
    expect(isRecordingActive()).toBe(true);
    release();
    await stopping;
    expect(writes).toEqual([
      "begin 0",
      "saved 0",
      "begin 1",
      "saved 1",
      "finished",
    ]);
    expect(storage.finishRecording).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: "complete",
        chunks: 2,
        size: 8,
        interrupted: false,
      }),
    );
    expect(config.onSaved).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(isRecordingActive()).toBe(false);
  });

  it("reports microphone denial and releases the active guard", async () => {
    getUserMedia.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const config = options();
    await expect(startCapture(config)).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expect(config.onError).toHaveBeenCalledWith(
      expect.stringContaining("denied"),
    );
    expect(storage.createRecording).not.toHaveBeenCalled();
    expect(isRecordingActive()).toBe(false);
  });

  it("rejects a second capture while microphone permission is pending", async () => {
    let allow!: (value: unknown) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          allow = resolve;
        }),
    );
    const pending = startCapture(options());
    await expect(startCapture(options())).rejects.toThrow("already running");
    allow({ getTracks: () => [track] });
    await (await pending).stop();
  });

  it("finalizes a hidden-page attempt as interrupted and stops tracks", async () => {
    const capture = await startCapture(options());
    documentMock.visibilityState = "hidden";
    documentMock.dispatchEvent(new Event("visibilitychange"));
    await capture.stop();
    expect(storage.finishRecording).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "interrupted", interrupted: true }),
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(isRecordingActive()).toBe(false);
  });

  it.each(["mute", "ended"])(
    "saves an interrupted attempt when its track emits %s",
    async (event) => {
      const capture = await startCapture(options());
      track.dispatchEvent(new Event(event));
      await capture.stop();
      expect(storage.finishRecording).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ interrupted: true }),
      );
      expect(track.stop).toHaveBeenCalledOnce();
    },
  );

  it("stops after a failed chunk save and reports the storage problem", async () => {
    storage.appendRecordingChunk.mockRejectedValue(
      new DOMException("Full", "QuotaExceededError"),
    );
    const config = options();
    const capture = await startCapture(config);
    Recorder.last.data();
    await flush();
    await capture.stop();
    expect(config.onError).toHaveBeenCalledWith(
      expect.stringContaining("not enough device storage"),
    );
    expect(storage.finishRecording).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ interrupted: true, chunks: 0 }),
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(isRecordingActive()).toBe(false);
  });

  it("does not claim a recording was saved when final metadata cannot be saved", async () => {
    storage.finishRecording.mockRejectedValue(new Error("Write failed"));
    const config = options();
    await (await startCapture(config)).stop();
    expect(config.onSaved).not.toHaveBeenCalled();
    expect(config.onError).toHaveBeenCalledWith("Write failed");
    expect(isRecordingActive()).toBe(false);
  });

  it("stops at 15 minutes and requests five-second chunk emission", async () => {
    const config = options();
    const capture = await startCapture(config);
    expect(Recorder.last.start).toHaveBeenCalledWith(5000);
    vi.advanceTimersByTime(15 * 60 * 1000);
    await capture.stop();
    expect(storage.finishRecording).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ durationMs: 900000, status: "complete" }),
    );
  });

  it("releases a wake lock that arrives after the recording has stopped", async () => {
    let grant!: (lock: unknown) => void;
    const release = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      wakeLock: {
        request: vi.fn(
          () =>
            new Promise((resolve) => {
              grant = resolve;
            }),
        ),
      },
    });
    await (await startCapture(options())).stop();
    grant({ release });
    await flush();
    expect(release).toHaveBeenCalledOnce();
  });

  it("selects a supported type and leaves browser selection available as fallback", () => {
    Recorder.isTypeSupported.mockImplementation(
      (type: string) => type === "audio/mp4",
    );
    expect(preferredRecordingType()).toBe("audio/mp4");
    Recorder.isTypeSupported.mockReturnValue(false);
    expect(preferredRecordingType()).toBeUndefined();
  });
  it("holds a cross-tab recording lock through saving and releases it afterward", async () => {
    let held = false;
    const request = vi.fn(
      async (
        name: string,
        lockOptions: { ifAvailable: boolean },
        callback: (lock: { name: string }) => Promise<void>,
      ) => {
        expect(lockOptions.ifAvailable).toBe(true);
        held = true;
        await callback({ name });
        held = false;
      },
    );
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      locks: { request },
    });
    const capture = await startCapture(options());
    expect(held).toBe(true);
    await capture.stop();
    await flush();
    expect(held).toBe(false);
    expect(request).toHaveBeenCalledWith(
      "japanese-recording",
      { ifAvailable: true },
      expect.any(Function),
    );
  });
  it("does not open the microphone when another tab owns the capture or backup lock", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      locks: {
        request: (...args: unknown[]) =>
          (args[2] as (lock: null) => Promise<void>)(null),
      },
    });
    await expect(startCapture(options())).rejects.toThrow(
      "Another recording or backup",
    );
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(isRecordingActive()).toBe(false);
  });
});

const voice = (lang: string, voiceURI: string, localService: boolean) =>
  ({ lang, voiceURI, localService }) as SpeechSynthesisVoice;
describe("Japanese speech selection", () => {
  it("prefers a local Japanese voice and honors a Japanese voice preference", () => {
    const remote = voice("ja-JP", "remote", false);
    const local = voice("ja-JP", "local", true);
    expect(
      japaneseVoice([voice("en-US", "english", true), remote, local]),
    ).toBe(local);
    expect(japaneseVoice([remote, local], "remote")).toBe(remote);
    expect(japaneseVoice([remote, local], "missing")).toBe(local);
  });
  it("does not substitute an English voice when Japanese voices are missing", () => {
    expect(japaneseVoice([])).toBeUndefined();
    expect(japaneseVoice([voice("en-US", "english", true)])).toBeUndefined();
  });
  it("splits Japanese speech into sentences without dropping punctuation", () => {
    expect(speechSentences("こんにちは。元気ですか？\nそうです！")).toEqual([
      "こんにちは。",
      "元気ですか？",
      "そうです！",
    ]);
  });
});
