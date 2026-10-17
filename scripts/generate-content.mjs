import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";

// These readings are authored, not inferred. Context-dependent readings use whole phrases.
const readingPairs = `
私:わたし 自分:じぶん 会社:かいしゃ 社長:しゃちょう 社員:しゃいん 同僚:どうりょう 仕事:しごと
日本:にほん 日本語:にほんご 東京:とうきょう 英語:えいご 最近:さいきん 前:まえ 後:あと 今:いま
今日:きょう 明日:あした 昨日:きのう 今年:ことし 去年:きょねん 来年:らいねん 今週:こんしゅう 来週:らいしゅう
今月:こんげつ 来月:らいげつ 毎日:まいにち 毎週:まいしゅう 毎月:まいつき 時間:じかん 時:じ 分:ふん
会議:かいぎ 打:う 話:はな 思:おも 考:かんが 聞:き 読:よ 書:か 作:つく 使:つか
言:い 行:い 来:く 来:く 帰:かえ 見:み 知:し 会:あ 伝:つた 教:おし 覚:おぼ
説明:せつめい 紹介:しょうかい 連絡:れんらく 相談:そうだん 確認:かくにん 質問:しつもん 返事:へんじ
予定:よてい 約束:やくそく 日程:にってい 都合:つごう 変更:へんこう 調整:ちょうせい 参加:さんか
製品:せいひん 商品:しょうひん 開発:かいはつ 技術:ぎじゅつ 機能:きのう 画面:がめん 操作:そうさ
利用:りよう 利用者:りようしゃ 顧客:こきゃく お客様:おきゃくさま 客:きゃく 体験:たいけん 経験:けいけん
課題:かだい 問題:もんだい 解決:かいけつ 改善:かいぜん 工夫:くふう 方法:ほうほう 仕組:しく
内容:ないよう 資料:しりょう 情報:じょうほう データ:データ 統計:とうけい 時計:とけい 伯母:おば 祖母:そぼ
研究:けんきゅう 調査:ちょうさ 分析:ぶんせき 結果:けっか 原因:げんいん 理由:りゆう 目的:もくてき
目標:もくひょう 成果:せいか 効果:こうか 影響:えいきょう 変化:へんか 判断:はんだん 決定:けってい
成功:せいこう 失敗:しっぱい 改良:かいりょう 試験:しけん 実験:じっけん 検証:けんしょう 品質:ひんしつ
安全:あんぜん 安心:あんしん 信頼:しんらい 責任:せきにん 管理:かんり 保存:ほぞん 記録:きろく
費用:ひよう 料金:りょうきん 価格:かかく 無料:むりょう 有料:ゆうりょう 支払:しはら 売上:うりあげ
予算:よさん 契約:けいやく 条件:じょうけん 規模:きぼ 状況:じょうきょう 場合:ばあい 環境:かんきょう
生活:せいかつ 趣味:しゅみ 友達:ともだち 友人:ゆうじん 家族:かぞく 子:こ 家:いえ 住:す
食事:しょくじ 昼:ひる 夜:よる 朝:あさ 夕方:ゆうがた 週末:しゅうまつ 休日:きゅうじつ 休:やす
店:みせ 予約:よやく 席:せき 人:にん 名:めい 飲:の 食:た 好:す 楽:たの
料理:りょうり 映画:えいが 音楽:おんがく 旅行:りょこう 運動:うんどう 散歩:さんぽ 出張:しゅっちょう
久:ひさ 元気:げんき 忙:いそが 大変:たいへん 大丈夫:だいじょうぶ 面白:おもしろ 難:むずか 易:やさ
便利:べんり 不便:ふべん 簡単:かんたん 複雑:ふくざつ 自然:しぜん 丁寧:ていねい 大切:たいせつ
必要:ひつよう 十分:じゅうぶん 大事:だいじ 有名:ゆうめい 特別:とくべつ 正確:せいかく 正:ただ
小:ちい 大:おお 新:あたら 古:ふる 長:なが 短:みじか 少:すこ 多:おお 高:たか 安:やす
早:はや 速:はや 遅:おそ 強:つよ 弱:よわ 良:よ 悪:わる 近:ちか 遠:とお 同:おな
初:はじ 次:つぎ 最後:さいご 最初:さいしょ 最終:さいしゅう 一緒:いっしょ 別:べつ 一度:いちど
全部:ぜんぶ 一部:いちぶ 全体:ぜんたい 以上:いじょう 以下:いか 以前:いぜん 以降:いこう 以内:いない
以上:いじょう 一方:いっぽう 自動:じどう 手動:しゅどう 基本:きほん 実際:じっさい 例えば:たとえば
具体的:ぐたいてき 一般的:いっぱんてき 定期的:ていきてき 個人的:こじんてき 積極的:せっきょくてき
相手:あいて 自由:じゆう 意見:いけん 関係:かんけい 共通:きょうつう 興味:きょうみ 特徴:とくちょう
印象:いんしょう 感想:かんそう 感:かん 分:わ 違:ちが 似:に 比:くら 選:えら 決:き
続:つづ 始:はじ 終:お 完了:かんりょう 進:すす 進捗:しんちょく 残:のこ 減:へ 増:ふ
送:おく 届:とど 戻:もど 持:も 待:ま 受:う 入:い 出:だ 押:お 修正:しゅうせい
追加:ついか 削除:さくじょ 検索:けんさく 入力:にゅうりょく 出力:しゅつりょく 表示:ひょうじ 更新:こうしん
公開:こうかい 共有:きょうゆう 対応:たいおう 提案:ていあん 提供:ていきょう 導入:どうにゅう 依頼:いらい
実装:じっそう 設計:せっけい 運用:うんよう 保守:ほしゅ 保護:ほご 設定:せってい 接続:せつぞく
通信:つうしん 保存:ほぞん 権限:けんげん 個人情報:こじんじょうほう 判断:はんだん 処理:しょり
音声:おんせい 文章:ぶんしょう 言葉:ことば 表現:ひょうげん 意味:いみ 文脈:ぶんみゃく 説明:せつめい
学習:がくしゅう 練習:れんしゅう 復習:ふくしゅう 翻訳:ほんやく 誤:あやま 間違:まちが 発音:はつおん
漢字:かんじ 読:よ 声:こえ 音:おと 文:ぶん 雑談:ざつだん 敬語:けいご 文化:ぶんか
世界:せかい 社会:しゃかい 国内:こくない 海外:かいがい 地域:ちいき 地元:じもと 市場:しじょう
駅:えき 電車:でんしゃ 道:みち 場所:ばしょ 住所:じゅうしょ 地図:ちず 到着:とうちゃく 遅刻:ちこく
名刺:めいし 名刺交換:めいしこうかん 忘年会:ぼうねんかい お礼:おれい お願:おねが 失礼:しつれい
弊社:へいしゃ 御社:おんしゃ 貴社:きしゃ 拝見:はいけん 拝読:はいどく 伺:うかが 申:もう
申:もう 承知:しょうち 承:うけたまわ 存:ぞん 参:まい 差:さ ご覧:ごらん お越:おこ
召:めし 賜:たまわ 頂:いただ 幸:さいわい 恐:おそ 恐縮:きょうしゅく お世話:おせわ お手数:おてすう
様:さま 方:かた 皆:みな 皆様:みなさま 皆さん:みなさん 担当:たんとう 担当者:たんとうしゃ
部長:ぶちょう 上司:じょうし 先輩:せんぱい 後輩:こうはい お名前:おなまえ 名前:なまえ 助:たす
本日:ほんじつ 明日:あした 後日:ごじつ 午前:ごぜん 午後:ごご 三時:さんじ 二時:にじ 十分:じゅっぷん
二人:ふたり 一人:ひとり 二:に 三:さん 四:よん 五:ご 六:ろく 七:なな 八:はち 九:きゅう 十:じゅう
一:いち 円:えん 万:まん 年:ねん 月:つき 日:ひ 回:かい 番:ばん 毎:まい 度:ど 点:てん
途中:とちゅう 期限:きげん 納期:のうき 今回:こんかい 前回:ぜんかい 次回:じかい 本当:ほんとう
人間:にんげん 人:ひと 努力:どりょく 得意:とくい 苦手:にがて 飽:あ 気:き 気軽:きがる
気持:きも 感謝:かんしゃ 感動:かんどう 大好:だいす 夢中:むちゅう 集中:しゅうちゅう
試:ため 抜:ぬ 役:やく 立:た 見直:みなお 取:と 合:あ 間:あいだ 向:む
合意:ごうい 認識:にんしき 相互:そうご 結局:けっきょく 実用:じつよう 価値:かち 項目:こうもく
基準:きじゅん 選択:せんたく 可能:かのう 不可能:ふかのう 段階:だんかい 負担:ふたん 効率:こうりつ
調:しら 調:しら 整理:せいり 評価:ひょうか 計算:けいさん 一律:いちりつ 手順:てじゅん 手:て
活動:かつどう 交流:こうりゅう 景色:けしき 写真:しゃしん 趣味:しゅみ 顔:かお 笑:わら
働:はたら 戻:もど 遊:あそ 汗:あせ 両方:りょうほう 片方:かたほう 壊:こわ 動:うご 動作:どうさ
終:お 達成:たっせい 一般:いっぱん 出来:でき 現在:げんざい 将来:しょうらい 将来的:しょうらいてき
前提:ぜんてい 問:と 必:かなら 限:かぎ 限界:げんかい 支援:しえん 協力:きょうりょく
感覚:かんかく 慣:な 効:き 保:たも 守:まも 続:つづ 軽:かる 重:おも
買:か 売:う 交:か 一番:いちばん 苦労:くろう 量:りょう 個:こ 区別:くべつ
一言:ひとこと 数:かず 数字:すうじ 数:すう 誤解:ごかい 確:たし 戸惑:とまど
身近:みぢか 業務:ぎょうむ 作業:さぎょう 形式:けいしき 面倒:めんどう 日常:にちじょう
業界:ぎょうかい 専門:せんもん 専門家:せんもんか 小規模:しょうきぼ 大規模:だいきぼ
見積:みつ 費:つい 買:か 売:う 置:お 断:ことわ 謝:あやま 返:かえ 離:はな
昼食:ちゅうしょく 飲み物:のみもの 甘:あま 辛:から 冷:つめ 暑:あつ 寒:さむ
週:しゅう 週末:しゅうまつ 一年間:いちねんかん 五年間:ごねんかん 三年間:さんねんかん
`;
const readings = new Map(
  readingPairs
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(":")),
);
const contextualReadings = `
日々:ひび 主:おも 何:なに 何て:なんて 困:こま 集:あつ 内:ない 版:ばん 用意:ようい 詳:くわ
詳細:しょうさい 過:す 機会:きかい 忘:わす 辺:へん 普段:ふだん 特:とく 邪魔:じゃま
取り組:とりく 答:こた 準備:じゅんび 次第:しだい 基本的:きほんてき 浮:う 検討:けんとう
上で:うえで 上:あ 優先:ゆうせん 可能性:かのうせい 理解:りかい 延期:えんき 中:ちゅう
返信:へんしん 誰:だれ 専門知識:せんもんちしき 変:か 加:くわ 主催:しゅさい 場面:ばめん
率直:そっちょく お互:おたが 例:れい 案内:あんない 懐:なつ 急:いそ 任:まか ご飯:ごはん
座:すわ 入口:いりぐち 件:けん 存じ上:ぞんじあ 会議室:かいぎしつ 招:まね 分野:ぶんや
来て:きて 来た:きた 来ます:きます 来ました:きました 出て:でて 出る:でる 出た:でた 出ます:でます
出ない:でない 楽に:らくに 楽な:らくな 楽です:らくです 楽だ:らくだ 間に合:まにあ 召し上が:めしあが
十分な:じゅうぶんな 十分に:じゅうぶんに 十分です:じゅうぶんです 分か:わか 分け:わけ
少人数:しょうにんずう 人数:にんずう 三人:さんにん 四人:よにん 五人:ごにん 六人:ろくにん
主な:おもな 主に:おもに 何でも:なんでも 何度:なんど 何時:なんじ 行う:おこなう 行い:おこない
お話し:おはなし お話:おはなし 話を:はなしを 話は:はなしは 話が:はなしが 話に:はなしに
話も:はなしも 話の:はなしの 話と:はなしと 話で:はなしで そんな話:そんなはなし 確認の上:かくにんのうえ
手伝:てつだ 少なく:すくなく 少ない:すくない 何です:なんです 数:かず 分:ふん
専門的:せんもんてき 的:てき 当たり前:あたりまえ 関:かん 省:はぶ 生:う 示:しめ 側:がわ
部分:ぶぶん 知識:ちしき 注目:ちゅうもく 下書:したが 指示:しじ 元:もと 事実:じじつ
信:しん 直:なお 範囲:はんい 重要:じゅうよう 作成:さくせい 道具:どうぐ 無理:むり 扱:あつか
含:ふく 全員:ぜんいん 先:さき 勝:か 目指:めざ 歩:ある 雰囲気:ふんいき 反対:はんたい
希望:きぼう 負:ま 意外:いがい 出来事:できごと 中心:ちゅうしん 避:さ 喜:よろこ 以外:いがい
順番:じゅんばん 誘導:ゆうどう 際:さい 止:と 応:こた 採用:さいよう 過程:かてい 育:そだ
報告:ほうこく 込:こ 文字:もじ 単:たん 翌日:よくじつ 常:つね 組み合:くみあ 完成:かんせい
無駄:むだ 絞:しぼ 一般化:いっぱんか 勧:すす 起:お 繰り返:くりかえ 足:た 結論:けつろん
参加者:さんかしゃ 幅:はば 広:ひろ 言語:げんご 発言:はつげん 明確:めいかく 未決定:みけってい
端末:たんまつ 外部:がいぶ 利点:りてん 失:うしな 移:うつ 複数:ふくすう 優:すぐ 期待:きたい
専門用語:せんもんようご 並:なら 形:かたち 場:ば 役職:やくしょく 面接:めんせつ 敬意:けいい
目の前:めのまえ 話題:わだい 関心:かんしん 自己紹介:じこしょうかい 完璧:かんぺき 登録:とうろく
注意:ちゅうい 手間:てま 日常生活:にちじょうせいかつ 後回:あとまわ 期間:きかん 当:あ 背景:はいけい 回数:かいすう 一つ:ひとつ 一歩:いっぽ 上手:じょうず 行動:こうどう 調子:ちょうし 出な:でな 中で:なかで 会議中:かいぎちゅう テスト中:テストちゅう 出張中:しゅっちょうちゅう 十分で:じゅうぶんで
佐藤:さとう 渡:わた 一か所:いっかしょ 表:ひょう 探:さが 火曜日:かようび 先日:せんじつ
反応:はんのう 厳:きび 茶:ちゃ 電話:でんわ 野菜:やさい 相変わらず:あいかわらず 案件:あんけん
疲:つか 和食:わしょく 目立:めだ 何人:なんにん 二十人:にじゅうにん 七時:しちじ 日時:にちじ
当日:とうじつ 会話:かいわ 方向:ほうこう 少な:すくな 肉:にく 魚:さかな
`;
for (const pair of contextualReadings.trim().split(/\s+/)) {
  const [surface, reading] = pair.split(":");
  readings.set(surface, reading);
}
const ordered = [...readings].sort((a, b) => b[0].length - a[0].length);
const unknown = new Set();
function jp(text) {
  let output = "";
  for (let offset = 0; offset < text.length;) {
    const found = ordered.find(([word]) => text.startsWith(word, offset));
    if (found && /[\p{Script=Han}々]/u.test(found[0])) {
      output += `[[${found[0]}|${found[1]}]]`;
      offset += found[0].length;
    } else {
      const ch = text[offset];
      if (/[\p{Script=Han}々]/u.test(ch))
        unknown.add(text.slice(offset, offset + 12));
      output += ch;
      offset++;
    }
  }
  return output;
}
const review = process.argv.includes("--ai-reviewed")
  ? {
      status: "ai-reviewed",
      reviewer: "Independent AI language review (GPT-6)",
      date: "2026-10-12",
    }
  : { status: "draft", reviewer: "author", date: "2026-10-12" };
