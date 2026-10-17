import type { Card } from "ts-fsrs";
export const PHASES = ["reactivation", "core", "business", "trip"] as const;
export type Phase = (typeof PHASES)[number];
export type Skill = "vocabulary" | "grammar" | "readings" | "keigo";
export type Register = "casual" | "polite" | "keigo";
export const ISSUE_TAGS = [
  "vocabulary-recall",
  "grammar-form",
  "kanji-reading",
  "missing-na",
  "katakana-spelling",
  "long-vowels",
  "honorific",
  "humble",
  "register",
  "naturalness",
] as const;
export type IssueTag = (typeof ISSUE_TAGS)[number];
export type SelfRating = "not-yet" | "with-support" | "independent";
export type ReviewInfo = {
  status: "draft" | "ai-reviewed" | "native-reviewed";
  reviewer: string;
  date: string;
};
export type Alternative = { text: string; context: string };
export interface ProductionItem {
  id: string;
  revision: number;
  kind: "card" | "keigo" | "diagnostic";
  prompt: string;
  promptJapanese?: string;
  answer: string;
  alternatives: Alternative[];
  notes: string;
  register: Register;
  keigoType?: "honorific" | "humble" | "both";
  phaseTags: Phase[];
  skillTags: Skill[];
  tripRelevant: boolean;
  issueTags: IssueTag[];
  review: ReviewInfo;
  retired?: boolean;
}
export interface Passage {
  id: string;
  revision: number;
  title: string;
  body: string;
  register: Register;
  glossary: { id: string; term: string; meaning: string }[];
  questions: { prompt: string; answer: string }[];
  speechText?: string;
  review: ReviewInfo;
}
export interface ScenarioTurn {
  id: string;
  partner: string;
  prompt: string;
  answer: string;
  alternatives: Alternative[];
  notes: string;
  issueTags: IssueTag[];
  speechText?: string;
}
export interface Scenario {
  id: string;
  revision: number;
  title: string;
  situation: string;
  register: Register;
  mode: "speaking" | "email";
  phaseTags: Phase[];
  turns: ScenarioTurn[];
  review: ReviewInfo;
}
export type ContentSnapshot = ProductionItem | Passage | Scenario;
export interface Catalog {
  version: string;
  cards: ProductionItem[];
  keigoDrills: ProductionItem[];
  diagnostic: ProductionItem[];
  passages: Passage[];
  scenarios: Scenario[];
}
export interface PlanConfig {
  startDate: string | null;
  targetDate: string;
  dailyMinutes: number;
  phaseWeights: [number, number, number, number];
  timezone: string;
}
export interface Settings {
  plan: PlanConfig;
  furigana: boolean;
  baselineRegister: "polite" | "casual";
  voiceURI: string;
  lastExportAt: number | null;
  installAcknowledged: boolean;
}
export type SerializedCard = Omit<Card, "due" | "last_review"> & {
  due: number;
  last_review?: number;
};
export interface ReviewEvent {
  id: string;
  cardId: string;
  sessionId: string;
  at: number;
  observationDate: string;
  rating: 1 | 2 | 3 | 4;
  introduced: boolean;
  contentRevision: number;
  log: Record<string, unknown>;
}
export interface Session {
  id: string;
  studyDate: string;
  phase: Phase;
  kind: "diagnostic" | "daily" | "checkpoint-a" | "checkpoint-b" | "extra";
  checkpointIndex?: number;
  createdAt: number;
  completedAt: number | null;
  stage: number;
  reviewElapsed: number;
  readingMode: "reading" | "shadowing";
  scenarioId: string;
  passageId: string;
  passageRepeated: boolean;
  contentSnapshots?: Record<string, ContentSnapshot>;
  currentCardId?: string;
  diagnosticIds?: string[];
  practiceGrades?: Record<string, ReviewEvent["rating"]>;
  manualCheckpoint?: boolean;
  drafts: Record<string, string>;
  ratings: Record<string, SelfRating>;
  completedTasks: string[];
  recordingIds: Record<string, string>;
  lookedUp: string[];
  externalLookups: number;
  assisted: boolean;
  startedTasks: Record<string, number>;
  finishedTasks: Record<string, number>;
  summary: string;
}
export interface Mistake {
  cardId: string;
  addedAt: number;
  source: "review" | "manual" | "output";
  archived: boolean;
}
export interface Observation {
  id: string;
  issue: IssueTag;
  sessionId: string;
  at: number;
  date: string;
  sourceId: string;
}
export interface ProgressData {
  settings: Settings;
  catalogVersion: string;
  cardStates: Record<string, SerializedCard>;
  reviewEvents: ReviewEvent[];
  sessions: Session[];
  userCards: ProductionItem[];
  mistakes: Record<string, Mistake>;
  observations: Observation[];
  diagnosticGrades: Record<string, 1 | 2 | 3 | 4>;
  diagnosticComplete: boolean;
  snapshots: Record<string, ContentSnapshot>;
}
export interface RecordingMeta {
  id: string;
  sessionId: string;
  taskId: string;
  mimeType: string;
  startedAt: number;
  durationMs: number;
  size: number;
  chunks: number;
  status: "recording" | "complete" | "interrupted";
  interrupted: boolean;
}
export const BASELINE_PROMPTS = [
  "初めて会う仕事関係の人に、あなたがどんな人で、どんなソフトウェアを作っているかを紹介してください。最後に、相手が答えやすい質問を一つしてください。",
  "久しぶりに会った同僚に、最近の仕事や生活で印象に残ったことを一つ話してください。最後に、相手に聞いてみたいことも一つ加えてください。",
] as const;
