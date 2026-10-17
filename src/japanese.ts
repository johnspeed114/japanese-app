export type JapaneseSegment = { text: string; reading?: string };
export type JapaneseGlossaryEntry = {
  id: string;
  term: string;
  meaning: string;
};
export type JapaneseGlossarySpan = {
  text: string;
  entry?: JapaneseGlossaryEntry;
};

export function japaneseGlossarySpans(
  value: string,
  glossary: readonly JapaneseGlossaryEntry[],
): JapaneseGlossarySpan[] {
  const entries = glossary
    .filter((entry) => entry.term.length > 0)
    .sort((a, b) => b.term.length - a.term.length);
  const spans: JapaneseGlossarySpan[] = [];
  let plain = "";
  const flush = () => {
    if (plain) spans.push({ text: plain });
    plain = "";
  };
  for (let offset = 0; offset < value.length;) {
    const entry = entries.find((entry) => value.startsWith(entry.term, offset));
    if (entry) {
      flush();
      spans.push({ text: entry.term, entry });
      offset += entry.term.length;
      continue;
    }
    // Keep an unmatched ruby token intact; glossary terms must not match its reading.
    const rubyEnd = value.startsWith("[[", offset)
      ? value.indexOf("]]", offset + 2)
      : -1;
    const end = rubyEnd >= 0 ? rubyEnd + 2 : offset + 1;
    plain += value.slice(offset, end);
    offset = end;
  }
  flush();
  return spans;
}

export function japaneseSegments(value: string): JapaneseSegment[] {
  const parts: JapaneseSegment[] = [];
  const pattern = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor)
      parts.push({ text: value.slice(cursor, match.index) });
    parts.push({ text: match[1], reading: match[2] });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts;
}
export function plainJapanese(value: string): string {
  return japaneseSegments(value)
    .map((part) => part.text)
    .join("");
}
export function hasCompleteReadings(value: string): boolean {
  return japaneseSegments(value).every(
    (part) => !/[\p{Script=Han}々]/u.test(part.text) || Boolean(part.reading),
  );
}
export function isCompositionKey(
  event: { isComposing?: boolean; keyCode?: number },
  composing = false,
): boolean {
  return composing || Boolean(event.isComposing) || event.keyCode === 229;
}