const catalog = {
  version: "2026.10.12.2",
  cards: [],
  keigoDrills: [],
  diagnostic: [],
  passages: [],
  scenarios: [],
};
const lines = (source) =>
  source
    .trim()
    .split("\n")
    .map((line) => line.split("|"));
function production(rows, kind, prefix, defaults) {
  return rows.map(
    ([prompt, answer, alternative = "", notes = "", issues = ""], index) => ({
      id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
      revision: 1,
      kind,
      prompt,
      answer: jp(answer),
      alternatives: alternative
        ? [
            {
              text: jp(alternative),
              context: notes || "Another suitable response in this situation.",
            },
          ]
        : [],
      notes:
        notes ||
        "Register choice: polite wording suits a new work contact. Compare the meaning, not exact spelling.",
      register: defaults.register,
      phaseTags: defaults.phases,
      skillTags: [defaults.skill],
      tripRelevant: true,
      issueTags: issues ? issues.split(",") : defaults.issues,
      review: { ...review },
    }),
  );
}

const vocabulary = lines(`
Say you make software products.|ソフトウェアの製品を開発しています。|ソフトウェアを作っています。|Register choice: the shorter version is warm and easy to follow.
Say your product helps people organize information.|情報を整理するためのアプリです。|情報の整理に使うアプリです。|Naturalness: describe the user's task before technical details.
Explain that it reduces routine work.|毎日の作業を減らせます。|日々の作業を楽にできます。|Meaning: reducing work and making it easier are related, not identical.
Say your team is small.|小さなチームで開発しています。|少人数のチームで作っています。|Register choice: both work in friendly business conversation.
Ask what someone is currently working on.|今はどんな仕事をされているんですか。|最近はどんなお仕事をされているんですか。|Register choice: されている adds respect without becoming stiff.
Say you are responsible for development.|開発を担当しています。|主に開発をしています。|Meaning: 担当 identifies your responsibility; 主に identifies your main activity.
Ask who uses their product.|どんな方が使っているんですか。|どんな人が利用しているんですか。|Register choice: 方 is a respectful way to refer to people.
Ask what makes their product distinctive.|どんな特徴があるんですか。|ほかの製品とはどんなところが違うんですか。|Naturalness: the second question invites a concrete comparison.
Say you want to hear their impressions.|感想を聞かせてもらえるとうれしいです。|使ってみた感想を教えてもらえますか。|Register choice: both invite feedback without pressure.
Say you improved the interface.|画面を使いやすくしました。|画面の操作をわかりやすくしました。|Meaning: ease of use and ease of understanding overlap.
Ask about their biggest current challenge.|今、いちばん大きな課題は何ですか。|今、どんなことで困っているんですか。|Naturalness: the second is more conversational and less corporate.
Say you are testing a new feature.|新しい機能を試しています。|新しい機能のテストをしています。|Register choice: both are ordinary product-development wording.
Say you are gathering user feedback.|使っている方の意見を集めています。|利用者の声を聞いています。|Meaning: 声 here means feedback, not literal audio.
Ask whether the feature is useful.|この機能は役に立ちそうですか。|この機能、使えそうですか。|Register choice: the second is lighter and invites an honest answer.
Explain that users can share information.|情報をチームで共有できます。|チーム内で情報を共有できます。|Meaning: the second explicitly limits sharing to the team.
Say setup takes about ten minutes.|設定は十分ぐらいで終わります。|設定には十分ほどかかります。|Naturalness: ぐらい is friendlier; ほど is slightly more formal.
Say there is a free version.|無料で使えるバージョンもあります。|無料版も用意しています。|Register choice: both suit a product explanation.
Explain that the paid version has more features.|有料版では、もっと多くの機能が使えます。|有料版には追加の機能があります。|Meaning: identify the benefit, not just the price.
Say you are still checking the cost.|費用はまだ確認しています。|費用については、まだ調べているところです。|Naturalness: ところ conveys work in progress.
Say you will send the details later.|詳しい内容は後で送ります。|詳細は後でメールします。|Register choice: a friendly work contact does not always need a humble verb.
Ask about their schedule next week.|来週のご予定はいかがですか。|来週はいつならご都合がいいですか。|Register choice: the second asks directly for availability.
Suggest adjusting the meeting date.|日程を調整しましょうか。|別の日に変更しましょうか。|Meaning: changing the date is one way to adjust a schedule.
Say you are visiting Tokyo on business.|仕事で東京に来ています。|出張で東京に来ています。|Meaning: 出張 specifically means a business trip.
Say it has been a long time.|お久しぶりです。|しばらくですね。|Register choice: お久しぶりです is a safe warm greeting.
Ask how someone has been.|最近、いかがお過ごしですか。|最近はどうですか。|Register choice: the first is more courteous; the second is friendly.
Say you are glad to meet again.|またお会いできてうれしいです。|また会えてうれしいです。|Register choice: お会いできて adds respect for a senior contact.
Say you used to live in Japan.|以前、日本に住んでいました。|前は日本に住んでいたんです。|Naturalness: んです adds conversational explanation.
Say your Japanese is rusty.|最近、日本語を話す機会が少なくて。|しばらく日本語を使っていなくて、ちょっと忘れています。|Naturalness: mentioning reduced opportunities is gentler than declaring total inability.
Ask someone to speak a little more slowly.|もう少しゆっくり話していただけますか。|もう少しゆっくり話してもらえますか。|Register choice: いただけますか is more deferential.
Ask what a word means.|その言葉はどういう意味ですか。|今の言葉の意味を教えてもらえますか。|Naturalness: either is a useful repair request.
Confirm that you understood correctly.|つまり、来週までに決めるということですか。|来週までに決めればいい、ということですね。|Meaning: the second proposes confirmation rather than asking neutrally.
Say you cannot remember the word.|言葉がすぐに出てこなくて。|言いたいことはあるんですが、言葉が出てこないんです。|Naturalness: this explains a pause without ending the conversation.
Ask what someone does on weekends.|週末は何をされているんですか。|お休みの日はどんなことをしていますか。|Register choice: a warm work conversation can include a light personal question.
Say you like going for walks.|散歩するのが好きです。|よく散歩しています。|Meaning: liking walks and walking often are distinct claims.
Ask for a restaurant recommendation.|おすすめのお店はありますか。|この辺で好きなお店はありますか。|Naturalness: asking what they like often invites a personal story.
Ask whether they play games.|ゲームはされますか。|ゲームは好きですか。|Meaning: playing and liking games are different questions.
Say you have been absorbed in a game.|最近、そのゲームに夢中です。|最近、そのゲームをよく遊んでいます。|Naturalness: with a specific game, を遊ぶ is used; に夢中 is the safest model here.
Ask what kind of music they like.|どんな音楽がお好きですか。|普段はどんな音楽を聞きますか。|Meaning: favorites and listening habits may differ.
Say you went on a trip recently.|最近、旅行に行ってきました。|この前、旅行したんです。|Register choice: the second feels more conversational.
Ask what left a strong impression.|何がいちばん印象に残りましたか。|特に面白かったことはありますか。|Meaning: memorable and interesting are not always the same.
Say you appreciate their help.|助かりました。ありがとうございます。|手伝ってくださって、ありがとうございます。|Register choice: the second explicitly honors the other person's help.
Say you would like to keep in touch.|また連絡させてください。|これからも連絡を取り合えたらうれしいです。|Meaning: the second invites mutual contact.
Invite them to lunch if they have time.|お時間があれば、一緒にお昼でもいかがですか。|よかったら、一緒にお昼を食べませんか。|Register choice: the second is friendly and still polite.
Say you do not want to interrupt their work.|お仕事の邪魔にならないようにします。|お忙しいと思うので、短くお話ししますね。|Meaning: the second explains how you will avoid disruption.
Say the goal is to make things easier for users.|使う方の負担を減らすのが目標です。|使う人が楽になるようにしたいです。|Register choice: the second explains the benefit in simple words.
Say you are interested in their approach.|そのやり方に興味があります。|どう進めているのか、ぜひ聞きたいです。|Naturalness: the second turns interest into an invitation to explain.
Say the idea is still at an early stage.|まだ考え始めたところです。|まだ最初の段階です。|Naturalness: both avoid overstating product maturity.
Say you are training to regain fluency.|日本語を話すトレーニングをしています。|日本語を話す練習をしています。|Wrong: トレーニング has this spelling; 練習 is a natural alternative.|katakana-spelling
Say you used statistics to check the results.|統計を使って結果を確認しました。|統計データで結果を確かめました。|Wrong: 統計 is とうけい; 時計 is とけい.|long-vowels,kanji-reading
Say you work on a variety of problems.|さまざまな課題に取り組んでいます。|いろいろな課題に取り組んでいます。|Wrong: さまざま needs な before a noun.|missing-na
`);
const grammar = lines(`
Say: Although it is small, the app has useful features.|小さいアプリですが、便利な機能があります。|小さいながらも、便利な機能があります。|Naturalness: ながらも is a compact contrast; ですが is a warmer spoken choice.
Say: We are not necessarily trying to make everything automatic.|全部を自動にしたいわけではありません。|何でも自動にするつもりではないんです。|Meaning: わけではない denies an overly broad conclusion.
Say: If we hear users' opinions, we can improve it.|利用者の意見を聞けば、改善できます。|使う方の声を聞くことで、改善できます。|Meaning: ば states a condition; ことで describes the means.
Say: We developed it while talking to users.|利用者と話しながら開発しました。|利用者の声を聞きつつ、開発を進めました。|Register choice: ながら is ordinary speech; つつ is more formal.
Say: The more you use it, the easier it becomes.|使えば使うほど、使いやすくなります。|使っているうちに、慣れてきます。|Meaning: the alternative describes growing familiarity, not a product change.
Say: I have just started using it.|使い始めたばかりです。|まだ使い始めたところです。|Meaning: ばかり expresses a recent start from the speaker's perspective.
Say: I intended to contact you yesterday.|昨日、連絡するつもりでした。|昨日、連絡しようと思っていたんです。|Naturalness: the second explains an intention that was not carried out.
Say: I will check before I answer.|答える前に確認します。|確認してからお返事します。|Meaning: both put checking before replying.
Say: Once it is ready, I will send it.|準備ができ次第、送ります。|準備ができたら、すぐに送ります。|Register choice: 次第 is concise business phrasing; たら is conversational.
Say: Even if the demo fails, I can explain the product.|デモがうまくいかなくても、製品の説明はできます。|デモに失敗しても、製品については説明できます。|Meaning: ても allows the result despite the condition.
Say: We cannot release it unless we confirm safety.|安全を確認しない限り、公開できません。|安全を確認するまでは、公開できません。|Meaning: 限り marks a necessary condition; までは marks the waiting period.
Say: It is worth trying once.|一度、試してみる価値があります。|一度、試してみるといいと思います。|Meaning: the alternative recommends trying without explicitly assessing value.
Say: It should arrive by tomorrow.|明日までには届くはずです。|明日までに届くと思います。|Meaning: はず implies a reasoned expectation, not certainty.
Say: It seems the meeting has already started.|会議はもう始まったようです。|会議はもう始まったみたいです。|Register choice: みたい is more conversational.
Say: I heard that a new version is coming.|新しいバージョンが出るそうです。|新しいバージョンが出ると聞きました。|Meaning: そう here reports information from another source.
Say: It looks easy to use.|使いやすそうですね。|使いやすそうに見えますね。|Meaning: appearance alone does not establish actual usability.
Say: We are making it easier to use.|使いやすくなるように改善しています。|使いやすくなるように工夫しています。|Naturalness: 工夫 adds the idea of practical improvements.
Say: I have become able to explain it briefly.|短く説明できるようになりました。|前より短く説明できるようになりました。|Meaning: ようになった marks a change in ability.
Say: We ended up changing the date.|日程を変更することになりました。|結局、別の日に変更しました。|Meaning: ことになった presents an arranged or decided outcome.
Say: I have decided to attend.|参加することにしました。|参加しようと決めました。|Meaning: ことにした emphasizes your decision.
Say: Depending on the user, the necessary features differ.|使う人によって、必要な機能が違います。|利用者ごとに、必要な機能は違います。|Meaning: によって indicates variation by person.
Say: Compared with before, it is easier to use.|以前に比べて、使いやすくなりました。|前より使いやすくなりました。|Register choice: 前より is a natural short spoken alternative.
Say: It is useful not only for work but also for daily life.|仕事だけでなく、日常生活でも役に立ちます。|仕事にも生活にも使えます。|Meaning: the alternative says it can be used, not explicitly that it helps.
Say: We have enough time to explain the main features.|主な機能を説明するだけの時間はあります。|基本的な機能なら説明する時間があります。|Meaning: だけの expresses a sufficient amount.
Say: We want to avoid making it complicated.|複雑にしないようにしたいです。|できるだけ簡単にしたいです。|Naturalness: the positive alternative is often clearer in conversation.
Say: I forgot the word even though I know it.|知っている言葉なのに、忘れてしまいました。|知っているはずの言葉が出てこなかったんです。|Meaning: the alternative describes retrieval difficulty rather than loss of knowledge.
Say: While we were talking, I thought of an idea.|話しているうちに、アイデアが浮かびました。|話していたら、アイデアが浮かんだんです。|Meaning: うちに describes a change during an activity.
Say: As development progresses, new issues appear.|開発が進むにつれて、新しい課題が出てきます。|開発を進めると、新しい課題が見えてきます。|Meaning: につれて links changes that progress together.
Say: The product is aimed at people with little time.|時間がない人に向けた製品です。|忙しい人のための製品です。|Meaning: 向け identifies the intended audience.
Say: We made a change based on feedback.|意見をもとに変更しました。|いただいた意見を参考にして、変更しました。|Register choice: いただいた recognizes feedback received from the other person.
Say: We have not decided whether to add it.|追加するかどうかは、まだ決めていません。|追加するかは、まだ検討しています。|Meaning: かどうか marks a yes-or-no uncertainty.
Say: We will consider it after checking the results.|結果を確認した上で、検討します。|結果を見てから考えます。|Register choice: 上で is formal; 見てから is conversational.
Say: It is not impossible, but it takes time.|できないわけではありませんが、時間がかかります。|できると思いますが、少し時間が必要です。|Meaning: the first cautiously rejects impossibility.
Say: It might be better to start small.|小さく始めたほうがいいかもしれません。|まずは小さく始めてみませんか。|Meaning: the alternative invites a shared decision.
Say: I would like to talk whenever it suits you.|ご都合がいいときにお話しできればと思います。|ご都合のいいときにお話しできるとうれしいです。|Naturalness: the second is warm and less formulaic.
Say: Please tell me if anything is unclear.|わからないことがあれば、教えてください。|説明がわかりにくかったら、言ってくださいね。|Register choice: the second is approachable when showing a product.
Say: We improved it without increasing the price.|価格を上げずに改善しました。|価格はそのままで、使いやすくしました。|Meaning: ずに means without doing the stated action.
Say: Rather than adding features, we improved the basics.|機能を増やすより、基本の操作を改善しました。|新しい機能よりも、使いやすさを優先しました。|Meaning: the alternative explicitly states the priority.
Say: This is likely to cause confusion.|これは誤解につながる可能性があります。|これだと、誤解されるかもしれません。|Register choice: the second is simpler spoken language.
Say: I do not want to decide just from the numbers.|数字だけで判断したくありません。|数字だけを見て決めたくないんです。|Naturalness: both make the limitation clear without rejecting data.
Say: It is important to make sure our understanding matches.|認識が合っているか確認することが大切です。|同じように理解しているか、確認したいです。|Meaning: the alternative turns a general principle into a concrete request.
Say: If we can solve this issue, things will become easier.|この課題さえ解決できれば、楽になります。|この問題が解決したら、かなり楽になると思います。|Meaning: さえ emphasizes this as the key remaining condition.
Say: I have no choice but to postpone it.|延期するしかありません。|今回は延期しないといけません。|Meaning: しかない suggests alternatives have been ruled out.
Say: We are still testing it, so it is not yet available.|まだテスト中なので、今は使えません。|今は検証しているところで、まだ公開していません。|Meaning: the alternative names the release status explicitly.
Say: I was so busy that I could not reply.|忙しくて、返事ができませんでした。|忙しかったので、返信が遅くなりました。|Meaning: a late reply is not identical to being unable to reply.
Say: The explanation should be simple enough for anyone.|誰でもわかるように、簡単に説明したいです。|専門知識がなくてもわかる説明にしたいです。|Meaning: the alternative defines the audience more precisely.
Say: We should not assume everybody knows this word.|みんながこの言葉を知っているとは限りません。|この言葉を知らない人もいると思います。|Meaning: とは限らない denies a universal assumption.
Say: I want to hear the whole story before giving an opinion.|最後まで聞いてから、意見を言いたいです。|まずは全部お話を聞きたいです。|Naturalness: the alternative avoids sounding argumentative.
Say: Thanks to your help, we finished on time.|手伝っていただいたおかげで、間に合いました。|助けていただいて、予定どおりに終わりました。|Meaning: おかげで attributes a favorable outcome to help.
Say: We will improve it little by little rather than all at once.|一度に全部変えるのではなく、少しずつ改善します。|まとめて変えずに、少しずつ良くしていきます。|Naturalness: both suit a lightweight product explanation.
`);
const polite = lines(`
Start a friendly conversation at a networking event.|こんにちは。こちらのイベントは初めてですか。||Register choice: a light shared-context question is easier than a formal interview.
Ask whether you may join a conversation.|よかったら、ご一緒してもいいですか。|お話に加わってもいいですか。|Register choice: request entry without demanding attention.
Ask how someone knows the host.|主催の方とは、どのようなお知り合いなんですか。||Naturalness: use this when you know there is a host, not for an anonymous public event.
Ask about their role without sounding like a questionnaire.|普段はどんなお仕事をされているんですか。||Register choice: んですか makes a direct question conversational.
Invite a concrete example.|例えば、どんな場面で使うんですか。||Naturalness: 場面 asks for a situation rather than technical specifications.
Say their explanation is easy to follow.|具体的に説明していただいて、よくわかりました。||Register choice: acknowledge their help rather than judging their language ability.
Respond warmly to an unexpected common interest.|私もそれが好きです。どんなところが面白いと思いますか。||Naturalness: follow the shared interest with a real question.
Ask about a recent enjoyable experience.|最近、何か楽しかったことはありましたか。||Register choice: an open, optional topic is suitable once conversation feels comfortable.
Ask about changes since you last worked together.|以前と比べて、仕事のやり方は変わりましたか。||Naturalness: this leaves room for both organizational and personal changes.
Say you remember working together fondly.|一緒に仕事をしたときのことを、よく覚えています。||Register choice: follow with one specific memory when possible.
Say you are impressed by their progress.|すごく進んでいますね。特にどんなところが変わりましたか。||Naturalness: ask about the changes rather than offering empty praise.
Ask about a product using plain language.|使う方は、どんなことで困っているんですか。||Naturalness: focuses on the user's problem.
Explain one benefit without jargon.|何度も同じ情報を入力しなくてよくなるんです。||Meaning: explain the practical change for the user.
Say you would welcome a candid opinion.|率直な感想を聞かせてもらえるとうれしいです。||Register choice: warm invitation rather than pressure to approve.
Say you are not trying to sell immediately.|今日はまず、お互いの仕事についてお話しできたらうれしいです。||Naturalness: states your conversational purpose positively.
Ask for permission to send a short follow-up.|後で短い紹介をメールしてもいいですか。||Register choice: ask before sending unsolicited material.
Give someone an easy way to decline lunch.|ご都合が合えばで大丈夫です。||Naturalness: reduces pressure after an invitation.
Check whether now is a good time.|今、少しお話ししても大丈夫ですか。||Register choice: safe with staff as well as senior colleagues.
Tell someone you enjoyed hearing their story.|お話を聞けて楽しかったです。||Naturalness: a simple, warm closing.
Close while leaving room for another meeting.|またゆっくりお話しできたらうれしいです。||Register choice: courteous without a heavy promise.
Ask for a moment to find a word.|言葉を思い出すので、ちょっと待ってくださいね。||Naturalness: works in a friendly conversation; in a formal meeting, use 少しお待ちください.
Admit that you did not catch the last part.|すみません、最後のところをもう一度お願いできますか。||Register choice: concise repair request.
Ask whether a simpler explanation would help.|具体的な例で説明しましょうか。||Naturalness: offer an example rather than commenting on their English or understanding.
Suggest Japanese as the conversation language.|日本語でお話しできればうれしいです。||Register choice: expresses your preference without assuming their English ability.
Thank the staff after a visit.|今日は案内していただいて、ありがとうございました。||Register choice: credits the staff's help appropriately.
`);
const casual = lines(`
Greet a familiar former colleague warmly.|久しぶり。元気だった。|久しぶりだね。最近どう。|Register choice: use with someone you already speak casually with.
Ask how their work has been lately.|最近、仕事はどう。|最近、仕事のほうはどう。|Register choice: the rising intonation carries the question.
Say it is good to see them again.|また会えてうれしいよ。||Register choice: よ adds warm emphasis.
Say you miss the old team.|前のチームが懐かしいな。||Naturalness: 懐かしい expresses fond recollection, not a demand to recreate the past.
Ask whether they still live nearby.|まだこの辺に住んでるの。||Register choice: 住んでる is a spoken contraction of 住んでいる.
Ask what they have been into recently.|最近、何にはまってるの。|最近、何か夢中になってることある。|Register choice: casual and suitable for a familiar colleague.
Say you keep forgetting Japanese words.|日本語の言葉がなかなか出てこないんだよね。||Naturalness: describes recall difficulty without claiming all knowledge is gone.
Ask them to remind you of a word.|あれ、日本語で何て言うんだっけ。||Register choice: だっけ asks about something you are trying to remember.
Say their joke made you laugh.|それ、面白いね。思わず笑っちゃった。||Register choice: 笑っちゃった is casual 笑ってしまった.
Ask for the rest of a story.|それで、どうなったの。||Naturalness: an easy follow-up rather than changing subjects.
Respond with mild surprise.|そうなんだ。知らなかった。||Naturalness: acknowledge new information without overreacting.
Say you recently started exercising again.|最近、また運動を始めたんだ。||Register choice: んだ introduces a personal update.
Invite them to grab lunch.|よかったら、お昼でも行かない。||Register choice: suitable for familiar peers, not a first meeting with a CEO.
Suggest meeting after work.|仕事が終わったら、ちょっと会わない。||Naturalness: ちょっと makes the invitation feel light.
Say there is no rush to decide.|急がなくていいよ。||Register choice: reassuring among friends; avoid sounding directive to a senior contact.
Ask which restaurant they would prefer.|どのお店がいい。||Register choice: a short casual choice question.
Say you will leave the restaurant choice to them.|お店は任せてもいい。||Naturalness: ask permission rather than assuming they will organize everything.
Tell them to message you when available.|時間があるときに連絡してね。||Register choice: a friendly request, not a formal business instruction.
Say you will send a photo later.|後で写真を送るね。||Register choice: ね softens a promise.
Say a game is hard to stop playing.|このゲーム、なかなかやめられないんだよね。||Naturalness: conversational description of being absorbed.
Ask whether they tried the new game.|新しいゲーム、もう遊んだ。|新しいゲーム、もうやってみた。|Register choice: both are casual; specify the title if needed.
Say you would like to hear more next time.|続きはまた今度聞かせて。||Register choice: casual invitation to continue a story.
Check whether you are remembering correctly.|前もそんな話をしてたよね。||Meaning: asks for confirmation of a shared memory.
Say you were happy to catch up.|久しぶりに話せて楽しかった。||Naturalness: simple and warm.
Close with a suggestion to meet again.|また会おうね。|またご飯でも行こう。|Register choice: informal closing with an established friend.
`);
for (const [rows, defaults] of [
  [
    vocabulary,
    {
      register: "polite",
      skill: "vocabulary",
      phases: ["reactivation", "core", "trip"],
      issues: ["vocabulary-recall"],
    },
  ],
  [
    grammar,
    {
      register: "polite",
      skill: "grammar",
      phases: ["core", "business", "trip"],
      issues: ["grammar-form"],
    },
  ],
  [
    polite,
    {
      register: "polite",
      skill: "vocabulary",
      phases: ["reactivation", "business", "trip"],
      issues: ["register"],
    },
  ],
  [
    casual,
    {
      register: "casual",
      skill: "vocabulary",
      phases: ["reactivation", "trip"],
      issues: ["register"],
    },
  ],
]) {
  const start = catalog.cards.length;
  catalog.cards.push(
    ...production(rows, "card", "card", defaults).map((item, i) => ({
      ...item,
      id: `card-${String(start + i + 1).padStart(3, "0")}`,
    })),
  );
}

