import { readFile } from "node:fs/promises";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type {
  Catalog,
  ProductionItem,
  ProgressData,
  RecordingMeta,
  Session,
} from "../../src/types";
import {
  addDays,
  applyGrade,
  createSession,
  dateInZone,
} from "../../src/engine";
import { plainJapanese } from "../../src/japanese";
import type { SpeechClip, SpeechManifest } from "../../src/speech-audio";

type SpeechSimulation = {
  audio: (EventTarget & { src: string })[];
  played: string[];
  paused: string[];
  loads: number;
  spoken: string[];
};

// Queue/failure checks simulate events; the Chromium smoke below uses real MP3s.
async function simulatedSpeech(
  context: BrowserContext,
  audioMode: "playing" | "rejected" | "unsupported" = "playing",
) {
  await context.addInitScript(
    ({ audioMode }) => {
      const simulation: SpeechSimulation = {
        audio: [],
        played: [],
        paused: [],
        loads: 0,
        spoken: [],
      };
      Object.defineProperty(window, "__speechSimulation", {
        value: simulation,
      });
      class SimulatedAudio extends EventTarget {
        src = "";
        preload = "";
        constructor() {
          super();
          simulation.audio.push(this);
        }
        play() {
          simulation.played.push(this.src);
          return audioMode === "rejected"
            ? Promise.reject(
                new DOMException(
                  "Simulated decoder failure",
                  "NotSupportedError",
                ),
              )
            : Promise.resolve();
        }
        pause() {
          simulation.paused.push(this.src);
        }
        removeAttribute(name: string) {
          if (name === "src") this.src = "";
        }
        load() {
          simulation.loads++;
        }
      }
      Object.defineProperty(window, "Audio", {
        configurable: true,
        value: audioMode === "unsupported" ? undefined : SimulatedAudio,
      });
      const synthesis = new EventTarget();
      Object.assign(synthesis, {
        getVoices: () => [
          {
            default: true,
            lang: "ja-JP",
            localService: true,
            name: "Simulated Japanese voice",
            voiceURI: "simulation-ja",
          },
        ],
        speak: (utterance: { text: string }) =>
          simulation.spoken.push(utterance.text),
        cancel: () => {},
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: synthesis,
      });
      class SimulatedUtterance {
        voice?: SpeechSynthesisVoice;
        lang = "";
        rate = 1;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public text: string) {}
      }
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: SimulatedUtterance,
      });
    },
    { audioMode },
  );
}

async function speechState(page: Page) {
  return page.evaluate(() => {
    const simulation = Reflect.get(
      window,
      "__speechSimulation",
    ) as SpeechSimulation;
    return {
      played: simulation.played,
      paused: simulation.paused,
      loads: simulation.loads,
      spoken: simulation.spoken,
      sources: simulation.audio.map((audio) => audio.src),
    };
  });
}

async function speechEvent(page: Page, index: number, event = "ended") {
  await page.evaluate(
    ({ index, event }) => {
      const simulation = Reflect.get(
        window,
        "__speechSimulation",
      ) as SpeechSimulation;
      simulation.audio[index].dispatchEvent(new Event(event));
    },
    { index, event },
  );
}

async function speechClips(text: string): Promise<readonly SpeechClip[]> {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../src/content/speech-manifest.json", import.meta.url),
      "utf8",
    ),
  ) as SpeechManifest;
  expect(manifest.voice).toBe("marin");
  const clips =
    manifest.entries[plainJapanese(text).replace(/\s+/gu, " ").trim()];
  expect(
    clips,
    "the authored fixture must have bundled recorded speech",
  ).toBeDefined();
  return clips;
}

async function recordedCardFixture(page: Page) {
  const catalog = JSON.parse(
    await readFile(
      new URL("../../src/content/catalog.json", import.meta.url),
      "utf8",
    ),
  ) as Catalog;
  const item = catalog.cards[0];
  const clips = await speechClips(item.answer);
  await page.goto("./");
  await page.getByRole("link", { name: "Practice", exact: true }).click();
  await page
    .locator(".library-card")
    .filter({
      has: page.getByRole("heading", { name: item.prompt, exact: true }),
    })
    .getByRole("button", { name: "Practice this card", exact: true })
    .click();
  await page.getByRole("button", { name: "I don’t know", exact: true }).click();
  await expect(
    page.getByText("AI-generated Japanese voice", { exact: true }),
  ).toBeVisible();
  return { item, clips };
}

async function shadowingFixture(page: Page) {
  const { session, catalog } = await sessionFixture(
    page,
    "daily",
    2,
    (_data, _catalog, session) => {
      session.readingMode = "shadowing";
    },
  );
  const passage = catalog.passages.find(
    (value) => value.id === session.passageId,
  )!;
  const clips = await speechClips(passage.speechText ?? passage.body);
  await page
    .getByRole("button", { name: "Start shadowing", exact: true })
    .click();
  await expect(
    page.getByText("AI-generated Japanese voice", { exact: true }),
  ).toBeVisible();
  return { passage, clips };
}

async function observeRealSpeech(context: BrowserContext) {
  await context.addInitScript(() => {
    const nativeAudio = window.Audio;
    const observation = { audio: [] as HTMLAudioElement[], plays: 0 };
    Object.defineProperty(window, "__realSpeech", { value: observation });
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: function Audio(src?: string) {
        const element = new nativeAudio(src);
        observation.audio.push(element);
        const play = element.play.bind(element);
        element.play = () => {
          observation.plays++;
          return play();
        };
        return element;
      },
    });
  });
}

async function realSpeechState(page: Page) {
  return page.evaluate(() => {
    const observation = Reflect.get(window, "__realSpeech") as {
      audio: HTMLAudioElement[];
      plays: number;
    };
    return {
      plays: observation.plays,
      audio: observation.audio.map((element) => ({
        duration: element.duration,
        time: element.currentTime,
        paused: element.paused,
        crossOrigin: element.crossOrigin,
        error: element.error?.code ?? null,
      })),
    };
  });
}

