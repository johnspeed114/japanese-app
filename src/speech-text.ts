import { plainJapanese } from "./japanese.ts";

export function speechTextKey(input: string): string {
  return plainJapanese(input).replace(/\s+/gu, " ").trim();
}

export function speechSentences(input: string): string[] {
  return (
    speechTextKey(input)
      .match(/[^。！？!?]+(?:[。！？!?]+[」』”’]*|$)/gu)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? []
  );
}