const statistics = catalog.cards.find((item) => item.id === "card-049");
if (!statistics) throw new Error("The statistics production card is missing.");
statistics.revision = 2;
statistics.skillTags = ["vocabulary", "readings"];

const honorific = lines(`
Respect the CEO's action: the CEO will come tomorrow.|社長は明日いらっしゃいます。|社長は明日お越しになります。|Register choice: honorific language raises the CEO's action.|honorific
Respect your manager's action: the manager said this.|部長はそうおっしゃいました。|部長はそのようにおっしゃいました。|Wrong: 申す describes your own side, not the manager's action.|honorific
Ask respectfully whether they have seen the material.|資料はご覧になりましたか。|資料をご覧いただけましたか。|Register choice: the alternative frames their viewing as something you received.|honorific
Ask respectfully whether they know this product.|この製品をご存じですか。||Wrong: 存じています is humble and refers to your own knowledge.|honorific
Ask a senior contact whether they will attend.|会議に参加なさいますか。|会議に参加されますか。|Register choice: both honor the other person's action.|honorific
Ask respectfully what work they do.|どんなお仕事をなさっているんですか。|どんなお仕事をされているんですか。|Naturalness: the second is a lighter everyday choice.|honorific
Invite a guest to sit here.|こちらにお座りください。||Register choice: use お＋verb stem＋ください for the guest's action.|honorific
Invite a guest to have a drink.|どうぞお飲みください。|どうぞ召し上がってください。|Register choice: 召し上がる can refer to eating or drinking.|honorific
Ask respectfully whether they have had lunch.|お昼はもう召し上がりましたか。||Wrong: いただく is humble for your own eating, not the guest's.|honorific
Ask respectfully whether they read the email.|メールはお読みになりましたか。|メールをご覧になりましたか。|Meaning: ご覧になる asks about viewing; お読みになる explicitly asks about reading.|honorific
Ask respectfully when they will return.|いつお戻りになりますか。||Register choice: honors the other person's return.|honorific
Ask whether the CEO is present.|社長はいらっしゃいますか。||Meaning: いらっしゃる can mean be present, come, or go.|honorific
Say the guest has already gone home.|もうお帰りになりました。|もう帰られました。|Register choice: both honor the guest's departure.|honorific
Ask respectfully for their name.|お名前を伺ってもよろしいですか。||Register choice: this honors the contact by humbling your asking.|humble
Invite the guest to look at this screen.|こちらの画面をご覧ください。||Register choice: concise honorific request, without redundant extra layers.|honorific
Ask respectfully whether they will use the app.|このアプリをお使いになりますか。|このアプリを利用なさいますか。|Register choice: the first is lighter and more conversational.|honorific
Ask respectfully whether the date has been decided.|日程はお決めになりましたか。|日程はもう決められましたか。|Register choice: honors the other person's decision.|honorific
Say the guest is waiting at the entrance.|お客様が入口でお待ちです。||Register choice: お待ちです honors the guest's waiting.|honorific
Invite the guest to contact you without hesitation.|どうぞお気軽にご連絡ください。||Register choice: a familiar business invitation, suitable when the invitation is genuine.|honorific
Ask respectfully about their opinion.|どのようにお考えですか。|どうお考えになりますか。|Naturalness: the first is concise; avoid honorific overload.|honorific
`);
const humble = lines(`
Introduce yourself modestly by name.|ジョンと申します。|ジョンです。|Register choice: 申します suits a first business introduction; です is warmer in casual settings.|humble
Say you will visit their office tomorrow.|明日、御社に伺います。||Wrong: use 伺う for your visit to the other person's side.|humble
Say you have read their material.|資料を拝見しました。|資料を読ませていただきました。|Register choice: the alternative is appropriate when permission or a benefit is relevant.|humble
Say you know that fact.|その件は存じております。|そのことは知っています。|Register choice: 存じる humbles your own knowledge; the alternative is plain polite.|humble
Say you know the person.|その方は存じ上げております。||Naturalness: 存じ上げる is used for knowing a person.|humble
Say you will explain briefly.|簡単にご説明します。|簡単に説明いたします。|Register choice: concise humble wording; avoid stacking several forms.|humble
Say you will send the materials.|資料をお送りします。|資料をお送りいたします。|Register choice: いたします adds formality; the first often suffices.|humble
Say you will guide them to the room.|会議室までご案内します。||Register choice: your action benefits the guest.|humble
Ask if you may listen to their account.|お話を伺ってもよろしいですか。||Wrong: 伺う humbles your listening or asking.|humble
Say you received their email.|メールをいただきました。|メールを受け取りました。|Register choice: いただく acknowledges receiving from the other person.|humble
Thank them for taking time.|お時間をいただき、ありがとうございます。|お時間を取ってくださって、ありがとうございます。|Register choice: the first humbles receiving; the second honors giving.|humble
Say you will check and reply.|確認して、お返事します。|確認の上、お返事いたします。|Register choice: the alternative is more suitable for formal written correspondence.|humble
Say you understand a request.|承知しました。|かしこまりました。|Register choice: かしこまりました is common in service settings; 承知しました suits many business exchanges.|humble
Tell an outside contact your own CEO will explain.|弊社の社長がご説明します。||Wrong: do not elevate your own company’s CEO when speaking to an outside contact.|humble
Say you will be waiting for their visit.|お越しをお待ちしております。||Register choice: お越し honors their coming; お待ちしております is courteous about your waiting.|humble
Say you will bring the material.|資料をお持ちします。|資料を持って伺います。|Meaning: the alternative also states that you will visit.|humble
Say you will ask the person in charge.|担当者に確認してまいります。|担当者に確認します。|Register choice: まいります adds formal courtesy, not extra information about responsibility.|humble
Say you will take their question.|ご質問を承ります。|ご質問があれば、伺います。|Register choice: 承る suits formal facilitation or a service exchange.|humble
Say you would be pleased if they checked the details.|内容をご確認いただけると幸いです。|内容を確認していただけるとうれしいです。|Register choice: 幸いです suits email; うれしいです is warmer in speech.|humble
Thank them for inviting you.|お招きいただき、ありがとうございます。|お招きくださって、ありがとうございます。|Register choice: receiving humbly versus honoring their invitation.|humble
`);
catalog.keigoDrills = production([...honorific, ...humble], "keigo", "keigo", {
  register: "keigo",
  skill: "keigo",
  phases: ["business", "trip"],
  issues: ["register"],
}).map((item) => ({
  ...item,
  keigoType: item.issueTags.includes("honorific") ? "honorific" : "humble",
}));

