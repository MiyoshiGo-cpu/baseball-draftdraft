// 完成したチームの「答え合わせ」：各選手のキャリアハイの年度と、チームの総合力。
// DOM に触れない純粋関数（Node のテストからも使う）。
//
// 年度の自動選択（枠ごと）：
//   スタメン・控え … 規定打席に届いた年の中で OPS が最も高い年（届いた年がなければ打席数が最も多い年）
//   先発         … 勝利数が最も多い年（同じなら防御率が低い年）
//   中継ぎ       … セーブとホールドの合計が最も多い年（どちらの記録もない時代だけなら登板数が最も多い年）
//   抑え         … セーブが最も多い年（セーブの記録がない時代だけなら登板数が最も多い年）
// 選手ごとに、遊んだ人が別の年度を選び直せる（snapshot.careerYears に pickId → 年度 で入れる）。

import { battingTotals, fmtEra, fmtRate, outsToIp, pitchingTotals, rowObject } from "./stats.js";

/** 枠の種類 → 使う成績（bat: 打撃、pit: 投手） */
export const SEASON_TYPE = { lineup: "bat", bench: "bat", SP: "pit", RP: "pit", CL: "pit" };

/** 総合力に入れるときの重み（1人あたり）。スタメンと先発を重く、控えは軽く。 */
export const SCORE_WEIGHT = { lineup: 1, bench: 0.35, SP: 1.4, RP: 0.7, CL: 0.9 };

/**
 * ランクの境目（点数がこれ以上ならそのランク）。
 * 選手：1年の成績の評価。S は MVP 級、A はタイトル争い級、B は主力級。
 * チーム：17人の重み付き平均。1つの「球団×年度」から選べる選手は限られるので、選手より低めに区切る
 * （指名データで試した結果、よく知られた選手を選んでいくと C〜B、選び方を工夫すると A、S はかなりの好成績）。
 */
export const PLAYER_RANKS = [
  ["S", 90],
  ["A", 75],
  ["B", 60],
  ["C", 45],
  ["D", 30],
  ["E", 0],
];
export const TEAM_RANKS = [
  ["S", 66],
  ["A", 59],
  ["B", 52],
  ["C", 45],
  ["D", 38],
  ["E", 0],
];

export function rankOf(score, table = PLAYER_RANKS) {
  for (const [rank, min] of table) if (score >= min) return rank;
  return "E";
}

/** その年のおおよその試合数（規定打席・規定投球回の目安に使う）。 */
export function seasonGames(year) {
  if (year <= 1965) return 140;
  if (year <= 1996) return 130;
  if (year <= 2000) return 135;
  if (year <= 2003) return 140;
  if (year === 2004) return 138;
  if (year <= 2006) return 146;
  if (year <= 2014) return 144;
  if (year === 2020) return 120;
  return 143;
}

/** 規定打席（試合数×3.1） */
export const qualifyingPA = (year) => Math.floor(seasonGames(year) * 3.1);
/** 規定投球回（試合数×1回）をアウト数で */
export const qualifyingOuts = (year) => seasonGames(year) * 3;