async function progress(page: Page): Promise<ProgressData> {
  return page.evaluate(
    () =>
      new Promise<ProgressData>((resolve, reject) => {
        const request = indexedDB.open("japanese-reactivation");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["meta", "progress"]);
          const pointers = tx.objectStore("meta").get("active");
          pointers.onerror = () => reject(pointers.error);
          pointers.onsuccess = () => {
            const value = tx
              .objectStore("progress")
              .get(pointers.result.progress);
            value.onerror = () => reject(value.error);
            value.onsuccess = () => resolve(value.result as ProgressData);
          };
          tx.oncomplete = () => db.close();
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

// This exercises browser event handling and IndexedDB, not a microphone or codec.
// The emitted bytes are deliberately synthetic and cannot be used for playback QA.
async function simulatedMicrophone(context: BrowserContext, denied = false) {
  await context.addInitScript(
    ({ denied }) => {
      const simulation = {
        constraints: undefined as MediaStreamConstraints | undefined,
        options: undefined as MediaRecorderOptions | undefined,
        timeslice: 0,
        events: [] as string[],
        stoppedTracks: 0,
      };
      Object.defineProperty(window, "__recordingSimulation", {
        value: simulation,
      });
      class SimulatedTrack extends EventTarget {
        readyState = "live";
        stop() {
          this.readyState = "ended";
          simulation.stoppedTracks++;
        }
      }
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          async getUserMedia(constraints: MediaStreamConstraints) {
            simulation.constraints = constraints;
            if (denied)
              throw new DOMException(
                "Simulated permission denial",
                "NotAllowedError",
              );
            const track = new SimulatedTrack();
            return { getTracks: () => [track] };
          },
        },
      });
      class SimulatedMediaRecorder extends EventTarget {
        static isTypeSupported(type: string) {
          return type === "audio/webm;codecs=opus";
        }
        state = "inactive";
        mimeType: string;
        constructor(_stream: unknown, options: MediaRecorderOptions) {
          super();
          simulation.options = options;
          this.mimeType = options.mimeType ?? "audio/webm";
        }
        emitChunk = () => {
          if (this.state === "recording") this.emit("periodic");
        };
        emit(kind: "periodic" | "final") {
          simulation.events.push(`data-${kind}`);
          const event = new Event("dataavailable");
          Object.defineProperty(event, "data", {
            value: new Blob([`simulated ${kind} chunk\n`], {
              type: this.mimeType,
            }),
          });
          this.dispatchEvent(event);
        }
        start(timeslice: number) {
          this.state = "recording";
          simulation.timeslice = timeslice;
          simulation.events.push("start");
          window.addEventListener("simulation-recording-chunk", this.emitChunk);
        }
        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          simulation.events.push("stop-request");
          window.removeEventListener(
            "simulation-recording-chunk",
            this.emitChunk,
          );
          setTimeout(() => {
            this.emit("final");
            simulation.events.push("stop");
            this.dispatchEvent(new Event("stop"));
          }, 0);
        }
      }
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: SimulatedMediaRecorder,
      });
    },
    { denied },
  );
}