const diagnostics = [
  [
    "vocabulary",
    "Write the Japanese word for speaking practice/training.",
    "トレーニング",
    "練習",
    "Wrong: the katakana spelling is トレーニング.",
    ["katakana-spelling"],
  ],
  [
    "vocabulary",
    "Explain in one sentence what a software product does.",
    "情報を整理するためのアプリです。",
    "情報を整理するアプリです。",
    "Naturalness: your real product explanation may differ; grade recall and clarity.",
    ["vocabulary-recall"],
  ],
  [
    "vocabulary",
    "Say you would like to hear their impressions.",
    "感想を聞かせてもらえるとうれしいです。",
    "感想を教えてもらえますか。",
    "Register choice: both are polite invitations.",
    ["vocabulary-recall", "register"],
  ],
  [
    "vocabulary",
    "Ask a familiar colleague what they have been into lately.",
    "最近、何にはまってるの。",
    "最近、何か夢中になってることある。",
    "Register choice: casual wording belongs with a familiar colleague.",
    ["vocabulary-recall", "register"],
  ],
  [
    "grammar",
    "Complete the blank: various fields of computer science.",
    "コンピュータサイエンスのさまざまな分野",
    "コンピュータサイエンスのいろいろな分野",
    "Wrong: use な after さまざま before a noun.",
    ["missing-na"],
  ],
  [
    "grammar",
    "Say you are not necessarily trying to automate everything.",
    "全部を自動にしたいわけではありません。",
    "何でも自動にするつもりではありません。",
    "Meaning: deny a broad inference without denying all automation.",
    ["grammar-form"],
  ],
  [
    "grammar",
    "Say that as development progresses, new issues appear.",
    "開発が進むにつれて、新しい課題が出てきます。",
    "開発を進めると、新しい課題が見えてきます。",
    "Meaning: the model links two developing changes.",
    ["grammar-form"],
  ],
  [
    "grammar",
    "Say you will send it as soon as it is ready.",
    "準備ができ次第、送ります。",
    "準備ができたら、すぐに送ります。",
    "Register choice: both express prompt action after preparation.",
    ["grammar-form"],
  ],
  [
    "readings",
    "Write both readings in kana, in this order: clock; statistics.",
    "とけい、とうけい",
    "",
    "Wrong: 時計 is とけい; 統計 is とうけい.",
    ["long-vowels", "kanji-reading"],
  ],
  [
    "readings",
    "Write both words in kana, in this order: aunt; grandmother.",
    "おばさん、おばあさん",
    "",
    "Wrong: the long vowel changes the meaning.",
    ["long-vowels"],
  ],
  [
    "readings",
    "Write both loanwords, in this order: building; beer.",
    "ビル、ビール",
    "",
    "Wrong: the long vowel changes the meaning.",
    ["long-vowels", "katakana-spelling"],
  ],
  [
    "readings",
    "Write the reading of 課題 in kana.",
    "かだい",
    "",
    "Wrong: 課題 is かだい.",
    ["kanji-reading"],
  ],
  [
    "keigo",
    "Ask a senior contact if they have seen your material.",
    "資料はご覧になりましたか。",
    "資料をご覧いただけましたか。",
    "Wrong: 拝見する is for your own viewing, not theirs.",
    ["honorific"],
  ],
  [
    "keigo",
    "Tell a contact you will visit their office tomorrow.",
    "明日、御社に伺います。",
    "",
    "Wrong: 伺う humbles your own visit.",
    ["humble"],
  ],
  [
    "keigo",
    "Introduce yourself at a first business meeting.",
    "ジョンと申します。",
    "ジョンです。",
    "Register choice: a different real name is expected; grade register rather than identity.",
    ["humble", "register"],
  ],
  [
    "keigo",
    "Ask a familiar colleague to meet for lunch, without formal honorifics.",
    "よかったら、お昼でも行かない。",
    "一緒にお昼を食べない。",
    "Register choice: a casual invitation is appropriate only in an established casual relationship.",
    ["register"],
  ],
];
catalog.diagnostic = diagnostics.map(
  ([skill, prompt, answer, alternative, notes, issues], index) => ({
    id: `diag-${String(index + 1).padStart(2, "0")}`,
    revision: 1,
    kind: "diagnostic",
    prompt,
    ...(index === 4
      ? { promptJapanese: jp("コンピュータサイエンスのさまざま（　）分野") }
      : {}),
    answer: jp(answer),
    alternatives: alternative
      ? [
          {
            text: jp(alternative),
            context: "Accept equivalent wording appropriate to the situation.",
          },
        ]
      : [],
    notes,
    register: [3, 15].includes(index)
      ? "casual"
      : index >= 12
        ? "keigo"
        : "polite",
    ...(index >= 12 && index < 15
      ? { keigoType: index === 12 ? "honorific" : "humble" }
      : {}),
    phaseTags: ["reactivation"],
    skillTags: [skill],
    tripRelevant: true,
    issueTags: issues,
    review: { ...review },
  }),
);

