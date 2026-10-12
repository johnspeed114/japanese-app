import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import {
  addDays,
  applyGrade,
  availablePassageIds,
  checkpointCount,
  checkpointOnDate,
  confirmedPatterns,
  createSession,
  dateInZone,
  daysBetween,
  diagnosticWeaknesses,
  hasPriorPassageExposure,
  phaseLengths,
  phaseOnDate,
  pinContentForSession,
  resolveReviewContent,
  resolveSessionContent,
  reviewBudgetSeconds,
  saveContentSnapshot,
  selectNextCard,
  streak,
} from "../src/engine";
import { parseProgress } from "../src/validation";
import type {
  Catalog,
  Observation,
  PlanConfig,
  ProductionItem,
  ProgressData,
} from "../src/types";

const NOW = Date.parse("2026-10-11T19:00:00Z");
const review = {
  status: "ai-reviewed" as const,
  reviewer: "Language reviewer",
  date: "2026-10-11",
};

function plan(startDate = "2026-10-11", targetDate = "2026-12-02"): PlanConfig {
  return {
    startDate,
    targetDate,
    dailyMinutes: 30,
    phaseWeights: [15, 35, 25, 25],
    timezone: "America/Los_Angeles",
  };
}

function item(
  id: string,
  overrides: Partial<ProductionItem> = {},
): ProductionItem {
  return {
    id,
    revision: 1,
    kind: "card",
    prompt: "Introduce your work politely.",
    answer: "ソフトウェアを開発しています。",
    alternatives: [],
    notes: "",
    register: "polite",
    phaseTags: ["reactivation"],
    skillTags: ["vocabulary"],
    tripRelevant: false,
    issueTags: ["vocabulary-recall"],
    review,
    ...overrides,
  };
}

function catalog(
  cards = [item("one"), item("two"), item("three"), item("four"), item("five")],
): Catalog {
  return {
    version: "1",
    cards,
    keigoDrills: [],
    diagnostic: [],
    passages: Array.from({ length: 10 }, (_, index) => ({
      id: `passage-${index}`,
      revision: 1,
      title: "記事",
      body: "日本語の記事です。",
      register: "polite",
      glossary: [],
      questions: [
        { prompt: "What is this?", answer: "記事です。" },
        { prompt: "What language is it in?", answer: "日本語です。" },
      ],
      review,
    })),
    scenarios: [
      {
        id: "introduce",
        revision: 1,
        title: "紹介",
        situation: "仕事を紹介します。",
        register: "polite",
        mode: "speaking",
        phaseTags: ["reactivation", "core", "business", "trip"],
        turns: [
          {
            id: "greeting",
            partner: "初めまして。",
            prompt: "Greet your contact.",
            answer: "初めまして。",
            alternatives: [],
            notes: "",
            issueTags: [],
          },
        ],
        review,
      },
    ],
  };
}

function progress(): ProgressData {
  return {
    settings: {
      plan: plan(),
      furigana: false,
      baselineRegister: "polite",
      voiceURI: "",
      lastExportAt: null,
      installAcknowledged: false,
    },
    catalogVersion: "1",
    cardStates: {},
    reviewEvents: [],
    sessions: [],
    userCards: [],
    mistakes: {},
    observations: [],
    diagnosticGrades: {},
    diagnosticComplete: true,
    snapshots: {},
  };
}

function observation(
  id: string,
  date: string,
  sessionId: string,
  issue: Observation["issue"] = "missing-na",
): Observation {
  return { id, date, sessionId, issue, at: NOW, sourceId: "diagnostic-probe" };
}