async function storedAudio(page: Page, id: string) {
  return page.evaluate(
    (id) =>
      new Promise<{
        meta?: RecordingMeta;
        chunks: number;
        content: string;
      }>((resolve, reject) => {
        const opening = indexedDB.open("japanese-reactivation");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction(["meta", "recordings", "chunks"]);
          let recording: RecordingMeta | undefined;
          let parts: BlobPart[] = [];
          const pointers = tx.objectStore("meta").get("active");
          pointers.onsuccess = () => {
            const meta = tx
              .objectStore("recordings")
              .get([pointers.result.audio, id]);
            meta.onsuccess = () => {
              recording = meta.result as RecordingMeta | undefined;
            };
            const chunks = tx
              .objectStore("chunks")
              .getAll(
                IDBKeyRange.bound(
                  [pointers.result.audio, id, 0],
                  [pointers.result.audio, id, Number.MAX_SAFE_INTEGER],
                ),
              );
            chunks.onsuccess = () => {
              parts = chunks.result as BlobPart[];
            };
          };
          tx.oncomplete = () => {
            db.close();
            void new Blob(parts).text().then((content) => {
              resolve({ meta: recording, chunks: parts.length, content });
            }, reject);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    id,
  );
}

async function start(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: /^Start diagnostic/ }).click();
  await expect(
    page.getByRole("heading", { name: "Start with your own voice." }),
  ).toBeVisible();
}
async function typedBaselines(page: Page) {
  for (const answer of [
    "ソフトウェアを作っています。よろしくお願いします。",
    "最近、仕事で新しい製品を作りました。",
  ]) {
    await page
      .getByRole("button", { name: "Type instead or add notes" })
      .click();
    await page
      .getByRole("textbox", { name: /^Typed Japanese response/ })
      .fill(answer);
    await page
      .getByRole("button", { name: "Finish this attempt", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Independent", exact: true })
      .click();
    await page.getByRole("button", { name: "Continue →", exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Continue to typed diagnostic" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find the words you still know." }),
  ).toBeVisible();
}
async function seedProgress(page: Page, data: ProgressData) {
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("japanese-reactivation");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction(["meta", "progress"], "readwrite");
          const pointers = tx.objectStore("meta").get("active");
          pointers.onsuccess = () =>
            tx.objectStore("progress").put(data, pointers.result.progress);
          tx.oncomplete = () => {
            db.close();
            window.dispatchEvent(new Event("study-change"));
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    data,
  );
}
async function sessionFixture(
  page: Page,
  kind: "daily" | "checkpoint-a" | "checkpoint-b",
  stage: number,
  configure?: (data: ProgressData, catalog: Catalog, session: Session) => void,
) {
  await page.goto("./");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  const data = await progress(page);
  const catalog = JSON.parse(
    await readFile(
      new URL("../../src/content/catalog.json", import.meta.url),
      "utf8",
    ),
  ) as Catalog;
  const today = dateInZone(Date.now(), data.settings.plan.timezone);
  data.settings.plan.startDate = today;
  data.diagnosticComplete = true;
  const session = createSession(data, today, Date.now(), catalog, kind);
  session.stage = stage;
  configure?.(data, catalog, session);
  await seedProgress(page, data);
  await page.goto(`./#/session/${session.id}`);
  return { session, catalog };
}
async function completeOutput(page: Page, model = false) {
  await page
    .getByRole("button", { name: "Type instead or add notes", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: /^Typed Japanese response/ })
    .fill("ソフトウェアを作っています。最近の仕事について話します。");
  await page
    .getByRole("button", {
      name: model ? "Compare with a model answer" : "Finish this attempt",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Independent", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
}
async function completeReading(
  page: Page,
  questions: { prompt: string }[],
  summary: boolean,
) {
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  const lookup = page.getByRole("button", { name: /^Look up / }).first();
  await lookup.click();
  await lookup.click();
  await expect(
    page.getByText("1 distinct lookup", { exact: true }),
  ).toBeVisible();
  for (const question of questions)
    await page.getByLabel(question.prompt).fill("記事の内容を説明します。");
  if (summary)
    await page
      .getByRole("textbox", {
        name: /^Typed summary if recording is unavailable/,
      })
      .fill("製品についての記事です。");
  await page
    .getByRole("button", { name: "Finish reading and compare", exact: true })
    .click();
  await page.getByRole("button", { name: "Independent", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
}
async function completeWrap(page: Page) {
  await expect(
    page.getByRole("heading", { name: "A little more yours.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", {
      name: /^What felt easier, and what would you like to repeat/,
    })
    .fill("少し思い出しました。また練習します。");
  await page
    .getByRole("button", { name: "Finish session ✓", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/today$/);
}
function overdueCard(data: ProgressData, catalog: Catalog, session: Session) {
  const at = Date.now() - 2 * 86400000;
  const prior = createSession(
    data,
    addDays(session.studyDate, -2),
    at,
    catalog,
    "daily",
  );
  prior.completedAt = at;
  applyGrade(data, catalog.cards[0], 1, prior.id, at);
}
async function completeShortReview(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Bring the words back.", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I don’t know", exact: true }).click();
  await page.getByRole("button", { name: "Next card →", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your review block is complete.",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
}

test("saves the original baseline draft across reload and permits a typed fallback", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Type instead or add notes" }).click();
  await page
    .getByRole("textbox", { name: /^Typed Japanese response/ })
    .fill("私はソフトウェアを作っています。");
  await expect
    .poll(async () => Object.values((await progress(page)).sessions[0].drafts))
    .toContain("私はソフトウェアを作っています。");
  const original = (await progress(page)).sessions[0];
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: /^Typed Japanese response/ }),
  ).toHaveValue("私はソフトウェアを作っています。");
  const resumed = (await progress(page)).sessions[0];
  expect(resumed.id).toBe(original.id);
  expect(resumed.studyDate).toBe(original.studyDate);
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeEnabled();
});

test("an idle diagnostic keeps the speaking target separate from elapsed wall time", async ({
  page,
}) => {
  await page.clock.install();
  await start(page);
  await expect
    .poll(
      async () => (await progress(page)).sessions[0].startedTasks["baseline-1"],
    )
    .toBeGreaterThan(0);
  await page.clock.fastForward(50 * 60_000);
  await expect(page.getByText("Target 2:00", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".recorder-controls")
      .getByText("0:00 / target 2:00", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".card-top").getByText(/50:00/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeDisabled();
  expect((await progress(page)).sessions[0].recordingIds).toEqual({});
});

test("simulated browser recording saves periodic and final chunks before completion", async ({
  page,
  context,
}) => {
  await simulatedMicrophone(context);
  await start(page);
  const session = (await progress(page)).sessions[0];
  await page
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop and save", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("simulation-recording-chunk")),
  );
  await page
    .getByRole("button", { name: "Stop and save", exact: true })
    .click();
  await expect
    .poll(
      async () => (await progress(page)).sessions[0].recordingIds["baseline-1"],
    )
    .toBeTruthy();
  const id = (await progress(page)).sessions[0].recordingIds["baseline-1"];
  const audio = await storedAudio(page, id);
  expect(audio.content).toBe(
    "simulated periodic chunk\nsimulated final chunk\n",
  );
  expect(audio.chunks).toBe(2);
  expect(audio.meta).toMatchObject({
    id,
    sessionId: session.id,
    taskId: "baseline-1",
    mimeType: "audio/webm;codecs=opus",
    size: Buffer.byteLength(audio.content),
    chunks: 2,
    status: "complete",
    interrupted: false,
  });
  expect(
    await page.evaluate(() => Reflect.get(window, "__recordingSimulation")),
  ).toMatchObject({
    constraints: { audio: { channelCount: 1 }, video: false },
    options: { audioBitsPerSecond: 32_000 },
    timeslice: 5_000,
    stoppedTracks: 1,
    events: ["start", "data-periodic", "stop-request", "data-final", "stop"],
  });
  await expect(
    page.getByRole("button", { name: "Record another attempt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByLabel("Your recorded response", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeEnabled();
  expect((await storedAudio(page, id)).content).toBe(audio.content);
});

test("simulated microphone denial opens the typed fallback without saving audio", async ({
  page,
  context,
}) => {
  await simulatedMicrophone(context, true);
  await start(page);
  await page
    .getByRole("button", { name: "Record response", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    /Microphone access was denied/,
  );
  const answer = page.getByRole("textbox", {
    name: /^Typed Japanese response/,
  });
  await expect(answer).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeDisabled();
  expect((await progress(page)).sessions[0].recordingIds).toEqual({});
  await answer.fill("マイクが使えないので、入力して練習します。");
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Finish this attempt", exact: true })
    .click();
  await page.getByRole("button", { name: "Independent", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect
    .poll(async () => (await progress(page)).sessions[0].completedTasks)
    .toContain("baseline-1");
  const saved = await progress(page);
  expect(saved.sessions[0].completedTasks).toContain("baseline-1");
  expect(saved.sessions[0].recordingIds).toEqual({});
  expect(saved.sessions[0].drafts["baseline-1"]).toBe(
    "マイクが使えないので、入力して練習します。",
  );
});

test("a simulated decoder error after ZIP transfer explains unsupported audio and preserves its download", async ({
  page,
}) => {
  await start(page);
  const data = await progress(page);
  const session = data.sessions[0];
  const bytes = new TextEncoder().encode(
    "synthetic transferred audio; not a codec fixture",
  );
  const meta: RecordingMeta = {
    id: "transferred-audio",
    sessionId: session.id,
    taskId: "baseline-1",
    mimeType: "audio/mp4;codecs=simulated-unsupported",
    startedAt: Date.now(),
    durationMs: 1_200,
    size: bytes.byteLength,
    chunks: 1,
    status: "complete",
    interrupted: false,
  };
  session.recordingIds["baseline-1"] = meta.id;
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 0,
    useWebWorkers: false,
  });
  await writer.add(
    "manifest.json",
    new TextReader(
      JSON.stringify({
        format: "japanese-reactivation",
        version: 1,
        kind: "full",
        exportedAt: new Date().toISOString(),
        progress: data,
        recordings: [
          {
            id: meta.id,
            meta,
            included: true,
            file: `recordings/${meta.id}.bin`,
          },
        ],
      }),
    ),
  );
  await writer.add(`recordings/${meta.id}.bin`, new Uint8ArrayReader(bytes));
  const archive = await writer.close();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Choose a JSON or ZIP backup", { exact: true })
    .setInputFiles({
      name: "transferred-recording.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(archive),
    });
  await expect(
    page.getByRole("heading", { name: "Restore preview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "I understand what will be replaced and have saved any backup I need.",
    })
    .check();
  await page
    .getByRole("button", { name: "Restore this backup", exact: true })
    .click();
  await expect
    .poll(
      async () => (await progress(page)).sessions[0].recordingIds["baseline-1"],
    )
    .toBe(meta.id);
  await page.goto(`./#/session/${session.id}`);
  const playback = page.getByLabel("Your recorded response", { exact: true });
  await expect(playback).toBeVisible();
  // Explicitly simulate the receiving device's decoder error; no codec support is asserted.
  await playback.dispatchEvent("error");
  await expect(
    page.getByText(/This device cannot play this recording format/),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download this recording", exact: true })
    .click();
  const savedFile = await download;
  expect(savedFile.suggestedFilename()).toBe("baseline-1.m4a");
  expect(await readFile((await savedFile.path())!)).toEqual(Buffer.from(bytes));
  const stored = await storedAudio(page, meta.id);
  expect(stored.meta?.mimeType).toBe(meta.mimeType);
  expect(stored.content).toBe(new TextDecoder().decode(bytes));
  expect((await progress(page)).sessions[0].recordingIds["baseline-1"]).toBe(
    meta.id,
  );
});

test("IME confirmation never submits and two rapid grade clicks save once", async ({
  page,
}) => {
  await start(page);
  await typedBaselines(page);
  const answer = page.getByRole("textbox", { name: /^Your Japanese answer/ });
  await answer.dispatchEvent("compositionstart", { data: "とうけい" });
  await answer.fill("統計");
  await answer.dispatchEvent("compositionend", { data: "統計" });
  await answer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: false,
  });
  await expect(
    page.getByRole("button", { name: "Reveal model answer", exact: true }),
  ).toBeVisible();
  expect(Object.keys((await progress(page)).diagnosticGrades)).toHaveLength(0);
  await page
    .getByRole("button", { name: "I don’t know", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    page.getByText("✓ Diagnostic answer saved", { exact: true }),
  ).toBeVisible();
  const diagnostic = await progress(page);
  expect(Object.keys(diagnostic.diagnosticGrades)).toHaveLength(1);
  const diagnosticId = Object.keys(diagnostic.diagnosticGrades)[0];
  expect(diagnostic.userCards).toHaveLength(1);
  const mistake = diagnostic.userCards[0];
  expect(mistake.id).not.toBe(diagnosticId);
  expect(mistake.kind).toBe("card");
  expect(diagnostic.mistakes[mistake.id]).toBeDefined();
  expect(diagnostic.cardStates[diagnosticId]).toBeUndefined();
  expect(diagnostic.reviewEvents).toHaveLength(0);
  const saved = (await progress(page)).sessions[0].completedTasks.filter(
    (task) => task !== "baseline-1" && task !== "baseline-2",
  );
  expect(saved).toHaveLength(1);
  await page.getByRole("button", { name: "Next prompt →" }).click();
  await expect(answer).toHaveValue("");
  await expect(page.locator('[lang="ja"]').first()).toBeVisible();
  await page.getByRole("link", { name: "Mistakes", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "English production prompt",
      exact: true,
    }),
  ).toHaveValue(mistake.prompt);
});

test("a revealed production answer remains visible after reload before grading", async ({
  page,
}) => {
  await sessionFixture(page, "daily", 0);
  await page
    .getByRole("textbox", { name: /^Your Japanese answer/ })
    .fill("練習の回答です。");
  await page
    .getByRole("button", { name: "Reveal model answer", exact: true })
    .click();
  await expect(
    page.getByText("Model answer · compare, then self-grade", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Model answer · compare, then self-grade", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Good/ })).toBeEnabled();
  expect((await progress(page)).reviewEvents).toHaveLength(0);
});

test("ordinary reading requires comprehension answers and a spoken or typed summary", async ({
  page,
}) => {
  const { session, catalog } = await sessionFixture(page, "daily", 2);
  const passage = catalog.passages.find(
    (passage) => passage.id === session.passageId,
  )!;
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Finish reading and compare",
      exact: true,
    }),
  ).toBeDisabled();
  for (const question of passage.questions)
    await page.getByLabel(question.prompt).fill("記事の内容を説明します。");
  await expect(
    page.getByRole("button", {
      name: "Finish reading and compare",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", {
      name: /^Typed summary if recording is unavailable/,
    })
    .fill("この記事は製品について説明しています。");
  await expect(
    page.getByRole("button", {
      name: "Finish reading and compare",
      exact: true,
    }),
  ).toBeEnabled();
});

test("missing a checkpoint email reactivates its existing archived mistake card", async ({
  page,
}) => {
  await sessionFixture(page, "checkpoint-b", 0, (data, catalog) => {
    const email = catalog.scenarios.find(
      (scenario) => scenario.mode === "email",
    )!.turns[0];
    const card: ProductionItem = {
      id: "output-checkpoint-email",
      revision: 1,
      kind: "card",
      prompt: email.prompt,
      answer: email.answer,
      alternatives: email.alternatives,
      notes: email.notes,
      register: "keigo",
      phaseTags: ["business"],
      skillTags: ["keigo"],
      tripRelevant: true,
      issueTags: ["register"],
      review: {
        status: "draft",
        reviewer: "Your own mistake",
        date: "2026-10-12",
      },
    };
    data.userCards.push(card);
    data.snapshots[card.id] = card;
    data.mistakes[card.id] = {
      cardId: card.id,
      addedAt: 1000,
      source: "output",
      archived: true,
    };
  });
  await page
    .getByRole("button", { name: "Start ten-minute email", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: /^Your email in Japanese/ })
    .fill("本日はありがとうございました。よろしくお願いします。");
  await page
    .getByRole("button", { name: "Finish writing and compare", exact: true })
    .click();
  await page.getByRole("button", { name: "Not yet", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await progress(page)).mistakes["output-checkpoint-email"].archived,
    )
    .toBe(false);
  expect(
    (await progress(page)).userCards.filter(
      (card) => card.id === "output-checkpoint-email",
    ),
  ).toHaveLength(1);
});

test("progress JSON preview and restore replace drafts after explicit confirmation", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Type instead or add notes" }).click();
  await page
    .getByRole("textbox", { name: /^Typed Japanese response/ })
    .fill("保存した回答です。");
  await expect
    .poll(async () => (await progress(page)).sessions[0].drafts["baseline-1"])
    .toBe("保存した回答です。");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare progress JSON", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save / share backup", exact: true })
    .click();
  const download = await downloading;
  const path = await download.path();
  expect(path).not.toBeNull();
  const envelope = JSON.parse(await readFile(path!, "utf8"));
  expect(envelope.kind).toBe("progress");
  expect(envelope.progress.catalogVersion).toBeTruthy();
  expect(
    envelope.recordings.every((row: { included: boolean }) => !row.included),
  ).toBe(true);
  envelope.progress.sessions[0].drafts["baseline-1"] =
    "バックアップから戻した回答です。";
  envelope.progress.settings.plan.dailyMinutes = 45;
  await page
    .getByLabel("Choose a JSON or ZIP backup", { exact: true })
    .setInputFiles({
      name: "restored.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(envelope)),
    });
  await expect(
    page.getByRole("heading", { name: "Restore preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore this backup", exact: true }),
  ).toBeDisabled();
  expect((await progress(page)).sessions[0].drafts["baseline-1"]).toBe(
    "保存した回答です。",
  );
  await page
    .getByRole("checkbox", {
      name: "I understand what will be replaced and have saved any backup I need.",
    })
    .check();
  await page
    .getByRole("button", { name: "Restore this backup", exact: true })
    .click();
  await expect
    .poll(async () => (await progress(page)).sessions[0].drafts["baseline-1"])
    .toBe("バックアップから戻した回答です。");
  await expect(
    page.getByRole("spinbutton", { name: "Daily minutes", exact: true }),
  ).toHaveValue("45");
});

test("a restore in another tab refreshes settings while an export preserves unsaved preferences", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
  });
  await start(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const minutes = page.getByRole("spinbutton", {
    name: "Daily minutes",
    exact: true,
  });
  await minutes.fill("40");
  const other = await context.newPage();
  await other.goto("./#/settings");
  await other
    .getByRole("button", { name: "Prepare progress JSON", exact: true })
    .click();
  const downloading = other.waitForEvent("download");
  await other
    .getByRole("button", { name: "Save / share backup", exact: true })
    .click();
  const exported = await downloading;
  await expect
    .poll(async () => (await progress(page)).settings.lastExportAt)
    .not.toBeNull();
  await expect(minutes).toHaveValue("40");
  const envelope = JSON.parse(await readFile((await exported.path())!, "utf8"));
  envelope.progress.settings.plan.dailyMinutes = 45;
  await other
    .getByLabel("Choose a JSON or ZIP backup", { exact: true })
    .setInputFiles({
      name: "other-tab-restore.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(envelope)),
    });
  await expect(
    other.getByRole("heading", { name: "Restore preview", exact: true }),
  ).toBeVisible();
  await other
    .getByRole("checkbox", {
      name: "I understand what will be replaced and have saved any backup I need.",
    })
    .check();
  await other
    .getByRole("button", { name: "Restore this backup", exact: true })
    .click();
  await expect(minutes).toHaveValue("45");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Settings saved. Existing attempts keep their original dates and content.",
  );
  await expect
    .poll(async () => (await progress(page)).settings.plan.dailyMinutes)
    .toBe(45);
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "Daily minutes", exact: true }),
  ).toHaveValue("45");
});

test("missing audio in a progress restore cannot complete speaking or a reading summary", async ({
  page,
}) => {
  await start(page);
  const restored = await progress(page);
  const baseline = restored.sessions[0];
  baseline.recordingIds["baseline-1"] = "missing-baseline-audio";
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Choose a JSON or ZIP backup", { exact: true })
    .setInputFiles({
      name: "progress-without-audio.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "japanese-reactivation",
          version: 1,
          kind: "progress",
          exportedAt: new Date().toISOString(),
          progress: restored,
          recordings: [{ id: "missing-baseline-audio", included: false }],
        }),
      ),
    });
  await expect(
    page.getByRole("heading", { name: "Restore preview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "I understand what will be replaced and have saved any backup I need.",
    })
    .check();
  await page
    .getByRole("button", { name: "Restore this backup", exact: true })
    .click();
  await expect
    .poll(
      async () => (await progress(page)).sessions[0].recordingIds["baseline-1"],
    )
    .toBe("missing-baseline-audio");
  await page.goto(`./#/session/${baseline.id}`);
  await expect(
    page.getByText(/Recording not included in this backup/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Type instead or add notes", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: /^Typed Japanese response/ })
    .fill("録音の代わりに入力します。");
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeEnabled();

  const { session, catalog } = await sessionFixture(
    page,
    "daily",
    2,
    (_data, _catalog, session) => {
      session.recordingIds["reading-summary"] = "missing-reading-audio";
    },
  );
  await page
    .getByRole("button", { name: "Start reading", exact: true })
    .click();
  const passage = catalog.passages.find(
    (value) => value.id === session.passageId,
  )!;
  for (const question of passage.questions)
    await page.getByLabel(question.prompt).fill("記事の内容を説明します。");
  await expect(
    page.getByText(/Recording not included in this backup/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Finish reading and compare",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", {
      name: /^Typed summary if recording is unavailable/,
    })
    .fill("録音の代わりに記事を要約します。");
  await expect(
    page.getByRole("button", {
      name: "Finish reading and compare",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    (await progress(page)).sessions.find((value) => value.id === session.id)!
      .recordingIds["reading-summary"],
  ).toBe("missing-reading-audio");
});

test("manual checkpoint B preserves reserved readings and the planned session for today", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  const data = await progress(page);
  const today = dateInZone(Date.now(), data.settings.plan.timezone);
  data.diagnosticComplete = true;
  data.settings.plan.startDate = today;
  data.settings.plan.targetDate = addDays(today, 50);
  await seedProgress(page, data);
  await page.getByRole("link", { name: "Progress", exact: true }).click();
  const futureReadings = page.getByRole("button", {
    name: "Practice B",
    exact: true,
  });
  await expect(futureReadings).toHaveCount(7);
  for (const button of await futureReadings.all())
    await expect(button).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Repeat email & reading checkpoint",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Start ten-minute email", exact: true }),
  ).toBeVisible();
  const manual = (await progress(page)).sessions.at(-1)!;
  const catalog = JSON.parse(
    await readFile(
      new URL("../../src/content/catalog.json", import.meta.url),
      "utf8",
    ),
  ) as Catalog;
  expect(manual.kind).toBe("checkpoint-b");
  expect(manual.manualCheckpoint).toBe(true);
  expect(catalog.passages.slice(0, 3).map((passage) => passage.id)).toContain(
    manual.passageId,
  );
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: /^Start today’s session/ }).click();
  await expect(
    page.getByRole("heading", { name: "Bring the words back.", exact: true }),
  ).toBeVisible();
  const planned = (await progress(page)).sessions.at(-1)!;
  expect(planned.id).not.toBe(manual.id);
  expect(planned.kind).toBe("daily");
  expect(planned.manualCheckpoint).not.toBe(true);
});

