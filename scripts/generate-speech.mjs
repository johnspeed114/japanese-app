import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { speechTextKey, speechSentences } from "../src/speech-text.ts";
import { japaneseSegments } from "../src/japanese.ts";

const root = new URL("../", import.meta.url);
const manifestURL = new URL("src/content/speech-manifest.json", root);
const model = "gpt-4o-mini-tts-2025-12-15";
const voice = "marin";
const instructions = "Speak natural contemporary Japanese with a warm, conversational Tokyo accent. Use native Japanese pitch accent, fluid phrasing, and smooth rhythm. Speak clearly at a relaxed conversational pace. Avoid exaggerated pauses, syllable-by-syllable pronunciation, and an announcer tone. Read only the supplied Japanese text exactly, without any introduction, translation, or commentary.";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const catalog = JSON.parse(await readFile(new URL("src/content/catalog.json", root), "utf8"));
const corpus = new Map();
const entries = {};

function include(raw, override, source) {
  const effective = override ?? raw;
  const key = speechTextKey(effective);
  if (!key) return;
  // Keep authored pronunciation cues when an override only changes whitespace.
  const readingSource = speechTextKey(raw) === key ? raw : effective;
  const reading = japaneseSegments(readingSource).map((part) => part.reading ?? part.text).join("");
  const sentences = speechSentences(effective);
  const readings = speechSentences(reading);
  if (sentences.length !== readings.length) throw new Error(`Pronunciation boundary mismatch: ${source}`);
  const playlist = sentences.map((text, index) => {
    const spokenReading = readings[index];
    const previous = corpus.get(text);
    if (previous && previous.reading !== spokenReading) throw new Error(`Conflicting authored pronunciation: ${source}`);
    const prompt = `${instructions} Pronunciation guide in Japanese: ${spokenReading}`;
    const id = hash(JSON.stringify({ model, voice, input: text, instructions: prompt }));
    const file = `speech/${id}.mp3`;
    if (previous) previous.sources.add(source);
    else corpus.set(text, { text, reading: spokenReading, prompt, file, sources: new Set([source]) });
    return { text, file };
  });
  if (entries[key] && JSON.stringify(entries[key]) !== JSON.stringify(playlist)) throw new Error(`Conflicting speech playlist: ${source}`);
  entries[key] = playlist;
}

for (const item of [...catalog.cards, ...catalog.keigoDrills, ...catalog.diagnostic]) {
  if (item.review.status !== "draft" && !item.retired) include(item.answer, undefined, `${item.id}:answer`);
}
for (const scenario of catalog.scenarios) {
  if (scenario.review.status === "draft") continue;
  for (const turn of scenario.turns) {
    include(turn.partner, turn.speechText, `${scenario.id}/${turn.id}:partner`);
    include(turn.answer, undefined, `${scenario.id}/${turn.id}:answer`);
  }
}
for (const passage of catalog.passages) {
  if (passage.review.status !== "draft") include(passage.body, passage.speechText, `${passage.id}:body`);
}

const args = process.argv.slice(2);
if (args.some((arg) => !["--generate", "--check", "--dry-run"].includes(arg)) || args.length > 1) {
  console.error("Choose one of --generate, --check, or --dry-run. Only --generate uses the paid API.");
  process.exit(2);
}
const mode = args[0] ?? "--dry-run";
let existing;
try { existing = JSON.parse(await readFile(manifestURL, "utf8")); } catch { existing = { files: {} }; }
const clips = [...corpus.values()].sort((a, b) => a.file.localeCompare(b.file));
const files = {};
let completed = 0;

async function validExisting(clip) {
  const metadata = existing.files?.[clip.file];
  if (!metadata || metadata.text !== clip.text || metadata.reading !== clip.reading) return false;
  try {
    const data = await readFile(new URL(`public/${clip.file}`, root));
    return data.length === metadata.bytes && hash(data) === metadata.sha256;
  } catch { return false; }
}

