import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  japaneseGlossarySpans,
  japaneseSegments,
  plainJapanese,
  isCompositionKey,
} from "../japanese";
import { ISSUE_TAGS } from "../types";
import type { IssueTag, SelfRating, Session } from "../types";
import { useStudy } from "../study-context";
import { dateInZone } from "../engine";
export const ISSUE_LABELS: Record<IssueTag, string> = {
  "vocabulary-recall": "Vocabulary recall",
  "grammar-form": "Grammar form",
  "kanji-reading": "Kanji reading",
  "missing-na": "Missing な",
  "katakana-spelling": "Katakana spelling",
  "long-vowels": "Long vowels",
  honorific: "Honorific forms",
  humble: "Humble forms",
  register: "Politeness / register",
  naturalness: "Naturalness",
};
export const PHASE_LABELS = {
  reactivation: "Reactivation",
  core: "Core rebuild",
  business: "Workplace Japanese",
  trip: "Trip rehearsal",
};
export function Japanese({
  text,
  furigana = false,
  glossary,
  onLookup,
  lookedUp = [],
}: {
  text: string;
  furigana?: boolean;
  glossary?: { id: string; term: string; meaning: string }[];
  onLookup?: (id: string) => void;
  lookedUp?: string[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const spans = japaneseGlossarySpans(
    text,
    glossary && onLookup ? glossary : [],
  );
  const renderText = (value: string): ReactNode =>
    japaneseSegments(value).map((part, index) => (
      <span key={index}>
        {part.reading && furigana ? (
          <ruby>
            {part.text}
            <rt>{part.reading}</rt>
          </ruby>
        ) : (
          part.text
        )}
      </span>
    ));
  return (
    <span lang="ja" className="japanese">
      {spans.map((part, index) => {
        const entry = part.entry;
        if (entry && onLookup) {
          const occurrence = `${entry.id}:${index}`;
          return (
            <span key={index} className="gloss-wrap">
              <button
                type="button"
                className={`gloss ${lookedUp.includes(entry.id) ? "seen" : ""}`}
                onClick={() => {
                  setOpen(open === occurrence ? null : occurrence);
                  onLookup(entry.id);
                }}
                aria-label={`Look up ${plainJapanese(part.text)}`}
              >
                <Japanese text={part.text} furigana={furigana} />
              </button>
              {open === occurrence && (
                <span className="gloss-note" lang="en">
                  {entry.meaning}
                </span>
              )}
            </span>
          );
        }
        return <span key={index}>{renderText(part.text)}</span>;
      })}
    </span>
  );
}

export function DraftField({
  session,
  field,
  label,
  placeholder = "Type Japanese with your IME…",
  rows = 4,
}: {
  session: Session;
  field: string;
  label: string;
  placeholder?: string;
  rows?: number;
}) {
  const { change, busy } = useStudy();
  const [text, setText] = useState(session.drafts[field] ?? "");
  const composing = useRef(false);
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        lang="ja"
        value={text}
        rows={rows}
        placeholder={placeholder}
        disabled={busy}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            isCompositionKey(event.nativeEvent, composing.current)
          )
            event.stopPropagation();
        }}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          void change((d) => {
            const s = d.sessions.find((x) => x.id === session.id);
            if (s) s.drafts[field] = value;
          }).catch(() => {});
        }}
      />
      <small className="muted">Saved on this device as you type.</small>
    </label>
  );
}
export function SelfRatingButtons({
  value,
  onChange,
  disabled = false,
  disabledValues = [],
}: {
  value?: SelfRating;
  onChange: (value: SelfRating) => void;
  disabled?: boolean;
  disabledValues?: SelfRating[];
}) {
  return (
    <div className="rating-row" aria-label="Self-rating">
      {(
        [
          ["not-yet", "Not yet"],
          ["with-support", "With support"],
          ["independent", "Independent"],
        ] as const
      ).map(([key, label]) => (
        <button
          type="button"
          className={`button secondary ${value === key ? "selected" : ""}`}
          key={key}
          disabled={disabled || disabledValues.includes(key)}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function IssuePicker({
  session,
  sourceId,
  suggested = [],
}: {
  session: Session;
  sourceId: string;
  suggested?: IssueTag[];
}) {
  const { data, change } = useStudy();
  const now = Date.now();
  const today = dateInZone(now, data.settings.plan.timezone);
  const selected = data.observations
    .filter(
      (o) =>
        o.sessionId === session.id &&
        o.sourceId === sourceId &&
        o.date === today,
    )
    .map((o) => o.issue);
  const [expanded, setExpanded] = useState(false);
  const tags = expanded
    ? ISSUE_TAGS
    : suggested.length
      ? suggested
      : ISSUE_TAGS.slice(0, 3);
  return (
    <div className="issue-picker">
      <p className="eyebrow">
        What tripped you up?{" "}
        <span className="muted">Optional · confirm the issue yourself</span>
      </p>
      <div className="chips">
        {tags.map((issue) => (
          <button
            type="button"
            className={`chip ${selected.includes(issue) ? "selected" : ""}`}
            key={issue}
            onClick={() => {
              void change((d) => {
                if (
                  d.observations.some(
                    (o) =>
                      o.sessionId === session.id &&
                      o.sourceId === sourceId &&
                      o.date === today &&
                      o.issue === issue,
                  )
                )
                  return;
                d.observations.push({
                  id: crypto.randomUUID(),
                  issue,
                  sessionId: session.id,
                  at: Date.now(),
                  date: dateInZone(Date.now(), d.settings.plan.timezone),
                  sourceId,
                });
              }).catch(() => {});
            }}
            disabled={selected.includes(issue)}
          >
            {ISSUE_LABELS[issue]}
            {selected.includes(issue) ? " ✓" : ""}
          </button>
        ))}
        {!expanded && (
          <button
            className="chip"
            type="button"
            onClick={() => setExpanded(true)}
          >
            Other issues
          </button>
        )}
      </div>
    </div>
  );
}
export function RegisterBadge({ register }: { register: string }) {
  return (
    <span className={`badge register-${register}`}>
      {register === "keigo"
        ? "Keigo"
        : register === "casual"
          ? "Casual"
          : "Polite"}
    </span>
  );
}
export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
export function bytes(size: number) {
  return size < 1024 * 1024
    ? `${Math.round(size / 1024)} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
