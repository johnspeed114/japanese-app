import { useEffect, useRef, useState } from "react";
import { entries, version } from "../content/speech-manifest.json";
import {
  japaneseVoice,
  playDeviceSpeech,
  playJapaneseAudio,
  resolveSpeechClips,
  speechTextKey,
  type SpeechManifest,
  type SpeechPlaybackController,
  type SpeechPlaybackState,
} from "../speech-audio";

export { japaneseVoice, speechSentences } from "../speech-audio";

type SpeechButtonProps = {
  text: string;
  speechText?: string;
  voiceURI?: string;
  label?: string;
  disabled?: boolean;
};
const manifest = { entries, version } as Pick<SpeechManifest, "version" | "entries">;

export function SpeechButton({
  text,
  speechText,
  voiceURI,
  label = "Listen",
  disabled,
}: SpeechButtonProps) {
  const input = speechText ?? text;
  const key = speechTextKey(input);
  const clips = resolveSpeechClips(input, manifest);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [deviceFallback, setDeviceFallback] = useState(false);
  const controller = useRef<SpeechPlaybackController | undefined>(undefined);
  const mounted = useRef(true);
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => {
    mounted.current = true;
    if (!supported)
      return () => {
        mounted.current = false;
      };
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      mounted.current = false;
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
    };
  }, [supported]);
  useEffect(() => {
    setSpeaking(false);
    setError("");
    setDeviceFallback(false);
    return () => controller.current?.stop();
  }, [key, voiceURI]);

  const onState = (state: SpeechPlaybackState) => {
    if (!mounted.current) return;
    setSpeaking(state.status === "playing");
    if (state.status === "error")
      setError(state.message ?? "Speech playback failed.");
  };
  const play = (forceDevice = false) => {
    if (speaking && !forceDevice) {
      controller.current?.stop();
      setSpeaking(false);
      return;
    }
    controller.current?.stop();
    const device = forceDevice || deviceFallback || !clips;
    setError("");
    setDeviceFallback(device);
    setSpeaking(true);
    controller.current = device
      ? playDeviceSpeech({ text: input, voiceURI, onState })
      : playJapaneseAudio({
          clips,
          baseURL: import.meta.env.BASE_URL,
          onState,
        });
  };
  const device = !clips || deviceFallback;
  const voice = japaneseVoice(voices, voiceURI);
  return (
    <span className="speech-controls">
      <button
        className="button secondary"
        type="button"
        disabled={disabled || (!clips && !supported)}
        onClick={() => play()}
      >
        {speaking ? "Stop listening" : label}
      </button>
      <span className="muted">
        {device ? "Device voice" : "AI-generated Japanese voice"}
      </span>
      {!clips && (
        <span className="muted">No saved AI-generated clip for this text.</span>
      )}
      {device && !supported && (
        <span className="muted">
          Device speech is unavailable in this browser.
        </span>
      )}
      {device && supported && voices.length > 0 && !voice && (
        <span className="muted">No Japanese voice is installed.</span>
      )}
      {device && voice && !voice.localService && (
        <span className="muted">
          This device voice may need internet access.
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      {error && clips && !device && (
        <button
          className="button secondary"
          type="button"
          disabled={disabled || !supported}
          onClick={() => play(true)}
        >
          Use device voice
        </button>
      )}
    </span>
  );
}