for (const item of [...catalog.cards, ...catalog.diagnostic]) {
  if (
    item.register === "casual" &&
    /^(Ask|Greet|Invite|Suggest|Check)/.test(item.prompt)
  ) {
    item.answer = item.answer.replace(/。$/, "？");
    item.alternatives = item.alternatives.map((a) => ({
      ...a,
      text: a.text.replace(/。$/, "？"),
    }));
  }
}
catalog.keigoDrills[2].keigoType = "both";
catalog.keigoDrills[39].keigoType = "both";

const passageDrafts = [
  {
    title: "A product people can explain",
    body: `新しいソフトウェアを紹介するとき、開発した機能を全部説明したくなることがあります。しかし、初めて聞く人が知りたいのは、機能の数よりも、自分の仕事や生活がどう変わるかではないでしょうか。例えば、同じ情報を何度も入力する作業が減るなら、その場面を一つ見せるだけでも、製品の価値は伝わります。
    小さなチームでは、開発した人が説明も担当することが多いので、専門的な言葉を使いすぎることがあります。自分には当たり前の言葉でも、相手にはわからないかもしれません。短く説明した後で、相手の質問を聞く時間を残しておくと、理解しにくいところに気づけます。
    説明を短くすることは、情報をただ減らすことではありません。相手が判断するために必要な内容を選ぶことです。料金や安全に関する条件など、使う前に知っておくべきことまで省いてしまうと、後で誤解が生まれる可能性があります。
    そこで、最初は一つの具体的な例を示し、次に主な機能と条件を説明する方法が役に立ちます。最後に「どんな場面で使えそうですか」と聞けば、相手の仕事についても知ることができます。説明する側が話し続けるより、お互いの話をつなげるほうが、製品の改善につながる意見を聞けるかもしれません。
    説明を聞いた人に、自分の言葉で製品を紹介してもらうのも一つの方法です。どこが伝わり、どこが伝わらなかったのかを確認できるからです。伝わらなかった部分は、相手の知識の問題と決めつけず、例や言葉を見直すきっかけにできます。`,
    glossary: [
      ["価値", "value"],
      ["専門的", "specialized; technical"],
      ["誤解", "misunderstanding"],
      ["条件", "conditions"],
      ["改善", "improvement"],
    ],
    questions: [
      [
        "What should the first explanation focus on?",
        "相手の仕事や生活がどう変わるかに注目します。",
      ],
      [
        "Why ask someone to explain the product in their own words?",
        "何が伝わったかを確認し、説明を見直すためです。",
      ],
    ],
  },
  {
    title: "Checking an AI-generated answer",
    body: `文章を作るAIは、メールの下書きやアイデアの整理など、さまざまな作業に使われています。短い指示を入力するだけで、自然な文章がすぐに出てくるため、仕事が終わったように感じることもあります。しかし、読みやすい文章であることと、内容が正しいことは別です。数字や名前が間違っていても、文章だけを見ると気づきにくい場合があります。
    大切なのは、AIに任せる作業と、人が確認する作業を分けることです。例えば、表現をわかりやすくするために使うなら、元の意味が変わっていないかを確かめます。事実について質問するなら、答えをそのまま信じず、信頼できる資料と比べる必要があります。
    確認する手間を考えずに導入すると、かえって仕事が増えるかもしれません。毎回、長い文章を最初から調べ直すより、必要な部分だけを作ってもらうほうが、確認しやすいこともあります。何を任せれば時間が減るのかは、実際の作業で試してみないとわかりません。
    また、顧客の情報を入力してよいかどうかは、便利さだけでは判断できません。会社のルールやサービスの条件を確認し、保存される内容や利用される範囲を理解する必要があります。わからない点があれば、使う前に担当者に相談するほうが安心です。
    AIの利用では、速く文章を作れるかだけでなく、最後に人が責任を持って判断できるかも重要です。下書きの作成、確認、修正という手順を決めておけば、便利な道具として使いやすくなります。道具に合わせて仕事を変える前に、どんな問題を解決したいのかを考えることが、無理のない導入につながります。`,
    glossary: [
      ["下書き", "draft"],
      ["任せる", "entrust; leave to"],
      ["範囲", "scope; range"],
      ["導入", "introduction; adoption"],
      ["責任", "responsibility"],
    ],
    questions: [
      [
        "Why is readable AI text not enough?",
        "自然な文章でも、数字や事実が間違っている場合があるからです。",
      ],
      [
        "What should a company consider before adopting the tool?",
        "確認の手間や情報の扱いを含めて、解決したい問題を考えます。",
      ],
    ],
  },
  {
    title: "Enjoying games with different schedules",
    body: `友人と同じゲームを遊んでいても、遊べる時間が同じとは限りません。毎日少しずつ進める人もいれば、週末にまとめて遊ぶ人もいます。仕事や家族との予定がある中で、全員が同じ速さで進むことを目標にすると、楽しいはずの時間が負担になってしまうかもしれません。
    一緒に遊ぶときは、何を楽しみたいのかを先に話しておくと安心です。難しい相手に勝つことを目指すのか、まだ見ていない場所を歩くのかによって、必要な準備は変わります。初めて参加する人がいるなら、その人が質問しやすい雰囲気を作ることも大切です。
    経験がある人がすべての答えを教えてしまうと、進むのは速くなりますが、自分で考える楽しさは減ります。反対に、何も説明しなければ、操作がわからず困る人もいるでしょう。「先に説明したほうがいい」と思っても、一度「自分で試してみたいですか」と聞いてみると、相手の希望がわかります。
    遊んだ後の雑談も、関係を続けるきっかけになります。勝ったか負けたかだけでなく、面白かった場面や意外だった出来事を話せば、上手な人だけが会話の中心になることを避けられます。短い時間しか参加できなかった人にも、印象に残ったことを聞いてみるとよいでしょう。
    ゲームは、同じ場所に住んでいない友人とも時間を共有できる方法です。ただし、毎回参加することを約束しなくても、関係は続けられます。無理のない予定を決め、参加できない日があっても気軽に戻れるようにすることが、長く一緒に楽しむための工夫になります。`,
    glossary: [
      ["負担", "burden"],
      ["雰囲気", "atmosphere"],
      ["希望", "wish; preference"],
      ["意外", "unexpected"],
      ["約束", "promise; arrangement"],
    ],
    questions: [
      [
        "Why discuss what to enjoy before playing?",
        "目的によって必要な準備や進め方が変わるからです。",
      ],
      [
        "How can the group make continued participation easier?",
        "無理のない予定を決め、参加できない日があっても戻りやすくします。",
      ],
    ],
  },
  {
    title: "Listening before proposing a feature",
    body: `製品を改善するために利用者の話を聞くと、「この機能を追加してほしい」という依頼が集まることがあります。依頼された機能をすぐに作れば、相手は喜ぶかもしれません。しかし、その機能が必要になった理由を聞かないまま開発すると、本当の問題が残る場合があります。
    例えば、「情報を別の画面に出したい」という希望の背景には、今の画面では大事な情報を見つけにくいという問題があるかもしれません。画面を増やす以外にも、表示する順番を変えたり、検索しやすくしたりする方法があります。最初から一つの方法に決めず、どんなときに困るのかを具体的に聞くことが大切です。
    質問するときは、答えを誘導しないように気をつけます。「この機能があれば便利ですよね」と聞くと、相手は話を合わせてしまうかもしれません。「前回、困ったときは何をしましたか」と聞けば、実際の行動について話してもらえます。
    集まった意見を比べる際にも、依頼の数だけで判断しないことも大切です。毎日の仕事が止まる問題と、たまに少し不便に感じる問題では、影響が違います。どれだけ困っているのか、今はどう対応しているのかを知ることで、優先する課題を選びやすくなります。
    すべての依頼に応えることは難しくても、話を聞いた結果を伝えることはできます。採用しなかった理由や、別の方法を考えていることを説明すれば、相手も判断の過程を理解しやすくなります。意見を集める活動は、機能を増やすだけでなく、利用者との信頼を育てる機会でもあります。`,
    glossary: [
      ["依頼", "request"],
      ["誘導", "leading; directing"],
      ["優先", "priority"],
      ["採用", "adoption; selection"],
      ["過程", "process"],
    ],
    questions: [
      [
        "Why ask why a requested feature is needed?",
        "別の方法で本当の問題を解決できるかもしれないからです。",
      ],
      [
        "Why explain a decision not to add a feature?",
        "判断の過程を伝え、利用者との信頼を保つためです。",
      ],
    ],
  },
  {
    title: "Working with a team across time zones",
    body: `離れた場所にいる人たちと仕事をすると、同じ時間に集まることが難しい場合があります。全員で確認するために会議を増やしても、決めるべきことが少なければ、かえって集中する時間が減ってしまいます。大切なのは、会議をなくすことではなく、話し合う必要がある場面を選ぶことです。
    進捗の報告だけなら、短い文章で共有できることがあります。何を終えたか、次に何をするか、どこで困っているかを同じ形式で書けば、読む側も必要な情報を見つけやすくなります。ただし、文章にしただけで相手が理解したと思い込まないことが重要です。
    意見が分かれている問題では、声で話したほうが早い場合もあります。文字だけでは強く見える表現でも、声の調子を聞けば、単なる質問だったとわかることがあります。話した後に決定した内容を短く残しておけば、参加できなかった人も確認できます。
    返事を待つ時間についても、認識を合わせておく必要があります。すぐに返事が必要な連絡と、翌日までに読めばよい情報を区別すると、常に画面を見ていなくても仕事を進められます。相手の休日や生活の時間を考えることは、長く協力するための基本です。
    共有する文章は、長ければよいわけではありません。読む人が次の行動を判断できる内容になっているかが大切です。短い報告、必要な会話、決定の記録を組み合わせることで、離れたチームでも無理なく仕事を続けやすくなります。`,
    glossary: [
      ["進捗", "progress"],
      ["形式", "format"],
      ["調子", "tone; condition"],
      ["区別", "distinction"],
      ["認識", "understanding; perception"],
    ],
    questions: [
      [
        "When might speaking work better than text?",
        "意見が分かれているときや、表現が誤解されそうなときです。",
      ],
      [
        "Why distinguish urgent messages from other information?",
        "常に画面を見ずに仕事を進め、相手の生活の時間を守るためです。",
      ],
    ],
  },
  {
    title: "Learning from a small experiment",
    body: `新しい製品のアイデアができると、できるだけ多くの機能を作ってから公開したくなることがあります。しかし、時間をかけて完成させても、利用者が本当に必要としているとは限りません。開発する前に、小さな実験で確かめられることはないかを考えると、無駄な作業を減らせる場合があります。
    実験では、何を知りたいのかを一つに絞ることが大切です。例えば、ある作業を楽にするアイデアを説明して、試してみたい人がいるかを聞く方法があります。この段階では、製品を完成させる必要はありません。ただし、まだ使えない機能を、すでに使えるように説明してはいけません。
    人数が少ない調査では、結果を一般化しすぎないように気をつけます。三人が便利だと言ったからといって、誰にとっても役に立つとは判断できません。どんな仕事をしている人が、どんな場面で必要だと感じたのかを記録しておくと、次に何を調べるべきかが見えてきます。
    また、「使いたい」という言葉と、実際に使う行動は違うことがあります。説明を聞いたときは興味があっても、普段の作業を変えるほどの理由がないかもしれません。無理に利用を勧めるのではなく、試してもらった後に何が起きたかを確認するほうが、具体的な課題を知ることにつながります。
    実験の結果、最初の考えが正しくないとわかっても、失敗とは限りません。大きな費用をかける前に、別の方向を考えられるからです。小さな実験を繰り返し、結果に合わせて判断を変えることが、限られた時間で開発するチームの助けになります。`,
    glossary: [
      ["実験", "experiment"],
      ["絞る", "narrow down"],
      ["一般化", "generalization"],
      ["行動", "action; behavior"],
      ["繰り返し", "repetition"],
    ],
    questions: [
      [
        "What should a small experiment focus on?",
        "知りたいことを一つに絞り、必要な情報を集めます。",
      ],
      [
        "Why can a negative result still be useful?",
        "大きな費用をかける前に、考えや方向を見直せるからです。",
      ],
    ],
  },
  {
    title: "Planning a meeting people can contribute to",
    body: `会議の時間が足りなくなる原因は、話す内容が多いことだけではありません。何を決める会議なのかがはっきりしていないと、必要な情報を集めるところから始めることになり、結論が出ないまま時間が過ぎることがあります。会議の前に、目的と確認したい点を短く共有しておくと、参加者も準備しやすくなります。
    資料を送る場合は、全部読んでほしいのか、一部だけ確認してほしいのかを伝えます。「先に読んでください」と言うだけでは、どこに注目すべきかわかりません。意見がほしい部分を示すことで、専門が違う人も参加しやすくなります。
    会議中は、すぐに答える人の意見だけが集まらないように工夫します。考える時間が必要な人もいれば、使っている言葉の意味を確かめたい人もいるからです。少し待ってから質問を受けたり、文章で意見を送れるようにしたりすることで、聞ける意見の幅が広がります。
    すべての人が同じ言語を得意としているとは限りません。難しい言葉を使った場合には、具体的な例で説明すると理解しやすくなります。わからないことを質問してもよいと伝えるだけでなく、質問するための時間を実際に残すことが大切です。
    最後には、決まったことと、まだ決まっていないことを分けて確認します。誰が何をいつまでにするのかを記録しておけば、会議の後に同じ相談を繰り返す必要が減ります。発言の量ではなく、次の行動が明確になったかどうかを見直すことで、会議を改善できます。`,
    glossary: [
      ["結論", "conclusion"],
      ["注目", "attention; focus"],
      ["発言", "statement; speaking contribution"],
      ["明確", "clear; definite"],
      ["参加者", "participant"],
    ],
    questions: [
      [
        "How can a pre-meeting message make preparation easier?",
        "目的や意見がほしい部分を示します。",
      ],
      [
        "What should be confirmed at the end?",
        "決まったことと未決定のこと、次の担当と期限を確認します。",
      ],
    ],
  },
  {
    title: "Trust and information in a small app",
    body: `小さなアプリでも、使う人にとって大切な情報を扱うことがあります。開発する側が便利な機能を増やすことに集中していると、情報がどこに保存されるのか、誰が見ることができるのかという説明が後回しになりがちです。しかし、その仕組みがわからなければ、安心して使えない人もいます。
    最初に考えたいのは、本当に保存する必要がある情報かどうかです。将来、役に立つかもしれないという理由だけで集めると、管理する負担も増えます。必要な情報を選び、使う目的をはっきりさせることは、機能の設計と同じくらい大切です。
    端末だけに保存する方法では、外部に送らない利点がありますが、端末が壊れたり、データを削除したりすると失われる可能性があります。利用者にとっては、保存場所だけでなく、別の端末に移せるか、必要なときに取り出せるかも重要です。
    一方、サーバーに保存する方法では、複数の端末から使いやすくなりますが、接続できないときの動作や、情報を見る権限を考えなければなりません。どちらか一方が、すべての場面で優れているわけではありません。使う目的と、利用者が期待していることに合わせて判断する必要があります。
    説明は、難しい専門用語を並べるだけでは十分ではありません。「この端末を変えたら、何をすればいいか」といった具体的な質問に答えられる形が役に立ちます。便利さと情報の扱いを一緒に説明することで、使う人が自分で判断しやすい製品になります。`,
    glossary: [
      ["端末", "device"],
      ["権限", "permission; access rights"],
      ["後回し", "postponement"],
      ["外部", "outside; external"],
      ["利点", "advantage"],
    ],
    questions: [
      [
        "Why avoid collecting information just in case?",
        "管理の負担が増えるので、必要な情報と目的を選ぶためです。",
      ],
      [
        "Why is device-only storage not sufficient explanation?",
        "端末が壊れたときの対応や、情報を別の端末へ移す方法も説明する必要があるからです。",
      ],
    ],
  },
  {
    title: "A comfortable business conversation",
    body: `仕事の場で初めて会う人と話すとき、失礼のないようにしようとして、質問がかたくなることがあります。会社の規模や役職を順番に聞くだけでは、面接のように感じられるかもしれません。相手に敬意を示しながら、話しやすい雰囲気を作るには、目の前の共通の話題から始める方法があります。
    例えば、参加しているイベントについて「どのお話が印象に残りましたか」と聞けば、相手は自分の関心に合わせて答えられます。その答えから仕事の話につながることもあれば、趣味の話に広がることもあります。用意した質問を全部使うより、相手の答えを聞いて、次の質問を選ぶほうが自然です。
    自分の仕事を説明するときも、長い自己紹介を一度にする必要はありません。何を作っているかを短く伝え、興味を持ってもらえたら、具体的な例を加えます。相手が話した内容と関係がある部分を選べば、一方的な説明になりにくくなります。
    また、英語が得意かどうかを決めつけず、相手が話しやすい言語や表現に合わせることが大切です。日本語で言葉が出てこないときは、言い直したり、例を示したりできます。完璧に話すことだけを目標にせず、理解できたかをお互いに確認すると、会話を続けやすくなります。
    最後に、また話したいと思った理由を一つ伝えると、次の連絡もしやすくなります。すぐに仕事につながらなくても、楽しかった話題を覚えておくことはできます。短い会話の中で相手への関心を示すことが、長く続く関係の最初の一歩になります。`,
    glossary: [
      ["役職", "position; job title"],
      ["敬意", "respect"],
      ["関心", "interest; concern"],
      ["一方的", "one-sided"],
      ["完璧", "perfect"],
    ],
    questions: [
      [
        "Why start with a shared topic?",
        "相手が答えやすく、自然に会話を広げられるからです。",
      ],
      [
        "What can make follow-up easier without an immediate deal?",
        "楽しかった話題や、また話したい理由を伝えておくことです。",
      ],
    ],
  },
  {
    title: "Reading numbers before telling the story",
    body: `製品の利用が増えたかどうかを調べるとき、数字は便利な手がかりになります。しかし、一つの数字だけを見ると、実際の状況を誤解することがあります。登録した人が増えていても、次の週にはほとんど使っていないかもしれません。どんな変化を知りたいのかによって、確認する数字を選ぶ必要があります。
    比べる期間にも注意が必要です。休日が多い月と、普段どおりに仕事をする月では、同じ製品でも利用される回数が違う場合があります。前の月より少ないという理由だけで、製品に問題があるとは判断できません。何が違っていたかを確認してから、原因を考えるほうがよいでしょう。
    利用者が少ない製品では、十分な量のデータが集まるまで時間がかかることがあります。少人数の意見や短い期間の結果は、次の調査のヒントになりますが、すべての人に当てはまるとは限りません。統計を使う場合にも、どのような人の情報を、どんな方法で集めたのかを知ることが大切です。
    数字と利用者の話を組み合わせると、結果の意味を考えやすくなります。利用が減った人に話を聞くと、機能が足りなかったのではなく、仕事の担当が変わったためだとわかるかもしれません。数字は変化を示しますが、その理由まで自動的に教えてくれるわけではありません。
    結果を共有するときは、わかったことと、まだわからないことを分けて説明します。期待した成果が出なかった場合でも、都合のよい数字だけを選ばないことが重要です。限界を含めて伝えるほうが、次に何を確かめるべきかをチームで相談しやすくなります。`,
    glossary: [
      ["登録", "registration"],
      ["期間", "period"],
      ["統計", "statistics"],
      ["手がかり", "clue"],
      ["限界", "limit; limitation"],
    ],
    questions: [
      [
        "Why might a month-to-month decrease not prove a product problem?",
        "休日や仕事の状況など、比べる期間の条件が違う場合があるからです。",
      ],
      [
        "What should a report distinguish?",
        "わかったことと、まだわからないことを分けて伝えます。",
      ],
    ],
  },
];
catalog.passages = passageDrafts.map((passage, index) => ({
  id: `passage-${String(index + 1).padStart(2, "0")}`,
  revision: 1,
  title: passage.title,
  body: jp(passage.body.replace(/\n\s+/g, "\n\n")),
  register: "polite",
  glossary: passage.glossary.map(([term, meaning], termIndex) => ({
    id: `passage-${String(index + 1).padStart(2, "0")}-gloss-${String(termIndex + 1).padStart(2, "0")}`,
    term: jp(term),
    meaning,
  })),
  questions: passage.questions.map(([prompt, answer]) => ({
    prompt,
    answer: jp(answer),
  })),
  speechText: passage.body.replace(/\n\s+/g, "\n"),
  review: { ...review },
}));

