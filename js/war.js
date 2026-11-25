// 簡易 WAR（Wins Above Replacement：控えレベルの選手と比べて、何勝ぶん上積みしたか）。
// DOM に触れない純粋関数（Node のテストからも使う）。
//
// 公式の NPB の WAR は公開されていないので、手元の成績から計算する独自の目安。
// 年度・リーグごとの平均（data/leagues.json、NPB.jp の年度別成績から作成）と比べるので、時代の差は補正される。
//
// 打者（年度・球団ごとの行で計算して足す。単位は得点で、最後に「1勝に必要な得点」で割る）：
//   打撃   … wOBA（出塁と長打の価値を重み付けした率）がリーグ平均よりどれだけ上か × 打席
//   走塁   … 盗塁（+0.2点）と盗塁死（約 -0.4点）を、リーグ平均の走り方と比べる
//   守備   … その年・その守備位置のほかの選手（前後2年を含む）と比べた、守備範囲（補殺・刺殺の多さ）、
//            失策の少なさ、併殺、外野の補殺、捕手の盗塁阻止と捕逸。守備範囲は投手陣や球場の影響も受けるので
//            35% だけ数え、1つの守備位置・1年で ±15点までにする
//   守備位置 … その年に守った位置で、捕手・遊撃は加点、一塁・指名打者は減点
//   控えレベル … 打席数に応じた分を足す
// 投手：
//   防御率がリーグ平均よりどれだけ低いか × 投球回（自責点を失点に直す）＋ 控えレベルの分
//   救援で接戦の終盤に投げた分（セーブ・ホールドの多さ）は少し重く数える
// 球場の違い・走塁のうち盗塁以外（進塁など）・捕手のリードは、データがないので入れない。

import { seasonGames, teamForYear } from "./stats.js";

/** セ・リーグの球団（成績表の表記）。それ以外はパ・リーグ。 */
const CENTRAL = ["巨人", "阪神", "中日", "広島", "ヤクルト", "サンケイ", "アトムズ", "大洋", "横浜", "DeNA"];

export function leagueOf(team) {
  return CENTRAL.some((w) => String(team).includes(w)) ? "C" : "P";
}

/** wOBA の重み（1打席の価値。MLB の一般的な値） */
export const WOBA_WEIGHTS = { BB: 0.69, HBP: 0.72, "1B": 0.89, "2B": 1.27, "3B": 1.62, HR: 2.1 };
/**
 * wOBA の差を得点に直すときの割る数。点が入りにくい年ほど、1つの安打・四球の得点の価値が小さいので大きくする
 * （1打席あたり 0.122 点で 1.2。MLB の公表値の傾向に合わせた式）。
 */
export const WOBA_SCALE = 1.2;
export const wobaScale = (runsPerPA) => WOBA_SCALE * Math.pow(0.122 / runsPerPA, 0.6);
/** 守備位置の補正（162試合あたりの得点） */
export const POSITION_RUNS = { 捕手: 12.5, 遊撃: 7.5, 二塁: 2.5, 三塁: 2.5, 中堅: 2.5, 外野: -4, 左翼: -7.5, 右翼: -7.5, 一塁: -12.5, 内野: 0 };
/** 指名打者の補正（162試合あたりの得点） */
export const DH_RUNS = -17.5;
/** 盗塁1つの価値（得点） */
export const SB_RUNS = 0.2;
/** 控えレベルの選手だけのチームの勝率 */
export const REPLACEMENT_PCT = 0.294;
/** リーグ全体の WAR のうち、打者に配る割合（残りは投手） */
export const BATTER_SHARE = 0.57;

/** 守備の計算の決めごと */
export const FIELDING = {
  /** 守備範囲（補殺・刺殺の多さ）は投手陣や球場の影響も受けるので、この割合だけ数える */
  rangeShare: 0.35,
  /**
   * 守備範囲を数えるのは、その位置で年間の試合数の 40% 以上守った年だけ（途中出場が多いと1試合あたりの数が減るため）。
   * 40% から 80% までは少しずつ増やし、80% 以上で全部数える
   */
  regularShare: 0.4,
  fullShare: 0.8,
  /** 1つの守備位置・1年あたりの上限（得点） */
  cap: 15,
  /** アウト1つを増やした価値（得点）：内野の補殺、一塁の補殺、外野の刺殺 */
  infieldPlay: 0.75,
  firstPlay: 0.4,
  outfieldPlay: 0.8,
  /** 併殺1つ、外野の補殺1つ、失策1つ、盗塁刺1つ、捕逸1つの価値（得点） */
  doublePlay: 0.2,
  outfieldArm: 0.4,
  error: 0.4,
  caughtStealing: 0.65,
  passedBall: 0.28,
  /** 盗塁阻止は投手のクイックなどの影響も受けるので、この割合だけ数える */
  catcherShare: 0.75,
  /** 平均を出すときに前後何年まで含めるか */
  window: 2,
};

