# Independent language review

Reviewed on **2026-10-12** by **Independent AI language review (GPT-6)**. The reviewer was separate from the content author. This is an AI language review, not a native-speaker review or an official JLPT assessment.

The review covers all 228 catalog items: 150 production cards, 40 keigo drills, 16 diagnostic items, 10 original reading passages, and 12 role-play scenarios. All 56 scenario turns, accepted alternatives, glossary entries, and comprehension answers were included. Every published item records `ai-reviewed`; none claims `native-reviewed`.

## What was checked

- Natural phrasing for business introductions, product discussions, scheduling, email, year-end gatherings, restaurant reservations, and conversations with familiar friends.
- The speaker and recipient of honorific and humble verbs, including the distinction between an outside contact and the speaker's own company.
- Alternatives with different register or meaning, with context explaining the difference rather than treating every alternative as an exact synonym.
- Kanji readings in sentence context, including counters, compounds, verb inflections, and words whose readings change with their use.
- Reading passages and comprehension answers for clear arguments and internally consistent meaning. The passages are original, N2-oriented practice; they are not calibrated exam material.

## Corrections made before publication

The author applied the review findings in the content generator and regenerated the committed catalog. Contextual reading corrections include 来て, 出て, 出なかった, 楽に, 間に合う, 手伝う, お話 and お話し, 何ですか, 少なく and 少なければ, 十分, 一つ, 一歩, 上手, 会話, 行動, 方向, 調子, 人数, and numeric time expressions. A complete kanji-coverage check alone could not detect these pronunciation errors, so focused reading regressions now protect them.

The review also corrected the diagnostic modifier order in コンピュータサイエンスのさまざまな分野; fixed honorific/humble labels for drills that contrast the two; clarified alternative contexts; and added question punctuation to casual spoken questions. Passage edits removed unnatural collocations and an overgeneralization about small teams and data volume. The restaurant scenario now asks explicitly about vegetarian or meat/fish-free dishes and explains that stock and seasonings may need separate confirmation.

A targeted metadata review on **2026-10-12** approved revision 2 of `card-049` with `readings` as a secondary skill alongside `vocabulary`. Its existing feedback explicitly contrasts 統計（とうけい） and 時計（とけい）, matching its `kanji-reading` and `long-vowels` issue tags. The prompt, Japanese models, alternatives, and item count remain unchanged. This classification reflects an intentional reading contrast; kanji appearing incidentally in keigo drills does not justify the same label.

## Verification and limits

`tests/content.test.ts` checks catalog counts and unique IDs, independent review metadata, complete kana readings, relevant honorific/humble labels, glossary locations, passage lengths, speaking-turn counts, dietary wording, and contextual reading regressions. Production responses remain self-graded; accepted alternatives are examples rather than an exhaustive list of correct Japanese.

Company descriptions, names, interests, and shared memories in model answers should be adapted to the learner's actual circumstances. Browser speech quality and available Japanese voices still require device testing. A native-speaker pass remains useful before treating the content as polished reference material; that review has not been claimed or performed.
