// 完成したチームの「答え合わせ」：各選手のキャリアハイの年度と、チームの総合力（簡易 WAR）。
// DOM に触れない純粋関数（Node のテストからも使う）。WAR の計算は war.js。
//
// 年度の自動選択：その枠での WAR が最も高い年（打者の枠は打撃の WAR、投手の枠は投手の WAR）。
//   中継ぎ・抑えの枠は、1年に投げる回数が少ないので、投球回が 80 回を超える年は 80 回分に割り引いて比べる
//   （先発投手を抑えに入れても、抑えとして投げる回数ぶんの価値になる）。
// 選手ごとに、遊んだ人が別の年度を選び直せる（snapshot.careerYears に pickId → 年度 で入れる）。
// チームの総合力：17人の WAR の合計（控えは出場が少ないので 1/4）に、控えレベルの選手だけのチームの勝ち数
//   （143試合×.294＝42勝）を足して「予想勝利数」にする。

import { battingTotals, fmtEra, fmtRate, outsToIp, pitchingTotals, rowObject } from "./stats.js";
import { battingWar, fmtWar, pitchingWar } from "./war.js";

/** 枠の種類 → 使う成績（bat: 打撃、pit: 投手） */
export const SEASON_TYPE = { lineup: "bat", bench: "bat", SP: "pit", RP: "pit", CL: "pit" };

/** チームの WAR に入れる割合（控えは出場が少ない） */
export const SLOT_SHARE = { lineup: 1, bench: 0.25, SP: 1, RP: 1, CL: 1 };
/** 中継ぎ・抑えとして1年に投げる回数の上限（これを超える年は割り引く） */
export const RELIEF_IP = 80;
/** 予想勝利数の計算に使う試合数と、控えレベルの選手だけのチームの勝率 */
export const SEASON_GAMES = 143;
export const REPLACEMENT_WINS = Math.round(SEASON_GAMES * 0.294); // 42勝

/**
 * ランクの境目（WAR がこれ以上ならそのランク）。
 * 選手：S は MVP 級、A はオールスター級、B は主力、C はレギュラー、D は控え。
 * 中継ぎ・抑え：投げる回数が少ないぶん WAR も小さいので、別の区切り。
 * チーム：予想勝利数（実データで自動プレイを繰り返して決めた）。
 */
export const PLAYER_RANKS = [
  ["S", 7],
  ["A", 5],
  ["B", 3],
  ["C", 2],
  ["D", 1],
  ["E", -Infinity],
];
export const RELIEF_RANKS = [
  ["S", 3.5],
  ["A", 2.5],
  ["B", 1.5],
  ["C", 1],
  ["D", 0.5],
  ["E", -Infinity],
];
export const TEAM_RANKS = [
  ["S", 100],
  ["A", 90],
  ["B", 82],
  ["C", 74],
  ["D", 66],
  ["E", -Infinity],
];
/** チームのランクのひとこと */
export const TEAM_LABELS = { S: "歴代最強クラス", A: "独走で優勝", B: "優勝争い", C: "Aクラス争い", D: "Bクラス", E: "最下位争い" };

export function rankOf(value, table = PLAYER_RANKS) {
  for (const [rank, min] of table) if (value >= min) return rank;
  return "E";
}

/** 枠に合わせたランクの区切り */
export const ranksFor = (kind) => (kind === "RP" || kind === "CL" ? RELIEF_RANKS : PLAYER_RANKS);

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