describe("calendar plan", () => {
  it("derives dates in the saved timezone rather than UTC or the host timezone", () => {
    const midnightUTC = Date.parse("2026-10-12T01:00:00Z");
    expect(dateInZone(midnightUTC, "America/Los_Angeles")).toBe("2026-10-11");
    expect(dateInZone(midnightUTC, "Asia/Tokyo")).toBe("2026-10-12");
  });

  it("uses calendar arithmetic across DST and rejects impossible dates", () => {
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("2026-10-11", 0.5)).toThrow();
  });

  it("allocates all 52 or 51 days using largest remainders and stable ties", () => {
    expect(daysBetween("2026-10-11", "2026-12-02")).toBe(52);
    expect(phaseLengths(plan())).toEqual([8, 18, 13, 13]);
    expect(phaseLengths(plan("2026-10-12"))).toEqual([7, 18, 13, 13]);
    expect(
      phaseLengths({
        ...plan("2026-10-11", "2026-10-13"),
        phaseWeights: [1, 1, 1, 1],
      }),
    ).toEqual([1, 1, 0, 0]);
  });

  it("advances phases on calendar boundaries even when no sessions were completed", () => {
    expect(phaseOnDate(plan(), "2026-10-18")).toBe("reactivation");
    expect(phaseOnDate(plan(), "2026-10-19")).toBe("core");
    expect(phaseOnDate(plan(), "2026-11-06")).toBe("business");
    expect(phaseOnDate(plan(), "2026-11-19")).toBe("trip");
    expect(phaseOnDate(plan(), "2026-12-02")).toBe("trip");
  });

  it("schedules only complete checkpoint pairs before the exclusive target", () => {
    expect(checkpointCount(plan())).toBe(7);
    expect(checkpointCount(plan("2026-10-12"))).toBe(7);
    expect(checkpointOnDate(plan(), "2026-10-17")).toEqual({
      kind: "checkpoint-a",
      index: 0,
    });
    expect(checkpointOnDate(plan(), "2026-10-18")).toEqual({
      kind: "checkpoint-b",
      index: 0,
    });
    expect(checkpointOnDate(plan(), "2026-11-29")).toEqual({
      kind: "checkpoint-b",
      index: 6,
    });
    expect(checkpointOnDate(plan(), "2026-12-02")).toBeNull();
    expect(checkpointCount(plan("2026-10-11", "2026-10-18"))).toBe(0);
    expect(
      checkpointOnDate(plan("2026-10-11", "2026-10-18"), "2026-10-17"),
    ).toBeNull();
  });
});

