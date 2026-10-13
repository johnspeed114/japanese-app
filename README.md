# 帰る · Japanese reactivation

A personal Japanese study app for returning to conversations with a friendly CEO, Japanese-speaking employees, old colleagues, and friends before a Tokyo trip on December 2, 2026. It assumes prior experience living and working in Japan, rather than beginner study.

Milestone 1 runs entirely in your browser: no app account, runtime API key, paid playback, or cloud storage. Your progress and recordings stay on the device. The user separately authorized paid OpenAI generation of the bundled Japanese listening audio. Milestone 2’s AI tutor is not implemented.

## Run locally

Use Node.js 22.12 or later and npm.

```sh
npm install
npm run dev
```

Open the local URL shown by Vite, including `/japanese-app/`. Microphone access works on localhost. Opening an ordinary HTTP address from a phone does not provide the same secure-context exception; hosted phone recording needs HTTPS.

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

For browser checks against the production build:

```sh
npx playwright install chromium firefox webkit
npm run build
npm run test:e2e
```

For only the locally installed Chromium browser, use `npm run test:e2e -- --project=chromium`. Playwright serves the built app on port 4173. CI uses `npm ci` and installs all three browser engines and their system dependencies.

## Start studying

On an iPhone, add the app to the Home Screen and launch it there before starting the diagnostic. A Safari tab and an installed Home Screen app have separate storage, so switching later requires a backup transfer. On other devices, use the browser’s install option when available. The app requests persistent storage when supported, but backups are still necessary. See [WebKit’s storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) and [tracking prevention](https://webkit.org/tracking-prevention/).

Start with the two speaking samples and sixteen typed diagnostic prompts. Denied or unavailable microphone access has a typed fallback; writing a response does not measure spoken fluency. The diagnostic guides practice priorities rather than assigning a proficiency level.

Ordinary sessions budget eight minutes for production cards, twelve for an output task, seven for reading or shadowing, and three for wrap-up. Finish an active answer before moving on. Cards require typed Japanese, followed by comparison and self-grading; **I don’t know** reveals the answer and saves Again. Furigana starts hidden, and Japanese text has no romaji. Cards selected directly from Practice are extra practice: their self-grades are saved separately and do not change FSRS schedules or count as new daily introductions.

The catalog includes 150 production cards, 40 keigo drills, 16 diagnostic prompts, 10 reading passages, and 12 scenarios. Model answers distinguish wrong wording, less natural wording, and register choices. Content has explicit `draft`, `ai-reviewed`, or `native-reviewed` status; draft items enter the published catalog only after language review. **AI-reviewed does not mean native-reviewed.** Business introductions and CEO-facing emails still need a qualified native speaker’s check before relying on them for a real meeting.

Weekly speaking and writing/reading checkpoints replace normal sessions. The plan uses calendar dates in your saved study timezone. Missed days do not move departure or checkpoints, and resuming yesterday’s draft retains that session’s original date. After the target date, trip-phase practice and due-card reviews remain available without new weekly checkpoints.

## Keep and move your work

- **Progress JSON:** Small routine backup of settings, drafts, card schedules, reviews, mistakes, and references to recordings. It contains no audio. Restoring it replaces study history while retaining audio already stored on the destination. Missing audio references stay visible rather than being silently removed.
- **Full ZIP:** Includes the same progress and binary recordings. Restoring it replaces both study history and the destination’s audio library. Audio preserves its original format; a receiving device may be unable to play a recording made elsewhere.
- **Prepare, then save:** Prepare the backup first, then tap **Save / share backup**. File sharing uses the device share sheet when available, otherwise a download. On iPhone, choose a Files destination in the share sheet. Check that the file was actually saved.

Back up regularly, especially before changing devices, clearing browser data, or updating the operating system. Transfers do not merge histories or synchronize devices. Stop recording before a backup or restore. Restore validates and stages all data before switching the active storage generation; malformed, cancelled, or quota-limited imports preserve the existing history.

Recording requests mono audio at 32 kbps, saves emitted chunks during capture, and stops after fifteen minutes. Keep the app visible. An interruption saves what it can and marks the attempt incomplete; partial audio may not play.

Built-in Listen buttons play bundled Japanese recordings generated with OpenAI’s Marin voice. This is AI-generated speech, not a human recording or a GPT-Live conversation. Sentence clips use authored pronunciation cues and are cached with the app for offline playback after initial loading. Playback starts only from a tap. New or edited text without a matching recording uses the selected Japanese device voice; if a bundled clip fails, the app offers an explicit device-voice fallback. A remote device voice may need internet access. Audio generation costs money once; listening does not make API calls or consume credits. Pronunciation and naturalness still need a native speaker’s listening check.

Maintainers can verify speech assets without a key using `npm run speech:check`. To regenerate missing or changed clips after authorizing API use, `npm run speech:generate` reads `OPENAI_API_KEY` from the ignored `.env.local` file, preserves valid completed clips, and saves progress after each clip. Builds and CI never generate speech, and the browser receives no key. The selected model is recorded in the manifest; its API retirement does not affect existing recordings. See [OpenAI’s speech documentation](https://developers.openai.com/api/docs/guides/text-to-speech).

## Review and hosting

All app changes belong on `milestone-1` and go through a pull request for Claude’s final review. The user authorized exactly one empty baseline commit on `main` and its push to establish the repository; that exception does not authorize app changes on `main`. Merging, publishing, releasing, tagging, and deleting the work branch remain held for Claude’s review unless the user explicitly names the step to release it.

The intended free static host is GitHub Pages at `https://johnspeed114.github.io/japanese-app/`. Vite’s base URL, manifest scope, and service worker use `/japanese-app/`. This repository contains a verification workflow and **no deployment job**. The intended hosting address is not a claim that the app is published.

The Claude SessionStart hook runs dependency installation only when `CLAUDE_CODE_REMOTE=true`; local Claude sessions skip it. See [implementation details and device acceptance checks](docs/IMPLEMENTATION.md).