/** players.json の fieldingYears の列（meta.fieldingColumns がなければこれ） */
export const FIELDING_COLUMNS = ["year", "team", "pos", "G", "PO", "A", "E", "DP", "SBA", "CS", "PB"];

const INFIELD = new Set(["二塁", "三塁", "遊撃"]);
const OUTFIELD = new Set(["外野", "左翼", "中堅", "右翼"]);

const n = (x) => (typeof x === "number" && !Number.isNaN(x) ? x : 0);
const has = (x) => typeof x === "number" && !Number.isNaN(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

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
  return { num, den, single };
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
 * lgERA：リーグの防御率、runsPerER：失点÷自責点、runCS：盗塁死1つの価値、lgSbRate：出塁1回あたりの盗塁の価値の平均
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
  const { num, den, single } = wobaParts(x.bat);
  const decided = n(x.W) + n(x.L);
  const leagueWar = n(x.W) - REPLACEMENT_PCT * decided; // リーグ全体の WAR
  const runsPerOut = x.bat.R / Math.max(1, n(x.bat.AB) - n(x.bat.H) + n(x.bat.SF));
  const runCS = -(2 * runsPerOut + 0.075); // 盗塁死1つの価値（FanGraphs の式）
  const sbOpp = single + n(x.bat.BB) + n(x.bat.HBP); // 出塁して盗塁できる回数のめやす
  const ctx = {
    year,
    lg,
    games: x.games,
    rpw,
    lgWoba: num / den,
    wobaScale: wobaScale(x.bat.R / den),
    repPerPA: (BATTER_SHARE * leagueWar * rpw) / den,
    repPerOut: ((1 - BATTER_SHARE) * leagueWar * rpw) / outs,
    lgERA: (x.pit.ER * 27) / outs,
    runsPerER: x.pit.R / x.pit.ER,
    runCS,
    lgSbRate: (n(x.bat.SB) * SB_RUNS + n(x.bat.CS) * runCS) / sbOpp,
    csPerSb: n(x.bat.SB) ? n(x.bat.CS) / n(x.bat.SB) : 0.45,
    dhLeague: lg === "P" && year >= 1975,
  };
  cache.set(key, ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// 守備
// ---------------------------------------------------------------------------

/** 守備の比べる相手（年度・守備位置ごとの合計）。外野は左翼・中堅・右翼もまとめて「外野」で比べる。 */
const baseKey = (pos) => (OUTFIELD.has(pos) ? "外野" : pos);

function fieldRowObject(arr, cols) {
  const o = {};
  cols.forEach((c, i) => {
    o[c] = arr[i];
  });
  if (typeof o.team === "string") o.team = teamForYear(o.team, o.year);
  return o;
}

const baselineCache = new WeakMap();

/** 全選手の年度別守備成績から、年度・守備位置ごとの合計を作る（1回だけ）。 */
function fieldingTotals(playersJson) {
  if (baselineCache.has(playersJson)) return baselineCache.get(playersJson);
  const cols = playersJson.meta?.fieldingColumns || FIELDING_COLUMNS;
  const sums = new Map(); // "年|位置" → 合計
  const add = (year, pos, key, v) => {
    const k = `${year}|${pos}`;
    let o = sums.get(k);
    if (!o) sums.set(k, (o = {}));
    o[key] = (o[key] || 0) + v;
  };
  for (const p of Object.values(playersJson.players || {})) {
    for (const arr of p.fieldingYears || []) {
      const r = fieldRowObject(arr, cols);
      if (r.pos === "投手" || !(r.G > 0)) continue;
      const pos = baseKey(r.pos);
      const regular = r.G >= FIELDING.regularShare * seasonGames(r.year);
      if (regular) {
        add(r.year, pos, "regG", r.G);
        for (const k of ["PO", "A", "DP"]) if (has(r[k])) add(r.year, pos, `reg${k}`, r[k]), add(r.year, pos, `reg${k}G`, r.G);
      }
      if (has(r.PO) && has(r.A) && has(r.E)) {
        add(r.year, pos, "chances", r.PO + r.A + r.E);
        add(r.year, pos, "E", r.E);
      }
      if (has(r.SBA) && has(r.CS)) add(r.year, pos, "SBA", r.SBA), add(r.year, pos, "CS", r.CS);
      if (has(r.PB)) add(r.year, pos, "PB", r.PB), add(r.year, pos, "PBG", r.G);
    }
  }
  const out = { sums, cols, memo: new Map() };
  baselineCache.set(playersJson, out);
  return out;
}

/**
 * 年度・守備位置の平均（前後2年を含める）。
 * A / PO / DP：レギュラーの1試合あたり、err：守備機会あたりの失策、cs：盗塁企図あたりの盗塁刺、pb：1試合あたりの捕逸
 */
export function fieldingBaseline(playersJson, year, pos) {
  const t = fieldingTotals(playersJson);
  const key = `${year}|${baseKey(pos)}`;
  if (t.memo.has(key)) return t.memo.get(key);
  const pooled = {};
  for (let y = year - FIELDING.window; y <= year + FIELDING.window; y++) {
    const o = t.sums.get(`${y}|${baseKey(pos)}`);
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) pooled[k] = (pooled[k] || 0) + v;
  }
  const rate = (a, b) => (pooled[b] > 0 ? pooled[a] / pooled[b] : null);
  const base = {
    A: rate("regA", "regAG"),
    PO: rate("regPO", "regPOG"),
    DP: rate("regDP", "regDPG"),
    err: rate("E", "chances"),
    cs: rate("CS", "SBA"),
    pb: rate("PB", "PBG"),
    regularGames: pooled.regG || 0,
  };
  t.memo.set(key, base);
  return base;
}

/** 守備の1行（年度・球団・守備位置）の得点。平均より上ならプラス。 */
export function fieldingRuns(r, playersJson) {
  if (!r || r.pos === "投手" || !(r.G > 0)) return 0;
  const b = fieldingBaseline(playersJson, r.year, r.pos);
  const F = FIELDING;
  const share = r.G / seasonGames(r.year);
  const regular = share >= F.regularShare;
  let range = 0;
  if (regular) {
    if (INFIELD.has(r.pos)) {
      if (has(r.A) && b.A !== null) range += (r.A - b.A * r.G) * F.infieldPlay;
      if (has(r.DP) && b.DP !== null) range += (r.DP - b.DP * r.G) * F.doublePlay;
    } else if (r.pos === "一塁") {
      if (has(r.A) && b.A !== null) range += (r.A - b.A * r.G) * F.firstPlay;
    } else if (OUTFIELD.has(r.pos)) {
      if (has(r.PO) && b.PO !== null) range += (r.PO - b.PO * r.G) * F.outfieldPlay;
      if (has(r.A) && b.A !== null) range += (r.A - b.A * r.G) * F.outfieldArm;
    }
  }
  const phaseIn = clamp((share - F.regularShare) / (F.fullShare - F.regularShare), 0, 1);
  let runs = range * F.rangeShare * phaseIn;
  if (has(r.PO) && has(r.A) && has(r.E) && b.err !== null) {
    runs -= (r.E - b.err * (r.PO + r.A + r.E)) * F.error;
  }
  if (r.pos === "捕手") {
    if (has(r.SBA) && has(r.CS) && b.cs !== null) runs += (r.CS - b.cs * r.SBA) * F.caughtStealing * F.catcherShare;
    if (has(r.PB) && b.pb !== null) runs -= (r.PB - b.pb * r.G) * F.passedBall;
  }
  return clamp(runs, -F.cap, F.cap);
}

const playerFieldCache = new WeakMap();

/** 選手の年度別守備成績を、年度ごとに分けたもの（球団名はその年の名前に直す）。 */
function playerFieldYears(player, playersJson) {
  if (!player) return new Map();
  if (playerFieldCache.has(player)) return playerFieldCache.get(player);
  const cols = playersJson?.meta?.fieldingColumns || FIELDING_COLUMNS;
  const byYear = new Map();
  for (const arr of player.fieldingYears || []) {
    const r = fieldRowObject(arr, cols);
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year).push(r);
  }
  const battingTeams = new Map();
  for (const b of player.batting || []) battingTeams.set(b[0], (battingTeams.get(b[0]) || 0) + 1);
  const out = { byYear, battingTeams };
  playerFieldCache.set(player, out);
  return out;
}

