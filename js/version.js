// アプリのバージョンと更新ログ。
// 更新するときは、VERSION を上げて CHANGELOG の先頭に1件追加し、
// `npm run changelog` で CHANGELOG.md を作り直す（npm test で一致を確認する）。

export const VERSION = "1.0";

/** 変更の種類 → 表示名 */
export const CHANGE_TYPES = {
  new: "追加",
  improve: "改善",
  fix: "修正",
  data: "データ",
};

/**
 * 新しい順に並べる。
 * { version: "1.1", date: "YYYY-MM-DD", title: "見出し", changes: [{ type: "new" | "improve" | "fix" | "data", text }] }
 */
export const CHANGELOG = [
  {
    version: "1.0",
    date: "2026-11-24",
    title: "初回リリース",
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

/** 2026-11-24 → 2026/11/24 */
export function formatChangelogDate(date) {
  return String(date).replaceAll("-", "/");
}

/** CHANGELOG.md の本文を作る。 */
export function changelogMarkdown() {
  const lines = [
    "# 更新ログ",
    "",
    "ドラフトルーレットの更新履歴です。アプリでは、ヘッダーのバージョン表示（「更新ログ」）から見られます。",
    "",
    "> このファイルは `js/version.js` から `npm run changelog` で生成しています。直接編集しないでください。",
    "",
  ];
  for (const entry of CHANGELOG) {
    lines.push(`## v${entry.version}（${entry.date}）${entry.title}`, "");
    for (const c of entry.changes) lines.push(`- ${CHANGE_TYPES[c.type]}：${c.text}`);
    lines.push("");
  }
  return lines.join("\n");
}