test("production app and saved session reopen offline after installation caches finish", async ({
  page,
  context,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Type instead or add notes" }).click();
  await page
    .getByRole("textbox", { name: /^Typed Japanese response/ })
    .fill("オフラインでも練習します。");
  await expect
    .poll(async () => (await progress(page)).sessions[0].drafts["baseline-1"])
    .toBe("オフラインでも練習します。");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: /^Typed Japanese response/ }),
  ).toHaveValue("オフラインでも練習します。");
  await expect(
    page.getByRole("button", { name: "Finish this attempt", exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare progress JSON", exact: true })
    .click();
  await expect(page.getByText(/japanese-progress-.*\.json/)).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare full ZIP", exact: true })
    .click();
  await expect(page.getByText(/japanese-full-.*\.zip/)).toBeVisible();
});

test("manifest and icons use the intended Pages path", async ({
  page,
  request,
}) => {
  await page.goto("./");
  const manifestURL = await page
    .locator('link[rel="manifest"]')
    .evaluate((link) => (link as HTMLLinkElement).href);
  const response = await request.get(manifestURL);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.start_url).toBe("/japanese-app/");
  expect(manifest.scope).toBe("/japanese-app/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const asset = await request.get(new URL(icon.src, manifestURL).href);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["content-type"]).toMatch(/^image\//);
  }
});

