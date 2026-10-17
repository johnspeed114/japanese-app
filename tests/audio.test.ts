import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRecordingActive,
  preferredRecordingType,
  startCapture,
} from "../src/audio";
import { japaneseVoice, speechSentences } from "../src/components/SpeechButton";
import {
  playDeviceSpeech,
  playJapaneseAudio,
  resolveSpeechClips,
  speechTextKey,
} from "../src/speech-audio";
import type {
  SpeechClip,
  SpeechManifest,
  SpeechPlaybackController,
} from "../src/speech-audio";

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

const clips: readonly SpeechClip[] = [
  { text: "こんにちは。", file: "speech/hello.mp3" },
  { text: "元気ですか？", file: "speech/question.mp3" },
  { text: "また会いましょう。", file: "speech/goodbye.mp3" },
];
const manifest = (entries: SpeechManifest["entries"]): SpeechManifest => ({
  version: 1,
  model: "test-model",
  voice: "test-voice",
  generatedAt: "2026-10-13T00:00:00.000Z",
  entries,
});

describe("prerecorded Japanese speech lookup", () => {
  it("uses plain ruby text and normalized whitespace while preserving exact wording", () => {
    const spoken = [{ text: "御社 の製品ですか？", file: "speech/question.mp3" }];
    const catalog = manifest({ "御社 の製品ですか？": spoken });
    expect(
      resolveSpeechClips("\n[[御社|おんしゃ]]\t の製品ですか？  ", catalog),
    ).toBe(spoken);
    expect(resolveSpeechClips("御社 の製品ですか。", catalog)).toBeUndefined();
    expect(resolveSpeechClips("御社 の製品ですか？追加", catalog)).toBeUndefined();
    expect(speechTextKey("ＡＩです！")).toBe("ＡＩです！");
  });
  it("resolves a spoken override independently of the displayed wording", () => {
    const display = "今日は[[製品|せいひん]]を見せてください。";
    const override = "今日は製品を紹介してください。";
    const spoken = [{ text: override, file: "speech/override.mp3" }];
    const catalog = manifest({ [override]: spoken });
    expect(resolveSpeechClips(override, catalog)).toBe(spoken);
    expect(resolveSpeechClips(display, catalog)).toBeUndefined();
  });
  it("keeps punctuation groups and closing quotes with their spoken sentence", () => {
    expect(
      speechSentences("「[[製品|せいひん]]ですか？！」\n『はい！！』 続きです。"),
    ).toEqual(["「製品ですか？！」", "『はい！！』", "続きです。"]);
  });
});

class PlaybackAudio extends EventTarget {
  static instances: PlaybackAudio[] = [];
  static attempts: (() => Promise<void>)[] = [];
  src = "";
  preload = "";
  playedFiles: string[] = [];
  play = vi.fn(() => {
    this.playedFiles.push(this.src);
    return (PlaybackAudio.attempts.shift() ?? (() => Promise.resolve()))();
  });
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  removeEventListener = vi.fn(
    (
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      eventOptions?: EventListenerOptions | boolean,
    ) => super.removeEventListener(type, callback, eventOptions),
  );
  constructor() {
    super();
    PlaybackAudio.instances.push(this);
  }
}
class DeviceUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  onend: ((event: SpeechSynthesisEvent) => unknown) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => unknown) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
const endUtterance = (utterance: DeviceUtterance) =>
  utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
const speechError = (error: SpeechSynthesisErrorCode) =>
  Object.assign(new Event("error"), { error }) as SpeechSynthesisErrorEvent;