describe("sessions and reserved reading", () => {
  it("retains IDs, date, phase and drafts when an old session resumes after midnight", () => {
    const data = progress();
    const content = catalog();
    const session = createSession(data, "2026-10-18", NOW, content, "daily");
    session.drafts.answer = "途中の回答";
    const resumed = createSession(
      data,
      "2026-10-18",
      Date.parse("2026-10-19T08:05:00Z"),
      content,
      "daily",
    );
    expect(resumed).toBe(session);
    expect(resumed.studyDate).toBe("2026-10-18");
    expect(resumed.phase).toBe("reactivation");
    expect(resumed.drafts.answer).toBe("途中の回答");
    const next = createSession(data, "2026-10-19", NOW, content);
    expect(next.id).not.toBe(session.id);
    expect(next.phase).toBe("core");
  });

  it("anchors a null start date when study actually begins and gives extras unique IDs", () => {
    const data = progress();
    data.settings.plan.startDate = null;
    data.diagnosticComplete = false;
    const diagnostic = createSession(data, "2026-10-14", NOW, catalog());
    expect(data.settings.plan.startDate).toBe("2026-10-14");
    expect(diagnostic.kind).toBe("diagnostic");
    const first = createSession(data, "2026-10-14", NOW, catalog(), "extra");
    const second = createSession(data, "2026-10-14", NOW, catalog(), "extra");
    expect(first.id).not.toBe(second.id);
  });

  it("keeps practice before the diagnostic from starting the plan early", () => {
    const data = progress();
    const content = catalog();
    data.settings.plan.startDate = null;
    data.diagnosticComplete = false;
    const practice = createSession(data, "2026-10-12", NOW, content, "extra");
    expect(data.settings.plan.startDate).toBeNull();
    expect(practice.passageId).toBe("passage-0");
    expect(
      availablePassageIds(
        data.settings.plan,
        "2026-10-12",
        content.passages,
        data.sessions,
      ),
    ).toEqual(["passage-0", "passage-1", "passage-2"]);
    const diagnostic = createSession(data, "2026-10-14", NOW + 1, content);
    expect(diagnostic.kind).toBe("diagnostic");
    expect(data.settings.plan.startDate).toBe("2026-10-14");
    expect(
      daysBetween(data.settings.plan.startDate!, data.settings.plan.targetDate),
    ).toBe(49);
    expect(checkpointCount(data.settings.plan)).toBe(6);
    expect(practice.studyDate).toBe("2026-10-12");
  });

  it("restores the earliest diagnostic anchor before choosing checkpoints without redating history", () => {
    const data = progress();
    const content = catalog();
    data.settings.plan.startDate = "2026-10-14";
    createSession(data, "2026-10-15", NOW, content, "diagnostic");
    createSession(data, "2026-10-14", NOW + 1, content, "diagnostic");
    createSession(data, "2026-10-16", NOW + 2, content, "daily");
    const historicalDates = data.sessions.map((session) => [
      session.id,
      session.studyDate,
    ]);
    data.settings.plan.startDate = null;
    const checkpoint = createSession(data, "2026-10-21", NOW + 3, content);
    expect(data.settings.plan.startDate).toBe("2026-10-14");
    expect(checkpoint.kind).toBe("checkpoint-b");
    expect(checkpoint.checkpointIndex).toBe(0);
    expect(
      data.sessions
        .slice(0, 3)
        .map((session) => [session.id, session.studyDate]),
    ).toEqual(historicalDates);
  });

  it("anchors ordinary legacy study on its date when no diagnostic history exists", () => {
    const data = progress();
    data.settings.plan.startDate = null;
    const session = createSession(data, "2026-10-14", NOW, catalog());
    expect(session.kind).toBe("daily");
    expect(data.settings.plan.startDate).toBe("2026-10-14");
  });

  it("alternates only after completed ordinary sessions", () => {
    const data = progress();
    const content = catalog();
    const first = createSession(data, "2026-10-11", NOW, content);
    expect(first.readingMode).toBe("reading");
    const incomplete = createSession(data, "2026-10-12", NOW, content);
    expect(incomplete.readingMode).toBe("reading");
    first.completedAt = NOW;
    const checkpoint = createSession(data, "2026-10-17", NOW, content);
    checkpoint.completedAt = NOW;
    const second = createSession(data, "2026-10-19", NOW, content);
    expect(second.readingMode).toBe("shadowing");
  });

  it("unlocks checkpoint readings after completion or their date passes, including missed slots", () => {
    const data = progress();
    const content = catalog();
    expect(
      availablePassageIds(plan(), "2026-10-18", content.passages, []),
    ).toEqual(["passage-0", "passage-1", "passage-2"]);
    expect(
      availablePassageIds(plan(), "2026-10-19", content.passages, []),
    ).toContain("passage-3");
    const checkpoint = createSession(data, "2026-10-18", NOW, content);
    expect(checkpoint.passageId).toBe("passage-3");
    checkpoint.completedAt = NOW;
    expect(
      availablePassageIds(
        plan(),
        "2026-10-18",
        content.passages,
        data.sessions,
      ),
    ).toContain("passage-3");
  });

  it("releases unused checkpoint pool readings after the final scheduled B and releases all for zero pairs", () => {
    const content = catalog();
    const shorter = plan("2026-10-11", "2026-10-20");
    expect(
      availablePassageIds(shorter, "2026-10-18", content.passages, []),
    ).toHaveLength(3);
    expect(
      availablePassageIds(shorter, "2026-10-19", content.passages, []),
    ).toHaveLength(10);
    expect(
      availablePassageIds(
        plan("2026-10-11", "2026-10-15"),
        "2026-10-11",
        content.passages,
        [],
      ),
    ).toHaveLength(10);
  });

  it("reserves unfamiliar checkpoint passages before the diagnostic sets a start date", () => {
    const pending = { ...plan(), startDate: null };
    expect(
      availablePassageIds(pending, "2026-10-12", catalog().passages, []),
    ).toEqual(["passage-0", "passage-1", "passage-2"]);
    expect(pending.startDate).toBeNull();
    expect(
      availablePassageIds(
        { ...pending, targetDate: "2026-10-15" },
        "2026-10-12",
        catalog().passages,
        [],
      ),
    ).toHaveLength(10);
  });

  it("releases the whole pool immediately after the final reading checkpoint is completed", () => {
    const data = progress();
    data.settings.plan = plan("2026-10-11", "2026-10-20");
    const content = catalog();
    const final = createSession(data, "2026-10-18", NOW, content);
    final.completedAt = NOW;
    expect(
      availablePassageIds(
        data.settings.plan,
        "2026-10-18",
        content.passages,
        data.sessions,
      ),
    ).toHaveLength(10);
  });

  it("marks repeated checkpoint passages when a longer plan reuses its seven-passage pool", () => {
    const data = progress();
    data.settings.plan = plan("2026-09-01");
    const session = createSession(data, "2026-10-27", NOW, catalog());
    expect(session.kind).toBe("checkpoint-b");
    expect(session.checkpointIndex).toBe(7);
    expect(session.passageId).toBe("passage-3");
    expect(session.passageRepeated).toBe(true);
  });

  it("keeps manual checkpoints separate from planned sessions, streaks and reservation release", () => {
    const data = progress();
    data.settings.plan = plan("2026-10-11", "2026-10-20");
    const content = catalog();
    const manual = createSession(data, "2026-10-18", NOW, content, "extra");
    manual.kind = "checkpoint-b";
    manual.checkpointIndex = 0;
    manual.manualCheckpoint = true;
    manual.completedAt = NOW;
    expect(streak(data.sessions, "2026-10-18")).toBe(0);
    expect(
      availablePassageIds(
        data.settings.plan,
        "2026-10-18",
        content.passages,
        data.sessions,
      ),
    ).toHaveLength(3);
    const planned = createSession(data, "2026-10-18", NOW + 1, content);
    expect(planned.id).not.toBe(manual.id);
    expect(planned.passageId).toBe("passage-3");
    expect(planned.passageRepeated).toBe(false);
    planned.completedAt = NOW + 2;
    expect(streak(data.sessions, "2026-10-18")).toBe(1);
    expect(
      availablePassageIds(
        data.settings.plan,
        "2026-10-18",
        content.passages,
        data.sessions,
      ),
    ).toHaveLength(10);
    expect(
      parseProgress(JSON.parse(JSON.stringify(data))).sessions[0]
        .manualCheckpoint,
    ).toBe(true);
  });

  it("marks an early-pool checkpoint familiar when that passage was already exposed", () => {
    const data = progress();
    const content = catalog();
    const earlier = createSession(data, "2026-10-16", NOW, content, "extra");
    earlier.passageId = "passage-3";
    earlier.startedTasks.reading = 0;
    const checkpoint = createSession(data, "2026-10-18", NOW + 1, content);
    expect(checkpoint.checkpointIndex).toBe(0);
    expect(checkpoint.passageRepeated).toBe(true);
  });

  it("detects exposure after checkpoint creation without treating its own ongoing reading as a new exposure", () => {
    const data = progress();
    const content = catalog();
    const checkpoint = createSession(data, "2026-10-18", NOW, content);
    checkpoint.startedTasks.reading = NOW;
    expect(hasPriorPassageExposure(data, checkpoint)).toBe(false);
    const laterPractice = createSession(
      data,
      "2026-10-19",
      NOW + 86_400_000,
      content,
      "extra",
    );
    laterPractice.passageId = checkpoint.passageId;
    laterPractice.startedTasks.reading = NOW + 86_400_000;
    expect(hasPriorPassageExposure(data, checkpoint)).toBe(true);
    const resumed = createSession(
      data,
      "2026-10-18",
      NOW + 86_400_001,
      content,
    );
    expect(resumed.id).toBe(checkpoint.id);
    expect(resumed.passageRepeated).toBe(true);
  });
});

