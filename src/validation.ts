import { z } from "zod";
import { ISSUE_TAGS, PHASES } from "./types";
import type { Catalog, ProgressData, RecordingMeta } from "./types";
const finite = z.number().finite();
const positiveInt = finite.int().nonnegative();
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date.");
const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Unknown timezone.");
const register = z.enum(["casual", "polite", "keigo"]);
const review = z.object({
  status: z.enum(["draft", "ai-reviewed", "native-reviewed"]),
  reviewer: z.string().min(1),
  date: dateSchema,
});
const alternative = z.object({
  text: z.string().min(1),
  context: z.string().min(1),
});
export const productionSchema = z.object({
  id: z.string().min(1),
  revision: positiveInt.min(1),
  kind: z.enum(["card", "keigo", "diagnostic"]),
  prompt: z.string().min(1),
  promptJapanese: z.string().optional(),
  answer: z.string().min(1),
  alternatives: z.array(alternative),
  notes: z.string(),
  register,
  keigoType: z.enum(["honorific", "humble", "both"]).optional(),
  phaseTags: z.array(z.enum(PHASES)).min(1),
  skillTags: z
    .array(z.enum(["vocabulary", "grammar", "readings", "keigo"]))
    .min(1),
  tripRelevant: z.boolean(),
  issueTags: z.array(z.enum(ISSUE_TAGS)),
  review,
  retired: z.boolean().optional(),
});
export const passageSchema = z.object({
  id: z.string().min(1),
  revision: positiveInt.min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  register,
  glossary: z.array(
    z.object({
      id: z.string().min(1),
      term: z.string().min(1),
      meaning: z.string().min(1),
    }),
  ),
  questions: z
    .array(z.object({ prompt: z.string().min(1), answer: z.string().min(1) }))
    .length(2),
  speechText: z.string().optional(),
  review,
});
export const scenarioSchema = z.object({
  id: z.string().min(1),
  revision: positiveInt.min(1),
  title: z.string().min(1),
  situation: z.string().min(1),
  register,
  mode: z.enum(["speaking", "email"]),
  phaseTags: z.array(z.enum(PHASES)).min(1),
  turns: z
    .array(
      z.object({
        id: z.string().min(1),
        partner: z.string(),
        prompt: z.string().min(1),
        answer: z.string().min(1),
        alternatives: z.array(alternative),
        notes: z.string(),
        issueTags: z.array(z.enum(ISSUE_TAGS)),
        speechText: z.string().optional(),
      }),
    )
    .min(1),
  review,
});
const contentSnapshot = z.union([
  productionSchema,
  passageSchema,
  scenarioSchema,
]);
export const catalogSchema = z.object({
  version: z.string().min(1),
  cards: z.array(productionSchema),
  keigoDrills: z.array(productionSchema),
  diagnostic: z.array(productionSchema),
  passages: z.array(passageSchema),
  scenarios: z.array(scenarioSchema),
});
const stringMap = z.record(z.string(), z.string());
const numberMap = z.record(z.string(), finite.nonnegative());
const rating = z.enum(["not-yet", "with-support", "independent"]);
const plan = z.object({
  startDate: dateSchema.nullable(),
  targetDate: dateSchema,
  dailyMinutes: finite.int().min(5).max(120),
  phaseWeights: z
    .tuple([
      finite.nonnegative(),
      finite.nonnegative(),
      finite.nonnegative(),
      finite.nonnegative(),
    ])
    .refine(
      (value) => value.reduce((a, b) => a + b, 0) > 0,
      "Choose at least one phase.",
    ),
  timezone,
});
export const settingsSchema = z.object({
  plan,
  furigana: z.boolean(),
  baselineRegister: z.enum(["polite", "casual"]),
  voiceURI: z.string(),
  lastExportAt: finite.nonnegative().nullable(),
  installAcknowledged: z.boolean(),
});
const cardState = z
  .object({
    due: finite.nonnegative(),
    stability: finite.nonnegative(),
    difficulty: finite.nonnegative(),
    elapsed_days: positiveInt,
    scheduled_days: positiveInt,
    reps: positiveInt,
    lapses: positiveInt,
    state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    last_review: finite.nonnegative().optional(),
    learning_steps: positiveInt,
  })
  .passthrough();
