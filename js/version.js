// アプリのバージョンと更新ログ。
// 正式版（v1.0）を出すまでは「Beta」版として、Beta v1.0、Beta v1.1… と表記する。
// 更新するときは、STAGE と VERSION を合わせて CHANGELOG の先頭に1件追加し、
// `npm run changelog` で CHANGELOG.md を作り直す（npm test で一致を確認する）。

/** "beta"（ベータ版）または "release"（正式版） */
export const STAGE = "beta";
export const VERSION = "1.6";

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
    version: "1.6",
    date: "2026-11-24",
    title: "答え合わせ（キャリアハイと総合力）",
    changes: [
      { type: "new", text: "完成画面の「答え合わせ」：入れた枠に合わせて、各選手のキャリアハイの年度を自動で選び、その年の成績を表示（スタメン・控えは規定打席に届いた年で OPS が最も高い年、先発は勝利数、中継ぎはセーブとホールドの合計、抑えはセーブが最も多い年）" },
      { type: "new", text: "答え合わせの選手をタップすると、ほかの年度に選び直せる（選んだ年度は保存したチームにも残る）" },
      { type: "new", text: "選手ごとの評価（S〜E と 0〜100 点）、チームの総合力（全体・打線・投手陣）、スタメンと投手陣の合計成績" },
      { type: "improve", text: "シェア画像に、総合力と各選手のキャリアハイの成績を追加。テキストのコピーにも総合力の行を追加" },
      { type: "improve", text: "保存したチームの一覧に総合力のランクを表示し、チームの詳細にも答え合わせを表示" },
      { type: "fix", text: "選手の詳細で、セーブとホールドがすべて「-」になっていたのを修正（Wikipedia の成績表の縦書きの見出しを読み取れていなかったため）" },
      { type: "fix", text: "成績表の球団名が「阪急 オリックス」のようにまとめて表示されることがあったのを、その年の球団名に修正" },
      { type: "improve", text: "画面を移ったときに、開いているシート（選手の詳細など）を閉じるように変更" },
    ],
  },
  {
    stage: "beta",
    version: "1.5",
    date: "2026-11-24",
    title: "選手の詳細",
    changes: [
      { type: "new", text: "選手の詳細シート：指名選手リストの「詳細」、配置画面の「選手の詳細」、マイチームの選手をタップすると開く" },
      { type: "new", text: "詳細シートの中身：プロフィール（投打・守備位置・生年月日・出身地・身長体重・経歴）、守れるポジション（一軍の守備位置別の試合数）、通算と年度別の成績（NPB 一軍）、タイトル・表彰、Wikipedia へのリンク" },
      { type: "data", text: "指名選手 5,029 人ぶんの選手データを収録（各選手の Wikipedia 記事から作成。NPB 一軍の成績がある選手は 3,730 人）" },
      { type: "improve", text: "リーグ1位の成績を赤の太字で表示" },
      { type: "improve", text: "指名選手リストの「育成」「入団せず」などのバッジを、名前の下に表示" },
    ],
  },
  {
    stage: "beta",
    version: "1.4",
    date: "2026-11-24",
    title: "投手と野手の区別をなくす",
    changes: [
      { type: "change", text: "投手と野手の区別をなくし、どの選手もスタメン・控え・先発・中継ぎ・抑えのどの枠にも入れられるように変更（糸井嘉男・雄平のように、投手から野手に転向して活躍した選手もいるため）" },
      { type: "change", text: "ルール設定から「投手⇔野手の制限（厳格／ゆるめ）」をなくした" },
      { type: "improve", text: "「投手」「内野手」などの登録ポジションと「二刀流」のバッジは、指名時の肩書きとして引き続き表示" },
      { type: "improve", text: "遊び方の「大事なルール」を新しいルールに合わせて変更" },
    ],
  },
  {
    stage: "beta",
    version: "1.3",
    date: "2026-11-24",
    title: "ホーム画面のアプリアイコン",
    changes: [
      { type: "new", text: "iPhone・Android のホーム画面に追加できるアプリアイコン（ルーレットと野球ボールに「DRAFT」の帯のデザイン）" },
      { type: "new", text: "ホーム画面から開くと、ブラウザのバーがない全画面のアプリとして起動（ホーム画面での名前は「ドラルー」）" },
      { type: "new", text: "オプション画面に「ホーム画面に追加する」方法の案内" },
      { type: "improve", text: "ブラウザのタブのアイコンを、新しいアプリアイコンに変更" },
    ],
  },
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