const scenarioDrafts = [
  {
    id: "scenario-introduction",
    title: "Meeting and exchanging business cards",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "business", "trip"],
    situation:
      "You meet a CEO at a Tokyo networking event. Introduce yourself warmly, exchange cards, and find a shared topic.",
    turns: lines(`
初めまして。佐藤です。|Greet them and introduce yourself.|初めまして。ジョンと申します。お会いできてうれしいです。|初めまして。ジョンです。よろしくお願いします。|Register choice: 申します is modest; the alternative is lighter.|humble,register
こちら、私の名刺です。|Accept their card and offer yours.|ありがとうございます。こちらが私の名刺です。よろしくお願いします。|ありがとうございます。私の名刺もお渡ししますね。|Register choice: お渡しします politely describes your own action.|humble
今はどんなお仕事をされているんですか。|Briefly explain your software-product work.|小さなチームでソフトウェア製品を作っています。情報を整理するアプリを開発しているんです。||Naturalness: adapt the example to your actual product rather than claiming invented work.|vocabulary-recall
そうなんですね。東京にはよくいらっしゃるんですか。|Explain your connection to Japan.|以前、日本に五年間住んでいました。今回は久しぶりの出張です。||Register choice: plain polite speech is enough for the personal background.|register
今日のイベントは、どのお話が面白かったですか。|Answer and invite their view.|小さなチームで開発する話が印象に残りました。佐藤さんは、どのお話が印象に残りましたか。||Naturalness: a shared event topic makes an easy follow-up.|naturalness
`),
  },
  {
    id: "scenario-products",
    title: "Explaining a software product simply",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "core", "trip"],
    situation:
      "A staff member asks about your software product. Describe one practical benefit and ask about their work.",
    turns: lines(`
どんな製品を作っているんですか。|Give a one-sentence explanation.|情報を整理して、チームで共有するためのアプリです。||Naturalness: start with the task and benefit, not the technology stack.|vocabulary-recall
例えば、どういうときに使うんですか。|Give one concrete user situation.|何人かで同じ仕事をするときに、必要な情報を一か所にまとめられるんです。||Naturalness: choose an example that matches the real product.|vocabulary-recall
今使っている道具とは、何が違うんでしょうか。|Describe one difference without dismissing their tools.|同じ情報を何度も入力しなくてよくなるところです。今は、どんな方法で共有していますか。||Naturalness: answer first, then invite their experience.|grammar-form
メールと表を使っていますが、探すのに時間がかかります。|Acknowledge the problem and check a detail.|そうなんですね。必要な情報が、いろいろな場所に分かれているんですか。||Naturalness: clarify before proposing a solution.|naturalness
そうですね。使い方を見てみたいです。|Offer a short demo with an easy decline.|よかったら、今、画面を少しお見せしましょうか。お忙しければ、後で短い紹介を送ります。||Register choice: お見せする humbles your demonstration.|humble
`),
  },
  {
    id: "scenario-scheduling",
    title: "Arranging a short meeting",
    mode: "speaking",
    register: "polite",
    phases: ["business", "trip"],
    situation:
      "Arrange a short follow-up meeting with a busy work contact. Clarify the date, duration, and place.",
    turns: lines(`
もう少し詳しくお話を聞きたいです。|Suggest a short follow-up at their convenience.|ありがとうございます。来週、ご都合のいいときに少しお話しできればうれしいです。||Register choice: warm polite language works without stacking honorifics.|register
火曜日の午後なら時間があります。|Suggest a specific time.|では、火曜日の午後二時はいかがですか。||Naturalness: repeat the day to reduce ambiguity.|vocabulary-recall
二時で大丈夫です。どのくらいかかりますか。|Offer a clear duration.|三十分ぐらいを考えています。ご都合に合わせて短くすることもできます。||Naturalness: state the duration and flexibility.|long-vowels
こちらの会社に来ていただけますか。|Accept the visit and check the location.|はい、伺います。住所を教えていただけますか。||Wrong: your visit uses humble 伺う, not honorific いらっしゃる.|humble
メールで住所を送りますね。|Confirm the complete arrangement.|ありがとうございます。では、来週の火曜日、午後二時に伺います。よろしくお願いします。||Naturalness: confirm the agreed details without adding unagreed promises.|humble
`),
  },
  {
    id: "scenario-email",
    title: "Writing a courteous follow-up email",
    mode: "email",
    register: "keigo",
    phases: ["business", "trip"],
    situation:
      "After meeting a CEO, write a warm email thanking them and proposing a short product discussion next week. Write within ten minutes.",
    turns: lines(String.raw`
先日はありがとうございました。製品について、また少しお話しできればと思います。|Write a clear email with a subject, greeting, purpose, proposed next step, and closing.|件名：製品についてのご相談\n\n佐藤様\n\n先日はお話しする機会をいただき、ありがとうございました。\nチームで情報を共有する方法についてのお話が、特に印象に残りました。\n\n来週、お時間があれば、弊社の製品を簡単にご紹介できればと思っております。三十分ほどを考えておりますが、ご都合に合わせて調整いたします。\nご都合のよい日時を教えていただけると幸いです。\n\nどうぞよろしくお願いいたします。\n\nジョン||Register choice: this is a courteous outside-business email. Use a real shared topic and truthful product details.|humble,register
`),
  },
  {
    id: "scenario-bonenkai",
    title: "Friendly conversation at a year-end gathering",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "trip"],
    situation:
      "At a 忘年会, chat with staff you know a little. Keep polite speech warm and avoid pressing for private details.",
    turns: lines(`
お久しぶりです。日本にはいつまでいらっしゃるんですか。|Answer briefly and ask a light question.|来週までいる予定です。久しぶりに皆さんに会えてうれしいです。今日は何人ぐらい集まるんですか。||Naturalness: keep the return question grounded in the gathering.|register
二十人ぐらいです。今年は忙しかったですよ。|Invite a comfortable work story.|そうだったんですね。今年は、どんなことが印象に残っていますか。||Naturalness: let them choose the story rather than demanding a success report.|naturalness
新しい製品を公開したのが大きかったですね。|Show interest and ask one follow-up.|それは大変でしたね。公開した後、どんな反応がありましたか。||Naturalness: 大変でしたね acknowledges effort; adjust if their story was easy rather than difficult.|vocabulary-recall
いい意見も、厳しい意見もありました。ジョンさんは最近どうですか。|Share a short personal update.|最近は開発の仕事をしながら、日本語を話す練習もしています。皆さんともっと自然に話せるようになりたいんです。||Naturalness: share enough about yourself to make the exchange mutual.|grammar-form
では、今日はたくさん話しましょう。飲み物はどうしますか。|Accept warmly and choose a drink without assuming alcohol.|ありがとうございます。今日はお茶にします。佐藤さんは何にされますか。||Register choice: no pressure to drink alcohol; adapt the name to the partner.|register
`),
  },
  {
    id: "scenario-restaurant",
    title: "Making a restaurant reservation",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "trip"],
    situation:
      "Phone a restaurant to reserve dinner for three. Confirm time and a dietary question without inventing an allergy.",
    turns: lines(`
お電話ありがとうございます。ご予約でしょうか。|Say you would like to book for three tomorrow.|はい、明日の夜、三人で予約したいのですが。||Register choice: のですが introduces a polite request.|register
お時間は何時ごろですか。|Ask for seven in the evening.|午後七時でお願いできますか。||Naturalness: 午後 avoids confusion about the time.|kanji-reading
七時でしたら、お席をご用意できます。|Ask whether a vegetarian option is available.|ありがとうございます。ベジタリアン向けの料理はありますか。|肉や魚を使わない料理はありますか。|Meaning: confirm stock and seasonings separately if restrictions are strict; do not invent an allergy.|vocabulary-recall
ございます。詳しくは当日、担当者がご案内します。お名前をお願いします。|Give your name and confirm the party size.|ジョンです。明日の午後七時、三人ですね。||Naturalness: confirm the arrangement in your own words.|register
はい、お待ちしております。|Close politely.|ありがとうございます。よろしくお願いします。||Register choice: ordinary polite language is sufficient for the caller.|register
`),
  },
  {
    id: "scenario-friend",
    title: "Catching up with an old friend",
    mode: "speaking",
    register: "casual",
    phases: ["reactivation", "trip"],
    situation:
      "You and an old friend already use casual Japanese. Exchange updates and arrange a relaxed meal.",
    turns: lines(`
久しぶり。元気だった？|Greet your friend and invite their update.|元気だったよ。久しぶりに会えてうれしい。最近どう？||Register choice: casual wording is appropriate in an established friendship.|register
仕事は忙しいけど、最近またゲームを始めたんだ。|Ask a follow-up about the game.|そうなんだ。どんなゲームを遊んでるの？||Naturalness: ask about their actual topic rather than switching to your own story.|vocabulary-recall
友達と一緒に遊べるゲーム。ジョンは最近何してるの？|Share a short update.|相変わらずソフトウェアを作ってるよ。最近は日本語を話す練習もしてるんだ。||Register choice: 作ってる and してる are normal spoken contractions.|register
日本語、ちゃんと覚えてるね。|Respond modestly without rejecting the compliment.|ありがとう。でも、言葉がすぐに出てこないこともあるんだよね。||Naturalness: accept the compliment before describing your difficulty.|naturalness
じゃあ、またゆっくり話そうよ。|Invite them for a meal.|うん。よかったら、今度ご飯でも行かない？都合のいい日を教えてね。||Register choice: friendly invitation, with room to choose a day.|register
`),
  },
  {
    id: "scenario-colleague",
    title: "Reconnecting with a former colleague",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "trip"],
    situation:
      "Meet a former colleague whose current casual/polite preference is uncertain. Begin politely and share a real memory.",
    turns: lines(`
お久しぶりです。日本に戻ってきたんですね。|Explain the visit and show warmth.|お久しぶりです。今回は出張で来ています。またお会いできてうれしいです。||Register choice: begin politely until the shared register is clear.|register
前に一緒に仕事をしたときが懐かしいですね。|Recall a concrete team experience without inventing personal facts.|そうですね。一緒に相談しながら進めたことを、よく覚えています。||Naturalness: replace the general model with a truthful shared memory.|vocabulary-recall
今はどんな仕事をしているんですか。|Give a brief update and return the question.|今はソフトウェア製品を作っています。そちらは、以前と比べて仕事が変わりましたか。||Naturalness: そちら avoids assuming the person still has the same role.|grammar-form
今は開発だけでなく、チームの調整もしています。|Ask about an aspect they enjoy.|そうなんですね。最近、特に面白いと感じるのはどんな仕事ですか。||Naturalness: invite their perspective rather than treating promotion as the only positive topic.|naturalness
人と話す仕事が増えたのは、面白いですね。|Relate to their answer and suggest another conversation.|私も、人と話す時間を大事にしたいと思っています。またゆっくりお話しできたらうれしいです。||Register choice: warm polite closing.|register
`),
  },
  {
    id: "scenario-ceo",
    title: "A relaxed conversation with a CEO",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "business", "trip"],
    situation:
      "You have a few minutes with a CEO. Build rapport with approachable polite Japanese and one lightweight product question.",
    turns: lines(`
今日は来てくださって、ありがとうございます。|Thank them for the opportunity warmly.|こちらこそ、お時間をいただき、ありがとうございます。皆さんとお話しできるのを楽しみにしていました。||Register choice: one modest thanks is enough; avoid elaborate honorific stacking.|humble
日本は久しぶりですか。|Give a short personal connection.|はい、以前は五年間住んでいたんですが、久しぶりに来ました。今日は皆さんに会えてうれしいです。||Naturalness: keep the answer personal and brief.|grammar-form
最近はどんな製品を作っていますか。|Explain one product and ask a relevant question.|チームで情報を整理するアプリを作っています。御社では、情報を共有するときにどんな工夫をされていますか。||Register choice: 御社 suits speech about the other company.|register
担当者が増えると、情報を探すのが難しくなりますね。|Acknowledge and invite a concrete example.|なるほど。例えば、どんな情報を探すのに時間がかかるんですか。||Naturalness: a plain-language follow-up supports mutual understanding.|vocabulary-recall
新しい案件の状況などですね。|Confirm understanding and leave room to continue later.|新しい仕事の状況を、すぐ確認できると便利ということですね。よかったら、またそのお話を伺いたいです。||Meaning: confirm the interpretation rather than claiming the product solves their issue.|humble,naturalness
`),
  },
  {
    id: "scenario-lunch",
    title: "Inviting staff to a casual lunch",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "trip"],
    situation:
      "Invite a staff member you have just met to lunch. Keep it easy to decline and let their local preferences lead.",
    turns: lines(`
午前の会議、お疲れさまでした。|Invite them without pressure.|お疲れさまでした。よかったら、一緒にお昼を食べませんか。||Register choice: friendly polite invitation.|register
いいですね。どんなものが食べたいですか。|Ask about their preferences and recommendations.|私は何でも大丈夫です。この辺で、おすすめのお店はありますか。||Meaning: say this only if you genuinely have no relevant restrictions.|vocabulary-recall
近くに、よく行くお店があります。|Respond warmly and ask what kind of food it serves.|いいですね。どんな料理のお店なんですか。||Naturalness: lets them talk about something familiar.|vocabulary-recall
和食のお店です。でも、少し歩きますよ。|Accept, while checking the schedule.|歩くのは大丈夫です。午後の予定に間に合いそうですか。||Naturalness: consider their work schedule rather than assuming unlimited time.|grammar-form
時間は大丈夫です。行きましょうか。|Accept and appreciate their help.|はい、ぜひ。案内していただいて、ありがとうございます。||Register choice: appreciative but not excessively formal.|humble
`),
  },
  {
    id: "scenario-hobbies",
    title: "Finding a shared interest with staff",
    mode: "speaking",
    register: "polite",
    phases: ["reactivation", "trip"],
    situation:
      "During a break, find a comfortable shared interest with a staff member. Ask open questions and reciprocate.",
    turns: lines(`
週末はゆっくりできましたか。|Answer briefly and return a light question.|はい、散歩してのんびりしました。お休みの日は、どんなことをしていますか。||Naturalness: keep the topic optional and non-intrusive.|register
最近は音楽を聞いたり、ゲームをしたりしています。|Choose one topic and ask a follow-up.|私もゲームが好きです。最近は、どんなゲームを遊んでいるんですか。||Naturalness: respond to their answer before asking a new question.|grammar-form
友達と一緒に遊べるものが好きですね。|Ask what they enjoy about that style.|そうなんですね。一緒に相談しながら進めるのが楽しいんですか。||Naturalness: this is a tentative interpretation they can correct.|naturalness
そうですね。遊んだ後に話すのも楽しいです。ジョンさんは？|Share your own preference honestly.|私は、少しずつ進められるゲームが好きです。短い時間でも楽しめると、続けやすいんです。||Meaning: adapt the model to your real preferences.|grammar-form
それなら、今度おすすめを紹介しますね。|Thank them and leave an easy follow-up.|ぜひ教えてください。おすすめを聞けるのを楽しみにしています。||Register choice: warm polite thanks.|register
`),
  },
  {
    id: "scenario-feedback",
    title: "Hearing candid product feedback",
    mode: "speaking",
    register: "polite",
    phases: ["core", "business", "trip"],
    situation:
      "A staff member tries a product demo. Listen without defending it, clarify a difficulty, and close appreciatively.",
    turns: lines(`
少し使ってみてもいいですか。|Invite them to try and explain the simple goal.|ぜひ。まず、必要な情報を一つ探してみてください。わかりにくいところがあれば、教えてくださいね。||Naturalness: set one task, not a long demonstration.|register
この画面で、何を押せばいいかわかりません。|Acknowledge the difficulty and ask what they expected.|なるほど。どんな表示があると、わかりやすいと思いますか。||Naturalness: explore their expectation before explaining your design.|naturalness
検索する場所が、もう少し目立つといいですね。|Confirm your interpretation.|検索するところを見つけにくい、ということですね。||Meaning: restate the issue without declaring a solution.|grammar-form
はい。後は使いやすいと思います。|Ask for one useful positive detail.|ありがとうございます。特に使いやすいと感じたのは、どの部分ですか。||Naturalness: concrete positive feedback is more useful than general praise.|vocabulary-recall
情報を共有するところです。|Thank them and describe a modest next step.|具体的に教えていただいて、助かりました。画面の表示を見直してみます。||Meaning: promise investigation rather than an unagreed delivery date.|humble
`),
  },
];
catalog.scenarios = scenarioDrafts.map((scenario) => ({
  id: scenario.id,
  revision: 1,
  title: scenario.title,
  situation: scenario.situation,
  register: scenario.register,
  mode: scenario.mode,
  phaseTags: scenario.phases,
  turns: scenario.turns.map(
    (
      [partner, prompt, answer, alternative = "", notes = "", issues = ""],
      index,
    ) => ({
      id: `${scenario.id}-turn-${String(index + 1).padStart(2, "0")}`,
      partner: jp(partner),
      prompt,
      answer: jp(answer.replace(/\\n/g, "\n")),
      alternatives: alternative
        ? [{ text: jp(alternative), context: notes }]
        : [],
      notes,
      issueTags: issues ? issues.split(",") : ["register"],
      speechText: partner,
    }),
  ),
  review: { ...review },
}));

