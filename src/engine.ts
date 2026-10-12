import { createEmptyCard, fsrs, State, type Card, type Grade } from "ts-fsrs";
import {
  PHASES,
  ISSUE_TAGS,
  type Catalog,
  type ContentSnapshot,
  type IssueTag,
  type Observation,
  type Passage,
  type Phase,
  type PlanConfig,
  type ProductionItem,
  type ProgressData,
  type ReviewEvent,
  type SerializedCard,
  type Session,
  type Skill,
} from "./types";

const DAY = 86_400_000;
const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: [],
  relearning_steps: [],
});
const SKILLS: Skill[] = ["vocabulary", "grammar", "readings", "keigo"];

function preserveLegacySession(data: ProgressData, session: Session): void {
  if (session.contentSnapshots !== undefined) return;
  const snapshots: Record<string, ContentSnapshot> = {};
  const references = new Set([
    session.scenarioId,
    session.passageId,
    ...Object.keys(session.drafts)
      .filter((key) => key.startsWith("card:"))
      .map((key) => key.slice(5)),
  ]);
  for (const event of data.reviewEvents.filter(
    (value) => value.sessionId === session.id,
  )) {
    const snapshot = data.snapshots[event.cardId];
    if (snapshot?.revision === event.contentRevision)
      snapshots[event.cardId] = structuredClone(snapshot);
  }
  for (const id of references)
    if (data.snapshots[id] && !snapshots[id])
      snapshots[id] = structuredClone(data.snapshots[id]);
  if (session.kind === "diagnostic")
    for (const id of session.completedTasks) {
      const snapshot = data.snapshots[id];
      if (snapshot && "kind" in snapshot && snapshot.kind === "diagnostic")
        snapshots[id] = structuredClone(snapshot);
    }
  session.contentSnapshots = snapshots;
}

export function saveContentSnapshot(
  data: ProgressData,
  item: ContentSnapshot,
): void {
  for (const session of data.sessions) preserveLegacySession(data, session);
  const previous = data.snapshots[item.id];
  if (!previous || previous.revision <= item.revision)
    data.snapshots[item.id] = structuredClone(item);
}

export function pinContentForSession(
  data: ProgressData,
  session: Session,
  item: ContentSnapshot,
): ContentSnapshot {
  preserveLegacySession(data, session);
  const snapshots = session.contentSnapshots!;
  const pinned = snapshots[item.id] ?? structuredClone(item);
  snapshots[item.id] = pinned;
  saveContentSnapshot(data, pinned);
  if ("kind" in pinned && pinned.kind !== "diagnostic")
    session.currentCardId = pinned.id;
  return pinned;
}

export function resolveSessionContent(
  data: ProgressData,
  session: Session,
  id: string,
  current?: ContentSnapshot,
): ContentSnapshot | undefined {
  const pinned = session.contentSnapshots?.[id];
  if (pinned) return pinned;
  if (session.contentSnapshots === undefined)
    return data.snapshots[id] ?? current;
  return current ?? data.snapshots[id];
}

export function resolveReviewContent(
  data: ProgressData,
  event: ReviewEvent,
): ProductionItem | undefined {
  const session = data.sessions.find((value) => value.id === event.sessionId);
  const candidates = [
    session?.contentSnapshots?.[event.cardId],
    data.snapshots[event.cardId],
    ...data.userCards.filter((item) => item.id === event.cardId),
  ];
  return candidates.find((item): item is ProductionItem =>
    Boolean(
      item &&
      "kind" in item &&
      item.id === event.cardId &&
      item.revision === event.contentRevision,
    ),
  );
}

function ordinal(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Use a calendar date in YYYY-MM-DD format.");
  const [year, month, day] = date.split("-").map(Number);
  const at = Date.UTC(year, month - 1, day);
  if (new Date(at).toISOString().slice(0, 10) !== date)
    throw new Error("That calendar date does not exist.");
  return at / DAY;
}

export function dateInZone(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (name: string) =>
    parts.find((value) => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days))
    throw new Error("Calendar offsets must be whole days.");
  return new Date((ordinal(date) + days) * DAY).toISOString().slice(0, 10);
}

export function daysBetween(start: string, target: string): number {
  return ordinal(target) - ordinal(start);
}