describe("historical content revisions", () => {
  it("resumes and grades the displayed revision after an update, midnight and budget expiration", () => {
    const data = progress();
    const original = item("one", { answer: "以前の答えです。" });
    const content = catalog([original]);
    const session = createSession(data, "2026-10-11", NOW, content);
    pinContentForSession(data, session, original);
    session.drafts["card:one"] = "途中の答え";
    const revised = {
      ...original,
      revision: 2,
      prompt: "An updated prompt",
      answer: "更新後の答えです。",
    };
    saveContentSnapshot(data, revised);
    const current = catalog([revised]);
    const resumed = selectNextCard(
      data,
      session,
      current,
      NOW + 86_400_000,
      500,
    );
    expect(resumed?.answer).toBe(original.answer);
    expect(resumed?.revision).toBe(1);
    expect(
      resolveSessionContent(data, session, original.id, revised)?.revision,
    ).toBe(1);
    applyGrade(data, revised, 3, session.id, NOW + 86_400_000);
    expect(data.reviewEvents[0].contentRevision).toBe(1);
    expect(resolveReviewContent(data, data.reviewEvents[0])?.answer).toBe(
      original.answer,
    );
    expect(session.currentCardId).toBeUndefined();
    expect(data.snapshots.one.revision).toBe(2);
    const next = createSession(data, "2026-10-12", NOW + 86_400_000, current);
    pinContentForSession(data, next, revised);
    applyGrade(data, revised, 4, next.id, NOW + 86_400_000);
    const restored = parseProgress(JSON.parse(JSON.stringify(data)));
    expect(
      resolveReviewContent(restored, restored.reviewEvents[0])?.answer,
    ).toBe(original.answer);
    expect(
      resolveReviewContent(restored, restored.reviewEvents[1])?.answer,
    ).toBe(revised.answer);
  });

  it("keeps old scenario and passage definitions while new sessions receive their revisions", () => {
    const data = progress();
    const original = catalog();
    const first = createSession(data, "2026-10-11", NOW, original);
    const revised = structuredClone(original);
    revised.passages[0] = {
      ...revised.passages[0],
      revision: 2,
      body: "更新された記事です。",
    };
    revised.scenarios[0] = {
      ...revised.scenarios[0],
      revision: 2,
      title: "Revised conversation",
    };
    saveContentSnapshot(data, revised.passages[0]);
    saveContentSnapshot(data, revised.scenarios[0]);
    expect(
      resolveSessionContent(data, first, first.passageId, revised.passages[0])
        ?.revision,
    ).toBe(1);
    expect(
      resolveSessionContent(data, first, first.scenarioId, revised.scenarios[0])
        ?.revision,
    ).toBe(1);
    const next = createSession(data, "2026-10-12", NOW, revised);
    expect(next.contentSnapshots?.[next.passageId].revision).toBe(2);
    expect(next.contentSnapshots?.[next.scenarioId].revision).toBe(2);
  });

  it("preserves available legacy definitions before replacing their global fallback", () => {
    const data = progress();
    const original = item("one");
    const session = createSession(data, "2026-10-11", NOW, catalog([original]));
    applyGrade(data, original, 3, session.id, NOW);
    delete session.contentSnapshots;
    const legacy = parseProgress(JSON.parse(JSON.stringify(data)));
    expect(legacy.sessions[0].contentSnapshots).toBeUndefined();
    const revised = { ...original, revision: 2, answer: "変更した答え" };
    expect(
      resolveSessionContent(legacy, legacy.sessions[0], "one", revised)
        ?.revision,
    ).toBe(1);
    saveContentSnapshot(legacy, revised);
    expect(legacy.snapshots.one.revision).toBe(2);
    expect(legacy.sessions[0].contentSnapshots?.one.revision).toBe(1);
    expect(resolveReviewContent(legacy, legacy.reviewEvents[0])?.revision).toBe(
      1,
    );
  });

  it("does not substitute a newer answer when a legacy attempt definition was already lost", () => {
    const data = progress();
    const original = item("one");
    const session = createSession(data, "2026-10-11", NOW, catalog([original]));
    applyGrade(data, original, 3, session.id, NOW);
    delete session.contentSnapshots;
    data.snapshots.one = { ...original, revision: 2 };
    expect(resolveReviewContent(data, data.reviewEvents[0])).toBeUndefined();
  });

  it("freezes diagnostic order and skill labels rather than reinterpreting past grades", () => {
    const data = progress();
    data.diagnosticComplete = false;
    const content = catalog();
    content.diagnostic = [
      item("diag-a", { kind: "diagnostic", skillTags: ["grammar"] }),
      item("diag-b", { kind: "diagnostic" }),
    ];
    const session = createSession(data, "2026-10-11", NOW, content);
    data.diagnosticGrades["diag-a"] = 1;
    session.completedTasks.push("diag-a");
    const revised = {
      ...content.diagnostic[0],
      revision: 2,
      skillTags: ["keigo" as const],
    };
    saveContentSnapshot(data, revised);
    content.diagnostic = [content.diagnostic[1], revised];
    expect(session.diagnosticIds).toEqual(["diag-a", "diag-b"]);
    expect(diagnosticWeaknesses(data, content)).toMatchObject({
      grammar: 1,
      keigo: 0,
    });
  });

  it("rejects mismatched pinned IDs and dangling active-card references on import", () => {
    const data = progress();
    const session = createSession(data, "2026-10-11", NOW, catalog());
    session.contentSnapshots!.bad = item("different-id");
    expect(() => parseProgress(data)).toThrow("snapshot ID mismatch");
    delete session.contentSnapshots!.bad;
    session.currentCardId = "not-saved";
    expect(() => parseProgress(data)).toThrow("saved session snapshot");
  });
});