const expected = {
  cards: 150,
  keigoDrills: 40,
  diagnostic: 16,
  passages: 10,
  scenarios: 12,
};
for (const [collection, count] of Object.entries(expected)) {
  if (catalog[collection].length !== count)
    throw new Error(
      `${collection}: expected ${count}, got ${catalog[collection].length}`,
    );
}
if (unknown.size)
  throw new Error(`Missing authored readings: ${[...unknown].join(", ")}`);
const strip = (text) => text.replace(/\[\[([^|]+)\|[^\]]+\]\]/g, "$1");
for (const passage of catalog.passages) {
  const length = strip(passage.body).replace(/\s/g, "").length;
  if (length < 500 || length > 800)
    throw new Error(
      `${passage.id}: length ${length} is outside 500–800 characters`,
    );
  for (const entry of passage.glossary) {
    if (!passage.body.includes(entry.term))
      throw new Error(
        `${passage.id}: glossary surface ${entry.term} is absent`,
      );
  }
}
for (const scenario of catalog.scenarios) {
  if (scenario.mode === "speaking" && scenario.turns.length < 5)
    throw new Error(`${scenario.id}: too few speaking turns`);
}
mkdirSync("src/content", { recursive: true });
writeFileSync(
  "src/content/catalog.json",
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(
  Object.fromEntries(
    Object.entries(expected).map(([k]) => [k, catalog[k].length]),
  ),
);