/** 行ごとの WAR を足す（どの行も計算できなければ null）。 */
function sumWar(rows) {
  const vals = rows.map((r) => r.WAR).filter((w) => typeof w === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** 打撃成績の行（rowObject 済み。WAR が付いていれば足す）→ 年度ごとの成績。 */
export function battingSeasons(rows) {
  return groupByYear(rows).map(([year, rs]) => {
    const t = battingTotals(rs);
    const one = rs.length === 1 ? rs[0] : null;
    // 1行だけなら記事の値（四捨五入済み）をそのまま使う
    for (const k of ["AVG", "OBP", "SLG", "OPS"]) if (one && num(one[k]) !== null) t[k] = one[k];
    if (t.PA === 0 && t.AB > 0) t.PA = t.AB + t.BB + t.HBP + t.SF;
    return { ...t, year, team: mergeTeams(rs), lead: mergeLead(rs), WAR: sumWar(rs) };
  });
}

/** 投手成績の行（rowObject 済み）→ 年度ごとの成績。 */
export function pitchingSeasons(rows) {
  return groupByYear(rows).map(([year, rs]) => {
    const t = pitchingTotals(rs);
    const one = rs.length === 1 ? rs[0] : null;
    if (one && num(one.ERA) !== null) t.ERA = one.ERA;
    if (one && num(one.WHIP) !== null) t.WHIP = one.WHIP;
    return { ...t, year, team: mergeTeams(rs), lead: mergeLead(rs), WAR: sumWar(rs) };
  });
}

/**
 * 選手データ（players.json）から、その選手の年度ごとの成績（type: "bat" | "pit"）。
 * leaguesJson（data/leagues.json）があれば、年度ごとの WAR も付ける。
 */
export function playerSeasons(playersJson, playerKey, type, leaguesJson = null) {
  const p = playersJson?.players?.[playerKey];
  if (!p) return [];
  const { battingColumns, pitchingColumns } = playersJson.meta;
  if (type === "bat") {
    const rows = (p.batting || []).map((r) => rowObject(r, battingColumns));
    if (leaguesJson) for (const r of rows) r.WAR = battingWar(r, leaguesJson, p);
    return battingSeasons(rows);
  }
  const rows = (p.pitching || []).map((r) => rowObject(r, pitchingColumns));
  if (leaguesJson) for (const r of rows) r.WAR = pitchingWar(r, leaguesJson);
  return pitchingSeasons(rows);
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

/**
 * その枠でのその年の WAR（チームに入れる値）。中継ぎ・抑えは 80 回を超える分を割り引く。
 * WAR が計算できなければ null。
 */
export function slotWar(season, kind) {
  if (!season || typeof season.WAR !== "number") return null;
  if ((kind === "RP" || kind === "CL") && season.outs > RELIEF_IP * 3) return (season.WAR * RELIEF_IP * 3) / season.outs;
  return season.WAR;
}

/** WAR が計算できないときの選び方（Beta v1.6 までと同じ） */
function fallbackSeason(seasons, kind) {
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

/** 枠の種類に合わせて、キャリアハイ（その枠での WAR が最も高い年）を選ぶ。選べなければ null。 */
export function autoSeason(seasons, kind) {
  if (!seasons.length) return null;
  const withWar = seasons.filter((s) => slotWar(s, kind) !== null);
  if (!withWar.length) return fallbackSeason(seasons, kind);
  const tie = SEASON_TYPE[kind] === "bat" ? [(s) => s.OPS ?? -1, 1] : [eraKey, -1];
  return best(withWar, [[(s) => slotWar(s, kind), 1], tie]);
}

// ---------------------------------------------------------------------------
// 評価
// ---------------------------------------------------------------------------

/** その枠での評価：{ war（チームに入れる値）, seasonWar（その年の WAR）, rank, scaled（割り引いたか） } */
export function seasonValue(season, kind) {
  const war = slotWar(season, kind);
  if (war === null) return { war: 0, seasonWar: null, rank: "E", scaled: false };
  return { war, seasonWar: season.WAR, rank: rankOf(war, ranksFor(kind)), scaled: war !== season.WAR };
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
  // 先発が中心の年（先発が登板の半分以上）は先発の形、それ以外は救援の形で出す
  const starter = s.G > 0 && s.GS / s.G >= 0.5;
  if (starter) {
    return [
      { text: `${s.W}勝${s.L}敗`, lead: L("W") },
      era,
      { text: `${s.IP}回`, lead: false },
      { text: `${s.SO}奪三振`, lead: L("SO") },
    ];
  }
  const parts = [{ text: `${s.G}登板`, lead: false }];
  if (s.SV) parts.push({ text: `${s.SV}セーブ`, lead: L("SV") });
  if (s.HLD) parts.push({ text: `${s.HLD}ホールド`, lead: L("HLD") });
  if (!s.SV && !s.HLD && s.W) parts.push({ text: `${s.W}勝`, lead: L("W") });
  parts.push(era);
  return parts;
}

export const statText = (s, kind) => statLine(s, kind).map((p) => p.text).join(" ");

/** 年度の選び方の説明（短い文） */
export const AUTO_RULE = {
  lineup: "WAR（打撃）が最も高い年",
  bench: "WAR（打撃）が最も高い年",
  SP: "WAR（投手）が最も高い年",
  RP: "中継ぎとしての WAR が最も高い年（80回を超える年は80回分に割り引き）",
  CL: "抑えとしての WAR が最も高い年（80回を超える年は80回分に割り引き）",
};

export { fmtWar };

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
 * 答え合わせの結果。leaguesJson（data/leagues.json）がなければ WAR は出ない（null）。
 * slots: [{ kind, order, field, player, type, seasons, season, auto, autoYear, year, war, seasonWar, scaled, rank }]
 * total: { war（チームの WAR）, wins, losses, rank } / batting・pitching: { war }
 * sums: 打線（スタメン9人）と投手陣（6人）の合計成績
 */
export function careerTeam(snapshot, playersJson, leaguesJson = null) {
  const chosen = snapshot.careerYears || {};
  const slots = snapshotSlots(snapshot).map((slot) => {
    const type = SEASON_TYPE[slot.kind];
    const seasons = slot.player ? playerSeasons(playersJson, slot.player.playerKey, type, leaguesJson) : [];
    const autoS = autoSeason(seasons, slot.kind);
    const want = slot.player ? chosen[slot.player.pickId] : undefined;
    const picked = want !== undefined ? seasons.find((s) => s.year === want) : null;
    const season = picked || autoS;
    const value = seasonValue(season, slot.kind);
    return {
      ...slot,
      type,
      seasons,
      season,
      autoYear: autoS ? autoS.year : null,
      auto: !picked,
      year: season ? season.year : null,
      ...value,
    };
  });

  const teamWar = (list) => list.reduce((a, s) => a + s.war * SLOT_SHARE[s.kind], 0);
  const batters = slots.filter((s) => s.type === "bat");
  const pitchers = slots.filter((s) => s.type === "pit");
  const war = teamWar(slots);
  const wins = Math.max(0, Math.min(SEASON_GAMES, Math.round(REPLACEMENT_WINS + war)));

  const lineupSeasons = slots.filter((s) => s.kind === "lineup" && s.season).map((s) => s.season);
  const staffSeasons = pitchers.filter((s) => s.season).map((s) => s.season);
  const total = (list, key) => list.reduce((a, s) => a + (num(s[key]) ?? 0), 0);
  const ab = total(lineupSeasons, "AB");
  const outs = staffSeasons.reduce((a, s) => a + (s.outs || 0), 0);
  const er = total(staffSeasons, "ER");

  return {
    slots,
    hasWar: Boolean(leaguesJson),
    total: { war, wins, losses: SEASON_GAMES - wins, rank: rankOf(wins, TEAM_RANKS), label: TEAM_LABELS[rankOf(wins, TEAM_RANKS)] },
    batting: { war: teamWar(batters) },
    pitching: { war: teamWar(pitchers) },
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
  const r = (x) => Math.round(x * 10) / 10;
  return {
    rank: result.total.rank,
    war: r(result.total.war),
    wins: result.total.wins,
    batting: r(result.batting.war),
    pitching: r(result.pitching.war),
  };
}
