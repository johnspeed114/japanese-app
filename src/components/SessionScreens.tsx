import { useEffect, useRef, useState } from "react";
import type { Grade } from "ts-fsrs";
import { useStudy } from "../study-context";
import { allCards, publishedCatalog } from "../content";
import {
  applyGrade,
  dateInZone,
  hasPriorPassageExposure,
  pinContentForSession,
  resolveSessionContent,
  saveContentSnapshot,
  selectNextCard,
} from "../engine";
import { getProgress } from "../storage";
import { BASELINE_PROMPTS } from "../types";
import type {
  Alternative,
  ProductionItem,
  ProgressData,
  Register,
  Session,
} from "../types";
import {
  DraftField,
  formatTime,
  IssuePicker,
  Japanese,
  PHASE_LABELS,
  RegisterBadge,
  SelfRatingButtons,
} from "./StudyUI";
import { Recorder } from "./Recorder";
import { SpeechButton } from "./SpeechButton";

function sessionIn(data: ProgressData, id: string) {
  const s = data.sessions.find((x) => x.id === id);
  if (!s) throw new Error("This saved session could not be found.");
  return s;
}
function useTaskClock(session: Session, key: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const start = session.startedTasks[key];
  return start
    ? ((session.finishedTasks[key] ?? Date.now()) - start) / 1000
    : 0;
}
export function ProductionAttempt({
  item: currentItem,
  session,
  diagnostic = false,
  unscheduled = false,
  onNext,
}: {
  item: ProductionItem;
  session: Session;
  diagnostic?: boolean;
  unscheduled?: boolean;
  onNext: () => void;
}) {
  const { data, change, busy } = useStudy();
  const pinned = resolveSessionContent(
    data,
    session,
    currentItem.id,
    currentItem,
  );
  const item = pinned && "kind" in pinned ? pinned : currentItem;
  const field = `card:${item.id}`;
  const savedGrade = diagnostic
    ? data.diagnosticGrades[item.id]
    : unscheduled
      ? session.practiceGrades?.[item.id]
      : data.reviewEvents.find(
          (event) => event.sessionId === session.id && event.cardId === item.id,
        )?.rating;
  const [revealed, setRevealed] = useState(
    Boolean(session.finishedTasks[field] || savedGrade),
  );
  const [grade, setGrade] = useState<Grade | undefined>(savedGrade);
  const [saving, setSaving] = useState(false);
  const guard = useRef(false);
  const actualGrade = savedGrade ?? grade;
  useEffect(() => {
    void change((d) => {
      const current = sessionIn(d, session.id);
      pinContentForSession(d, current, item);
      current.startedTasks[field] ??= Date.now();
      if (unscheduled) delete current.currentCardId;
    }).catch(() => {});
  }, [session.id, item.id]);
  const reveal = async () => {
    await change((d) => {
      const current = sessionIn(d, session.id);
      pinContentForSession(d, current, item);
      if (unscheduled) delete current.currentCardId;
      current.finishedTasks[field] ??= Date.now();
    });
    setRevealed(true);
  };
  const rate = async (value: Grade) => {
    if (guard.current) return;
    guard.current = true;
    setSaving(true);
    try {
      await change((d) => {
        const current = sessionIn(d, session.id);
        const frozen = pinContentForSession(d, current, item);
        if (unscheduled) delete current.currentCardId;
        current.finishedTasks[field] ??= Date.now();
        if (diagnostic) {
          if (d.diagnosticGrades[item.id]) return;
          d.diagnosticGrades[item.id] = value;
          if (!current.completedTasks.includes(item.id))
            current.completedTasks.push(item.id);
          if (value === 1 && "kind" in frozen) {
            const card: ProductionItem = {
              ...structuredClone(frozen),
              id: `manual-${crypto.randomUUID()}`,
              kind: "card",
              revision: 1,
              retired: false,
              review: {
                status: "draft",
                reviewer: "Your diagnostic mistake",
                date: dateInZone(Date.now(), d.settings.plan.timezone),
              },
            };
            d.userCards.push(card);
            d.mistakes[card.id] = {
              cardId: card.id,
              addedAt: Date.now(),
              source: "manual",
              archived: false,
            };
            saveContentSnapshot(d, card);
          }
        } else if (unscheduled) {
          current.practiceGrades ??= {};
          if (current.practiceGrades[item.id]) return;
          current.practiceGrades[item.id] = value;
          if (!current.completedTasks.includes(item.id))
            current.completedTasks.push(item.id);
          if (value === 1) {
            d.mistakes[item.id] = {
              cardId: item.id,
              addedAt: d.mistakes[item.id]?.addedAt ?? Date.now(),
              source: d.mistakes[item.id]?.source ?? "review",
              archived: false,
            };
            saveContentSnapshot(d, item);
          }
        } else applyGrade(d, item, value, session.id, Date.now());
      });
      setRevealed(true);
      setGrade(value);
    } finally {
      setSaving(false);
      guard.current = false;
    }
  };
  return (
    <article className="study-card">
      <div className="card-top">
        <span className="eyebrow">
          {diagnostic
            ? item.skillTags[0]
            : unscheduled
              ? "Extra practice"
              : item.kind === "keigo"
                ? "Keigo production"
                : "Recall in Japanese"}
        </span>
        <RegisterBadge register={item.register} />
      </div>
      {unscheduled && (
        <p className="notice">
          Extra practice · does not change your review schedule.
        </p>
      )}
      <h2>{item.prompt}</h2>
      {item.promptJapanese && (
        <p className="prompt-jp">
          <Japanese text={item.promptJapanese} />
        </p>
      )}
      <DraftField
        session={session}
        field={field}
        label="Your Japanese answer"
        rows={3}
      />
      {!revealed && !actualGrade ? (
        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={!session.drafts[field]?.trim() || busy || saving}
            onClick={() => {
              void reveal().catch(() => {});
            }}
          >
            Reveal model answer
          </button>
          <button
            className="button quiet"
            type="button"
            disabled={busy || saving}
            onClick={() => {
              void rate(1).catch(() => {});
            }}
          >
            I don’t know
          </button>
        </div>
      ) : (
        <div className="answer-block">
          <span className="eyebrow">
            Model answer · compare, then self-grade
          </span>
          <p className="model-answer">
            <Japanese text={item.answer} furigana={data.settings.furigana} />
          </p>
          {item.alternatives.map((answer, index) => (
            <div className="alternative" key={index}>
              <Japanese text={answer.text} furigana={data.settings.furigana} />
              <small>{answer.context}</small>
            </div>
          ))}
          <p className="note">{item.notes}</p>
          <SpeechButton text={item.answer} voiceURI={data.settings.voiceURI} />
          {!actualGrade ? (
            <>
              <p className="muted">
                Your answer and comparison are saved. Choose a self-grade when
                you are ready.
              </p>
              <div className="fsrs-ratings">
                {(
                  [
                    [1, "Again", "Couldn’t recall"],
                    [2, "Hard", "Recalled with effort"],
                    [3, "Good", "Recalled comfortably"],
                    [4, "Easy", "Immediate recall"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    type="button"
                    className="grade-button"
                    key={value}
                    disabled={busy || saving}
                    onClick={() => {
                      void rate(value).catch(() => {});
                    }}
                  >
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="saved-mark">
                ✓{" "}
                {diagnostic
                  ? "Diagnostic answer"
                  : unscheduled
                    ? "Extra practice"
                    : "Review"}{" "}
                saved
              </p>
              {actualGrade === 1 && (
                <>
                  <IssuePicker
                    session={session}
                    sourceId={item.id}
                    suggested={item.issueTags}
                  />
                  {diagnostic && (
                    <p className="muted">
                      A separate editable practice card was added to{" "}
                      <a href="#/mistakes">Mistakes</a>.
                    </p>
                  )}
                </>
              )}
              <button type="button" className="button" onClick={onNext}>
                Next {diagnostic ? "prompt" : "card"} →
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
export function ReviewBlock({
  session,
  onDone,
}: {
  session: Session;
  onDone: () => void;
}) {
  const { data, change } = useStudy();
  const [elapsed, setElapsed] = useState(session.reviewElapsed);
  const elapsedRef = useRef(elapsed);
  const budget =
    ((session.kind.startsWith("checkpoint-") ? 180 : 480) *
      data.settings.plan.dailyMinutes) /
    30;
  const [item, setItem] = useState<ProductionItem | null>(() =>
    selectNextCard(
      data,
      session,
      publishedCatalog,
      Date.now(),
      session.reviewElapsed,
    ),
  );
  useEffect(() => {
    if (!item) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = (now - previous) / 1000;
      previous = now;
      if (document.visibilityState === "hidden") return;
      elapsedRef.current += delta;
      setElapsed(elapsedRef.current);
      if (Math.floor(elapsedRef.current) % 5 === 0)
        void change((d) => {
          sessionIn(d, session.id).reviewElapsed = elapsedRef.current;
        }).catch(() => {});
    }, 1000);
    return () => {
      clearInterval(timer);
      void change((d) => {
        sessionIn(d, session.id).reviewElapsed = elapsedRef.current;
      }).catch(() => {});
    };
  }, [item?.id, session.id]);
  const next = async () => {
    const latest = await getProgress();
    setItem(
      selectNextCard(
        latest,
        sessionIn(latest, session.id),
        publishedCatalog,
        Date.now(),
        elapsedRef.current,
      ),
    );
  };
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">Production review</span>
          <h1>Bring the words back.</h1>
        </div>
        <span className="time-pill">
          {formatTime(elapsed)} / {formatTime(budget)}
        </span>
      </div>
      {elapsed >= budget && item && (
        <p className="notice">
          Finish this answer, then move to your next activity.
        </p>
      )}
      {item ? (
        <ProductionAttempt
          key={item.id}
          item={item}
          session={session}
          onNext={() => {
            void next();
          }}
        />
      ) : (
        <div className="panel empty-state">
          <span className="large-symbol" lang="ja">
            ✓
          </span>
          <h2>Your review block is complete.</h2>
          <p>
            Due cards come first. New cards appear only with time remaining, up
            to four per day.
          </p>
          <button className="button" onClick={onDone}>
            Continue →
          </button>
        </div>
      )}
      {item && (
        <button className="button quiet" onClick={onDone}>
          Finish review for today
        </button>
      )}
    </>
  );
}
export function OutputTask({
  session,
  taskId,
  title,
  prompt,
  partner,
  model,
  alternatives = [],
  notes = "",
  register = "polite",
  targetSeconds = 120,
  speechText,
  onDone,
}: {
  session: Session;
  taskId: string;
  title: string;
  prompt: string;
  partner?: string;
  model?: string;
  alternatives?: Alternative[];
  notes?: string;
  register?: Register;
  targetSeconds?: number;
  speechText?: string;
  onDone?: () => void;
}) {
  const { data, change, busy } = useStudy();
  const [typed, setTyped] = useState(Boolean(session.drafts[taskId]));
  const [revealed, setRevealed] = useState(
    Boolean(session.finishedTasks[taskId]),
  );
  useEffect(() => {
    void change((d) => {
      const s = sessionIn(d, session.id);
      if (!s.startedTasks[taskId]) s.startedTasks[taskId] = Date.now();
    }).catch(() => {});
  }, [session.id, taskId]);
  const [recordingAvailable, setRecordingAvailable] = useState(false);
  const hasResponse = Boolean(
    recordingAvailable || session.drafts[taskId]?.trim(),
  );
  const reveal = async () => {
    await change((d) => {
      const s = sessionIn(d, session.id);
      s.finishedTasks[taskId] ??= Date.now();
    });
    setRevealed(true);
  };
  const markMistake = (d: ProgressData) => {
    if (!model) return;
    const id = `output-${taskId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    let card = d.userCards.find((c) => c.id === id);
    if (!card) {
      card = {
        id,
        revision: 1,
        kind: "card",
        prompt,
        answer: model,
        alternatives,
        notes,
        register,
        phaseTags: ["business", "trip"],
        skillTags: [register === "keigo" ? "keigo" : "vocabulary"],
        tripRelevant: true,
        issueTags: [],
        review: {
          status: "draft",
          reviewer: "Your output mistake",
          date: dateInZone(Date.now(), d.settings.plan.timezone),
        },
      };
      d.userCards.push(card);
    }
    d.mistakes[id] = {
      cardId: id,
      addedAt: d.mistakes[id]?.addedAt ?? Date.now(),
      source: "output",
      archived: false,
    };
    saveContentSnapshot(d, card);
  };
  return (
    <article className="study-card">
      <div className="card-top">
        <span className="eyebrow">{title}</span>
        <RegisterBadge register={register} />
        <span className="time-pill">Target {formatTime(targetSeconds)}</span>
      </div>
      <h2
        lang={
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(prompt)
            ? "ja"
            : undefined
        }
      >
        {prompt}
      </h2>
      {partner && (
        <div className="partner-line">
          <span className="eyebrow">The other person says</span>
          <p>
            <Japanese text={partner} furigana={data.settings.furigana} />
          </p>
          <SpeechButton
            text={partner}
            speechText={speechText}
            voiceURI={data.settings.voiceURI}
          />
        </div>
      )}
      <Recorder
        sessionId={session.id}
        taskId={taskId}
        recordingId={session.recordingIds[taskId]}
        targetSeconds={targetSeconds}
        disabled={busy}
        onUnavailable={() => setTyped(true)}
        onAvailabilityChange={setRecordingAvailable}
        onSaved={(id) => {
          void change((d) => {
            sessionIn(d, session.id).recordingIds[taskId] = id;
          }).catch(() => {});
        }}
      />
      <button
        className="button quiet"
        type="button"
        onClick={() => setTyped((x) => !x)}
      >
        {typed ? "Hide typed response" : "Type instead or add notes"}
      </button>
      {typed && (
        <DraftField
          session={session}
          field={taskId}
          label="Typed Japanese response"
        />
      )}
      {!revealed ? (
        <div className="actions">
          <button
            type="button"
            className="button"
            disabled={!hasResponse || busy}
            onClick={() => {
              void reveal().catch(() => {});
            }}
          >
            {model ? "Compare with a model answer" : "Finish this attempt"}
          </button>
          {model && (
            <button
              type="button"
              className="button quiet"
              onClick={() => {
                void change((d) => {
                  const s = sessionIn(d, session.id);
                  s.ratings[taskId] = "not-yet";
                  s.finishedTasks[taskId] ??= Date.now();
                  markMistake(d);
                })
                  .then(() => setRevealed(true))
                  .catch(() => {});
              }}
            >
              I don’t know how to say it
            </button>
          )}
        </div>
      ) : (
        <div className="answer-block">
          {model && (
            <>
              <span className="eyebrow">One natural way to say it</span>
              <p className="model-answer">
                <Japanese text={model} furigana={data.settings.furigana} />
              </p>
              {alternatives.map((alt, i) => (
                <div className="alternative" key={i}>
                  <Japanese text={alt.text} furigana={data.settings.furigana} />
                  <small>{alt.context}</small>
                </div>
              ))}
              <p className="note">{notes}</p>
              <SpeechButton text={model} voiceURI={data.settings.voiceURI} />
            </>
          )}
          <p>How did this attempt feel?</p>
          <SelfRatingButtons
            value={session.ratings[taskId]}
            disabled={busy}
            disabledValues={!hasResponse ? ["with-support", "independent"] : []}
            onChange={(value) => {
              void change((d) => {
                const s = sessionIn(d, session.id);
                s.ratings[taskId] = value;
                s.finishedTasks[taskId] ??= Date.now();
                if (value === "not-yet") markMistake(d);
              }).catch(() => {});
            }}
          />
          {!hasResponse && session.ratings[taskId] === "not-yet" && (
            <p className="notice">
              No spoken or written response saved; this is a failed practice
              attempt.
            </p>
          )}
          {typed && (
            <p className="muted">
              A typed response is saved as a writing fallback; it does not
              measure spoken fluency.
            </p>
          )}
          {session.ratings[taskId] === "not-yet" && (
            <IssuePicker session={session} sourceId={taskId} />
          )}
          <button
            type="button"
            className="button"
            disabled={
              !session.ratings[taskId] ||
              busy ||
              (!hasResponse && session.ratings[taskId] !== "not-yet")
            }
            onClick={() => {
              void change((d) => {
                const s = sessionIn(d, session.id);
                if (!s.completedTasks.includes(taskId))
                  s.completedTasks.push(taskId);
              })
                .then(() => onDone?.())
                .catch(() => {});
            }}
          >
            Continue →
          </button>
        </div>
      )}
    </article>
  );
}
function EmailTask({
  session,
  taskId = "checkpoint-email",
  onDone,
}: {
  session: Session;
  taskId?: string;
  onDone: () => void;
}) {
  const { data, change, busy } = useStudy();
  const [revealed, setRevealed] = useState(
    Boolean(session.finishedTasks[taskId]),
  );
  const elapsed = useTaskClock(session, taskId);
  const pinnedEmail = Object.values(session.contentSnapshots ?? {}).find(
    (content) => "turns" in content && content.mode === "email",
  );
  const currentEmail = publishedCatalog.scenarios.find(
    (x) => x.mode === "email",
  );
  const resolved =
    pinnedEmail ??
    (currentEmail
      ? resolveSessionContent(data, session, currentEmail.id, currentEmail)
      : undefined);
  const emailScenario =
    resolved && "turns" in resolved && resolved.mode === "email"
      ? resolved
      : currentEmail;
  const email = emailScenario?.turns[0];
  useEffect(() => {
    if (emailScenario)
      void change((d) => {
        pinContentForSession(d, sessionIn(d, session.id), emailScenario);
      }).catch(() => {});
  }, [session.id, emailScenario?.id]);
  const model = email?.answer ?? "";
  const markMistake = (d: ProgressData) => {
    const id = "output-checkpoint-email";
    let card = d.userCards.find((item) => item.id === id);
    if (!card) {
      card = {
        id,
        revision: 1,
        kind: "card",
        prompt: "Produce a warm follow-up email after a product conversation.",
        answer: model,
        alternatives: [],
        notes:
          "Register choice: recipient and relationship determine formality.",
        register: "keigo",
        phaseTags: ["business", "trip"],
        skillTags: ["keigo"],
        tripRelevant: true,
        issueTags: ["register"],
        review: {
          status: "draft",
          reviewer: "Your output mistake",
          date: dateInZone(Date.now(), d.settings.plan.timezone),
        },
      };
      d.userCards.push(card);
    }
    d.mistakes[id] = {
      cardId: id,
      addedAt: d.mistakes[id]?.addedAt ?? Date.now(),
      source: "output",
      archived: false,
    };
    saveContentSnapshot(d, card);
  };
  if (!email)
    return (
      <div className="panel">
        <h2>Email practice is unavailable.</h2>
        <p>This session has no available reviewed email model.</p>
        <button className="button" onClick={onDone}>
          Continue →
        </button>
      </div>
    );
  return (
    <article className="study-card">
      <div className="card-top">
        <span className="eyebrow">A useful follow-up email</span>
        <RegisterBadge register="keigo" />
        <span className="time-pill">{formatTime(elapsed)} / 10:00</span>
      </div>
      <h2>
        {email?.prompt ??
          "Write a warm, polite follow-up after meeting the CEO. Thank them, offer product information, and suggest a next step."}
      </h2>
      <p className="note">
        Target: a greeting, clear purpose, necessary details, appropriate
        recipient treatment, and closing within ten minutes. Review follows the
        writing window.
      </p>
      {!session.startedTasks[taskId] ? (
        <button
          className="button"
          onClick={() => {
            void change((d) => {
              sessionIn(d, session.id).startedTasks[taskId] = Date.now();
            }).catch(() => {});
          }}
        >
          Start ten-minute email
        </button>
      ) : (
        <>
          <DraftField
            session={session}
            field={taskId}
            label="Your email in Japanese"
            rows={9}
          />
          {!revealed ? (
            <button
              className="button"
              disabled={!session.drafts[taskId]?.trim() || busy}
              onClick={() => {
                void change((d) => {
                  sessionIn(d, session.id).finishedTasks[taskId] = Date.now();
                })
                  .then(() => setRevealed(true))
                  .catch(() => {});
              }}
            >
              Finish writing and compare
            </button>
          ) : (
            <div className="answer-block">
              <span className="eyebrow">Model email</span>
              <p className="model-answer">
                <Japanese text={model} furigana={data.settings.furigana} />
              </p>
              <p className="note">
                {email?.notes ??
                  "Register choice: keep the message warm and concise. More formal language is available for a first contact."}
              </p>
              <SelfRatingButtons
                value={session.ratings[taskId]}
                disabled={busy}
                onChange={(value) => {
                  void change((d) => {
                    sessionIn(d, session.id).ratings[taskId] = value;
                    if (value === "not-yet") markMistake(d);
                  }).catch(() => {});
                }}
              />
              {session.ratings[taskId] === "not-yet" && (
                <IssuePicker session={session} sourceId={taskId} />
              )}
              <button
                className="button"
                disabled={!session.ratings[taskId] || busy}
                onClick={() => {
                  void change((d) => {
                    const current = sessionIn(d, session.id);
                    if (!current.completedTasks.includes(taskId))
                      current.completedTasks.push(taskId);
                    if (current.ratings[taskId] === "not-yet") markMistake(d);
                  })
                    .then(onDone)
                    .catch(() => {});
                }}
              >
                Continue →
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
export function ReadingBlock({
  session,
  onDone,
}: {
  session: Session;
  onDone: () => void;
}) {
  const { data, change, busy } = useStudy();
  const currentPassage = publishedCatalog.passages.find(
    (x) => x.id === session.passageId,
  );
  const snapshot = resolveSessionContent(
    data,
    session,
    session.passageId,
    currentPassage,
  );
  const passage = snapshot && "body" in snapshot ? snapshot : currentPassage;
  const task = "reading";
  const shadow =
    session.kind === "daily" && session.readingMode === "shadowing";
  const elapsed = useTaskClock(session, task);
  const [furigana, setFurigana] = useState(
    session.kind === "checkpoint-b" ? false : data.settings.furigana,
  );
  const [compare, setCompare] = useState(Boolean(session.finishedTasks[task]));
  const [summaryAvailable, setSummaryAvailable] = useState(false);
  const responseComplete =
    session.kind === "checkpoint-b" ||
    Boolean(summaryAvailable || session.drafts["reading-summary"]?.trim());
  const questionsComplete =
    passage?.questions.every((_, index) =>
      Boolean(session.drafts[`reading-question-${index}`]?.trim()),
    ) ?? false;
  const ready = responseComplete && questionsComplete;
  useEffect(() => {
    if (passage)
      void change((d) => {
        pinContentForSession(d, sessionIn(d, session.id), passage);
      }).catch(() => {});
  }, [session.id, passage?.id]);
  if (!passage)
    return (
      <div className="panel">
        <h2>Reading passages are being prepared.</h2>
        <p>The diagnostic and card review are available in this preview.</p>
        <button className="button" onClick={onDone}>
          Continue
        </button>
      </div>
    );
  return (
    <article className="study-card reading-card">
      <div className="card-top">
        <span className="eyebrow">
          {shadow ? "Shadowing" : "Reading"} · N2-oriented
        </span>
        <RegisterBadge register={passage.register} />
        <span className="time-pill">
          {formatTime(elapsed)} /{" "}
          {session.kind === "checkpoint-b" ? "10:00" : "7:00"}
        </span>
      </div>
      <h1>{passage.title}</h1>
      {session.passageRepeated && (
        <p className="notice">
          Repeated passage: this attempt does not measure unfamiliar reading.
        </p>
      )}
      {!session.startedTasks[task] ? (
        <button
          className="button"
          onClick={() => {
            void change((d) => {
              const current = sessionIn(d, session.id);
              if (
                current.kind === "checkpoint-b" &&
                hasPriorPassageExposure(d, current)
              )
                current.passageRepeated = true;
              current.startedTasks[task] = Date.now();
            }).catch(() => {});
          }}
        >
          Start {shadow ? "shadowing" : "reading"}
        </button>
      ) : (
        <>
          <div className="reading-tools">
            <button
              className="chip"
              onClick={() => {
                setFurigana((x) => !x);
                if (!furigana)
                  void change((d) => {
                    sessionIn(d, session.id).assisted = true;
                  }).catch(() => {});
              }}
            >
              {furigana ? "Hide furigana" : "Show furigana"}
            </button>
            <span>
              {session.lookedUp.length + session.externalLookups} distinct
              lookups
            </span>
          </div>
          {shadow && (
            <SpeechButton
              text={passage.body}
              speechText={passage.speechText}
              voiceURI={data.settings.voiceURI}
              label="Listen sentence by sentence"
            />
          )}
          <div className="passage-body">
            <Japanese
              text={passage.body}
              furigana={furigana}
              glossary={passage.glossary}
              lookedUp={session.lookedUp}
              onLookup={(id) => {
                void change((d) => {
                  const s = sessionIn(d, session.id);
                  if (!s.lookedUp.includes(id)) s.lookedUp.push(id);
                }).catch(() => {});
              }}
            />
          </div>
          <div className="lookup-counter">
            <span>Outside dictionary lookups</span>
            <button
              className="chip"
              disabled={session.externalLookups === 0}
              onClick={() => {
                void change((d) => {
                  sessionIn(d, session.id).externalLookups = Math.max(
                    0,
                    session.externalLookups - 1,
                  );
                }).catch(() => {});
              }}
            >
              −
            </button>
            <strong>{session.externalLookups}</strong>
            <button
              className="chip"
              onClick={() => {
                void change((d) => {
                  sessionIn(d, session.id).externalLookups += 1;
                }).catch(() => {});
              }}
            >
              +
            </button>
          </div>
          <p className="note">
            Tap underlined words for authored glosses. Repeated taps on the same
            word count once.
          </p>
          {passage.questions.map((q, i) => (
            <DraftField
              key={i}
              session={session}
              field={`reading-question-${i}`}
              label={q.prompt}
              rows={2}
            />
          ))}
          {session.kind !== "checkpoint-b" && (
            <>
              <p className="eyebrow">
                {shadow
                  ? "Record a short shadowing attempt"
                  : "Summarize it aloud in Japanese"}
              </p>
              <Recorder
                sessionId={session.id}
                taskId="reading-summary"
                recordingId={session.recordingIds["reading-summary"]}
                targetSeconds={60}
                onAvailabilityChange={setSummaryAvailable}
                onSaved={(id) => {
                  void change((d) => {
                    sessionIn(d, session.id).recordingIds["reading-summary"] =
                      id;
                  }).catch(() => {});
                }}
              />
              <DraftField
                session={session}
                field="reading-summary"
                label="Typed summary if recording is unavailable"
                rows={2}
              />
              <p className="muted">
                Save a recording or typed summary, and answer both comprehension
                questions, to finish this practice.
              </p>
            </>
          )}
          {!compare ? (
            <button
              className="button"
              disabled={busy || !ready}
              onClick={() => {
                void change((d) => {
                  sessionIn(d, session.id).finishedTasks[task] = Date.now();
                })
                  .then(() => setCompare(true))
                  .catch(() => {});
              }}
            >
              Finish reading and compare
            </button>
          ) : (
            <div className="answer-block">
              <span className="eyebrow">Comprehension comparison</span>
              {passage.questions.map((q, i) => (
                <p key={i}>
                  <Japanese text={q.answer} furigana={data.settings.furigana} />
                </p>
              ))}
              {session.kind === "checkpoint-b" && (
                <p className="note">
                  Target: finish with at most four distinct lookups.{" "}
                  {session.assisted
                    ? "Furigana support was used."
                    : "Furigana support was not used."}{" "}
                  This is a self-rated task, not a proficiency certificate.
                </p>
              )}
              <SelfRatingButtons
                value={session.ratings[task]}
                onChange={(value) => {
                  void change((d) => {
                    sessionIn(d, session.id).ratings[task] = value;
                  }).catch(() => {});
                }}
              />
              <button
                className="button"
                disabled={!session.ratings[task] || busy || !ready}
                onClick={() => {
                  void change((d) => {
                    const s = sessionIn(d, session.id);
                    if (!s.completedTasks.includes(task))
                      s.completedTasks.push(task);
                  })
                    .then(onDone)
                    .catch(() => {});
                }}
              >
                Continue →
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}
function ScenarioBlock({
  session,
  onDone,
}: {
  session: Session;
  onDone: () => void;
}) {
  const { data } = useStudy();
  const currentScenario = publishedCatalog.scenarios.find(
    (x) => x.id === session.scenarioId,
  );
  const snapshot = resolveSessionContent(
    data,
    session,
    session.scenarioId,
    currentScenario,
  );
  const scenario = snapshot && "turns" in snapshot ? snapshot : currentScenario;
  const [turnIndex, setTurnIndex] = useState(
    () =>
      scenario?.turns.findIndex(
        (t) => !session.completedTasks.includes(`turn:${t.id}`),
      ) ?? 0,
  );
  if (!scenario)
    return (
      <div className="panel">
        <h2>Scenarios are being prepared.</h2>
        <button className="button" onClick={onDone}>
          Continue
        </button>
      </div>
    );
  if (scenario.mode === "email")
    return (
      <EmailTask
        session={session}
        taskId={`email:${scenario.id}`}
        onDone={onDone}
      />
    );
  const turn = scenario.turns[turnIndex];
  if (!turn)
    return (
      <div className="panel empty-state">
        <h2>One conversation, a little more familiar.</h2>
        <p>
          You completed {scenario.turns.length} turns. Repeat this scenario from
          Practice whenever you want.
        </p>
        <button className="button" onClick={onDone}>
          Continue to {session.readingMode} →
        </button>
      </div>
    );
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">
            Spoken practice · turn {turnIndex + 1} of {scenario.turns.length}
          </span>
          <h1>{scenario.title}</h1>
          <p>{scenario.situation}</p>
        </div>
      </div>
      <OutputTask
        key={turn.id}
        session={session}
        taskId={`turn:${turn.id}`}
        title="Your turn"
        prompt={turn.prompt}
        partner={turn.partner}
        model={turn.answer}
        alternatives={turn.alternatives}
        notes={turn.notes}
        register={scenario.register}
        speechText={turn.speechText}
        targetSeconds={90}
        onDone={() => setTurnIndex((i) => i + 1)}
      />
    </>
  );
}
function WrapUp({
  session,
  diagnostic = false,
}: {
  session: Session;
  diagnostic?: boolean;
}) {
  const { data, change, busy } = useStudy();
  const reviewed = data.reviewEvents.filter(
    (e) => e.sessionId === session.id,
  ).length;
  return (
    <article className="study-card wrap-card">
      <span className="eyebrow">Wrap-up</span>
      <h1>A little more yours.</h1>
      <p>
        {diagnostic
          ? "Your baseline is saved. It will guide the practice you see next."
          : `${reviewed} production reviews saved. Your answers, ratings, and recordings stay on this device.`}
      </p>
      <DraftField
        session={session}
        field="reflection"
        label="What felt easier, and what would you like to repeat?"
        rows={3}
      />
      <button
        className="button"
        disabled={busy || session.completedAt !== null}
        onClick={() => {
          void change((d) => {
            const s = sessionIn(d, session.id);
            s.completedAt = Date.now();
            s.summary = s.drafts.reflection ?? "";
            if (diagnostic) d.diagnosticComplete = true;
          })
            .then(() => {
              location.hash = "/today";
            })
            .catch(() => {});
        }}
      >
        Finish session ✓
      </button>
      <p className="muted">
        Next: due cards, one conversation, and{" "}
        {session.readingMode === "reading" ? "shadowing" : "reading"}.
        Checkpoint sessions replace the normal loop.
      </p>
    </article>
  );
}
function DiagnosticScreen({ session }: { session: Session }) {
  const { data, change } = useStudy();
  const diagnosticItems = (
    session.diagnosticIds ?? publishedCatalog.diagnostic.map((item) => item.id)
  )
    .map((id) =>
      resolveSessionContent(
        data,
        session,
        id,
        publishedCatalog.diagnostic.find((item) => item.id === id),
      ),
    )
    .filter((content): content is ProductionItem =>
      Boolean(content && "kind" in content && content.kind === "diagnostic"),
    );
  const [index, setIndex] = useState(() =>
    diagnosticItems.findIndex((x) => !data.diagnosticGrades[x.id]),
  );
  const advance = () => {
    void change((d) => {
      sessionIn(d, session.id).stage += 1;
    }).catch(() => {});
  };
  if (session.stage === 0) {
    const current = ["baseline-1", "baseline-2"].findIndex(
      (id) => !session.completedTasks.includes(id),
    );
    if (current === -1)
      return (
        <div className="panel">
          <h2>Speaking baseline saved.</h2>
          <button className="button" onClick={advance}>
            Continue to typed diagnostic
          </button>
        </div>
      );
    return (
      <>
        <div className="section-title">
          <div>
            <span className="eyebrow">Day 1 · speaking baseline</span>
            <h1>Start with your own voice.</h1>
            <p>Two minutes per prompt. Repeat these exact prompts each week.</p>
          </div>
        </div>
        {current === 1 &&
          !session.recordingIds["baseline-2"] &&
          !session.drafts["baseline-2"] && (
            <label className="field">
              <span>
                Register for this prompt (kept for future comparisons)
              </span>
              <select
                value={data.settings.baselineRegister}
                onChange={(event) => {
                  const value = event.target.value as "polite" | "casual";
                  void change((d) => {
                    d.settings.baselineRegister = value;
                  }).catch(() => {});
                }}
              >
                <option value="polite">Polite · です／ます</option>
                <option value="casual">Familiar casual speech</option>
              </select>
            </label>
          )}
        <OutputTask
          key={current}
          session={session}
          taskId={`baseline-${current + 1}`}
          title={`Baseline ${current + 1} of 2`}
          prompt={BASELINE_PROMPTS[current]}
          register={current === 0 ? "polite" : data.settings.baselineRegister}
          targetSeconds={120}
        />
      </>
    );
  }
  if (session.stage === 1) {
    const item = diagnosticItems[index];
    if (!item)
      return (
        <div className="panel">
          <h2>Typed diagnostic complete.</h2>
          <p>
            The March examples are probes, not confirmed recurring mistakes.
            Your self-ratings guide broad practice priorities.
          </p>
          <button className="button" onClick={advance}>
            See your baseline wrap-up
          </button>
        </div>
      );
    return (
      <>
        <div className="section-title">
          <div>
            <span className="eyebrow">
              Typed diagnostic · {index + 1} of {diagnosticItems.length}
            </span>
            <h1>Find the words you still know.</h1>
          </div>
        </div>
        <ProductionAttempt
          key={item.id}
          item={item}
          session={session}
          diagnostic
          onNext={() => setIndex((i) => i + 1)}
        />
      </>
    );
  }
  return <WrapUp session={session} diagnostic />;
}
function SpeakingCheckpoint({ session }: { session: Session }) {
  const { data, change } = useStudy();
  const tasks = [
    {
      id: "baseline-1",
      title: "Same baseline introduction",
      prompt: BASELINE_PROMPTS[0],
      seconds: 120,
      register: "polite" as Register,
    },
    {
      id: "baseline-2",
      title: "Same baseline open answer",
      prompt: BASELINE_PROMPTS[1],
      seconds: 120,
      register: data.settings.baselineRegister as Register,
    },
    {
      id: "business-intro",
      title: "Three-minute business introduction",
      prompt:
        "Introduce yourself, your software product, and your purpose for visiting. Use appropriate polite, honorific, and humble expressions without reading a model.",
      seconds: 180,
      register: "keigo" as Register,
    },
    {
      id: "conversation",
      title: "Ten-minute conversation rehearsal",
      prompt:
        "Imagine catching up with a friendly CEO or colleague. Talk about recent work, life in Japan, hobbies, and your product. Ask follow-up questions and practice asking for clarification. This solo task measures rehearsal; use a real partner when available.",
      seconds: 600,
      register: "casual" as Register,
    },
  ];
  const advance = () => {
    void change((d) => {
      sessionIn(d, session.id).stage += 1;
    }).catch(() => {});
  };
  if (session.stage < tasks.length) {
    const task = tasks[session.stage];
    return (
      <>
        <div className="section-title">
          <div>
            <span className="eyebrow">Weekly checkpoint A · speaking</span>
            <h1>Hear what has changed.</h1>
            <p>
              Target 30 minutes; recording transitions may take longer. Compare
              the recordings in Progress.
            </p>
          </div>
        </div>
        <OutputTask
          key={task.id}
          session={session}
          taskId={task.id}
          title={task.title}
          prompt={task.prompt}
          targetSeconds={task.seconds}
          register={task.register}
          onDone={advance}
        />
      </>
    );
  }
  if (session.stage === 4)
    return (
      <div className="study-card">
        <h2>Replay and self-rate</h2>
        <p>
          Replay a short part of this week’s and last week’s baseline in
          Progress. Notice recall speed, pauses, and comfort—not a proficiency
          score.
        </p>
        <DraftField
          session={session}
          field="speaking-checkpoint-notes"
          label="What changed from your last recording?"
        />
        <button className="button" onClick={advance}>
          Continue to a short review
        </button>
      </div>
    );
  if (session.stage === 5)
    return <ReviewBlock session={session} onDone={advance} />;
  return <WrapUp session={session} />;
}
export function SessionScreen({ id }: { id: string }) {
  const { data, change } = useStudy();
  const session = data.sessions.find((x) => x.id === id);
  if (!session)
    return (
      <div className="panel">
        <h1>Session not found</h1>
        <a className="button" href="#/today">
          Back to Today
        </a>
      </div>
    );
  if (session.completedAt)
    return (
      <div className="panel">
        <h1>This session is saved.</h1>
        <p>View your answers and recordings in Progress.</p>
        <a className="button" href="#/progress">
          Open Progress
        </a>
      </div>
    );
  const advance = () => {
    void change((d) => {
      sessionIn(d, id).stage += 1;
    }).catch(() => {});
  };
  return (
    <>
      <div className="session-breadcrumb">
        <a href="#/today">← Today</a>
        <span>
          {session.studyDate} · {PHASE_LABELS[session.phase]}
        </span>
      </div>
      {session.kind === "diagnostic" ? (
        <DiagnosticScreen session={session} />
      ) : session.kind === "checkpoint-a" ? (
        <SpeakingCheckpoint session={session} />
      ) : session.kind === "checkpoint-b" ? (
        session.stage === 0 ? (
          <EmailTask session={session} onDone={advance} />
        ) : session.stage === 1 ? (
          <ReadingBlock session={session} onDone={advance} />
        ) : session.stage === 2 ? (
          <ReviewBlock session={session} onDone={advance} />
        ) : (
          <WrapUp session={session} />
        )
      ) : session.stage === 0 ? (
        <ReviewBlock session={session} onDone={advance} />
      ) : session.stage === 1 ? (
        <ScenarioBlock session={session} onDone={advance} />
      ) : session.stage === 2 ? (
        <ReadingBlock session={session} onDone={advance} />
      ) : (
        <WrapUp session={session} />
      )}
    </>
  );
}
export function SingleCardScreen({
  cardId,
  sessionId,
}: {
  cardId: string;
  sessionId: string;
}) {
  const { data, change } = useStudy();
  const item = allCards(data).find((c) => c.id === cardId);
  const session = data.sessions.find((s) => s.id === sessionId);
  if (!item || !session)
    return (
      <div className="panel">
        <h1>This card is unavailable.</h1>
        <a href="#/practice">Back to Practice</a>
      </div>
    );
  return (
    <>
      <a className="back-link" href="#/practice">
        ← Practice
      </a>
      <ProductionAttempt
        item={item}
        session={session}
        unscheduled
        onNext={() => {
          void change((d) => {
            sessionIn(d, session.id).completedAt = Date.now();
          })
            .then(() => {
              location.hash = "/practice";
            })
            .catch(() => {});
        }}
      />
    </>
  );
}
