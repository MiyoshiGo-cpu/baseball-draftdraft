// 簡易 WAR（Wins Above Replacement：控えレベルの選手と比べて、何勝ぶん上積みしたか）。
// DOM に触れない純粋関数（Node のテストからも使う）。
//
// 公式の NPB の WAR は公開されていないので、手元の成績から計算する独自の目安。
// 年度・リーグごとの平均（data/leagues.json、NPB.jp の年度別成績から作成）と比べるので、時代の差は補正される。
//
// 打者（年度・球団ごとの行で計算して足す）：
//   打撃 … wOBA（出塁と長打の価値を重み付けした率）がリーグ平均よりどれだけ上か × 打席
//   守備位置 … 捕手・遊撃は加点、一塁は減点（その選手の一軍の守備位置の割合で混ぜる）
//   控えレベル … 打席数に応じた分を足す
//   → 合計の得点 ÷「1勝に必要な得点」
// 投手：
//   防御率がリーグ平均よりどれだけ低いか × 投球回（自責点を失点に直す）＋ 控えレベルの分
//   救援で接戦の終盤に投げた分（セーブ・ホールドの多さ）は少し重く数える
//   → 合計の得点 ÷「1勝に必要な得点」
// 守備の上手さ・走塁・球場の違いは、データがないので入れない。

/** セ・リーグの球団（成績表の表記）。それ以外はパ・リーグ。 */
const CENTRAL = ["巨人", "阪神", "中日", "広島", "ヤクルト", "サンケイ", "アトムズ", "大洋", "横浜", "DeNA"];

export function leagueOf(team) {
  return CENTRAL.some((w) => String(team).includes(w)) ? "C" : "P";
}

/** wOBA の重み（1打席の価値。MLB の一般的な値） */
export const WOBA_WEIGHTS = { BB: 0.69, HBP: 0.72, "1B": 0.89, "2B": 1.27, "3B": 1.62, HR: 2.1 };
/** wOBA の差を得点に直すときの割る数 */
export const WOBA_SCALE = 1.2;
/** 守備位置の補正（162試合あたりの得点） */
export const POSITION_RUNS = { 捕手: 12.5, 遊撃: 7.5, 二塁: 2.5, 三塁: 2.5, 中堅: 2.5, 外野: -4, 左翼: -7.5, 右翼: -7.5, 一塁: -12.5, 内野: 0 };
/** 控えレベルの選手だけのチームの勝率 */
export const REPLACEMENT_PCT = 0.294;
/** リーグ全体の WAR のうち、打者に配る割合（残りは投手） */
export const BATTER_SHARE = 0.57;

const n = (x) => (typeof x === "number" && !Number.isNaN(x) ? x : 0);

function wobaParts(o) {
  const single = n(o.H) - n(o["2B"]) - n(o["3B"]) - n(o.HR);
  const num =
    WOBA_WEIGHTS.BB * n(o.BB) +
    WOBA_WEIGHTS.HBP * n(o.HBP) +
    WOBA_WEIGHTS["1B"] * single +
    WOBA_WEIGHTS["2B"] * n(o["2B"]) +
    WOBA_WEIGHTS["3B"] * n(o["3B"]) +
    WOBA_WEIGHTS.HR * n(o.HR);
  const den = n(o.AB) + n(o.BB) + n(o.HBP) + n(o.SF);
  return { num, den };
}

/** 投球回 "206.2" → アウト数 */
function outsOf(ip) {
  const m = /^(\d+)(?:\.([012]))?$/.exec(String(ip ?? ""));
  return m ? Number(m[1]) * 3 + Number(m[2] || 0) : 0;
}

const contextCache = new WeakMap();

/**
 * 年度・リーグの基準値。データがなければ null。
 * rpw：1勝に必要な得点、lgWoba：リーグの wOBA、repPerPA / repPerOut：控えレベルとの差（1打席・1アウトあたりの得点）、
 * lgERA：リーグの防御率、runsPerER：失点÷自責点
 */
