import { useEffect, useRef, useState } from "react";
import { plainJapanese } from "../japanese";

type SpeechButtonProps = {
  text: string;
  speechText?: string;
  voiceURI?: string;
  label?: string;
  disabled?: boolean;
};
let activeSpeechSequence = 0;

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

export function speechSentences(text: string): string[] {
  return (
    text
      .match(/[^。！？!?\n]+[。！？!?]?/g)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? []
  );
}

export function SpeechButton({
  text,
  speechText,
  voiceURI,
  label = "Listen",
  disabled,
}: SpeechButtonProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const ownsSpeech = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
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
    const cancel = () => {
      if (ownsSpeech.current && sequence.current === activeSpeechSequence) {
        activeSpeechSequence++;
        window.speechSynthesis.cancel();
      }
      ownsSpeech.current = false;
      utteranceRef.current = null;
      if (mounted.current) setSpeaking(false);
    };
    window.addEventListener("hashchange", cancel);
    return () => {
      mounted.current = false;
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
      window.removeEventListener("hashchange", cancel);
      cancel();
    };
  }, [supported]);

  const play = () => {
    if (!supported) return;
    const token = ++activeSpeechSequence;
    sequence.current = token;
    window.speechSynthesis.cancel();
    ownsSpeech.current = false;
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const voice = japaneseVoice(window.speechSynthesis.getVoices(), voiceURI);
    if (!voice) {
      setError(
        "No Japanese voice is available. Install a Japanese speech voice in your device settings, or read the text aloud.",
      );
      return;
    }
    const sentences = speechSentences(plainJapanese(speechText ?? text));
    if (sentences.length === 0) return;
    setError("");
    setSpeaking(true);
    ownsSpeech.current = true;
    const next = (index: number) => {
      if (token !== activeSpeechSequence || !mounted.current) return;
      const sentence = sentences[index];
      if (!sentence) {
        ownsSpeech.current = false;
        utteranceRef.current = null;
        setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(sentence);
      utteranceRef.current = utterance;
      utterance.voice = voice;
      utterance.lang = "ja-JP";
      utterance.rate = 0.9;
      utterance.onend = () => next(index + 1);
      utterance.onerror = (event) => {
        if (token !== sequence.current || !mounted.current) return;
        ownsSpeech.current = false;
        utteranceRef.current = null;
        setSpeaking(false);
        if (event.error !== "canceled" && event.error !== "interrupted")
          setError(
            "Japanese speech playback failed. Try again, or read the text aloud. Some device voices need an internet connection.",
          );
      };
      window.speechSynthesis.speak(utterance);
    };
    next(0);
  };
  const voice = japaneseVoice(voices, voiceURI);
  return (
    <span className="speech-controls">
      <button
        className="button secondary"
        type="button"
        disabled={disabled || !supported}
        onClick={play}
      >
        {speaking ? "Stop listening" : label}
      </button>
      {!supported && (
        <span className="muted">
          Speech playback is unavailable in this browser.
        </span>
      )}
      {supported && voices.length > 0 && !voice && (
        <span className="muted">No Japanese voice is installed.</span>
      )}
      {voice && !voice.localService && (
        <span className="muted">This voice may need internet access.</span>
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
