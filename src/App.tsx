import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { StudyProvider } from "./state";
import { useStudy } from "./study-context";
import { allCards, publishedCatalog } from "./content";
import {
  addDays,
  availablePassageIds,
  checkpointCount,
  createSession,
  dateInZone,
  daysBetween,
  diagnosticWeaknesses,
  confirmedPatterns,
  phaseLengths,
  phaseOnDate,
  pinContentForSession,
  saveContentSnapshot,
  streak,
} from "./engine";
import {
  deleteRecording,
  getProgress,
  listRecordings,
  withRecordingIdle,
} from "./storage";
import type { BackupSummary } from "./backup";
import { hasCompleteReadings, plainJapanese } from "./japanese";
import { settingsSchema } from "./validation";
import { PHASES } from "./types";
import type { ProductionItem, RecordingMeta, Session, Settings } from "./types";
import {
  bytes,
  formatTime,
  ISSUE_LABELS,
  Japanese,
  PHASE_LABELS,
  RegisterBadge,
} from "./components/StudyUI";
import { SessionScreen, SingleCardScreen } from "./components/SessionScreens";
import { Recorder } from "./components/Recorder";
import { isRecordingActive } from "./audio";

const go = (path: string) => {
  location.hash = `/${path}`;
  window.scrollTo({ top: 0, behavior: "instant" });
};
const labelKind = (kind: Session["kind"]) =>
  ({
    diagnostic: "Baseline diagnostic",
    daily: "Daily practice",
    "checkpoint-a": "Speaking checkpoint",
    "checkpoint-b": "Email & reading checkpoint",
    extra: "Extra practice",
  })[kind];
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    today: "M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7",
    practice: "M3 5h7l2 2 2-2h7v15h-7l-2 2-2-2H3ZM12 7v15",
    mistakes: "M7 3h10v4H7ZM5 5H3v17h18V5h-2M7 12h10M7 17h7",
    progress: "M4 21V3M4 21h18M8 17v-5M13 17V8M18 17V4",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] ?? paths.today} />
    </svg>
  );
}
function InstallGuide() {
  const { data, change } = useStudy();
  const [standalone] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches,
  );
  if (standalone || data.settings.installAcknowledged) return null;
  return (
    <div className="install-guide">
      <div>
        <span className="eyebrow">Make this your study space</span>
        <h3>On iPhone, install before your diagnostic.</h3>
        <p>
          In Safari, use Share → Add to Home Screen. The installed app and
          Safari tab have separate histories. If you move later, transfer a
          backup first.
        </p>
      </div>
      <button
        className="button secondary"
        onClick={() => {
          void navigator.storage?.persist?.();
          void change((d) => {
            d.settings.installAcknowledged = true;
          }).catch(() => {});
        }}
      >
        Continue on this device
      </button>
    </div>
  );
}
function Today() {
  const { data, change, busy } = useStudy();
  const today = dateInZone(Date.now(), data.settings.plan.timezone);
  const plan = data.settings.plan;
  const remaining = Math.max(0, daysBetween(today, plan.targetDate));
  const incomplete = data.sessions
    .filter((s) => !s.completedAt && s.kind !== "extra" && !s.manualCheckpoint)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const completedToday = data.sessions.some(
    (s) =>
      s.studyDate === today &&
      s.completedAt &&
      s.kind !== "extra" &&
      !s.manualCheckpoint,
  );
  const lengths = phaseLengths(plan);
  const phase = phaseOnDate(plan, today);
  const cards = allCards(data);
  const due = cards.filter(
    (c) => data.cardStates[c.id]?.due <= Date.now(),
  ).length;
  const start = async () => {
    const value = await change((d) => {
      if (!d.diagnosticComplete && incomplete?.kind === "diagnostic") return;
      createSession(d, today, Date.now(), publishedCatalog);
    });
    const s =
      !value.diagnosticComplete && incomplete?.kind === "diagnostic"
        ? value.sessions.find((x) => x.id === incomplete.id)
        : value.sessions
            .filter(
              (x) =>
                x.studyDate === today &&
                x.kind !== "extra" &&
                !x.manualCheckpoint,
            )
            .at(-1);
    if (s) go(`session/${s.id}`);
  };
  return (
    <>
      <InstallGuide />
      <section className="hero">
        <div>
          <span className="eyebrow">YOUR JAPANESE, REACTIVATED</span>
          <h1 lang="ja">
            もう一度、
            <br />
            自然に。
          </h1>
          <p>
            Get the words flowing again.
            <br />
            One conversation at a time.
          </p>
          <button
            className="button light"
            disabled={busy || publishedCatalog.diagnostic.length !== 16}
            onClick={() => {
              void start().catch(() => {});
            }}
          >
            {!data.diagnosticComplete
              ? incomplete?.kind === "diagnostic"
                ? "Resume diagnostic"
                : "Start diagnostic"
              : completedToday
                ? "View today’s saved session"
                : incomplete?.studyDate === today
                  ? "Continue today’s session"
                  : "Start today’s session"}{" "}
            <span>↗</span>
          </button>
        </div>
        <div className="hero-date">
          <span className="eyebrow">TOKYO · DECEMBER 2</span>
          <strong>{remaining > 0 ? remaining : "✓"}</strong>
          <span>
            {remaining > 0 ? "days to reconnect" : "Keep your Japanese moving"}
          </span>
          <div className="hero-line" />
          <span className="mini-jp" lang="ja">
            話す。思い出す。つながる。
          </span>
        </div>
      </section>
      <div className="stat-grid">
        <div>
          <span className="stat-number">{streak(data.sessions, today)}</span>
          <span>day streak</span>
        </div>
        <div>
          <span className="stat-number">
            {Object.keys(data.cardStates).length}
            <small> / {cards.length}</small>
          </span>
          <span>items introduced</span>
        </div>
        <div>
          <span className="stat-number">{due}</span>
          <span>cards due</span>
        </div>
      </div>
      {incomplete && incomplete.studyDate !== today && (
        <div className="notice inline-notice">
          <div>
            <strong>A saved session is waiting.</strong>
            <p>
              Resume {labelKind(incomplete.kind).toLowerCase()} from{" "}
              {incomplete.studyDate}. Its date stays fixed when you return.
            </p>
          </div>
          <button
            className="button secondary"
            onClick={() => go(`session/${incomplete.id}`)}
          >
            Resume saved session
          </button>
        </div>
      )}
      <div className="home-grid">
        <section className="panel">
          <div className="section-title">
            <div>
              <span className="eyebrow">TODAY’S RHYTHM</span>
              <h2>
                {data.diagnosticComplete
                  ? "A small, complete session."
                  : "First, find your starting point."}
              </h2>
            </div>
            <span className="badge">{plan.dailyMinutes} min</span>
          </div>
          {(data.diagnosticComplete
            ? [
                [
                  "01",
                  "Recall",
                  "Produce Japanese, then compare and self-grade.",
                  `${Math.round(((plan.dailyMinutes * 8) / 30) * 10) / 10} min`,
                ],
                [
                  "02",
                  "Speak",
                  "A friendly conversation or a useful email.",
                  `${Math.round(((plan.dailyMinutes * 12) / 30) * 10) / 10} min`,
                ],
                [
                  "03",
                  "Read / shadow",
                  "Short passages, voiced practice, and your summary.",
                  `${Math.round(((plan.dailyMinutes * 7) / 30) * 10) / 10} min`,
                ],
                [
                  "04",
                  "Reflect",
                  "Notice what changed and what to repeat.",
                  `${Math.round(((plan.dailyMinutes * 3) / 30) * 10) / 10} min`,
                ],
              ]
            : [
                [
                  "01",
                  "Record",
                  "Two fixed two-minute prompts, in your own voice.",
                  "4 min",
                ],
                [
                  "02",
                  "Produce",
                  "Sixteen short vocabulary, grammar, reading, and keigo prompts.",
                  "~20 min",
                ],
                [
                  "03",
                  "Reflect",
                  "Save a tentative baseline, not a proficiency score.",
                  "~6 min",
                ],
              ]
          ).map(([number, title, note, time]) => (
            <div className="agenda-row" key={number}>
              <span className="agenda-index">{number}</span>
              <div>
                <strong>{title}</strong>
                <p>{note}</p>
              </div>
              <span>{time}</span>
            </div>
          ))}
        </section>
        <section className="panel focus-panel">
          <span className="eyebrow">CURRENT FOCUS</span>
          <h2>{PHASE_LABELS[phase]}</h2>
          <p>
            {phase === "reactivation"
              ? "Bring familiar words back into reach, with trip conversations from the beginning."
              : phase === "core"
                ? "Use N2 vocabulary and grammar in your own sentences."
                : phase === "business"
                  ? "Stay warm and polite, with keigo where the relationship calls for it."
                  : "Rehearse introductions, stories, and follow-up questions end to end."}
          </p>
          <div className="phase-track">
            {PHASES.map((name, i) => (
              <span
                title={`${PHASE_LABELS[name]}: ${lengths[i]} days`}
                className={name === phase ? "current" : ""}
                key={name}
                style={{ flex: Math.max(1, lengths[i]) }}
              />
            ))}
          </div>
          <p className="muted">
            {plan.startDate
              ? `Started ${plan.startDate} · ${checkpointCount(plan)} checkpoint pairs`
              : "Your schedule starts when you begin the diagnostic."}
          </p>
          <a className="text-link" href="#/practice">
            Explore practice →
          </a>
        </section>
      </div>
      {Date.now() -
        (data.settings.lastExportAt ??
          data.sessions[0]?.createdAt ??
          Date.now()) >=
        7 * 86400000 && (
        <div className="backup-nudge">
          <strong>Keep a copy of your progress.</strong>
          <p>
            Browser storage is local. Save a small progress backup regularly,
            and a full backup when moving devices.
          </p>
          <a href="#/settings" className="text-link">
            Open backups →
          </a>
        </div>
      )}
    </>
  );
}
function Practice() {
  const { data, change, busy } = useStudy();
  const [tab, setTab] = useState("cards");
  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState("all");
  const today = dateInZone(Date.now(), data.settings.plan.timezone);
  const available = availablePassageIds(
    data.settings.plan,
    today,
    publishedCatalog.passages,
    data.sessions,
  );
  const cards = allCards(data).filter(
    (c) =>
      (skill === "all" || c.skillTags.includes(skill as "vocabulary")) &&
      `${c.prompt} ${plainJapanese(c.answer)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const cardStart = async (item: ProductionItem) => {
    let id = "";
    await change((d) => {
      const s = createSession(d, today, Date.now(), publishedCatalog, "extra");
      id = s.id;
      pinContentForSession(d, s, item);
    });
    go(`card/${item.id}/${id}`);
  };
  const scenarioStart = async (id: string) => {
    let sessionId = "";
    await change((d) => {
      const s = createSession(d, today, Date.now(), publishedCatalog, "extra");
      s.stage = 1;
      s.scenarioId = id;
      sessionId = s.id;
      const scenario = publishedCatalog.scenarios.find((x) => x.id === id);
      if (scenario) pinContentForSession(d, s, scenario);
    });
    go(`session/${sessionId}`);
  };
  const passageStart = async (id: string) => {
    let sessionId = "";
    await change((d) => {
      const s = createSession(d, today, Date.now(), publishedCatalog, "extra");
      s.stage = 2;
      s.passageId = id;
      sessionId = s.id;
      const passage = publishedCatalog.passages.find((x) => x.id === id);
      if (passage) pinContentForSession(d, s, passage);
    });
    go(`session/${sessionId}`);
  };
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">THE PRACTICE LIBRARY</span>
        <h1>Useful words. Real situations.</h1>
        <p>
          Choose extra practice whenever you want. Your daily plan keeps its own
          time budget.
        </p>
      </div>
      <div className="tabs">
        {[
          ["cards", "Production cards"],
          ["scenarios", "Conversations"],
          ["readings", "Reading passages"],
        ].map(([id, label]) => (
          <button
            type="button"
            aria-pressed={tab === id}
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "cards" ? (
        <>
          <div className="filter-row">
            <label className="field">
              <span>Find a card</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a topic or Japanese word…"
              />
            </label>
            <label className="field">
              <span>Practice focus</span>
              <select value={skill} onChange={(e) => setSkill(e.target.value)}>
                <option value="all">All production items</option>
                <option value="vocabulary">Vocabulary</option>
                <option value="grammar">Grammar</option>
                <option value="readings">Kanji readings</option>
                <option value="keigo">Keigo</option>
              </select>
            </label>
          </div>
          <div className="library-grid">
            {cards.map((item) => (
              <article className="panel library-card" key={item.id}>
                <div className="card-top">
                  <RegisterBadge register={item.register} />
                  <span className="muted">
                    {item.retired
                      ? "Archived"
                      : data.cardStates[item.id]
                        ? "Introduced"
                        : "New"}
                  </span>
                </div>
                <h3>{item.prompt}</h3>
                <p className="muted">
                  {item.skillTags.join(" · ")}
                  {item.tripRelevant ? " · trip useful" : ""}
                </p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    void cardStart(item).catch(() => {});
                  }}
                >
                  Practice this card
                </button>
              </article>
            ))}
          </div>
          {cards.length === 0 && (
            <div className="panel empty-state">
              <h2>No matching cards.</h2>
              <p>Try a different word or focus.</p>
            </div>
          )}
        </>
      ) : tab === "scenarios" ? (
        <div className="library-grid">
          {publishedCatalog.scenarios.map((item) => (
            <article className="panel library-card" key={item.id}>
              <div className="card-top">
                <RegisterBadge register={item.register} />
                <span className="muted">
                  {item.mode === "email"
                    ? "Writing"
                    : `${item.turns.length} turns`}
                </span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.situation}</p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  void scenarioStart(item.id).catch(() => {});
                }}
              >
                Rehearse this scenario
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="library-grid">
          {publishedCatalog.passages.map((item, index) => (
            <article className="panel library-card" key={item.id}>
              <span className="eyebrow">N2-oriented · passage {index + 1}</span>
              <h3>{item.title}</h3>
              <p className="muted">
                {available.includes(item.id)
                  ? "Ready for reading and spoken summaries."
                  : "Reserved for a first-seen checkpoint reading."}
              </p>
              <button
                className="button secondary"
                disabled={busy || !available.includes(item.id)}
                onClick={() => {
                  void passageStart(item.id).catch(() => {});
                }}
              >
                {available.includes(item.id)
                  ? "Read this passage"
                  : "Reserved for checkpoint"}
              </button>
            </article>
          ))}
        </div>
      )}
      <p className="catalog-note">
        Model answers are independently AI-reviewed. They are not labelled as
        native-speaker reviewed. If wording seems off, report it from Settings.
      </p>
    </>
  );
}
function Mistakes() {
  const { data, change, busy } = useStudy();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProductionItem | null>(null);
  const [front, setFront] = useState("");
  const [answer, setAnswer] = useState("");
  const [notes, setNotes] = useState("");
  const [register, setRegister] = useState<"casual" | "polite" | "keigo">(
    "polite",
  );
  const [word, setWord] = useState("");
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(false);
  const patterns = confirmedPatterns(data.observations);
  const items = Object.values(data.mistakes).filter(
    (m) => showArchived || !m.archived,
  );
  const cards = allCards(data);
  const edit = (item?: ProductionItem) => {
    setEditing(item ?? null);
    setFront(item?.prompt ?? "");
    setAnswer(item?.answer ?? "");
    setNotes(item?.notes ?? "");
    setRegister(item?.register ?? "polite");
    setError("");
    setForm(true);
  };
  const save = async () => {
    if (!front.trim() || !answer.trim()) {
      setError("Add an English production prompt and a Japanese answer.");
      return;
    }
    if (!hasCompleteReadings(answer)) {
      setError("Add readings for kanji words with the helper below.");
      return;
    }
    const id = editing?.id ?? `manual-${crypto.randomUUID()}`;
    await change((d) => {
      const card: ProductionItem = {
        id,
        revision: (editing?.revision ?? 0) + 1,
        kind: "card",
        prompt: front.trim(),
        answer: answer.trim(),
        alternatives: editing?.alternatives ?? [],
        notes: notes.trim(),
        register,
        phaseTags: ["reactivation", "core", "business", "trip"],
        skillTags: editing?.skillTags ?? [
          register === "keigo" ? "keigo" : "vocabulary",
        ],
        tripRelevant: true,
        issueTags: editing?.issueTags ?? [],
        review: {
          status: "draft",
          reviewer: "You · manually added",
          date: dateInZone(Date.now(), d.settings.plan.timezone),
        },
      };
      const index = d.userCards.findIndex((c) => c.id === id);
      if (index < 0) d.userCards.push(card);
      else d.userCards[index] = card;
      d.mistakes[id] = {
        cardId: id,
        addedAt: d.mistakes[id]?.addedAt ?? Date.now(),
        source: editing ? (d.mistakes[id]?.source ?? "manual") : "manual",
        archived: false,
      };
      saveContentSnapshot(d, card);
    });
    setForm(false);
  };
  const practice = async (item: ProductionItem) => {
    let id = "";
    await change((d) => {
      id = createSession(
        d,
        dateInZone(Date.now(), d.settings.plan.timezone),
        Date.now(),
        publishedCatalog,
        "extra",
      ).id;
    });
    go(`card/${item.id}/${id}`);
  };
  return (
    <>
      <div className="page-heading heading-actions">
        <div>
          <span className="eyebrow">YOUR MISTAKE DECK</span>
          <h1>Give the difficult parts another turn.</h1>
          <p>
            A miss adds a card. A specific pattern needs your confirmation
            across different sessions and dates.
          </p>
        </div>
        <button className="button" onClick={() => edit()}>
          Add a card manually
        </button>
      </div>
      {patterns.length > 0 && (
        <div className="panel pattern-panel">
          <span className="eyebrow">Confirmed recurring issues</span>
          <div className="chips">
            {patterns.map((tag) => (
              <span className="chip selected" key={tag}>
                {ISSUE_LABELS[tag]}
              </span>
            ))}
          </div>
        </div>
      )}
      {form && (
        <section className="study-card">
          <h2>
            {editing ? "Edit your card" : "A card from your own experience"}
          </h2>
          <label className="field">
            <span>English production prompt</span>
            <input value={front} onChange={(e) => setFront(e.target.value)} />
          </label>
          <label className="field">
            <span>Japanese model answer</span>
            <textarea
              lang="ja"
              rows={3}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
          <div className="reading-helper">
            <label className="field">
              <span>Kanji word</span>
              <input
                lang="ja"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="統計"
              />
            </label>
            <label className="field">
              <span>Kana reading</span>
              <input
                lang="ja"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                placeholder="とうけい"
              />
            </label>
            <button
              className="button secondary"
              disabled={!word.trim() || !reading.trim()}
              onClick={() => {
                setAnswer((x) => `${x}[[${word.trim()}|${reading.trim()}]]`);
                setWord("");
                setReading("");
              }}
            >
              Insert word with reading
            </button>
          </div>
          <p className="muted">
            The helper inserts a word with its reading. For words already in the
            answer, replace them with the inserted version. Preview:{" "}
            <Japanese text={answer} furigana />
          </p>
          <label className="field">
            <span>Register</span>
            <select
              value={register}
              onChange={(e) => setRegister(e.target.value as typeof register)}
            >
              <option value="polite">Polite</option>
              <option value="casual">Casual</option>
              <option value="keigo">Keigo</option>
            </select>
          </label>
          <label className="field">
            <span>Short note</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                void save().catch(() => {});
              }}
            >
              Save card
            </button>
            <button className="button quiet" onClick={() => setForm(false)}>
              Cancel
            </button>
          </div>
          {editing && (
            <p className="muted">
              Editing keeps your review history. Resetting learning is a
              separate action.
            </p>
          )}
        </section>
      )}
      <label className="check-field">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />{" "}
        Show archived mistake entries
      </label>
      <div className="library-grid">
        {items.map((mistake) => {
          const item = cards.find((c) => c.id === mistake.cardId);
          if (!item) return null;
          return (
            <article className="panel library-card" key={item.id}>
              <div className="card-top">
                <RegisterBadge register={item.register} />
                <span className="muted">{mistake.source}</span>
              </div>
              <h3>{item.prompt}</h3>
              <p className="muted">
                Missed{" "}
                {
                  data.reviewEvents.filter(
                    (e) => e.cardId === item.id && e.rating === 1,
                  ).length
                }{" "}
                review attempts
              </p>
              <div className="actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    void practice(item).catch(() => {});
                  }}
                >
                  Practice this card
                </button>
                {data.userCards.some((c) => c.id === item.id) && (
                  <button className="button quiet" onClick={() => edit(item)}>
                    Edit
                  </button>
                )}
                <button
                  className="button quiet"
                  onClick={() => {
                    void change((d) => {
                      d.mistakes[item.id].archived = !mistake.archived;
                    }).catch(() => {});
                  }}
                >
                  {mistake.archived ? "Restore to Mistakes" : "Archive entry"}
                </button>
                {data.cardStates[item.id] && (
                  <button
                    className="button quiet"
                    onClick={() => {
                      if (
                        !confirm(
                          "Reset the learning schedule for this card? Review history remains in Progress.",
                        )
                      )
                        return;
                      void change((d) => {
                        delete d.cardStates[item.id];
                      }).catch(() => {});
                    }}
                  >
                    Reset learning
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {items.length === 0 && (
        <div className="panel empty-state">
          <span className="large-symbol" lang="ja">
            芽
          </span>
          <h2>Your deck will grow from real attempts.</h2>
          <p>
            Cards you miss appear here. Add expressions you want to use on your
            trip.
          </p>
        </div>
      )}
    </>
  );
}
function Progress() {
  const { data, change, notify } = useStudy();
  const [audio, setAudio] = useState<RecordingMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [compare, setCompare] = useState("");
  const today = dateInZone(Date.now(), data.settings.plan.timezone);
  const weak = diagnosticWeaknesses(data, publishedCatalog);
  useEffect(() => {
    let live = true;
    void listRecordings()
      .then((value) => {
        if (live) setAudio(value);
      })
      .catch((e) => notify(String(e)));
    return () => {
      live = false;
    };
  }, [data, notify]);
  const repeat = async (
    kind: "checkpoint-a" | "checkpoint-b",
    index?: number,
  ) => {
    let id = "";
    await change((d) => {
      if (index !== undefined && d.settings.plan.startDate) {
        const scheduled = addDays(
          d.settings.plan.startDate,
          6 + index * 7 + (kind === "checkpoint-b" ? 1 : 0),
        );
        if (scheduled > today)
          throw new Error(
            "This checkpoint reading is reserved until its scheduled date. Use a manual repeat instead.",
          );
      }
      const s = createSession(d, today, Date.now(), publishedCatalog, "extra");
      s.kind = kind;
      s.manualCheckpoint = true;
      s.checkpointIndex = index;
      s.passageRepeated = true;
      if (kind === "checkpoint-b") {
        const pool = publishedCatalog.passages.slice(3);
        const available = new Set(
          availablePassageIds(
            d.settings.plan,
            today,
            publishedCatalog.passages,
            d.sessions,
          ),
        );
        const passage =
          index === undefined
            ? (pool.find((item) => available.has(item.id)) ??
              publishedCatalog.passages.find((item) => available.has(item.id)))
            : pool[index % pool.length];
        if (passage) {
          s.passageId = passage.id;
          pinContentForSession(d, s, passage);
        }
      }
      id = s.id;
    });
    go(`session/${id}`);
  };
  const history = [...data.sessions].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">LOOK BACK, THEN KEEP GOING</span>
        <h1>Hear the difference.</h1>
        <p>
          Recordings and comparable tasks show change more clearly than a level
          label.
        </p>
      </div>
      <div className="stat-grid">
        <div>
          <span className="stat-number">
            {
              data.sessions.filter(
                (s) =>
                  s.completedAt && s.kind !== "extra" && !s.manualCheckpoint,
              ).length
            }
          </span>
          <span>completed sessions</span>
        </div>
        <div>
          <span className="stat-number">{data.reviewEvents.length}</span>
          <span>production attempts</span>
        </div>
        <div>
          <span className="stat-number">{audio.length}</span>
          <span>saved recordings</span>
        </div>
      </div>
      {data.diagnosticComplete && (
        <section className="panel">
          <h2>Your diagnostic practice priorities</h2>
          <p className="muted">
            These are self-rated recall gaps, not proficiency scores.
          </p>
          <div className="priority-bars">
            {Object.entries(weak).map(([skill, value]) => (
              <div key={skill}>
                <span>{skill === "readings" ? "Kanji readings" : skill}</span>
                <div>
                  <span style={{ width: `${value * 100}%` }} />
                </div>
                <small>
                  {value > 0.5
                    ? "More practice"
                    : value > 0
                      ? "Some practice"
                      : "Maintain"}
                </small>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="section-title">
          <div>
            <span className="eyebrow">WEEKLY TARGETS</span>
            <h2>Speaking, email, and reading.</h2>
          </div>
        </div>
        <p>
          Three-minute business introduction · ten-minute casual
          conversation/rehearsal · email within ten minutes · unfamiliar reading
          with fewer than five lookups.
        </p>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => {
              void repeat("checkpoint-a").catch(() => {});
            }}
          >
            Repeat speaking checkpoint
          </button>
          <button
            className="button secondary"
            onClick={() => {
              void repeat("checkpoint-b").catch(() => {});
            }}
          >
            Repeat email & reading checkpoint
          </button>
        </div>
        {data.settings.plan.startDate && (
          <div className="checkpoint-list">
            {Array.from(
              { length: checkpointCount(data.settings.plan) },
              (_, index) => {
                const a = addDays(data.settings.plan.startDate!, 6 + index * 7);
                const b = addDays(a, 1);
                const status = (kind: Session["kind"], date: string) =>
                  data.sessions.some(
                    (s) =>
                      s.kind === kind &&
                      !s.manualCheckpoint &&
                      s.studyDate === date &&
                      s.completedAt,
                  )
                    ? "Completed"
                    : date < today
                      ? "Missed · optional makeup"
                      : "Upcoming";
                return (
                  <div className="checkpoint-row" key={index}>
                    <strong>Week {index + 1}</strong>
                    <span>
                      {a} · A: {status("checkpoint-a", a)}
                      <br />
                      {b} · B: {status("checkpoint-b", b)}
                    </span>
                    <button
                      className="button quiet"
                      disabled={a > today}
                      onClick={() => {
                        void repeat("checkpoint-a", index).catch(() => {});
                      }}
                    >
                      Practice A
                    </button>
                    <button
                      className="button quiet"
                      disabled={b > today}
                      onClick={() => {
                        void repeat("checkpoint-b", index).catch(() => {});
                      }}
                    >
                      Practice B
                    </button>
                  </div>
                );
              },
            )}
          </div>
        )}
      </section>
      <section className="panel">
        <span className="eyebrow">YOUR VOICE, OVER TIME</span>
        <h2>Recording comparison</h2>
        <p className="muted">
          Choose two attempts at the same prompt. Nothing is transcribed or
          uploaded.
        </p>
        <div className="comparison-grid">
          {[
            [selected, setSelected, "First recording"],
            [compare, setCompare, "Compare with"],
          ].map(([value, setter, label], index) => (
            <div key={index}>
              <label className="field">
                <span>{label as string}</span>
                <select
                  value={value as string}
                  onChange={(e) =>
                    (setter as (id: string) => void)(e.target.value)
                  }
                >
                  <option value="">Choose a recording</option>
                  {audio.map((meta) => (
                    <option key={meta.id} value={meta.id}>
                      {dateInZone(meta.startedAt, data.settings.plan.timezone)}{" "}
                      · {meta.taskId} · {Math.round(meta.durationMs / 1000)}s
                    </option>
                  ))}
                </select>
              </label>
              {value &&
                (() => {
                  const meta = audio.find((x) => x.id === value);
                  return meta ? (
                    <>
                      <Recorder
                        sessionId={meta.sessionId}
                        taskId={meta.taskId}
                        recordingId={meta.id}
                        disabled
                        onSaved={() => {}}
                      />
                      <button
                        className="button quiet danger"
                        onClick={() => {
                          if (
                            !confirm(
                              "Delete this recording from this device? Its study attempt remains saved.",
                            )
                          )
                            return;
                          void deleteRecording(meta.id)
                            .then(() => {
                              (setter as (id: string) => void)("");
                              notify("Recording deleted.");
                              return listRecordings();
                            })
                            .then(setAudio)
                            .catch((e) => notify(String(e)));
                        }}
                      >
                        Delete recording · {bytes(meta.size)}
                      </button>
                    </>
                  ) : null;
                })()}
            </div>
          ))}
        </div>
        {audio.length === 0 && (
          <p>
            No recordings yet. Your diagnostic creates the first comparison
            points.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Saved sessions</h2>
        {history.length === 0 ? (
          <p>Your history starts with the diagnostic.</p>
        ) : (
          history.map((s) => (
            <details className="history-row" key={s.id}>
              <summary>
                <span>
                  {s.studyDate} · {labelKind(s.kind)}
                  {s.manualCheckpoint ? " · manual repeat" : ""}
                </span>
                <span className="badge">
                  {s.completedAt ? "Saved" : "In progress"}
                </span>
              </summary>
              <div>
                <p>{s.summary || "No wrap-up note."}</p>
                {!s.completedAt && (
                  <button
                    className="button secondary"
                    onClick={() => go(`session/${s.id}`)}
                  >
                    Resume this session
                  </button>
                )}
                {Object.entries(s.ratings).map(([key, value]) => (
                  <p className="muted" key={key}>
                    {key}: {value.replace(/-/g, " ")}
                  </p>
                ))}
                {Object.entries(s.practiceGrades ?? {}).map(([id, grade]) => (
                  <p className="muted" key={`practice-${id}`}>
                    {id}: extra practice ·{" "}
                    {["", "Again", "Hard", "Good", "Easy"][grade]}
                  </p>
                ))}
                {Object.entries(s.drafts)
                  .filter(([, value]) => value.trim())
                  .map(([key, value]) => (
                    <div className="saved-answer" key={key}>
                      <span className="eyebrow">{key}</span>
                      <p>
                        <Japanese text={value} />
                      </p>
                    </div>
                  ))}
                {s.startedTasks.reading && (
                  <p>
                    {formatTime(
                      ((s.finishedTasks.reading ??
                        s.completedAt ??
                        s.startedTasks.reading) -
                        s.startedTasks.reading) /
                        1000,
                    )}{" "}
                    reading time · {s.lookedUp.length + s.externalLookups}{" "}
                    reading lookups ·{" "}
                    {s.assisted
                      ? "with reading support"
                      : "without furigana support"}{" "}
                    ·{" "}
                    {s.passageRepeated
                      ? "repeated passage"
                      : s.kind === "checkpoint-b"
                        ? "unfamiliar checkpoint"
                        : "ordinary reading practice"}
                  </p>
                )}
              </div>
            </details>
          ))
        )}
      </section>
    </>
  );
}
function BackupControls({
  onRestored,
}: {
  onRestored: (settings: Settings) => void;
}) {
  const { busy, setBusy, notify } = useStudy();
  const [ready, setReady] = useState<File>();
  const [file, setFile] = useState<File>();
  const [summary, setSummary] = useState<BackupSummary>();
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [controller, setController] = useState<AbortController>();
  const prepare = async (full: boolean) => {
    const abort = new AbortController();
    setController(abort);
    setBusy(true);
    setReady(undefined);
    setError("");
    try {
      const options = {
        signal: abort.signal,
        onProgress: (label: string, current: number, total: number) =>
          setStatus(`${label}${total ? ` · ${current}/${total}` : ""}`),
      };
      const backup = await import("./backup");
      const result = await (full
        ? backup.exportFull(options)
        : backup.exportProgress(options));
      setReady(result);
      setStatus(
        "Ready to save. Tap below to open your device’s share sheet or download.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Backup failed. Your saved study data is unchanged.",
      );
    } finally {
      setBusy(false);
      setController(undefined);
    }
  };
  const inspect = async (value: File) => {
    setBusy(true);
    setFile(value);
    setSummary(undefined);
    setConfirmed(false);
    setError("");
    try {
      const { inspectBackup } = await import("./backup");
      setSummary(await inspectBackup(value));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This backup could not be read.",
      );
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!file || !confirmed) return;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    setController(abort);
    try {
      const { restoreBackup } = await import("./backup");
      await restoreBackup(file, {
        signal: abort.signal,
        onProgress: (label, current, total) =>
          setStatus(`${label} · ${current}/${total}`),
      });
      onRestored((await getProgress()).settings);
      setSummary(undefined);
      setFile(undefined);
      setConfirmed(false);
      notify("Backup restored. Your study history is ready.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Restore failed. Existing data remains active.",
      );
    } finally {
      setBusy(false);
      setController(undefined);
    }
  };
  return (
    <section className="panel backup-panel">
      <span className="eyebrow">BACKUPS & DEVICE TRANSFERS</span>
      <h2>Keep your progress with you.</h2>
      <p>
        Small JSON backs up study progress. Full ZIP also includes recordings
        and is the format to use when moving devices.
      </p>
      <div className="actions">
        <button
          className="button"
          disabled={busy || isRecordingActive()}
          onClick={() => {
            void prepare(false);
          }}
        >
          Prepare progress JSON
        </button>
        <button
          className="button secondary"
          disabled={busy || isRecordingActive()}
          onClick={() => {
            void prepare(true);
          }}
        >
          Prepare full ZIP
        </button>
        {controller && (
          <button className="button quiet" onClick={() => controller.abort()}>
            Cancel transfer
          </button>
        )}
      </div>
      {status && (
        <p className="muted" aria-live="polite">
          {status}
        </p>
      )}
      {ready && (
        <div className="notice">
          <strong>
            {ready.name} · {bytes(ready.size)}
          </strong>
          <div className="actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                void import("./backup")
                  .then(({ shareBackup }) => shareBackup(ready))
                  .then(() =>
                    notify(
                      "Backup exported. Keep the file somewhere you can find it.",
                    ),
                  )
                  .catch((e) =>
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Sharing failed. Try again.",
                    ),
                  );
              }}
            >
              Save / share backup
            </button>
          </div>
          <p>
            On iPhone, choose Save to Files from the share sheet. Keep the app
            open while preparing a large archive.
          </p>
        </div>
      )}
      <hr />
      <label className="field">
        <span>Choose a JSON or ZIP backup</span>
        <input
          type="file"
          accept=".json,.zip,application/json,application/zip"
          disabled={busy}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) void inspect(selected);
          }}
        />
      </label>
      {summary && (
        <div className="restore-preview">
          <h3>Restore preview</h3>
          <p>
            {summary.sessions} sessions · {summary.cards} introduced cards ·{" "}
            {summary.recordings} included recordings
          </p>
          <p>
            {summary.kind === "full"
              ? "This replaces study progress and recordings on this device."
              : "This replaces study progress and keeps recordings already on this device. Imported audio plays only when its recording file is present locally."}
          </p>
          {summary.missing > 0 && (
            <p className="muted">
              {summary.missing} recording references have no audio in this
              backup.
            </p>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I understand what will be replaced and have saved any backup I need.
          </label>
          <button
            className="button"
            disabled={busy || !confirmed || isRecordingActive()}
            onClick={() => {
              void restore();
            }}
          >
            Restore this backup
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function SettingsScreen() {
  const { data, change, notify, busy } = useStudy();
  const [settings, setSettings] = useState<Settings>(
    structuredClone(data.settings),
  );
  const savedVersion = useRef(
    JSON.stringify({ ...data.settings, lastExportAt: null }),
  );
  useEffect(() => {
    const next = JSON.stringify({ ...data.settings, lastExportAt: null });
    if (next !== savedVersion.current) {
      savedVersion.current = next;
      setSettings(structuredClone(data.settings));
      notify(
        "Saved settings changed in another window or a restore. This form has been refreshed.",
      );
    }
  }, [data.settings, notify]);
  const [error, setError] = useState("");
  const [storage, setStorage] = useState<{
    usage?: number;
    quota?: number;
    persistent: boolean;
  }>({ persistent: false });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    void Promise.all([
      navigator.storage?.estimate?.(),
      navigator.storage?.persisted?.(),
    ])
      .then(([estimate, persistent]) =>
        setStorage({ ...estimate, persistent: !!persistent }),
      )
      .catch(() => {});
    if (!("speechSynthesis" in window)) return;
    const refresh = () =>
      setVoices(
        window.speechSynthesis
          .getVoices()
          .filter((v) => /^ja(?:-|$)/i.test(v.lang)),
      );
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);
  const save = async () => {
    const expectedVersion = savedVersion.current;
    const conflictMessage =
      "Saved settings changed elsewhere. Review the refreshed form before saving.";
    try {
      const checked = settingsSchema.parse(settings);
      setError("");
      savedVersion.current = JSON.stringify({ ...checked, lastExportAt: null });
      await change((d) => {
        if (
          JSON.stringify({ ...d.settings, lastExportAt: null }) !==
          expectedVersion
        ) {
          throw new Error(conflictMessage);
        }
        d.settings = { ...checked, lastExportAt: d.settings.lastExportAt };
      });
      notify(
        "Settings saved. Existing attempts keep their original dates and content.",
      );
    } catch (e) {
      savedVersion.current = expectedVersion;
      if (e instanceof Error && e.message === conflictMessage) {
        const fresh = await getProgress().catch(() => undefined);
        if (fresh) {
          savedVersion.current = JSON.stringify({
            ...fresh.settings,
            lastExportAt: null,
          });
          setSettings(structuredClone(fresh.settings));
        }
      }
      setError(e instanceof Error ? e.message : "Check your settings.");
    }
  };
  const setPlan = (
    key: keyof Settings["plan"],
    value: string | number | number[] | null,
  ) =>
    setSettings((previous) => ({
      ...previous,
      plan: { ...previous.plan, [key]: value },
    }));
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">YOUR STUDY SPACE</span>
        <h1>Settings & backups</h1>
        <p>
          No login. Your answers and audio stay in this browser until you export
          them.
        </p>
      </div>
      <section className="panel">
        <h2>Practice preferences</h2>
        <label className="check-field">
          <input
            type="checkbox"
            checked={settings.furigana}
            onChange={(e) =>
              setSettings((x) => ({ ...x, furigana: e.target.checked }))
            }
          />{" "}
          Show furigana on model answers and ordinary passages
        </label>
        <label className="field">
          <span>Japanese device voice (fallback)</span>
          <select
            value={settings.voiceURI}
            onChange={(e) =>
              setSettings((x) => ({ ...x, voiceURI: e.target.value }))
            }
          >
            <option value="">Prefer a local Japanese voice</option>
            {voices.map((v) => (
              <option value={v.voiceURI} key={v.voiceURI}>
                {v.name}
                {v.localService ? " · local" : " · may need internet"}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Built-in listening uses Marin, an AI-generated Japanese voice, with
          recordings saved for offline playback. New or edited text can use your
          device voice above.
        </p>
        {voices.length === 0 && (
          <p className="muted">
            No Japanese device voice is currently listed. The built-in recordings
            still work. A device voice can become available after installation.
          </p>
        )}
        <div className="filter-row">
          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              value={settings.plan.startDate ?? ""}
              onChange={(e) => setPlan("startDate", e.target.value || null)}
            />
          </label>
          <label className="field">
            <span>Target date</span>
            <input
              type="date"
              value={settings.plan.targetDate}
              onChange={(e) => setPlan("targetDate", e.target.value)}
            />
          </label>
          <label className="field">
            <span>Daily minutes</span>
            <input
              type="number"
              min="5"
              max="120"
              value={settings.plan.dailyMinutes}
              onChange={(e) => setPlan("dailyMinutes", Number(e.target.value))}
            />
          </label>
        </div>
        <label className="field">
          <span>Saved study timezone</span>
          <input
            value={settings.plan.timezone}
            onChange={(e) => setPlan("timezone", e.target.value)}
            placeholder="America/Los_Angeles"
          />
        </label>
        <p className="muted">
          The timezone stays fixed during travel unless you change it. Existing
          session and observation dates remain saved.
        </p>
        <div className="phase-settings">
          {PHASES.map((phase, index) => (
            <label className="field" key={phase}>
              <span>{PHASE_LABELS[phase]}</span>
              <input
                type="number"
                min="0"
                value={settings.plan.phaseWeights[index]}
                onChange={(e) => {
                  const weights = [...settings.plan.phaseWeights];
                  weights[index] = Number(e.target.value);
                  setPlan("phaseWeights", weights);
                }}
              />
            </label>
          ))}
        </div>
        <p className="muted">
          Weights are normalized when allocating calendar days. Changing the
          plan regenerates future scheduling, keeping history and memory
          intervals.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            void save();
          }}
        >
          Save settings
        </button>
      </section>
      <section className="panel">
        <h2>Device storage</h2>
        <p>
          {storage.usage !== undefined
            ? `${bytes(storage.usage)} used${storage.quota ? ` of an estimated ${bytes(storage.quota)}` : ""}`
            : "Storage usage estimate is unavailable."}{" "}
          ·{" "}
          {storage.persistent
            ? "Persistence granted"
            : "Best-effort browser storage"}
        </p>
        <button
          className="button secondary"
          onClick={() => {
            void navigator.storage
              ?.persist?.()
              .then((persistent) => {
                setStorage((s) => ({ ...s, persistent: !!persistent }));
                notify(
                  persistent
                    ? "Persistent storage granted. Keep regular backups too."
                    : "Persistence was not granted. Regular backups still protect your history.",
                );
              })
              .catch(() =>
                notify("This browser could not request persistent storage."),
              );
          }}
        >
          Request persistent storage
        </button>
        <p className="muted">
          Safari-tab and home-screen app data are separate on iPhone. Use
          backups to transfer between them. Clearing browser data can remove
          this study history.
        </p>
      </section>
      <BackupControls
        onRestored={(restored) => setSettings(structuredClone(restored))}
      />
      <section className="panel">
        <h2>Language review & content corrections</h2>
        <p>
          The library has a separate AI language review. Native-speaker review
          has not been claimed. Your manually added cards remain your own,
          unreviewed study content.
        </p>
        <p className="muted">
          If a model answer seems wrong or too formal, keep the item ID and your
          proposed wording.
        </p>
        <a
          className="button secondary"
          href="https://github.com/johnspeed114/japanese-app/issues/new"
          target="_blank"
          rel="noreferrer"
        >
          Open a content issue on GitHub ↗
        </a>
        <p className="muted">
          This optional action leaves the app and uses your existing GitHub
          account. Add only the example you want to share.
        </p>
      </section>
    </>
  );
}
function Shell() {
  const { data, busy, saving, notify } = useStudy();
  const [route, setRoute] = useState(
    location.hash.replace(/^#\/?/, "") || "today",
  );
  const [offline, setOffline] = useState(!navigator.onLine);
  const {
    needRefresh: [refresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn("Offline setup failed", error);
    },
  });
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.replace(/^#\/?/, "") || "today");
      window.scrollTo(0, 0);
    };
    const network = () => setOffline(!navigator.onLine);
    window.addEventListener("hashchange", change);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);
  const [page, id, sessionId] = route.split("/");
  const navigation = [
    ["today", "Today"],
    ["practice", "Practice"],
    ["mistakes", "Mistakes"],
    ["progress", "Progress"],
    ["settings", "Settings"],
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/today">
          <span className="brand-mark" lang="ja">
            帰
          </span>
          <span>
            Japanese
            <br />
            <strong>reactivation</strong>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {navigation.map(([key, label]) => (
            <a
              key={key}
              href={`#/${key}`}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "active" : ""}
              onClick={(e) => {
                if (busy) {
                  e.preventDefault();
                  notify(
                    "Wait for the transfer to finish, or cancel it first.",
                  );
                }
              }}
            >
              <Icon name={key} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="tiny-dot" />
          Personal study · local history<p>Tokyo · December 2, 2026</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            {dateInZone(Date.now(), data.settings.plan.timezone)}{" "}
            <span className="muted">· {data.settings.plan.timezone}</span>
          </span>
          <span className="status-dot">
            {offline ? "Offline · saved practice" : "Saved on this device"}
          </span>
        </header>
        {refresh && (
          <div className="update-banner">
            <span>
              A new version is ready. Finish and save active work before
              updating.
            </span>
            <button
              className="button secondary"
              disabled={busy || saving || isRecordingActive()}
              onClick={() => {
                if (
                  !confirm(
                    "Reload to use the new version? Saved drafts will remain.",
                  )
                )
                  return;
                void withRecordingIdle(() => updateServiceWorker(true)).catch(
                  (error) =>
                    notify(
                      error instanceof Error
                        ? error.message
                        : "Wait until recording and saving are finished.",
                    ),
                );
              }}
            >
              Update app
            </button>
          </div>
        )}
        <main className="main-content">
          {page === "session" ? (
            <SessionScreen key={id} id={id} />
          ) : page === "card" ? (
            <SingleCardScreen
              key={`${id}:${sessionId}`}
              cardId={id}
              sessionId={sessionId}
            />
          ) : page === "practice" ? (
            <Practice />
          ) : page === "mistakes" ? (
            <Mistakes />
          ) : page === "progress" ? (
            <Progress />
          ) : page === "settings" ? (
            <SettingsScreen />
          ) : (
            <Today />
          )}
        </main>
        <footer className="app-footer">
          <span lang="ja">少しずつ、また自分の言葉に。</span>
          <span>Personal practice · no accounts · local data</span>
        </footer>
      </div>
    </div>
  );
}
export default function App() {
  return (
    <StudyProvider>
      <Shell />
    </StudyProvider>
  );
}
