import { describe, expect, it } from "vitest";
import raw from "../src/content/catalog.json";
import {
  hasCompleteReadings,
  japaneseGlossarySpans,
  japaneseSegments,
  plainJapanese,
} from "../src/japanese";
import { parseCatalog } from "../src/validation";

const content = parseCatalog(raw);
const production = [
  ...content.cards,
  ...content.keigoDrills,
  ...content.diagnostic,
];
const allItems = [...production, ...content.passages, ...content.scenarios];
const kana = (value: string) =>
  japaneseSegments(value)
    .map((part) => part.reading ?? part.text)
    .join("");
const card = (id: string) => production.find((item) => item.id === id)!;
const passage = (id: string) =>
  content.passages.find((item) => item.id === id)!;

describe("reviewed seed content", () => {
  it("contains the promised complete catalog with stable unique IDs", () => {
    expect([
      content.cards.length,
      content.keigoDrills.length,
      content.diagnostic.length,
      content.passages.length,
      content.scenarios.length,
    ]).toEqual([150, 40, 16, 10, 12]);
    const ids = [
      ...allItems.map((item) => item.id),
      ...content.scenarios.flatMap((scenario) =>
        scenario.turns.map((turn) => turn.id),
      ),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(content.cards.map((item) => item.id)).toEqual(
      Array.from(
        { length: 150 },
        (_, index) => `card-${String(index + 1).padStart(3, "0")}`,
      ),
    );
  });

  it("has honest independent AI-review metadata for every published item", () => {
    for (const item of allItems) {
      expect(item.review, item.id).toEqual({
        status: "ai-reviewed",
        reviewer: "Independent AI language review (GPT-6)",
        date: "2026-10-12",
      });
    }
  });

  it("stores complete authored readings for every Japanese model field and accepted alternative", () => {
    const fields = [
      ...production.flatMap((item) => [
        item.answer,
        item.promptJapanese ?? "",
        ...item.alternatives.map((alternative) => alternative.text),
      ]),
      ...content.passages.flatMap((item) => [
        item.body,
        ...item.glossary.map((entry) => entry.term),
        ...item.questions.map((question) => question.answer),
      ]),
      ...content.scenarios.flatMap((item) =>
        item.turns.flatMap((turn) => [
          turn.partner,
          turn.answer,
          ...turn.alternatives.map((alternative) => alternative.text),
        ]),
      ),
    ];
    for (const field of fields) {
      expect(hasCompleteReadings(field), field).toBe(true);
      for (const part of japaneseSegments(field)) {
        if (part.reading)
          expect(part.reading, part.text).toMatch(
            /^[\p{Script=Hiragana}\p{Script=Katakana}ー、。！？・\s]+$/u,
          );
      }
      expect(plainJapanese(field)).not.toMatch(/\[\[|\]\]/);
    }
  });

  it("distinguishes humble and honorific forms where their roles differ", () => {
    expect(card("keigo-014").keigoType).toBe("humble");
    expect(card("keigo-003").keigoType).toBe("both");
    expect(card("keigo-040").keigoType).toBe("both");
    expect(plainJapanese(card("keigo-034").answer)).toBe(
      "弊社の社長がご説明します。",
    );
    expect(plainJapanese(card("diag-05").answer)).toBe(
      "コンピュータサイエンスのさまざまな分野",
    );
  });

  it("makes glossary entries findable in genuinely substantial checkpoint passages", () => {
    for (const item of content.passages) {
      expect(plainJapanese(item.body).length, item.id).toBeGreaterThanOrEqual(
        500,
      );
      expect(plainJapanese(item.body).length, item.id).toBeLessThanOrEqual(800);
      expect(item.questions, item.id).toHaveLength(2);
      expect(
        new Set(item.glossary.map((entry) => entry.id)).size,
        item.id,
      ).toBe(item.glossary.length);
      for (const entry of item.glossary)
        expect(item.body, `${item.id}: ${entry.id}`).toContain(entry.term);
    }
  });

  it("provides sustained speaking scenarios, an email task, and explicit dietary wording", () => {
    for (const scenario of content.scenarios.filter(
      (item) => item.mode === "speaking",
    ))
      expect(scenario.turns.length, scenario.id).toBeGreaterThanOrEqual(5);
    expect(
      content.scenarios.filter((item) => item.mode === "email"),
    ).toHaveLength(1);
    expect(
      content.scenarios.find((item) => item.id === "scenario-friend")?.register,
    ).toBe("casual");
    const restaurant = content.scenarios.find(
      (item) => item.id === "scenario-restaurant",
    )!;
    expect(plainJapanese(restaurant.turns[2].answer)).toContain(
      "ベジタリアン向け",
    );
    expect(
      restaurant.turns[2].alternatives.map((alternative) =>
        plainJapanese(alternative.text),
      ),
    ).toContain("肉や魚を使わない料理はありますか。");
  });
});

describe("authored readings regressions", () => {
  it.each([
    ["card-023", "しごとでとうきょうにきています。"],
    ["card-028", "さいきん、にほんごをはなすきかいがすくなくて。"],
    ["card-032", "ことばがすぐにでてこなくて。"],
    ["card-011", "いま、いちばんおおきなかだいはなんですか。"],
    ["card-016", "せっていはじゅっぷんぐらいでおわります。"],
  ])("reads %s correctly in its sentence context", (id, expected) => {
    expect(kana(card(id).answer)).toBe(expected);
  });

  it("distinguishes ease from enjoyment and noun speech from the verb stem", () => {
    expect(kana(card("card-003").alternatives[0].text)).toBe(
      "ひびのさぎょうをらくにできます。",
    );
    expect(kana(card("card-041").alternatives[0].text)).toBe(
      "てつだってくださって、ありがとうございます。",
    );
    expect(kana(card("keigo-032").alternatives[0].text)).toBe(
      "かくにんのうえ、おへんじいたします。",
    );
    expect(kana(passage("passage-09").body)).toContain("かいわのなかで");
  });

  it("handles compounds, counters, and inflections rather than just covering their kanji", () => {
    expect(kana(passage("passage-01").body)).toContain("きのうのかずより");
    expect(kana(passage("passage-03").body)).toContain("じょうずなひと");
    expect(kana(passage("passage-05").body)).toContain(
      "きめるべきことがすくなければ",
    );
    expect(kana(passage("passage-05").body)).toContain("こえのちょうし");
    expect(kana(passage("passage-06").body)).toContain("ひとつにしぼる");
    expect(kana(passage("passage-06").body)).toContain("べつのほうこう");
    expect(kana(passage("passage-07").body)).toContain("つぎのこうどう");
    expect(kana(passage("passage-08").body)).toContain(
      "じゅうぶんではありません",
    );
    expect(kana(passage("passage-10").body)).toContain("せいかがでなかった");
  });
});

describe("authored glossary spans", () => {
  it("matches the annotated surface before removing ruby markup", () => {
    const entry = { id: "value", term: "[[価値|かち]]", meaning: "value" };
    expect(
      japaneseGlossarySpans("ここに[[価値|かち]]があります。", [entry]),
    ).toEqual([
      { text: "ここに" },
      { text: entry.term, entry },
      { text: "があります。" },
    ]);
  });

  it("keeps ruby stems and following kana in the same clickable term", () => {
    const entries = [
      { id: "draft", term: "[[下書|したが]]き", meaning: "draft" },
      { id: "repeat", term: "[[繰り返|くりかえ]]し", meaning: "repetition" },
    ];
    const text =
      "[[下書|したが]]きを[[繰り返|くりかえ]]し[[確認|かくにん]]します。";
    const spans = japaneseGlossarySpans(text, entries);
    expect(
      spans
        .filter((span) => span.entry)
        .map((span) => plainJapanese(span.text)),
    ).toEqual(["下書き", "繰り返し"]);
    expect(spans.map((span) => span.text).join("")).toBe(text);
    expect(
      spans.filter((span) => span.entry).map((span) => kana(span.text)),
    ).toEqual(["したがき", "くりかえし"]);
  });

  it("chooses the longest authored term when matches overlap", () => {
    const short = {
      id: "information",
      term: "[[情報|じょうほう]]",
      meaning: "information",
    };
    const long = {
      id: "share",
      term: "[[情報|じょうほう]]を[[共有|きょうゆう]]",
      meaning: "sharing information",
    };
    const spans = japaneseGlossarySpans(`${long.term}します。`, [short, long]);
    expect(spans[0].entry?.id).toBe("share");
    expect(spans.filter((span) => span.entry)).toHaveLength(1);
  });

  it("keeps the same stable lookup ID at every occurrence of a repeated word", () => {
    const entry = { id: "value", term: "[[価値|かち]]", meaning: "value" };
    const spans = japaneseGlossarySpans(`${entry.term}と${entry.term}。`, [
      entry,
    ]);
    expect(
      spans.filter((span) => span.entry).map((span) => span.entry?.id),
    ).toEqual(["value", "value"]);
  });

  it("does not make words inside ruby readings clickable", () => {
    const text = "[[情報|じょうほう]]です。";
    expect(
      japaneseGlossarySpans(text, [
        { id: "hidden-reading", term: "じょうほう", meaning: "information" },
      ]),
    ).toEqual([{ text }]);
  });

  it("exposes every seed glossary entry as a complete clickable span", () => {
    for (const item of content.passages) {
      const spans = japaneseGlossarySpans(item.body, item.glossary);
      expect(spans.map((span) => span.text).join(""), item.id).toBe(item.body);
      const found = new Set(
        spans.flatMap((span) => (span.entry ? [span.entry.id] : [])),
      );
      for (const entry of item.glossary)
        expect(found.has(entry.id), `${item.id}: ${entry.id}`).toBe(true);
    }
  });
});