export function phaseLengths(
  plan: PlanConfig,
): [number, number, number, number] {
  if (!plan.startDate) return [0, 0, 0, 0];
  const duration = Math.max(0, daysBetween(plan.startDate, plan.targetDate));
  const total = plan.phaseWeights.reduce((sum, weight) => sum + weight, 0);
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    plan.phaseWeights.some((weight) => !Number.isFinite(weight) || weight < 0)
  )
    throw new Error("Phase weights must be nonnegative with a positive total.");
  const shares = plan.phaseWeights.map((weight) => (duration * weight) / total);
  const lengths = shares.map(Math.floor) as [number, number, number, number];
  const order = shares
    .map((share, index) => ({ index, remainder: share - lengths[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let remaining = duration - lengths.reduce((sum, length) => sum + length, 0);
  for (const entry of order) if (remaining-- > 0) lengths[entry.index] += 1;
  return lengths;
}

export function phaseOnDate(plan: PlanConfig, date: string): Phase {
  if (!plan.startDate) return "reactivation";
  const offset = daysBetween(plan.startDate, date);
  if (offset < 0) return "reactivation";
  let boundary = 0;
  const lengths = phaseLengths(plan);
  for (let index = 0; index < lengths.length; index++) {
    boundary += lengths[index];
    if (offset < boundary) return PHASES[index];
  }
  return "trip";
}

export function checkpointCount(plan: PlanConfig): number {
  return plan.startDate
    ? Math.max(
        0,
        Math.floor((daysBetween(plan.startDate, plan.targetDate) - 1) / 7),
      )
    : 0;
}

export function checkpointOnDate(
  plan: PlanConfig,
  date: string,
): { kind: "checkpoint-a" | "checkpoint-b"; index: number } | null {
  if (!plan.startDate) return null;
  const offset = daysBetween(plan.startDate, date);
  if (offset < 6) return null;
  const aIndex = (offset - 6) / 7;
  if (Number.isInteger(aIndex) && aIndex < checkpointCount(plan))
    return { kind: "checkpoint-a", index: aIndex };
  const bIndex = (offset - 7) / 7;
  if (Number.isInteger(bIndex) && bIndex < checkpointCount(plan))
    return { kind: "checkpoint-b", index: bIndex };
  return null;
}

export function availablePassageIds(
  plan: PlanConfig,
  date: string,
  passages: Passage[],
  sessions: Session[],
): string[] {
  if (!plan.startDate) plan = { ...plan, startDate: date };
  const count = checkpointCount(plan);
  if (!count || !plan.startDate) return passages.map((passage) => passage.id);
  const lastB = addDays(plan.startDate, count * 7);
  const lastCompleted = sessions.some(
    (session) =>
      session.kind === "checkpoint-b" &&
      !session.manualCheckpoint &&
      session.checkpointIndex === count - 1 &&
      session.studyDate === lastB &&
      session.completedAt !== null,
  );
  if (date > lastB || lastCompleted)
    return passages.map((passage) => passage.id);
  const pool = passages.slice(3);
  const available = new Set(passages.slice(0, 3).map((passage) => passage.id));
  for (let index = 0; index < count; index++) {
    const bDate = addDays(plan.startDate, 7 + index * 7);
    const done = sessions.some(
      (session) =>
        session.kind === "checkpoint-b" &&
        !session.manualCheckpoint &&
        session.checkpointIndex === index &&
        session.studyDate === bDate &&
        session.completedAt !== null,
    );
    if (date > bDate || done) {
      const passage = pool[index % pool.length];
      if (passage) available.add(passage.id);
    }
  }
  return passages
    .filter((passage) => available.has(passage.id))
    .map((passage) => passage.id);
}

export function createSession(
  data: ProgressData,
  date: string,
  now: number,
  catalog: Catalog,
  kindOverride?: Session["kind"],
): Session {
  ordinal(date);
  const plan = data.settings.plan;
  if (!plan.startDate && kindOverride !== "extra") {
    const diagnosticDates = data.sessions
      .filter((session) => session.kind === "diagnostic")
      .map((session) => session.studyDate);
    plan.startDate = diagnosticDates.reduce(
      (earliest, diagnosticDate) =>
        diagnosticDate < earliest ? diagnosticDate : earliest,
      diagnosticDates[0] ?? date,
    );
  }
  const checkpoint = checkpointOnDate(plan, date);
  const kind =
    kindOverride ??
    (!data.diagnosticComplete ? "diagnostic" : (checkpoint?.kind ?? "daily"));
  if (kind !== "extra") {
    const existing = data.sessions.find(
      (session) =>
        session.studyDate === date &&
        session.kind === kind &&
        !session.manualCheckpoint,
    );
    if (existing) {
      if (
        existing.kind === "checkpoint-b" &&
        hasPriorPassageExposure(data, existing)
      )
        existing.passageRepeated = true;
      return existing;
    }
  }
  data.catalogVersion = catalog.version;
  const phase = phaseOnDate(plan, date);
  const completedDays = data.sessions.filter(
    (session) => session.kind === "daily" && session.completedAt !== null,
  ).length;
  const scenarios = catalog.scenarios.filter((scenario) =>
    scenario.phaseTags.includes(phase),
  );
  const candidates = scenarios.length ? scenarios : catalog.scenarios;
  const scenario = candidates[completedDays % candidates.length];
  const available = availablePassageIds(
    plan,
    date,
    catalog.passages,
    data.sessions,
  );
  const checkpointIndex = kind.startsWith("checkpoint-")
    ? checkpoint?.index
    : undefined;
  const pool = catalog.passages.slice(3);
  const passageId =
    kind === "checkpoint-b" && checkpointIndex !== undefined && pool.length
      ? pool[checkpointIndex % pool.length].id
      : (available[completedDays % available.length] ?? "");
  const passage = catalog.passages.find((value) => value.id === passageId);
  const session: Session = {
    id: crypto.randomUUID(),
    studyDate: date,
    phase,
    kind,
    checkpointIndex,
    createdAt: now,
    completedAt: null,
    stage: 0,
    reviewElapsed: 0,
    readingMode:
      kind === "daily" && completedDays % 2 === 1 ? "shadowing" : "reading",
    scenarioId: scenario?.id ?? "",
    passageId,
    passageRepeated:
      kind === "checkpoint-b" &&
      checkpointIndex !== undefined &&
      pool.length > 0 &&
      checkpointIndex >= pool.length,
    contentSnapshots: {},
    drafts: {},
    ratings: {},
    completedTasks: [],
    recordingIds: {},
    lookedUp: [],
    externalLookups: 0,
    assisted: false,
    startedTasks: {},
    finishedTasks: {},
    summary: "",
  };
  if (kind === "checkpoint-b" && hasPriorPassageExposure(data, session))
    session.passageRepeated = true;
  data.sessions.push(session);
  if (scenario) pinContentForSession(data, session, scenario);
  if (passage) pinContentForSession(data, session, passage);
  if (kind === "diagnostic") {
    session.diagnosticIds = catalog.diagnostic.map((item) => item.id);
    for (const item of catalog.diagnostic)
      pinContentForSession(data, session, item);
  }
  if (kind === "checkpoint-b") {
    const email = catalog.scenarios.find((value) => value.mode === "email");
    if (email) pinContentForSession(data, session, email);
  }
  return session;
}

export function hasPriorPassageExposure(
  data: ProgressData,
  session: Pick<Session, "id" | "passageId">,
): boolean {
  return Boolean(
    session.passageId &&
    data.sessions.some(
      (previous) =>
        previous.id !== session.id &&
        previous.passageId === session.passageId &&
        previous.startedTasks.reading !== undefined,
    ),
  );
}

export function confirmedPatterns(observations: Observation[]): IssueTag[] {
  return ISSUE_TAGS.filter((issue) => {
    const matching = observations.filter(
      (observation) => observation.issue === issue,
    );
    return (
      new Set(matching.map((observation) => observation.date)).size >= 2 &&
      new Set(matching.map((observation) => observation.sessionId)).size >= 2
    );
  });
}

export function diagnosticWeaknesses(
  data: ProgressData,
  catalog: Catalog,
): Record<Skill, number> {
  const weaknesses = Object.fromEntries(
    SKILLS.map((skill) => [skill, 0]),
  ) as Record<Skill, number>;
  const definitions = Object.keys(data.diagnosticGrades)
    .map((id) => {
      const completed = data.sessions.find(
        (session) =>
          session.kind === "diagnostic" && session.completedTasks.includes(id),
      );
      const saved = completed?.contentSnapshots?.[id] ?? data.snapshots[id];
      return saved && "kind" in saved && saved.kind === "diagnostic"
        ? saved
        : catalog.diagnostic.find((item) => item.id === id);
    })
    .filter((item): item is ProductionItem => Boolean(item));
  for (const skill of SKILLS) {
    const grades = definitions
      .filter((item) => item.skillTags.includes(skill))
      .map((item) => data.diagnosticGrades[item.id]);
    if (grades.length)
      weaknesses[skill] =
        grades.reduce(
          (sum, grade) => sum + (grade === 1 ? 1 : grade === 2 ? 0.5 : 0),
          0,
        ) / grades.length;
  }
  return weaknesses;
}

export function reviewBudgetSeconds(
  data: ProgressData,
  session: Session,
): number {
  return Math.round(
    data.settings.plan.dailyMinutes *
      (session.kind.startsWith("checkpoint-") ? 6 : 16),
  );
}

export function selectNextCard(
  data: ProgressData,
  session: Session,
  catalog: Catalog,
  now: number,
  elapsedSeconds: number,
): ProductionItem | null {
  const budget = reviewBudgetSeconds(data, session);
  if (session.kind === "diagnostic") return null;
  const graded = new Set(
    data.reviewEvents
      .filter((event) => event.sessionId === session.id)
      .map((event) => event.cardId),
  );
  if (session.currentCardId && !graded.has(session.currentCardId)) {
    const current = [
      ...catalog.cards,
      ...catalog.keigoDrills,
      ...data.userCards,
    ].find((item) => item.id === session.currentCardId);
    const pinned = resolveSessionContent(
      data,
      session,
      session.currentCardId,
      current,
    );
    if (pinned && "kind" in pinned && pinned.kind !== "diagnostic")
      return pinned;
  }
  if (elapsedSeconds >= budget) return null;
  const definitions = new Map(
    [...catalog.cards, ...catalog.keigoDrills, ...data.userCards].map(
      (item) => [item.id, item],
    ),
  );
  for (const snapshot of Object.values(data.snapshots)) {
    if (
      "kind" in snapshot &&
      snapshot.kind !== "diagnostic" &&
      data.cardStates[snapshot.id] &&
      (!definitions.has(snapshot.id) || definitions.get(snapshot.id)?.retired)
    )
      definitions.set(snapshot.id, snapshot);
  }
  const userIds = new Set(data.userCards.map((item) => item.id));
  const items = [...definitions.values()]
    .map((item) => {
      const pinned = session.contentSnapshots?.[item.id];
      return pinned && "kind" in pinned ? pinned : item;
    })
    .filter(
      (item) =>
        !item.retired &&
        !graded.has(item.id) &&
        (!userIds.has(item.id) || !data.mistakes[item.id]?.archived),
    );
  const due = items
    .filter((item) => {
      const card = data.cardStates[item.id];
      return card && card.state !== State.New && card.due <= now;
    })
    .sort(
      (a, b) =>
        data.cardStates[a.id].due - data.cardStates[b.id].due ||
        a.id.localeCompare(b.id),
    );
  if (due.length) return due[0];
  if (budget - elapsedSeconds < 60 || session.kind !== "daily") return null;
  const todayIntroduced = data.reviewEvents.filter(
    (event) =>
      event.introduced &&
      event.observationDate === dateInZone(now, data.settings.plan.timezone),
  ).length;
  if (todayIntroduced >= 4) return null;
  const weaknesses = diagnosticWeaknesses(data, catalog);
  const patterns = new Set(confirmedPatterns(data.observations));
  const weakness = (item: ProductionItem) =>
    Math.max(0, ...item.skillTags.map((skill) => weaknesses[skill])) +
    (item.issueTags.some((issue) => patterns.has(issue)) ? 1 : 0);
  return (
    items
      .filter(
        (item) =>
          !data.cardStates[item.id] ||
          data.cardStates[item.id].state === State.New,
      )
      .sort(
        (a, b) =>
          weakness(b) - weakness(a) ||
          Number(b.tripRelevant) - Number(a.tripRelevant) ||
          Number(b.phaseTags.includes(session.phase)) -
            Number(a.phaseTags.includes(session.phase)) ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
}

function serializeCard(card: Card): SerializedCard {
  return {
    ...card,
    due: card.due.getTime(),
    last_review: card.last_review?.getTime(),
  };
}

export function applyGrade(
  data: ProgressData,
  item: ProductionItem,
  rating: Grade,
  sessionId: string,
  now: number,
): boolean {
  if (
    data.reviewEvents.some(
      (event) => event.cardId === item.id && event.sessionId === sessionId,
    )
  )
    return false;
  const session = data.sessions.find((value) => value.id === sessionId);
  if (!session) throw new Error("The study session could not be found.");
  const frozen = pinContentForSession(data, session, item);
  if (!("kind" in frozen))
    throw new Error("This session item is not a production card.");
  item = frozen;
  const before = data.cardStates[item.id];
  const introduced = !before || before.state === State.New;
  const { card, log } = scheduler.next(
    before ?? createEmptyCard(now),
    now,
    rating,
  );
  const atDate = dateInZone(now, data.settings.plan.timezone);
  const eventId = crypto.randomUUID();
  data.cardStates[item.id] = serializeCard(card);
  data.reviewEvents.push({
    id: eventId,
    cardId: item.id,
    sessionId,
    at: now,
    observationDate: atDate,
    rating,
    introduced,
    contentRevision: item.revision,
    log: { ...log, due: log.due.getTime(), review: log.review.getTime() },
  });
  if (session.currentCardId === item.id) delete session.currentCardId;
  if (rating === 1) {
    data.mistakes[item.id] = {
      cardId: item.id,
      addedAt: data.mistakes[item.id]?.addedAt ?? now,
      source: data.mistakes[item.id]?.source ?? "review",
      archived: false,
    };
  }
  return true;
}

export function streak(sessions: Session[], today: string): number {
  const completed = new Set(
    sessions
      .filter(
        (session) =>
          session.kind !== "extra" &&
          !session.manualCheckpoint &&
          session.completedAt !== null &&
          session.studyDate <= today,
      )
      .map((session) => session.studyDate),
  );
  let cursor = completed.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (completed.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}