function snapshot() {
  const available = new Set(Object.keys(files));
  return {
    version: 1, catalogVersion: catalog.version, model, voice,
    generatedAt: new Date().toISOString(), instructions,
    entries: Object.fromEntries(Object.entries(entries).filter(([, playlist]) => playlist.every((clip) => available.has(clip.file))).sort(([a], [b]) => a.localeCompare(b))),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  };
}

let manifestWrites = Promise.resolve();
function saveManifest() {
  const value = JSON.stringify(snapshot(), null, 2) + "\n";
  manifestWrites = manifestWrites.then(async () => {
    const temporary = new URL("src/content/speech-manifest.json.tmp", root);
    await writeFile(temporary, value);
    await rename(temporary, manifestURL);
  });
  return manifestWrites;
}

if (mode === "--dry-run") {
  console.log(JSON.stringify({ model, voice, inputs: Object.keys(entries).length, clips: clips.length, characters: clips.reduce((sum, clip) => sum + clip.text.length, 0), paidRequests: 0 }));
  process.exit(0);
}

if (mode === "--check") {
  if (existing.version !== 1 || existing.model !== model || existing.voice !== voice || existing.catalogVersion !== catalog.version) throw new Error("Speech manifest metadata does not match the authored catalog and voice.");
  for (const clip of clips) if (!(await validExisting(clip))) throw new Error(`Missing or corrupt speech asset: ${clip.file}`);
  if (JSON.stringify(existing.entries) !== JSON.stringify(Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))))) throw new Error("Speech playlists do not match the authored corpus.");
  console.log(JSON.stringify({ inputs: Object.keys(entries).length, clips: clips.length, bytes: Object.values(existing.files).reduce((sum, file) => sum + file.bytes, 0), paidRequests: 0, result: "passed" }));
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing. Use the approved local key setup before generation.");
await mkdir(new URL("public/speech/", root), { recursive: true });
for (const clip of clips) {
  if (await validExisting(clip)) {
    files[clip.file] = { ...existing.files[clip.file], sources: [...clip.sources].sort() };
    completed++;
  }
}
await saveManifest();
const remaining = clips.filter((clip) => !files[clip.file]);
console.log(JSON.stringify({ model, voice, reused: completed, pending: remaining.length }));
let next = 0;
const failures = [];

async function worker() {
  while (next < remaining.length && failures.length === 0) {
    const clip = remaining[next++];
    const target = new URL(`public/${clip.file}`, root);
    const temporary = new URL(`public/${clip.file}.part`, root);
    try {
      const response = await globalThis.fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice, input: clip.text, instructions: clip.prompt, response_format: "mp3" }),
        signal: globalThis.AbortSignal.timeout(90_000),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        // Never print provider error messages: authentication errors may contain a key fragment.
        const code = String(error?.error?.code ?? "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 60);
        throw new Error(`Speech generation failed: HTTP ${response.status}, code ${code}`);
      }
      if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Speech response is not audio.");
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 1000 || data.length > 5_000_000) throw new Error("Speech response size is outside the asset limit.");
      await writeFile(temporary, data);
      await rename(temporary, target);
      files[clip.file] = { text: clip.text, reading: clip.reading, bytes: data.length, sha256: hash(data), generatedAt: new Date().toISOString(), sources: [...clip.sources].sort() };
      completed++;
      await saveManifest();
      if (completed % 25 === 0) console.log(JSON.stringify({ completed, total: clips.length }));
    } catch (error) {
      await rm(temporary, { force: true });
      failures.push(error instanceof Error && error.message.startsWith("Speech generation failed:") ? error.message : "Speech generation or file save failed; completed assets are retained.");
    }
  }
}

await Promise.all(Array.from({ length: 4 }, () => worker()));
await saveManifest();
if (failures.length) {
  console.error(JSON.stringify({ failures, completed, total: clips.length }));
  process.exit(1);
}
console.log(JSON.stringify({ result: "complete", completed, bytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0), manifest: fileURLToPath(manifestURL) }));