test("completes all sixteen diagnostic prompts and saves the baseline wrap-up", async ({
  page,
}) => {
  await start(page);
  await typedBaselines(page);
  for (let index = 0; index < 16; index++) {
    await page
      .getByRole("button", { name: "I don’t know", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Next prompt →", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "See your baseline wrap-up", exact: true })
    .click();
  await completeWrap(page);
  const saved = await progress(page);
  expect(saved.diagnosticComplete).toBe(true);
  expect(Object.keys(saved.diagnosticGrades)).toHaveLength(16);
  expect(saved.userCards).toHaveLength(16);
  expect(saved.reviewEvents).toHaveLength(0);
  expect(
    saved.sessions.find((session) => session.kind === "diagnostic")
      ?.completedAt,
  ).not.toBeNull();
});

test("completes the daily production, every scenario turn, reading summary, and wrap-up", async ({
  page,
}) => {
  const { session, catalog } = await sessionFixture(page, "daily", 0);
  await page.getByRole("button", { name: "I don’t know", exact: true }).click();
  await page
    .getByRole("button", { name: "Finish review for today", exact: true })
    .click();
  const scenario = catalog.scenarios.find(
    (scenario) => scenario.id === session.scenarioId,
  )!;
  expect(scenario.mode).toBe("speaking");
  for (const turn of scenario.turns) {
    await expect(
      page.getByRole("heading", { name: turn.prompt, exact: true }),
    ).toBeVisible();
    await completeOutput(page, true);
  }
  await page
    .getByRole("button", { name: "Continue to reading →", exact: true })
    .click();
  const passage = catalog.passages.find(
    (passage) => passage.id === session.passageId,
  )!;
  await completeReading(page, passage.questions, true);
  await completeWrap(page);
  const saved = await progress(page);
  const completed = saved.sessions.find((value) => value.id === session.id)!;
  expect(completed.completedAt).not.toBeNull();
  expect(
    completed.completedTasks.filter((task) => task.startsWith("turn:")),
  ).toHaveLength(scenario.turns.length);
  expect(completed.completedTasks).toContain("reading");
  expect(completed.lookedUp).toHaveLength(1);
  expect(completed.drafts["reading-summary"]).toBe("製品についての記事です。");
  expect(
    saved.reviewEvents.filter((event) => event.sessionId === session.id),
  ).toHaveLength(1);
});

test("completes checkpoint A with typed speaking fallbacks, due-only review, and wrap-up", async ({
  page,
}) => {
  const { session, catalog } = await sessionFixture(
    page,
    "checkpoint-a",
    0,
    overdueCard,
  );
  for (let index = 0; index < 4; index++) await completeOutput(page);
  await page
    .getByRole("textbox", { name: /^What changed from your last recording/ })
    .fill("少し話しやすくなりました。");
  await page
    .getByRole("button", { name: "Continue to a short review", exact: true })
    .click();
  await completeShortReview(page);
  await completeWrap(page);
  const saved = await progress(page);
  const completed = saved.sessions.find((value) => value.id === session.id)!;
  expect(completed.completedAt).not.toBeNull();
  expect(completed.completedTasks).toEqual(
    expect.arrayContaining([
      "baseline-1",
      "baseline-2",
      "business-intro",
      "conversation",
    ]),
  );
  expect(completed.recordingIds).toEqual({});
  expect(saved.cardStates[catalog.cards[0].id].reps).toBe(2);
  expect(
    saved.reviewEvents.filter((event) => event.sessionId === session.id),
  ).toHaveLength(1);
});

test("completes checkpoint B email, unfamiliar reading, due-only review, and wrap-up", async ({
  page,
}) => {
  const { session, catalog } = await sessionFixture(
    page,
    "checkpoint-b",
    0,
    overdueCard,
  );
  await page
    .getByRole("button", { name: "Start ten-minute email", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: /^Your email in Japanese/ })
    .fill(
      "本日はお時間をいただき、ありがとうございました。よろしくお願いします。",
    );
  await page
    .getByRole("button", { name: "Finish writing and compare", exact: true })
    .click();
  await page.getByRole("button", { name: "Independent", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  const passage = catalog.passages.find(
    (passage) => passage.id === session.passageId,
  )!;
  await completeReading(page, passage.questions, false);
  await completeShortReview(page);
  await completeWrap(page);
  const saved = await progress(page);
  const completed = saved.sessions.find((value) => value.id === session.id)!;
  expect(completed.completedAt).not.toBeNull();
  expect(completed.completedTasks).toEqual(
    expect.arrayContaining(["checkpoint-email", "reading"]),
  );
  expect(completed.assisted).toBe(false);
  expect(completed.lookedUp).toHaveLength(1);
  expect(completed.drafts["reading-summary"]).toBeUndefined();
  expect(saved.cardStates[catalog.cards[0].id].reps).toBe(2);
});

test("a manually added card can be practiced without changing its FSRS schedule", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("link", { name: "Mistakes", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a card manually", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "English production prompt", exact: true })
    .fill("Greet a new colleague politely.");
  await page
    .getByRole("textbox", { name: "Japanese model answer", exact: true })
    .fill("よろしくおねがいします。");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  await page
    .getByRole("button", { name: "Practice this card", exact: true })
    .click();
  await expect(
    page.getByText("Extra practice · does not change your review schedule.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I don’t know", exact: true }).click();
  await page.getByRole("button", { name: "Next card →", exact: true }).click();
  const saved = await progress(page);
  const cardId = saved.userCards[0].id;
  expect(saved.reviewEvents).toHaveLength(0);
  expect(saved.cardStates[cardId]).toBeUndefined();
  expect(
    saved.sessions.find((session) => session.kind === "extra")
      ?.practiceGrades?.[cardId],
  ).toBe(1);
  expect(Object.keys(saved.mistakes)).toEqual([cardId]);
});

test("recorded speech starts on a tap, advances in order, and Stop prevents late sentence events", async ({
  page,
  context,
}) => {
  await simulatedSpeech(context);
  const { clips } = await shadowingFixture(page);
  expect(clips.length).toBeGreaterThan(2);
  expect((await speechState(page)).played).toEqual([]);
  await page
    .getByRole("button", { name: "Listen sentence by sentence", exact: true })
    .click();
  expect((await speechState(page)).played).toEqual([
    `/japanese-app/${clips[0].file}`,
  ]);
  await speechEvent(page, 0);
  expect((await speechState(page)).played).toEqual(
    clips.slice(0, 2).map((clip) => `/japanese-app/${clip.file}`),
  );
  await page
    .getByRole("button", { name: "Stop listening", exact: true })
    .click();
  await speechEvent(page, 0);
  const stopped = await speechState(page);
  expect(stopped.played).toHaveLength(2);
  expect(stopped.paused).toEqual([`/japanese-app/${clips[1].file}`]);
  expect(stopped.sources).toEqual([""]);
  expect(stopped.loads).toBe(1);
  await expect(
    page.getByRole("button", {
      name: "Listen sentence by sentence",
      exact: true,
    }),
  ).toBeVisible();
});

test("starting a model voice stops the partner voice and navigation stops the current voice", async ({
  page,
  context,
}) => {
  await simulatedSpeech(context);
  await sessionFixture(page, "daily", 1);
  const partner = page.locator(".partner-line .speech-controls");
  await partner.getByRole("button", { name: "Listen", exact: true }).click();
  await page
    .getByRole("button", { name: "I don’t know how to say it", exact: true })
    .click();
  const model = page.locator(".answer-block .speech-controls");
  await model.getByRole("button", { name: "Listen", exact: true }).click();
  const replaced = await speechState(page);
  expect(replaced.played).toHaveLength(2);
  expect(replaced.paused).toEqual([replaced.played[0]]);
  expect(replaced.sources[0]).toBe("");
  await expect(
    partner.getByRole("button", { name: "Listen", exact: true }),
  ).toBeVisible();
  await expect(
    model.getByRole("button", { name: "Stop listening", exact: true }),
  ).toBeVisible();
  await speechEvent(page, 0);
  expect((await speechState(page)).played).toHaveLength(2);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings & backups", exact: true }),
  ).toBeVisible();
  await speechEvent(page, 1);
  const navigated = await speechState(page);
  expect(navigated.played).toHaveLength(2);
  expect(navigated.paused).toEqual(replaced.played);
  expect(navigated.sources).toEqual(["", ""]);
});

for (const failure of ["rejected", "unsupported", "decoder-error"] as const) {
  test(`recorded speech ${failure} offers an explicit device-voice fallback without speaking automatically`, async ({
    page,
    context,
  }) => {
    await simulatedSpeech(
      context,
      failure === "decoder-error" ? "playing" : failure,
    );
    const { item } = await recordedCardFixture(page);
    await page.getByRole("button", { name: "Listen", exact: true }).click();
    if (failure === "decoder-error") await speechEvent(page, 0, "error");
    await expect(page.getByRole("alert")).toContainText(
      "AI-generated Japanese voice could not play",
    );
    const fallback = page.getByRole("button", {
      name: "Use device voice",
      exact: true,
    });
    await expect(fallback).toBeVisible();
    expect((await speechState(page)).spoken).toEqual([]);
    await fallback.click();
    await expect(page.getByText("Device voice", { exact: true })).toBeVisible();
    expect((await speechState(page)).spoken[0]).toBe(
      plainJapanese(item.answer),
    );
    await expect(
      page.getByRole("button", { name: "Stop listening", exact: true }),
    ).toBeVisible();
  });
}

test("manual and edited models without a bundled clip clearly use device voice", async ({
  page,
  context,
}) => {
  await simulatedSpeech(context);
  await page.goto("./");
  await page.getByRole("link", { name: "Mistakes", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a card manually", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "English production prompt", exact: true })
    .fill("Describe the imaginary coding cat.");
  const answers = [
    "きょうは、あおいねこがコードをかきます。",
    "あしたは、みどりのねこがテストをします。",
  ];
  await page
    .getByRole("textbox", { name: "Japanese model answer", exact: true })
    .fill(answers[0]);
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  for (const [index, answer] of answers.entries()) {
    if (index > 0) {
      await page.getByRole("link", { name: "Mistakes", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Japanese model answer", exact: true })
        .fill(answer);
      await page
        .getByRole("button", { name: "Save card", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "Practice this card", exact: true })
      .click();
    await page
      .getByRole("button", { name: "I don’t know", exact: true })
      .click();
    await expect(page.getByText("Device voice", { exact: true })).toBeVisible();
    await expect(
      page.getByText("No saved AI-generated clip for this text.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("AI-generated Japanese voice", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Listen", exact: true }).click();
    expect((await speechState(page)).spoken).toEqual(
      answers.slice(0, index + 1),
    );
    expect((await speechState(page)).played).toEqual([]);
    await page
      .getByRole("button", { name: "Stop listening", exact: true })
      .click();
  }
});

test("Chromium decodes a real bundled MP3 and plays the cached voice while offline", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Real MP3 decoding smoke is checked in Chromium; other engines run the control regressions.",
  );
  await observeRealSpeech(context);
  const { clips } = await recordedCardFixture(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  expect((await realSpeechState(page)).plays).toBe(0);
  const path = `/japanese-app/${clips[0].file}`;
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path,
  );
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toMatch(/^audio\//);
  await expect
    .poll(async () => (await realSpeechState(page)).audio[0]?.duration ?? 0)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await realSpeechState(page)).audio[0]?.time ?? 0)
    .toBeGreaterThan(0);
  expect((await realSpeechState(page)).audio[0].error).toBeNull();
  expect((await realSpeechState(page)).audio[0].crossOrigin).toBe("anonymous");
  await page
    .getByRole("button", { name: "Stop listening", exact: true })
    .click();
  expect((await realSpeechState(page)).audio[0].paused).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          const key = (await cache.keys()).find(
            (request) => new URL(request.url).pathname === path,
          );
          if (key) {
            const cached = await cache.match(key);
            if (cached) return (await cached.arrayBuffer()).byteLength;
          }
        }
        return 0;
      }, path),
    )
    .toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("AI-generated Japanese voice", { exact: true }),
  ).toBeVisible();
  expect((await realSpeechState(page)).plays).toBe(0);
  const offlineResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path,
  );
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  const offlineResponse = await offlineResponsePromise;
  expect(offlineResponse.ok()).toBe(true);
  expect(offlineResponse.fromServiceWorker()).toBe(true);
  await expect
    .poll(async () => (await realSpeechState(page)).audio[0]?.time ?? 0)
    .toBeGreaterThan(0);
  expect((await realSpeechState(page)).audio[0].error).toBeNull();
  await page
    .getByRole("button", { name: "Stop listening", exact: true })
    .click();
  const saved = await progress(page);
  expect(
    saved.sessions.every(
      (session) => Object.keys(session.recordingIds).length === 0,
    ),
  ).toBe(true);
});

test("cached MP3 byte ranges stay exact offline and reject malformed ranges", async ({
  page,
  context,
}) => {
  const { clips } = await recordedCardFixture(page);
  const bytes = await readFile(
    new URL(`../../public/${clips[0].file}`, import.meta.url),
  );
  const path = `/japanese-app/${clips[0].file}`;
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  const partialResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().headers()["range"] === "bytes=0-1",
  );
  const partial = await page.evaluate(async (path) => {
    const response = await fetch(path, { headers: { Range: "bytes=0-1" } });
    return {
      status: response.status,
      contentRange: response.headers.get("content-range"),
      contentLength: response.headers.get("content-length"),
      bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  }, path);
  expect((await partialResponse).fromServiceWorker()).toBe(true);
  expect(partial.status).toBe(206);
  expect(partial.contentRange).toBe(`bytes 0-1/${bytes.byteLength}`);
  expect(partial.contentLength).toBe("2");
  expect(partial.bytes).toEqual(Array.from(bytes.subarray(0, 2)));
  const invalidRange = "bytes=invalid";
  const invalidResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().headers()["range"] === invalidRange,
  );
  const invalid = await page.evaluate(
    async ({ path, invalidRange }) => {
      const response = await fetch(path, { headers: { Range: invalidRange } });
      return {
        status: response.status,
        bytes: (await response.arrayBuffer()).byteLength,
      };
    },
    { path, invalidRange },
  );
  expect((await invalidResponse).fromServiceWorker()).toBe(true);
  expect(invalid).toEqual({ status: 416, bytes: 0 });
});