describe("production SRS", () => {
  it("keeps Again due tomorrow and exposes no minute-scale learning step", () => {
    const data = progress();
    const content = catalog();
    const session = createSession(data, "2026-10-11", NOW, content);
    applyGrade(data, content.cards[0], 1, session.id, NOW);
    expect(data.cardStates.one.state).toBe(State.Review);
    expect(data.cardStates.one.due).toBe(NOW + 86_400_000);
    expect(data.cardStates.one.learning_steps).toBe(0);
    expect(data.mistakes.one.archived).toBe(false);
    expect(
      selectNextCard(data, session, content, NOW + 600_000, 400)?.id,
    ).not.toBe("one");
  });

  it("is idempotent for the same card and session and records the actual timezone date", () => {
    const data = progress();
    const content = catalog();
    const session = createSession(data, "2026-10-11", NOW, content);
    const afterMidnight = Date.parse("2026-10-12T08:05:00Z");
    expect(
      applyGrade(data, content.cards[0], 1, session.id, afterMidnight),
    ).toBe(true);
    const due = data.cardStates.one.due;
    expect(
      applyGrade(data, content.cards[0], 4, session.id, afterMidnight + 1000),
    ).toBe(false);
    expect(data.reviewEvents).toHaveLength(1);
    expect(data.observations).toHaveLength(0);
    expect(data.cardStates.one.due).toBe(due);
    expect(data.reviewEvents[0].observationDate).toBe("2026-10-12");
    expect(session.studyDate).toBe("2026-10-11");
  });

  it("serves overdue cards before new cards and uses actual due timestamps", () => {
    const data = progress();
    const content = catalog();
    const yesterday = createSession(
      data,
      "2026-10-10",
      NOW - 86_400_000,
      content,
      "daily",
    );
    applyGrade(data, content.cards[1], 1, yesterday.id, NOW - 86_400_000);
    const today = createSession(data, "2026-10-11", NOW, content);
    expect(selectNextCard(data, today, content, NOW, 0)?.id).toBe("two");
    expect(selectNextCard(data, today, content, NOW - 1, 0)?.id).not.toBe(
      "two",
    );
    expect(selectNextCard(data, today, content, NOW, 470)?.id).toBe("two");
    expect(selectNextCard(data, today, content, NOW, 480)).toBeNull();
  });

  it("gates new introductions on remaining time and caps them across sessions on the actual day", () => {
    const data = progress();
    const content = catalog();
    const session = createSession(data, "2026-10-11", NOW, content);
    expect(selectNextCard(data, session, content, NOW, 421)).toBeNull();
    expect(selectNextCard(data, session, content, NOW, 420)).not.toBeNull();
    for (const card of content.cards.slice(0, 4))
      applyGrade(data, card, 3, session.id, NOW);
    expect(selectNextCard(data, session, content, NOW, 0)).toBeNull();
    const nextDay = createSession(
      data,
      "2026-10-12",
      NOW + 86_400_000,
      content,
    );
    expect(
      selectNextCard(data, nextDay, content, NOW + 86_400_000, 0)?.id,
    ).toBe("five");
  });

  it("permits a three-minute due-only review on checkpoint days", () => {
    const data = progress();
    const content = catalog();
    const previous = createSession(
      data,
      "2026-10-16",
      NOW - 86_400_000,
      content,
      "daily",
    );
    applyGrade(data, content.cards[0], 1, previous.id, NOW - 86_400_000);
    const checkpoint = createSession(data, "2026-10-17", NOW, content);
    expect(checkpoint.kind).toBe("checkpoint-a");
    expect(selectNextCard(data, checkpoint, content, NOW, 179)?.id).toBe("one");
    expect(selectNextCard(data, checkpoint, content, NOW, 180)).toBeNull();
    applyGrade(data, content.cards[0], 3, checkpoint.id, NOW);
    expect(selectNextCard(data, checkpoint, content, NOW, 0)).toBeNull();
  });

  it("scales review time with configured study minutes while retaining the one-minute new-card gate", () => {
    const data = progress();
    data.settings.plan.dailyMinutes = 15;
    const content = catalog();
    const daily = createSession(data, "2026-10-11", NOW, content);
    const checkpoint = createSession(data, "2026-10-17", NOW, content);
    expect(reviewBudgetSeconds(data, daily)).toBe(240);
    expect(reviewBudgetSeconds(data, checkpoint)).toBe(90);
    expect(selectNextCard(data, daily, content, NOW, 180)).not.toBeNull();
    expect(selectNextCard(data, daily, content, NOW, 181)).toBeNull();
  });

  it("prioritizes diagnosed weak domains, then trip relevance, then phase relevance", () => {
    const cards = [
      item("a-trip", { tripRelevant: true }),
      item("b-grammar", { skillTags: ["grammar"] }),
      item("c-phase", { phaseTags: ["reactivation"] }),
    ];
    const content = catalog(cards);
    content.diagnostic = [
      item("grammar-test", { kind: "diagnostic", skillTags: ["grammar"] }),
    ];
    const data = progress();
    data.diagnosticGrades["grammar-test"] = 1;
    const session = createSession(data, "2026-10-11", NOW, content);
    expect(diagnosticWeaknesses(data, content).grammar).toBe(1);
    expect(selectNextCard(data, session, content, NOW, 0)?.id).toBe(
      "b-grammar",
    );
    applyGrade(data, cards[1], 3, session.id, NOW);
    expect(selectNextCard(data, session, content, NOW, 0)?.id).toBe("a-trip");
  });

  it("keeps studied snapshots reviewable when their catalog entry disappears or retires", () => {
    const data = progress();
    const content = catalog();
    const previous = createSession(
      data,
      "2026-10-10",
      NOW - 86_400_000,
      content,
      "daily",
    );
    applyGrade(data, content.cards[0], 1, previous.id, NOW - 86_400_000);
    const today = createSession(data, "2026-10-11", NOW, content);
    const updated = catalog(content.cards.filter((card) => card.id !== "one"));
    expect(selectNextCard(data, today, updated, NOW, 0)?.id).toBe("one");
    updated.cards.push({ ...content.cards[0], retired: true });
    expect(selectNextCard(data, today, updated, NOW, 0)?.id).toBe("one");
  });

  it("does not boost a narrow March probe until the user confirms recurrence on separate days", () => {
    const data = progress();
    const content = catalog([
      item("a-general"),
      item("z-probe", { issueTags: ["missing-na"] }),
    ]);
    const session = createSession(data, "2026-10-11", NOW, content);
    data.observations = [observation("1", "2026-10-10", "earlier")];
    expect(selectNextCard(data, session, content, NOW, 0)?.id).toBe(
      "a-general",
    );
    data.observations.push(observation("2", "2026-10-11", session.id));
    expect(selectNextCard(data, session, content, NOW, 0)?.id).toBe("z-probe");
  });
});