/** 打撃の1行（年度・球団）に対応する守備の行。球団が合わなくても、その年の打撃の行が1つだけなら年度で合わせる。 */
function fieldRowsFor(row, player, playersJson) {
  const { byYear, battingTeams } = playerFieldYears(player, playersJson);
  const rows = byYear?.get(row.year) || [];
  if (!rows.length) return [];
  const sameTeam = rows.filter((r) => r.team === row.team);
  if (sameTeam.length) return sameTeam;
  return (battingTeams?.get(row.year) || 0) <= 1 ? rows : [];
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
 * 守備位置の補正（1試合あたりの得点）。通算の守備位置の試合数（players.json の fielding）で混ぜる。
 * 守備成績がなければプロフィールの守備位置、それもなければ 0。年度別の守備成績がない年に使う。
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

/** その年に守った位置による補正（得点）。守備についていない試合は、指名打者のあるリーグなら指名打者とみなす。 */
function positionRunsForYear(row, frows, player, ctx) {
  const fielders = frows.filter((r) => r.pos !== "投手" && r.pos in POSITION_RUNS && r.G > 0);
  if (!fielders.length) {
    if (frows.some((r) => r.pos === "投手")) return 0; // 投手の打席
    return positionRunsPerGame(player) * n(row.G);
  }
  const fieldGames = fielders.reduce((a, r) => a + r.G, 0);
  let runs = fielders.reduce((a, r) => a + (r.G * POSITION_RUNS[r.pos]) / 162, 0);
  if (fieldGames > n(row.G) && fieldGames > 0) runs *= n(row.G) / fieldGames; // 1試合で複数の位置を守った分
  const dhGames = Math.max(0, n(row.G) - fieldGames);
  if (ctx.dhLeague) runs += (dhGames * DH_RUNS) / 162;
  return runs;
}

// ---------------------------------------------------------------------------
// 打者・投手の WAR
// ---------------------------------------------------------------------------

/**
 * 打者の1行（rowObject 済み）の WAR の内訳（得点）。リーグのデータがなければ null。
 * player は players.json の選手、playersJson は全体（守備の平均を出すのに使う。なければ守備は 0）。
 * { batting, baserunning, fielding, position, replacement, rpw, war }
 */
export function battingWarParts(row, leaguesJson, player = null, playersJson = null) {
  const ctx = leagueContext(leaguesJson, row.year, leagueOf(row.team));
  if (!ctx) return null;
  const { num, den, single } = wobaParts(row);
  if (!den) return { batting: 0, baserunning: 0, fielding: 0, position: 0, replacement: 0, rpw: ctx.rpw, war: 0 };
  const batting = ((num / den - ctx.lgWoba) / ctx.wobaScale) * den;
  // 盗塁死の記録がない行は、リーグ平均の割合で失敗したとみなす
  const cs = has(row.CS) ? row.CS : n(row.SB) * ctx.csPerSb;
  const baserunning = n(row.SB) * SB_RUNS + cs * ctx.runCS - ctx.lgSbRate * (single + n(row.BB) + n(row.HBP));
  const frows = fieldRowsFor(row, player, playersJson);
  const fielding = playersJson ? frows.reduce((a, r) => a + fieldingRuns(r, playersJson), 0) : 0;
  const position = positionRunsForYear(row, frows, player, ctx);
  const replacement = ctx.repPerPA * den;
  const war = (batting + baserunning + fielding + position + replacement) / ctx.rpw;
  return { batting, baserunning, fielding, position, replacement, rpw: ctx.rpw, war };
}

/** 打者の1行の WAR。リーグのデータがなければ null。 */
export function battingWar(row, leaguesJson, player = null, playersJson = null) {
  return battingWarParts(row, leaguesJson, player, playersJson)?.war ?? null;
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

/** 符号つきの表示（"+1.2"、"-0.4"） */
export function fmtWarSigned(x) {
  const s = fmtWar(x);
  return s === "-" || s.startsWith("-") ? s : `+${s}`;
}
