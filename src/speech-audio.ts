import { speechSentences, speechTextKey } from "./speech-text.ts";

export { speechSentences, speechTextKey } from "./speech-text.ts";

export type SpeechClip = { text: string; file: string };
export type SpeechManifest = {
  version: 1;
  model: string;
  voice: string;
  generatedAt: string;
  entries: Record<string, readonly SpeechClip[]>;
};
export type SpeechPlaybackState = {
  source: "ai" | "device";
  status: "playing" | "ended" | "stopped" | "error";
  message?: string;
  remote?: boolean;
};
export type SpeechPlaybackController = { stop(): void };
type StateCallback = (state: SpeechPlaybackState) => void;
let activePlayback: SpeechPlaybackController | undefined;

export function resolveSpeechClips(
  input: string,
  manifest: Pick<SpeechManifest, "version" | "entries">,
): readonly SpeechClip[] | undefined {
  const clips = manifest.entries[speechTextKey(input)];
  return manifest.version === 1 &&
    Array.isArray(clips) &&
    clips.length > 0 &&
    clips.every(
      (clip) => clip.text.trim() && /^speech\/[\w/-]+\.mp3$/.test(clip.file),
    )
    ? clips
    : undefined;
}

export function japaneseVoice(
  voices: SpeechSynthesisVoice[],
  voiceURI?: string,
): SpeechSynthesisVoice | undefined {
  const japanese = voices.filter((voice) => /^ja(?:-|$)/i.test(voice.lang));
  return (
    japanese.find((voice) => voice.voiceURI === voiceURI) ??
    japanese.find((voice) => voice.localService) ??
    japanese[0]
  );
}

function claimPlayback(
  source: SpeechPlaybackState["source"],
  onState: StateCallback,
  cleanup: () => void,
) {
  activePlayback?.stop();
  let closed = false;
  const controller: SpeechPlaybackController = {
    stop: () => finish({ status: "stopped" }),
  };
  const current = () => !closed && activePlayback === controller;
  const finish = (state: Omit<SpeechPlaybackState, "source">) => {
    if (closed) return;
    closed = true;
    if (activePlayback === controller) activePlayback = undefined;
    if (typeof window !== "undefined")
      window.removeEventListener("hashchange", controller.stop);
    cleanup();
    onState({ source, ...state });
  };
  activePlayback = controller;
  if (typeof window !== "undefined")
    window.addEventListener("hashchange", controller.stop);
  return {
    controller,
    current,
    finish,
    update: (state: Omit<SpeechPlaybackState, "source">) => {
      if (current()) onState({ source, ...state });
    },
  };
}

export function playJapaneseAudio({
  clips,
  baseURL,
  onState,
}: {
  clips: readonly SpeechClip[];
  baseURL: string;
  onState: StateCallback;
}): SpeechPlaybackController {
  let audio: HTMLAudioElement | undefined;
  let index = 0;
  const playback = claimPlayback("ai", onState, () => {
    if (!audio) return;
    audio.removeEventListener("ended", ended);
    audio.removeEventListener("error", failed);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  });
  const failed = () => {
    if (playback.current())
      playback.finish({
        status: "error",
        message:
          "The AI-generated Japanese voice could not play here. Try again, or choose device voice.",
      });
  };
  const next = () => {
    if (!playback.current()) return;
    const clip = clips[index];
    if (!clip) {
      playback.finish({ status: "ended" });
      return;
    }
    const attempt = index;
    audio!.src = `${baseURL.replace(/\/?$/, "/")}${clip.file}`;
    try {
      void Promise.resolve(audio!.play()).then(
        () => {
          if (playback.current() && attempt === index)
            playback.update({ status: "playing" });
        },
        () => {
          if (playback.current() && attempt === index) failed();
        },
      );
    } catch {
      failed();
    }
  };
  function ended() {
    if (playback.current()) {
      index++;
      next();
    }
  }
  if (typeof Audio === "undefined" || clips.length === 0) failed();
  else {
    try {
      // Reuse the element so sentence playback retains the original tap's audio permission.
      audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      audio.addEventListener("ended", ended);
      audio.addEventListener("error", failed);
      next();
    } catch {
      failed();
    }
  }
  return playback.controller;
}

export function playDeviceSpeech({
  text,
  voiceURI,
  onState,
}: {
  text: string;
  voiceURI?: string;
  onState: StateCallback;
}): SpeechPlaybackController {
  let utterance: SpeechSynthesisUtterance | undefined;
  const synthesis =
    typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const playback = claimPlayback("device", onState, () => {
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    utterance = undefined;
    synthesis?.cancel();
  });
  const voice = synthesis
    ? japaneseVoice(synthesis.getVoices(), voiceURI)
    : undefined;
  if (!synthesis || typeof SpeechSynthesisUtterance === "undefined" || !voice) {
    playback.finish({
      status: "error",
      message:
        "No Japanese device voice is available. Install a Japanese speech voice in your device settings, or read the text aloud.",
    });
    return playback.controller;
  }
  const sentences = speechSentences(text);
  const next = (index: number) => {
    if (!playback.current()) return;
    const sentence = sentences[index];
    if (!sentence) {
      playback.finish({ status: "ended" });
      return;
    }
    utterance = new SpeechSynthesisUtterance(sentence);
    utterance.voice = voice;
    utterance.lang = "ja-JP";
    utterance.rate = 0.9;
    utterance.onend = () => next(index + 1);
    utterance.onerror = (event) => {
      if (!playback.current()) return;
      playback.finish(
        event.error === "canceled" || event.error === "interrupted"
          ? { status: "stopped" }
          : {
              status: "error",
              message:
                "Device voice playback failed. Try again, or read the text aloud. Some device voices need an internet connection.",
            },
      );
    };
    playback.update({ status: "playing", remote: !voice.localService });
    try {
      synthesis.speak(utterance);
    } catch {
      playback.finish({
        status: "error",
        message:
          "Device voice playback failed. Try again, or read the text aloud.",
      });
    }
  };
  next(0);
  return playback.controller;
}