export const progressSchema = z.object({
  settings: settingsSchema,
  catalogVersion: z.string().min(1),
  cardStates: z.record(z.string(), cardState),
  reviewEvents: z.array(
    z.object({
      id: z.string().min(1),
      cardId: z.string().min(1),
      sessionId: z.string().min(1),
      at: finite.nonnegative(),
      observationDate: dateSchema,
      rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      introduced: z.boolean(),
      contentRevision: positiveInt.min(1),
      log: z.record(z.string(), z.unknown()),
    }),
  ),
  sessions: z.array(
    z
      .object({
        id: z.string().min(1),
        studyDate: dateSchema,
        phase: z.enum(PHASES),
        kind: z.enum([
          "diagnostic",
          "daily",
          "checkpoint-a",
          "checkpoint-b",
          "extra",
        ]),
        checkpointIndex: positiveInt.optional(),
        createdAt: finite.nonnegative(),
        completedAt: finite.nonnegative().nullable(),
        stage: positiveInt,
        reviewElapsed: finite.nonnegative(),
        readingMode: z.enum(["reading", "shadowing"]),
        scenarioId: z.string(),
        passageId: z.string(),
        passageRepeated: z.boolean(),
        contentSnapshots: z.record(z.string(), contentSnapshot).optional(),
        currentCardId: z.string().min(1).optional(),
        diagnosticIds: z.array(z.string().min(1)).optional(),
        practiceGrades: z
          .record(
            z.string(),
            z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
          )
          .optional(),
        manualCheckpoint: z.boolean().optional(),
        drafts: stringMap,
        ratings: z.record(z.string(), rating),
        completedTasks: z.array(z.string()),
        recordingIds: stringMap,
        lookedUp: z.array(z.string()),
        externalLookups: positiveInt,
        assisted: z.boolean(),
        startedTasks: numberMap,
        finishedTasks: numberMap,
        summary: z.string(),
      })
      .superRefine((session, context) => {
        for (const [id, item] of Object.entries(session.contentSnapshots ?? {}))
          if (id !== item.id)
            context.addIssue({
              code: "custom",
              path: ["contentSnapshots", id],
              message: "Session content snapshot ID mismatch.",
            });
        if (session.currentCardId && session.contentSnapshots !== undefined) {
          const active = session.contentSnapshots[session.currentCardId];
          if (!active || !("kind" in active) || active.kind === "diagnostic")
            context.addIssue({
              code: "custom",
              path: ["currentCardId"],
              message:
                "The active production card needs a saved session snapshot.",
            });
        }
        if (session.diagnosticIds) {
          if (
            new Set(session.diagnosticIds).size !== session.diagnosticIds.length
          )
            context.addIssue({
              code: "custom",
              path: ["diagnosticIds"],
              message: "Duplicate diagnostic prompts.",
            });
          for (const id of session.diagnosticIds) {
            const item = session.contentSnapshots?.[id];
            if (!item || !("kind" in item) || item.kind !== "diagnostic")
              context.addIssue({
                code: "custom",
                path: ["diagnosticIds"],
                message:
                  "The diagnostic sequence needs its saved prompt definitions.",
              });
          }
        }
      }),
  ),
  userCards: z.array(productionSchema),
  mistakes: z.record(
    z.string(),
    z.object({
      cardId: z.string().min(1),
      addedAt: finite.nonnegative(),
      source: z.enum(["review", "manual", "output"]),
      archived: z.boolean(),
    }),
  ),
  observations: z.array(
    z.object({
      id: z.string().min(1),
      issue: z.enum(ISSUE_TAGS),
      sessionId: z.string().min(1),
      at: finite.nonnegative(),
      date: dateSchema,
      sourceId: z.string().min(1),
    }),
  ),
  diagnosticGrades: z.record(
    z.string(),
    z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  ),
  diagnosticComplete: z.boolean(),
  snapshots: z.record(z.string(), contentSnapshot),
});
export const recordingSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  taskId: z.string().min(1),
  mimeType: z.string().min(1),
  startedAt: finite.nonnegative(),
  durationMs: finite.nonnegative(),
  size: positiveInt.max(64 * 1024 * 1024),
  chunks: positiveInt,
  status: z.enum(["recording", "complete", "interrupted"]),
  interrupted: z.boolean(),
});
export function parseCatalog(input: unknown): Catalog {
  return catalogSchema.parse(input) as Catalog;
}
export function parseProgress(input: unknown): ProgressData {
  return progressSchema.parse(input) as ProgressData;
}
export function parseRecording(input: unknown): RecordingMeta {
  return recordingSchema.parse(input);
}