export function leagueContext(leaguesJson, year, lg) {
  const x = leaguesJson?.leagues?.[year]?.[lg];
  if (!x) return null;
  let cache = contextCache.get(leaguesJson);
  if (!cache) contextCache.set(leaguesJson, (cache = new Map()));
  const key = `${year}${lg}`;
  if (cache.has(key)) return cache.get(key);

  const outs = x.pit.outs;
  const runsPerInning = (x.pit.R * 3) / outs;
  const rpw = 9 * runsPerInning * 1.5 + 3; // 1勝に必要な得点（FanGraphs の式）
  const { num, den } = wobaParts(x.bat);
  const decided = n(x.W) + n(x.L);
  const leagueWar = n(x.W) - REPLACEMENT_PCT * decided; // リーグ全体の WAR
  const ctx = {
    year,
    lg,
    games: x.games,
    rpw,
    lgWoba: num / den,
    repPerPA: (BATTER_SHARE * leagueWar * rpw) / den,
    repPerOut: ((1 - BATTER_SHARE) * leagueWar * rpw) / outs,
    lgERA: (x.pit.ER * 27) / outs,
    runsPerER: x.pit.R / x.pit.ER,
  };
  cache.set(key, ctx);
  return ctx;
}

/** プロフィールの守備位置（「投手→外野手」なら最後の「外野手」）→ 補正の種類。わからなければ null。 */
export function positionFromProfile(position) {
  const last = String(position || "").split(/→|、|,|・/).filter(Boolean).at(-1) || "";
  for (const pos of ["捕手", "遊撃", "二塁", "三塁", "一塁", "中堅", "左翼", "右翼"]) if (last.includes(pos)) return pos;
  if (last.includes("外野")) return "外野";
  if (last.includes("内野")) return "内野";
  return null;
}

/**
 * 守備位置の補正（1試合あたりの得点）。一軍の守備位置の試合数（players.json の fielding）で混ぜる。
 * 守備成績がなければプロフィールの守備位置、それもなければ 0。指名打者は記録がないので補正しない。
 */
export function positionRunsPerGame(player) {
  let games = 0;
  let runs = 0;
  for (const [pos, g] of Object.entries(player?.fielding || {})) {
    if (!(pos in POSITION_RUNS) || !(g > 0)) continue;
    games += g;
    runs += g * POSITION_RUNS[pos];
  }
  if (games > 0) return runs / games / 162;
  const pos = positionFromProfile(player?.profile?.position);
  return pos ? POSITION_RUNS[pos] / 162 : 0;
}

/** 打者の1行（rowObject 済み）の WAR。リーグのデータがなければ null。player は players.json の選手。 */
export function battingWar(row, leaguesJson, player = null) {
  const ctx = leagueContext(leaguesJson, row.year, leagueOf(row.team));
  if (!ctx) return null;
  const { num, den } = wobaParts(row);
  if (!den) return 0;
  const batting = ((num / den - ctx.lgWoba) / WOBA_SCALE) * den;
  const position = positionRunsPerGame(player) * n(row.G);
  const replacement = ctx.repPerPA * den;
  return (batting + position + replacement) / ctx.rpw;
}

/** 救援で終盤に投げた分の重み（1〜1.5）。セーブ・ホールドの記録がない時代は中くらいとみなす。 */
export function reliefLeverage(row) {
  const g = n(row.G);
  if (!g) return 1;
  const reliefShare = 1 - Math.min(1, n(row.GS) / g);
  if (!reliefShare) return 1;
  const noRecord = (row.SV === null || row.SV === undefined) && (row.HLD === null || row.HLD === undefined);
  const late = noRecord ? 0.3 : Math.min(1, (n(row.SV) + n(row.HLD)) / Math.max(1, g - n(row.GS)));
  return 1 + reliefShare * 0.5 * late;
}

/** 投手の1行（rowObject 済み）の WAR。リーグのデータがなければ null。 */
export function pitchingWar(row, leaguesJson) {
  const ctx = leagueContext(leaguesJson, row.year, leagueOf(row.team));
  if (!ctx) return null;
  const outs = outsOf(row.IP);
  if (!outs) return 0;
  const aboveAverage = ((ctx.lgERA * outs) / 27 - n(row.ER)) * ctx.runsPerER;
  // 先発は控えレベルとの差が大きく、救援は小さい（リーグ全体でおおよそ 1 になるように）
  const startShare = n(row.G) ? Math.min(1, n(row.GS) / n(row.G)) : 1;
  const replacement = ctx.repPerOut * outs * (startShare * 1.15 + (1 - startShare) * 0.6);
  return ((aboveAverage + replacement) * reliefLeverage(row)) / ctx.rpw;
}

/** 0.1 単位に丸めた表示（"7.2"、"-0.4"） */
export function fmtWar(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  const v = Math.round(x * 10) / 10;
  return (Object.is(v, -0) ? 0 : v).toFixed(1);
}