const num = (x) => (typeof x === "number" && !Number.isNaN(x) ? x : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** 同じ年の行（シーズン途中の移籍）を1年にまとめ、年の順に並べる。 */
function groupByYear(rows) {
  const map = new Map();
  for (const r of rows) {
    if (typeof r.year !== "number") continue;
    if (!map.has(r.year)) map.set(r.year, []);
    map.get(r.year).push(r);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

function mergeTeams(rows) {
  return [...new Set(rows.map((r) => r.team).filter(Boolean))].join("・");
}

function mergeLead(rows) {
  const lead = new Set();
  for (const r of rows) for (const k of r.lead || []) lead.add(k);
  return lead;
}

/** 打撃成績の行（rowObject 済み）→ 年度ごとの成績。 */
export function battingSeasons(rows) {
  return groupByYear(rows).map(([year, rs]) => {
    const t = battingTotals(rs);
    const one = rs.length === 1 ? rs[0] : null;
    // 1行だけなら記事の値（四捨五入済み）をそのまま使う
    for (const k of ["AVG", "OBP", "SLG", "OPS"]) if (one && num(one[k]) !== null) t[k] = one[k];
    if (t.PA === 0 && t.AB > 0) t.PA = t.AB + t.BB + t.HBP + t.SF;
    return { ...t, year, team: mergeTeams(rs), lead: mergeLead(rs) };
  });
}

/** 投手成績の行（rowObject 済み）→ 年度ごとの成績。 */
export function pitchingSeasons(rows) {
  return groupByYear(rows).map(([year, rs]) => {
    const t = pitchingTotals(rs);
    const one = rs.length === 1 ? rs[0] : null;
    if (one && num(one.ERA) !== null) t.ERA = one.ERA;
    if (one && num(one.WHIP) !== null) t.WHIP = one.WHIP;
    return { ...t, year, team: mergeTeams(rs), lead: mergeLead(rs) };
  });
}

/** 選手データ（players.json）から、その選手の年度ごとの成績（type: "bat" | "pit"）。 */
export function playerSeasons(playersJson, playerKey, type) {
  const p = playersJson?.players?.[playerKey];
  if (!p) return [];
  const { battingColumns, pitchingColumns } = playersJson.meta;
  if (type === "bat") return battingSeasons((p.batting || []).map((r) => rowObject(r, battingColumns)));
  return pitchingSeasons((p.pitching || []).map((r) => rowObject(r, pitchingColumns)));
}

// ---------------------------------------------------------------------------
// 年度の自動選択
// ---------------------------------------------------------------------------

const eraKey = (s) => (num(s.ERA) === null ? Infinity : s.ERA);

/** a のほうが良ければ負、b のほうが良ければ正（並べ替え用）。keys は [値を出す関数, 大きいほど良いなら 1 / 小さいほど良いなら -1]。 */
function compareBy(keys) {
  return (a, b) => {
    for (const [f, dir] of keys) {
      const x = f(a);
      const y = f(b);
      if (x !== y) return x > y ? -dir : dir;
    }
    return a.year - b.year;
  };
}

const best = (list, keys) => (list.length ? [...list].sort(compareBy(keys))[0] : null);

/** 規定打席に届いたか */
export const isQualifiedBatter = (s) => s.PA >= qualifyingPA(s.year);
/** 規定投球回に届いたか */
export const isQualifiedPitcher = (s) => s.outs >= qualifyingOuts(s.year);

/** 枠の種類に合わせて、キャリアハイの年度を選ぶ。選べなければ null。 */
export function autoSeason(seasons, kind) {
  if (!seasons.length) return null;
  const type = SEASON_TYPE[kind];
  if (type === "bat") {
    const qualified = seasons.filter(isQualifiedBatter);
    if (qualified.length) return best(qualified, [[(s) => s.OPS ?? -1, 1], [(s) => s.HR, 1], [(s) => s.PA, 1]]);
    return best(seasons, [[(s) => s.PA, 1], [(s) => s.OPS ?? -1, 1]]);
  }
  if (kind === "SP") return best(seasons, [[(s) => s.W, 1], [eraKey, -1], [(s) => s.outs, 1]]);
  const key = kind === "CL" ? (s) => s.SV ?? 0 : (s) => (s.SV ?? 0) + (s.HLD ?? 0);
  const withRecord = seasons.filter((s) => key(s) > 0);
  if (withRecord.length) return best(withRecord, [[key, 1], [eraKey, -1], [(s) => s.G, 1]]);
  return best(seasons, [[(s) => s.G, 1], [eraKey, -1]]);
}

// ---------------------------------------------------------------------------
// 点数（0〜100）
// ---------------------------------------------------------------------------

/** 打者：OPS（打席が少ないほど平均の .650 に寄せる）と、出場の多さ。 */
export function battingScore(s) {
  if (!s || !s.PA) return 0;
  const ops = s.OPS ?? 0;
  const k = 120;
  const adj = (ops * s.PA + 0.65 * k) / (s.PA + k);
  const quality = clamp01((adj - 0.55) / 0.42);
  const playing = clamp01(s.PA / qualifyingPA(s.year));
  return Math.round(100 * quality * (0.55 + 0.45 * playing));
}

/** 防御率の評価（投球回が少ないほど 4.00 に寄せる）。4.80 で 0、1.80 で 1。 */
function eraQuality(s, k) {
  const ip = s.outs / 3;
  if (!ip) return 0;
  const era = num(s.ERA) ?? (s.ER * 27) / s.outs;
  const adj = (era * ip + 4.0 * k) / (ip + k);
  return clamp01((4.8 - adj) / 3.0);
}

/** 投手（先発・中継ぎ・抑え）の点数。 */
export function pitchingScore(s, kind) {
  if (!s || !s.outs) return 0;
  if (kind === "SP") {
    const era = eraQuality(s, 40);
    const wins = clamp01(s.W / 18);
    const innings = clamp01(s.outs / qualifyingOuts(s.year));
    return Math.round(100 * (0.6 * era + 0.4 * wins) * (0.55 + 0.45 * innings));
  }
  const era = eraQuality(s, 20);
  const games = clamp01(s.G / 55);
  if (kind === "CL") {
    const saves = s.SV === null || s.SV === undefined ? games * 0.8 : clamp01(s.SV / 35);
    return Math.round(100 * (0.55 * era + 0.45 * saves) * (0.6 + 0.4 * games));
  }
  const late = (s.HLD ?? 0) + (s.SV ?? 0);
  const holds = s.HLD === null || s.HLD === undefined ? Math.max(games, clamp01(late / 30)) : Math.max(clamp01(late / 30), games * 0.8);
  return Math.round(100 * (0.65 * era + 0.35 * holds) * (0.6 + 0.4 * games));
}

export function seasonScore(season, kind) {
  if (!season) return 0;
  return SEASON_TYPE[kind] === "bat" ? battingScore(season) : pitchingScore(season, kind);
}

// ---------------------------------------------------------------------------
// 表示用の成績の並び
// ---------------------------------------------------------------------------

/** 1年分の成績を短い言葉の並びにする。[{ text, lead }] */
export function statLine(s, kind) {
  if (!s) return [];
  const L = (key) => s.lead?.has(key) ?? false;
  if (SEASON_TYPE[kind] === "bat") {
    const parts = [
      { text: `打率${fmtRate(s.AVG)}`, lead: L("AVG") },
      { text: `${s.HR}本`, lead: L("HR") },
      { text: `${s.RBI}打点`, lead: L("RBI") },
    ];
    if (s.SB >= 10 || L("SB")) parts.push({ text: `${s.SB}盗塁`, lead: L("SB") });
    parts.push({ text: `OPS${fmtRate(s.OPS)}`, lead: L("OPS") });
    return parts;
  }
  const era = { text: `防御率${fmtEra(s.ERA)}`, lead: L("ERA") };
  if (kind === "SP") {
    return [
      { text: `${s.W}勝${s.L}敗`, lead: L("W") },
      era,
      { text: `${s.IP}回`, lead: false },
      { text: `${s.SO}奪三振`, lead: L("SO") },
    ];
  }
  const parts = [{ text: `${s.G}登板`, lead: false }];
  if (kind === "CL" && s.SV !== null && s.SV !== undefined) parts.push({ text: `${s.SV}セーブ`, lead: L("SV") });
  if (kind === "RP") {
    if (s.HLD) parts.push({ text: `${s.HLD}ホールド`, lead: L("HLD") });
    if (s.SV) parts.push({ text: `${s.SV}セーブ`, lead: L("SV") });
    if (!s.HLD && !s.SV && s.W) parts.push({ text: `${s.W}勝`, lead: L("W") });
  }
  parts.push(era);
  return parts;
}

export const statText = (s, kind) => statLine(s, kind).map((p) => p.text).join(" ");

/** 年度の選び方の説明（短い文） */
export const AUTO_RULE = {
  lineup: "規定打席に届いた年で OPS が最も高い年",
  bench: "規定打席に届いた年で OPS が最も高い年",
  SP: "勝利数が最も多い年",
  RP: "セーブとホールドの合計が最も多い年（記録がない時代は登板数）",
  CL: "セーブが最も多い年（記録がない時代は登板数）",
};

// ---------------------------------------------------------------------------
// チーム全体
// ---------------------------------------------------------------------------

/** snapshot（game.teamSnapshot の戻り値）の選手を、枠の順に並べる。 */
export function snapshotSlots(snapshot) {
  const slots = snapshot.lineup.map((r) => ({ kind: "lineup", order: r.order, field: r.field, player: r.player }));
  for (const kind of ["bench", "SP", "RP", "CL"]) {
    for (const player of snapshot[kind] || []) slots.push({ kind, order: null, field: null, player });
  }
  return slots;
}

/**
 * 答え合わせの結果。
 * slots: [{ kind, order, field, player, type, seasons, season, auto, year, score, rank }]
 * total / batting / pitching: { score, rank }
 * sums: 打線（スタメン9人）と投手陣（5人）の合計成績
 */
export function careerTeam(snapshot, playersJson) {
  const chosen = snapshot.careerYears || {};
  const slots = snapshotSlots(snapshot).map((slot) => {
    const type = SEASON_TYPE[slot.kind];
    const seasons = slot.player ? playerSeasons(playersJson, slot.player.playerKey, type) : [];
    const autoS = autoSeason(seasons, slot.kind);
    const want = slot.player ? chosen[slot.player.pickId] : undefined;
    const picked = want !== undefined ? seasons.find((s) => s.year === want) : null;
    const season = picked || autoS;
    const score = seasonScore(season, slot.kind);
    return {
      ...slot,
      type,
      seasons,
      season,
      autoYear: autoS ? autoS.year : null,
      auto: !picked,
      year: season ? season.year : null,
      score,
      rank: rankOf(score, PLAYER_RANKS),
    };
  });

  const avg = (list) => {
    const w = list.reduce((a, s) => a + SCORE_WEIGHT[s.kind], 0);
    const v = list.reduce((a, s) => a + SCORE_WEIGHT[s.kind] * s.score, 0);
    const score = w ? Math.round(v / w) : 0;
    return { score, rank: rankOf(score, TEAM_RANKS) };
  };
  const batters = slots.filter((s) => s.type === "bat");
  const pitchers = slots.filter((s) => s.type === "pit");

  const lineupSeasons = slots.filter((s) => s.kind === "lineup" && s.season).map((s) => s.season);
  const staffSeasons = pitchers.filter((s) => s.season).map((s) => s.season);
  const total = (list, key) => list.reduce((a, s) => a + (num(s[key]) ?? 0), 0);
  const ab = total(lineupSeasons, "AB");
  const outs = staffSeasons.reduce((a, s) => a + (s.outs || 0), 0);
  const er = total(staffSeasons, "ER");

  return {
    slots,
    total: avg(slots),
    batting: avg(batters),
    pitching: avg(pitchers),
    sums: {
      AVG: ab ? total(lineupSeasons, "H") / ab : null,
      HR: total(lineupSeasons, "HR"),
      RBI: total(lineupSeasons, "RBI"),
      SB: total(lineupSeasons, "SB"),
      W: total(staffSeasons, "W"),
      SV: total(staffSeasons, "SV"),
      HLD: total(staffSeasons, "HLD"),
      ERA: outs ? (er * 27) / outs : null,
      IP: outsToIp(outs),
    },
    complete: slots.every((s) => s.player),
  };
}

/** 保存用の短いまとめ（保存一覧に出す）。 */
export function careerSummary(result) {
  return { score: result.total.score, rank: result.total.rank, batting: result.batting.score, pitching: result.pitching.score };
}