describe("patterns and streaks", () => {
  it("requires both different observation dates and separate sessions", () => {
    expect(confirmedPatterns([observation("1", "2026-10-11", "one")])).toEqual(
      [],
    );
    expect(
      confirmedPatterns([
        observation("1", "2026-10-11", "one"),
        observation("2", "2026-10-11", "two"),
      ]),
    ).toEqual([]);
    expect(
      confirmedPatterns([
        observation("1", "2026-10-11", "one"),
        observation("2", "2026-10-12", "one"),
      ]),
    ).toEqual([]);
    expect(
      confirmedPatterns([
        observation("1", "2026-10-11", "one"),
        observation("2", "2026-10-12", "two"),
      ]),
    ).toEqual(["missing-na"]);
  });

  it("counts completed scheduled study dates once and ignores extra practice", () => {
    const data = progress();
    const content = catalog();
    for (const date of ["2026-10-11", "2026-10-12"])
      createSession(data, date, NOW, content).completedAt = NOW;
    createSession(data, "2026-10-13", NOW, content, "extra").completedAt = NOW;
    expect(streak(data.sessions, "2026-10-13")).toBe(2);
    expect(streak(data.sessions, "2026-10-14")).toBe(0);
    createSession(data, "2026-10-13", NOW, content).completedAt = NOW;
    expect(streak(data.sessions, "2026-10-13")).toBe(3);
  });
});
