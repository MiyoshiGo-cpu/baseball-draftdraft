// アプリのバージョンと更新ログ。
// 正式版（v1.0）を出すまでは「Beta」版として、Beta v1.0、Beta v1.1… と表記する。
// 更新するときは、STAGE と VERSION を合わせて CHANGELOG の先頭に1件追加し、
// `npm run changelog` で CHANGELOG.md を作り直す（npm test で一致を確認する）。

/** "beta"（ベータ版）または "release"（正式版） */
export const STAGE = "beta";
export const VERSION = "1.2";

export const STAGE_ORDER = ["beta", "release"];

/** 表示用：Beta v1.2 / v1.0 */
export function versionLabel(stage, version) {
  return stage === "beta" ? `Beta v${version}` : `v${version}`;
}

/** 保存・比較用の識別子：beta-1.2 / 1.0 */
export function versionId(stage, version) {
  return stage === "beta" ? `beta-${version}` : version;
}

export const VERSION_LABEL = versionLabel(STAGE, VERSION);
export const VERSION_ID = versionId(STAGE, VERSION);

/** 変更の種類 → 表示名 */
export const CHANGE_TYPES = {
  new: "追加",
  improve: "改善",
  change: "変更",
  fix: "修正",
  data: "データ",
};

/**
 * 新しい順に並べる。
 * { stage: "beta" | "release", version: "1.2", date: "YYYY-MM-DD", title: "見出し",
 *   changes: [{ type: "new" | "improve" | "change" | "fix" | "data", text }] }
 */
export const CHANGELOG = [
  {
    stage: "beta",
    version: "1.2",
    date: "2026-11-24",
    title: "ドラフト会議の演出と、新しいデザイン",
    changes: [
      { type: "improve", text: "見た目を白を基調にしたデザインに一新（紺と赤の配色、立体的なボタン、紺色の上部バー）" },
      { type: "improve", text: "タイトル画面を、ドラフト会議の会場モニター風に変更（歴代の1位指名選手を「選択希望選手」として発表）" },
      { type: "new", text: "選手を指名したときに「第○巡選択希望選手」「交渉権確定」を発表する演出" },
      { type: "new", text: "17人そろったときの「選択終了」の演出" },
      { type: "new", text: "マイチームと履歴に、何巡目に指名した選手かを表示" },
      { type: "improve", text: "ルーレットを会場モニター風の「抽選」表示に変更し、ゲーム開始ボタンを「ドラフト開始！」に変更" },
      { type: "improve", text: "シェア画像を新しいデザインに変更" },
      { type: "change", text: "バージョン表記を「Beta」付きに変更（正式版の前のベータ版として、これまでの版も Beta v1.0・Beta v1.1 と表記）" },
      { type: "change", text: "ダークモードをやめ、いつも白い画面で表示" },
    ],
  },
  {
    stage: "beta",
    version: "1.1",
    date: "2026-11-24",
    title: "タイトル画面とメニュー",
    changes: [
      { type: "new", text: "タイトル画面（ナイターの球場をイメージした画面に「遊ぶ」ボタン。歴代の1位指名選手が流れる帯つき）" },
      { type: "new", text: "メニュー画面（新しく始める・続きから・保存したチーム・遊び方・オプション・更新ログ・クレジット）" },
      { type: "new", text: "ルール設定画面（ルールを決めて「プレイボール！」でゲーム開始）" },
      { type: "new", text: "遊び方・オプション（効果音、データの削除と初期化）・クレジットの各画面" },
      { type: "improve", text: "保存したチームと更新ログを、それぞれ独立した画面に変更" },
      { type: "improve", text: "画面左上の戻るボタンとブラウザの「戻る」で、前の画面に戻れるように変更" },
      { type: "improve", text: "ゲーム画面から設定パネルを外し、今回のルールを画面上部に表示" },
    ],
  },
  {
    stage: "beta",
    version: "1.0",
    date: "2026-11-24",
    title: "最初の公開",
    changes: [
      { type: "new", text: "ルーレットで決まった「球団×年度」のドラフト指名選手から1人ずつ選び、17人のチームを作るゲームを公開" },
      { type: "data", text: "1965〜2025年度のドラフト指名データを収録（731の球団×年度、5,494人。Wikipedia の各年度記事から作成）" },
      { type: "new", text: "年度範囲、パス上限、育成指名・入団拒否の選手を含めるか、投手⇔野手の制限（厳格／ゆるめ）を選べる設定" },
      { type: "new", text: "パスと自動スキップ（配置できる選手がいないときはパスを使わずに次へ）" },
      { type: "new", text: "進行中のゲームの自動保存（リロードしても続きから遊べる）" },
      { type: "new", text: "完成時のテキストコピー、シェア画像の保存、編成の保存と保存一覧" },
      { type: "new", text: "リールの回転演出と効果音、ダークモード" },
      { type: "new", text: "バージョン表示と更新ログ" },
    ],
  },
];

/** 並べ替え用：新しいほど大きい。 */
export function versionRank(stage, version) {
  const [major, minor] = String(version).split(".").map(Number);
  return [STAGE_ORDER.indexOf(stage), major, minor];
}

/** 2026-11-24 → 2026/11/24 */
export function formatChangelogDate(date) {
  return String(date).replaceAll("-", "/");
}

/** CHANGELOG.md の本文を作る。 */
export function changelogMarkdown() {
  const lines = [
    "# 更新ログ",
    "",
    "ドラフトルーレットの更新履歴です。アプリでは、タイトル画面のバージョン表示か、メニューの「更新ログ」から見られます。",
    "正式版（v1.0）を出すまでは、ベータ版として「Beta v1.x」と表記します。",
    "",
    "> このファイルは `js/version.js` から `npm run changelog` で生成しています。直接編集しないでください。",
    "",
  ];
  for (const entry of CHANGELOG) {
    lines.push(`## ${versionLabel(entry.stage, entry.version)}（${entry.date}）${entry.title}`, "");
    for (const c of entry.changes) lines.push(`- ${CHANGE_TYPES[c.type]}：${c.text}`);
    lines.push("");
  }
  return lines.join("\n");
}