describe("Japanese speech playback", () => {
  const baseURL = "https://study.example/japanese-app/";
  const local = voice("ja-JP", "local", true);
  const remote = voice("ja-JP", "remote", false);
  let windowMock: EventTarget;
  let synthesis: {
    getVoices: ReturnType<typeof vi.fn<() => SpeechSynthesisVoice[]>>;
    speak: ReturnType<typeof vi.fn<(utterance: DeviceUtterance) => void>>;
    cancel: ReturnType<typeof vi.fn<() => void>>;
  };
  let controllers: SpeechPlaybackController[];
  const own = (controller: SpeechPlaybackController) => {
    controllers.push(controller);
    return controller;
  };
  beforeEach(() => {
    PlaybackAudio.instances = [];
    PlaybackAudio.attempts = [];
    controllers = [];
    synthesis = {
      getVoices: vi.fn(() => [remote, local]),
      speak: vi.fn(),
      cancel: vi.fn(),
    };
    windowMock = Object.assign(new EventTarget(), { speechSynthesis: synthesis });
    vi.stubGlobal("window", windowMock);
    vi.stubGlobal("Audio", PlaybackAudio);
    vi.stubGlobal("SpeechSynthesisUtterance", DeviceUtterance);
  });
  afterEach(() => {
    for (const controller of controllers) controller.stop();
  });

  it("starts on request and plays the manifest's sentence order through one audio element", async () => {
    const spoken = "こんにちは。元気ですか？また会いましょう。";
    const playlist = resolveSpeechClips(spoken, manifest({ [spoken]: clips }))!;
    expect(PlaybackAudio.instances).toHaveLength(0);
    const onState = vi.fn();
    own(playJapaneseAudio({ clips: playlist, baseURL, onState }));
    await flush();
    expect(PlaybackAudio.instances).toHaveLength(1);
    const audio = PlaybackAudio.instances[0];
    expect(audio.playedFiles).toEqual([`${baseURL}speech/hello.mp3`]);
    expect(onState).toHaveBeenLastCalledWith({ source: "ai", status: "playing" });
    audio.dispatchEvent(new Event("ended"));
    await flush();
    expect(audio.playedFiles).toEqual([
      `${baseURL}speech/hello.mp3`,
      `${baseURL}speech/question.mp3`,
    ]);
    audio.dispatchEvent(new Event("ended"));
    await flush();
    expect(audio.playedFiles).toEqual(clips.map((clip) => `${baseURL}${clip.file}`));
    audio.dispatchEvent(new Event("ended"));
    expect(onState).toHaveBeenLastCalledWith({ source: "ai", status: "ended" });
    expect(
      onState.mock.calls.filter(([state]) => state.status === "ended"),
    ).toHaveLength(1);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalledOnce();
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it.each(["stop", "hashchange"])(
    "stops the playlist on %s and removes handlers before later media events",
    async (reason) => {
      const onState = vi.fn();
      const controller = own(playJapaneseAudio({ clips, baseURL, onState }));
      await flush();
      const audio = PlaybackAudio.instances[0];
      if (reason === "stop") controller.stop();
      else windowMock.dispatchEvent(new Event("hashchange"));
      expect(onState).toHaveBeenLastCalledWith({ source: "ai", status: "stopped" });
      expect(audio.removeEventListener).toHaveBeenCalledWith(
        "ended", expect.any(Function),
      );
      expect(audio.removeEventListener).toHaveBeenCalledWith(
        "error", expect.any(Function),
      );
      expect(audio.pause).toHaveBeenCalledOnce();
      expect(audio.src).toBe("");
      expect(audio.load).toHaveBeenCalledOnce();
      const states = onState.mock.calls.length;
      audio.dispatchEvent(new Event("ended"));
      audio.dispatchEvent(new Event("error"));
      controller.stop();
      await flush();
      expect(onState).toHaveBeenCalledTimes(states);
      expect(audio.play).toHaveBeenCalledOnce();
      expect(audio.pause).toHaveBeenCalledOnce();
    },
  );

  it.each(["resolve", "reject"])(
    "ignores an old play promise's %s after a new audio player takes ownership",
    async (settlement) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      PlaybackAudio.attempts.push(
        () => new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
      );
      const oldState = vi.fn();
      const old = own(playJapaneseAudio({ clips, baseURL, onState: oldState }));
      const newState = vi.fn();
      own(playJapaneseAudio({ clips: [clips[1]], baseURL, onState: newState }));
      await flush();
      expect(oldState).toHaveBeenLastCalledWith({ source: "ai", status: "stopped" });
      const oldCalls = oldState.mock.calls.length;
      const newCalls = newState.mock.calls.length;
      if (settlement === "resolve") resolve();
      else reject(new Error("Old media request failed"));
      old.stop();
      PlaybackAudio.instances[0].dispatchEvent(new Event("ended"));
      await flush();
      expect(oldState).toHaveBeenCalledTimes(oldCalls);
      expect(newState).toHaveBeenCalledTimes(newCalls);
      expect(PlaybackAudio.instances[1].pause).not.toHaveBeenCalled();
      expect(PlaybackAudio.instances[1].src).toBe(`${baseURL}speech/question.mp3`);
    },
  );

  it("ignores a previous sentence's rejected play promise after the playlist advances", async () => {
    let reject!: (error: Error) => void;
    PlaybackAudio.attempts.push(
      () => new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
    );
    const onState = vi.fn();
    own(playJapaneseAudio({ clips, baseURL, onState }));
    const audio = PlaybackAudio.instances[0];
    audio.dispatchEvent(new Event("ended"));
    await flush();
    reject(new Error("Previous sentence failed late"));
    await flush();
    expect(onState).toHaveBeenLastCalledWith({ source: "ai", status: "playing" });
    expect(
      onState.mock.calls.some(([state]) => state.status === "error"),
    ).toBe(false);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.src).toBe(`${baseURL}speech/question.mp3`);
  });

  it.each(["reject", "throw", "media-error"])(
    "reports %s clearly without automatically switching to device voice",
    async (failure) => {
      if (failure !== "media-error")
        PlaybackAudio.attempts.push(() => {
          if (failure === "throw") throw new Error("Cannot play audio");
          return Promise.reject(
            new DOMException("Playback denied", "NotAllowedError"),
          );
        });
      const onState = vi.fn();
      own(playJapaneseAudio({ clips, baseURL, onState }));
      const audio = PlaybackAudio.instances[0];
      if (failure === "media-error") audio.dispatchEvent(new Event("error"));
      await flush();
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source: "ai",
          status: "error",
          message: expect.stringMatching(/device voice/i),
        }),
      );
      audio.dispatchEvent(new Event("ended"));
      expect(audio.play).toHaveBeenCalledOnce();
      expect(audio.pause).toHaveBeenCalledOnce();
      expect(audio.src).toBe("");
      expect(synthesis.speak).not.toHaveBeenCalled();
      expect(PlaybackAudio.instances).toHaveLength(1);
    },
  );

  it("reports unavailable audio playback without starting browser speech", () => {
    vi.stubGlobal("Audio", undefined);
    const onState = vi.fn();
    own(playJapaneseAudio({ clips, baseURL, onState }));
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "ai",
        status: "error",
        message: expect.any(String),
      }),
    );
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it("plays prerecordings when the browser has no device speech API", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    const onState = vi.fn();
    own(playJapaneseAudio({ clips, baseURL, onState }));
    await flush();
    expect(onState).toHaveBeenLastCalledWith({ source: "ai", status: "playing" });
    expect(PlaybackAudio.instances[0].playedFiles).toEqual([
      `${baseURL}speech/hello.mp3`,
    ]);
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it.each([undefined, "remote"])(
    "plays device sentences in order using Japanese voice preference %s",
    (voiceURI) => {
      const onState = vi.fn();
      own(
        playDeviceSpeech({
          text: "「[[製品|せいひん]]ですか？！」\n『はい！！』 続きです。",
          voiceURI,
          onState,
        }),
      );
      expect(synthesis.speak).toHaveBeenCalledOnce();
      const first = synthesis.speak.mock.calls[0][0];
      expect(first.text).toBe("「製品ですか？！」");
      expect(first.voice).toBe(voiceURI ? remote : local);
      expect(first.lang).toBe("ja-JP");
      expect(onState).toHaveBeenLastCalledWith({
        source: "device",
        status: "playing",
        remote: Boolean(voiceURI),
      });
      endUtterance(first);
      expect(synthesis.speak).toHaveBeenCalledTimes(2);
      endUtterance(synthesis.speak.mock.calls[1][0]);
      expect(
        synthesis.speak.mock.calls.map(([utterance]) => utterance.text),
      ).toEqual(["「製品ですか？！」", "『はい！！』", "続きです。"]);
      endUtterance(synthesis.speak.mock.calls[2][0]);
      expect(onState).toHaveBeenLastCalledWith({ source: "device", status: "ended" });
      expect(PlaybackAudio.instances).toHaveLength(0);
    },
  );

  it.each([
    { voices: [] },
    { voices: [voice("en-US", "english", true)] },
  ])(
    "reports missing Japanese device voices without substituting other languages: %j",
    ({ voices }) => {
      synthesis.getVoices.mockReturnValue(voices);
      const onState = vi.fn();
      own(playDeviceSpeech({ text: "こんにちは。", onState }));
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source: "device",
          status: "error",
          message: expect.stringMatching(/Japanese.*voice/i),
        }),
      );
      expect(synthesis.speak).not.toHaveBeenCalled();
      expect(PlaybackAudio.instances).toHaveLength(0);
    },
  );

  it.each(["network", "canceled", "interrupted"] as const)(
    "finishes device playback on %s without queueing another sentence",
    (failure) => {
      const onState = vi.fn();
      own(playDeviceSpeech({ text: "一つ目です。二つ目です。", onState }));
      const utterance = synthesis.speak.mock.calls[0][0];
      const lateEnd = utterance.onend!;
      utterance.onerror?.(speechError(failure));
      expect(onState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source: "device",
          status: failure === "network" ? "error" : "stopped",
        }),
      );
      if (failure === "network")
        expect(onState.mock.lastCall?.[0].message).toMatch(/failed/i);
      lateEnd(new Event("end") as SpeechSynthesisEvent);
      expect(synthesis.speak).toHaveBeenCalledOnce();
      expect(utterance.onend).toBeNull();
      expect(utterance.onerror).toBeNull();
      expect(PlaybackAudio.instances).toHaveLength(0);
    },
  );

  it("stops device speech on navigation and ignores its old sentence callback", () => {
    const onState = vi.fn();
    own(playDeviceSpeech({ text: "一つ目です。二つ目です。", onState }));
    const lateEnd = synthesis.speak.mock.calls[0][0].onend!;
    windowMock.dispatchEvent(new Event("hashchange"));
    expect(onState).toHaveBeenLastCalledWith({ source: "device", status: "stopped" });
    lateEnd(new Event("end") as SpeechSynthesisEvent);
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(synthesis.cancel).toHaveBeenCalledOnce();
  });

  it("shares ownership between AI and device speech while stale cleanup leaves the new player alone", async () => {
    const firstState = vi.fn();
    const first = own(
      playDeviceSpeech({ text: "一つ目です。二つ目です。", onState: firstState }),
    );
    const lateEnd = synthesis.speak.mock.calls[0][0].onend!;
    const audioState = vi.fn();
    const audioController = own(
      playJapaneseAudio({ clips, baseURL, onState: audioState }),
    );
    await flush();
    expect(firstState).toHaveBeenLastCalledWith({ source: "device", status: "stopped" });
    first.stop();
    lateEnd(new Event("end") as SpeechSynthesisEvent);
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(PlaybackAudio.instances[0].pause).not.toHaveBeenCalled();
    const newState = vi.fn();
    own(playDeviceSpeech({ text: "新しい文です。", onState: newState }));
    expect(audioState).toHaveBeenLastCalledWith({ source: "ai", status: "stopped" });
    audioController.stop();
    PlaybackAudio.instances[0].dispatchEvent(new Event("ended"));
    expect(synthesis.cancel).toHaveBeenCalledOnce();
    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(newState).toHaveBeenLastCalledWith({
      source: "device", status: "playing", remote: false,
    });
  });
});
