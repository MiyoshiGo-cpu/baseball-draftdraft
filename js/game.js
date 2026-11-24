// ゲームのルール。DOM に触れない純粋関数だけを置く（Node のテストからも読み込む）。
// 状態は毎回新しいオブジェクトを返し、引数の状態は書き換えない。

import { nextRandom, seedToState } from "./roulette.js";

export const STATE_VERSION = 1;

export const POSITIONS = ["捕", "一", "二", "三", "遊", "左", "中", "右", "DH"];
export const POSITION_NAMES = {
  捕: "捕手", 一: "一塁", 二: "二塁", 三: "三塁", 遊: "遊撃",
  左: "左翼", 中: "中堅", 右: "右翼", DH: "DH",
};
export const CAPACITY = { lineup: 9, bench: 2, SP: 3, RP: 2, CL: 1 };
export const KIND_LABELS = { lineup: "スタメン", bench: "控え", SP: "先発", RP: "中継ぎ", CL: "抑え" };
export const PITCHER_KINDS = ["SP", "RP", "CL"];
export const FIELDER_KINDS = ["lineup", "bench"];
export const TOTAL_SLOTS = Object.values(CAPACITY).reduce((a, b) => a + b, 0); // 17
export const MIN_PAIRS = TOTAL_SLOTS;

export const YEAR_MIN = 1965;
export const YEAR_MAX = 2025;
export const PASS_LIMIT_MAX = 10;

export const DEFAULT_SETTINGS = Object.freeze({
  yearFrom: YEAR_MIN,
  yearTo: YEAR_MAX,
  passLimit: 3,
  includeIkusei: true,
  includeUnsigned: true,
  pitcherFielderRule: "strict", // "strict"（厳格） | "loose"（ゆるめ）
  sound: true,
});

export class GameError extends Error {}

// ---------------------------------------------------------------------------
// データ
// ---------------------------------------------------------------------------

export function pairKey(year, franchiseId) {
  return `${year}-${franchiseId}`;
}

/** drafts.json を検索しやすい形にまとめる。 */
export function indexData(json) {
  const franchiseOrder = new Map(json.franchises.map((f, i) => [f.id, i]));
  const franchises = new Map(json.franchises.map((f) => [f.id, f]));
  const pairs = new Map();
  const picks = new Map();
  const pickDraft = new Map();
  for (const d of json.drafts) {
    pairs.set(pairKey(d.year, d.franchiseId), d);
    for (const p of d.picks) {
      picks.set(p.id, p);
      pickDraft.set(p.id, d);
    }
  }
  const pairList = [...pairs.values()].sort(
    (a, b) => a.year - b.year || franchiseOrder.get(a.franchiseId) - franchiseOrder.get(b.franchiseId),
  );
  const years = pairList.map((d) => d.year);
  return {
    meta: json.meta,
    franchises,
    franchiseList: json.franchises,
    franchiseOrder,
    pairs,
    pairList,
    picks,
    pickDraft,
    yearMin: Math.min(...years),
    yearMax: Math.max(...years),
  };
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 欠けた値を初期値で埋め、範囲外の値を丸める。 */
export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(input || {}) };
  let yearFrom = clampInt(s.yearFrom, YEAR_MIN, YEAR_MAX, DEFAULT_SETTINGS.yearFrom);
  let yearTo = clampInt(s.yearTo, YEAR_MIN, YEAR_MAX, DEFAULT_SETTINGS.yearTo);
  if (yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  return {
    yearFrom,
    yearTo,
    passLimit: clampInt(s.passLimit, 0, PASS_LIMIT_MAX, DEFAULT_SETTINGS.passLimit),
    includeIkusei: Boolean(s.includeIkusei),
    includeUnsigned: Boolean(s.includeUnsigned),
    pitcherFielderRule: s.pitcherFielderRule === "loose" ? "loose" : "strict",
    sound: Boolean(s.sound),
  };
}

/** 設定の絞り込み（育成・入団しなかった選手）を適用した指名一覧。 */
export function filterPicks(settings, draft) {
  return draft.picks.filter(
    (p) => (settings.includeIkusei || p.draftType !== "ikusei") && (settings.includeUnsigned || p.signed),
  );
}

/** 設定だけで決まる、抽選の対象になりうるペア（出たかどうかは見ない）。 */
export function eligiblePairs(settings, data) {
  return data.pairList.filter(
    (d) => d.year >= settings.yearFrom && d.year <= settings.yearTo && filterPicks(settings, d).length > 0,
  );
}

// ---------------------------------------------------------------------------
// ゲームの作成
// ---------------------------------------------------------------------------

export function emptyRoster() {
  return { lineup: [], bench: [], SP: [], RP: [], CL: [] };
}

export function createGame(settings, seed) {
  return {
    version: STATE_VERSION,
    settings: normalizeSettings(settings),
    seed,
    rngState: seedToState(seed),
    status: "setup",
    usedPairs: [],
    current: null,
    roster: emptyRoster(),
    passesUsed: 0,
    history: [],
  };
}

/** 設定を変える。効果音以外は1回目のスピンの前だけ変えられる。 */
export function updateSettings(state, patch) {
  const keys = Object.keys(patch);
  if (state.status !== "setup" && keys.some((k) => k !== "sound")) {
    throw new GameError("設定を変えられるのは1回目のスピンの前だけです");
  }
  return { ...state, settings: normalizeSettings({ ...state.settings, ...patch }) };
}

/** 開始できるか（対象のペアが17以上あるか）。 */
export function canStart(settings, data) {
  const count = eligiblePairs(settings, data).length;
  if (count < MIN_PAIRS) {
    return {
      ok: false,
      count,
      message: `対象の「球団×年度」が${count}組しかありません。${MIN_PAIRS}組以上になるように年度範囲を広げてください。`,
    };
  }
  return { ok: true, count, message: "" };
}

// ---------------------------------------------------------------------------
// 抽選
// ---------------------------------------------------------------------------

/** まだ出ていない、抽選できるペアの一覧（年度→球団の順）。 */
export function availablePairs(state, data) {
  const used = new Set(state.usedPairs);
  return eligiblePairs(state.settings, data).filter((d) => !used.has(pairKey(d.year, d.franchiseId)));
}

/**
 * ペアを1つ決めて current に入れる。
 * rng を渡すとそれを使い、渡さなければ状態の中の乱数（rngState）を進める。
 */
export function spin(state, data, rng = null) {
  if (state.status !== "setup" && state.status !== "playing") {
    throw new GameError("このゲームは終了しています");
  }
  if (state.current) {
    throw new GameError("選手を配置するかパスするまで、次のスピンはできません");
  }
  if (state.status === "setup") {
    const check = canStart(state.settings, data);
    if (!check.ok) throw new GameError(check.message);
  }
  const pairs = availablePairs(state, data);
  if (pairs.length === 0) {
    return { ...state, status: "stuck" };
  }
  let value;
  let rngState = state.rngState;
  if (rng) {
    value = rng();
  } else {
    const r = nextRandom(rngState);
    value = r.value;
    rngState = r.state;
  }
  const chosen = pairs[Math.min(pairs.length - 1, Math.floor(value * pairs.length))];
  return {
    ...state,
    rngState,
    status: "playing",
    usedPairs: [...state.usedPairs, pairKey(chosen.year, chosen.franchiseId)],
    current: { year: chosen.year, franchiseId: chosen.franchiseId },
  };
}

export function currentDraft(state, data) {
  if (!state.current) return null;
  return data.pairs.get(pairKey(state.current.year, state.current.franchiseId)) || null;
}

/** 今のスピンで選べる指名一覧（設定の絞り込み後）。 */
export function currentPicks(state, data) {
  const d = currentDraft(state, data);
  return d ? filterPicks(state.settings, d) : [];
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export function rosterPickIds(roster) {
  return [
    ...roster.lineup.map((e) => e.pickId),
    ...roster.bench,
    ...roster.SP,
    ...roster.RP,
    ...roster.CL,
  ];
}

export function filledCount(roster) {
  return rosterPickIds(roster).length;
}

function usedCount(roster, kind) {
  return roster[kind].length;
}

/** 選手の区分と設定から、入れてよい枠の種類。 */
export function allowedKinds(pick, settings) {
  if (pick.twoWay) return [...FIELDER_KINDS, ...PITCHER_KINDS];
  if (pick.group === "F") return [...FIELDER_KINDS];
  if (settings.pitcherFielderRule === "loose") return [...FIELDER_KINDS, ...PITCHER_KINDS];
  return [...PITCHER_KINDS];
}

/** その選手を今入れられる枠の種類と空き数。例：[{ kind: "SP", free: 2 }] */
export function openSlots(state, pick) {
  return allowedKinds(pick, state.settings)
    .map((kind) => ({ kind, free: CAPACITY[kind] - usedCount(state.roster, kind) }))
    .filter((s) => s.free > 0);
}

export function freeOrders(roster) {
  const used = new Set(roster.lineup.map((e) => e.order));
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !used.has(n));
}

export function freePositions(roster) {
  const used = new Set(roster.lineup.map((e) => e.pos));
  return POSITIONS.filter((p) => !used.has(p));
}

/** 配置できるなら null、できないなら理由の文字列を返す。 */
export function pickableReason(state, pick, data) {
  const keys = new Set(rosterPickIds(state.roster).map((id) => data.picks.get(id)?.playerKey));
  if (keys.has(pick.playerKey)) return "同じ選手がチームにいます";
  if (openSlots(state, pick).length > 0) return null;
  if (pick.twoWay) return "空き枠がありません";
  if (pick.group === "F") return "野手枠が満杯";
  if (state.settings.pitcherFielderRule === "loose") return "空き枠がありません";
  return "投手枠が満杯";
}

/** 今の一覧に、配置できる選手が1人でもいるか。 */
export function hasPickable(state, data) {
  return currentPicks(state, data).some((p) => pickableReason(state, p, data) === null);
}

/** 枠の文字列を分解する。"lineup:4:右" / "bench" / "SP" / "RP" / "CL" */
export function parseSlot(slot) {
  const parts = String(slot).split(":");
  if (parts[0] === "lineup" && parts.length === 3) {
    return { kind: "lineup", order: Number(parts[1]), pos: parts[2] };
  }
  if (parts.length === 1 && parts[0] in CAPACITY && parts[0] !== "lineup") {
    return { kind: parts[0] };
  }
  throw new GameError(`枠の指定が正しくありません: ${slot}`);
}

export function lineupSlot(order, pos) {
  return `lineup:${order}:${pos}`;
}

function nextStatus(state, data) {
  if (filledCount(state.roster) >= TOTAL_SLOTS) return "complete";
  if (availablePairs(state, data).length === 0) return "stuck";
  return "playing";
}

function resolveSpin(state, data, entry) {
  const next = {
    ...state,
    current: null,
    history: [...state.history, { n: state.usedPairs.length, ...state.current, ...entry }],
  };
  return { ...next, status: nextStatus(next, data) };
}

function requireCurrent(state) {
  if (state.status !== "playing" || !state.current) {
    throw new GameError("今は選手を選べません。先にルーレットを回してください");
  }
}

/** 選手を枠に配置して、新しい状態を返す。 */
export function place(state, data, pickId, slot) {
  requireCurrent(state);
  const pick = data.picks.get(pickId);
  if (!pick || !currentPicks(state, data).some((p) => p.id === pickId)) {
    throw new GameError("この選手は今のスピンの一覧にいません");
  }
  const reason = pickableReason(state, pick, data);
  if (reason) throw new GameError(reason);

  const target = parseSlot(slot);
  if (!openSlots(state, pick).some((s) => s.kind === target.kind)) {
    throw new GameError(`この選手は${KIND_LABELS[target.kind]}に入れられません`);
  }

  const roster = {
    lineup: [...state.roster.lineup],
    bench: [...state.roster.bench],
    SP: [...state.roster.SP],
    RP: [...state.roster.RP],
    CL: [...state.roster.CL],
  };
  let slotText = target.kind;
  if (target.kind === "lineup") {
    if (!freeOrders(roster).includes(target.order)) throw new GameError(`${target.order}番はもう埋まっています`);
    if (!freePositions(roster).includes(target.pos)) throw new GameError(`${target.pos}はもう埋まっています`);
    roster.lineup.push({ order: target.order, pos: target.pos, pickId });
    roster.lineup.sort((a, b) => a.order - b.order);
    slotText = lineupSlot(target.order, target.pos);
  } else {
    roster[target.kind].push(pickId);
  }
  return resolveSpin({ ...state, roster }, data, { action: "pick", pickId, slot: slotText });
}

/** パスする。 */
export function pass(state, data) {
  requireCurrent(state);
  if (state.passesUsed >= state.settings.passLimit) {
    throw new GameError("パスはもう残っていません");
  }
  return resolveSpin({ ...state, passesUsed: state.passesUsed + 1 }, data, { action: "pass" });
}

/** 配置できる選手が1人もいないときだけ、パスを消費せずに次へ進む。 */
export function autoSkip(state, data) {
  requireCurrent(state);
  if (hasPickable(state, data)) {
    throw new GameError("配置できる選手がいるので、自動スキップはできません");
  }
  return resolveSpin(state, data, { action: "skip" });
}

// ---------------------------------------------------------------------------
// 状態の参照
// ---------------------------------------------------------------------------

export function isComplete(state) {
  return filledCount(state.roster) >= TOTAL_SLOTS;
}

export function isStuck(state, data) {
  return (
    state.status !== "setup" && !state.current && !isComplete(state) && availablePairs(state, data).length === 0
  );
}

export function passesLeft(state) {
  return Math.max(0, state.settings.passLimit - state.passesUsed);
}

export function spinCount(state) {
  return state.usedPairs.length;
}

/**
 * 保存・共有用に、チームを選手情報つきで書き出す（データが変わっても再表示できるように）。
 * 各枠は { pickId, name, playerKey, year, franchiseId, teamName, roundLabel, pos, group, twoWay } か null。
 */
export function teamSnapshot(state, data) {
  const info = (pickId) => {
    const p = data.picks.get(pickId);
    const d = data.pickDraft.get(pickId);
    if (!p || !d) return null;
    return {
      pickId,
      name: p.name,
      playerKey: p.playerKey,
      year: d.year,
      franchiseId: d.franchiseId,
      teamName: d.teamName,
      roundLabel: p.roundLabel,
      pos: p.pos,
      group: p.group,
      twoWay: p.twoWay,
    };
  };
  const fill = (ids, size) => Array.from({ length: size }, (_, i) => (ids[i] ? info(ids[i]) : null));
  const lineup = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((order) => {
    const e = state.roster.lineup.find((x) => x.order === order);
    return e ? { order, field: e.pos, player: info(e.pickId) } : { order, field: null, player: null };
  });
  return {
    lineup,
    bench: fill(state.roster.bench, CAPACITY.bench),
    SP: fill(state.roster.SP, CAPACITY.SP),
    RP: fill(state.roster.RP, CAPACITY.RP),
    CL: fill(state.roster.CL, CAPACITY.CL),
    spins: spinCount(state),
    passes: state.passesUsed,
    complete: isComplete(state),
    settings: { ...state.settings },
  };
}

/**
 * localStorage から読んだ状態を確かめる。形が合わない・データにない選手がいる場合は null。
 */
export function restoreState(raw, data) {
  try {
    if (!raw || raw.version !== STATE_VERSION) return null;
    if (!["setup", "playing", "complete", "stuck"].includes(raw.status)) return null;
    const roster = raw.roster;
    if (!roster || !Array.isArray(roster.lineup)) return null;
    for (const kind of ["bench", "SP", "RP", "CL"]) {
      if (!Array.isArray(roster[kind]) || roster[kind].length > CAPACITY[kind]) return null;
    }
    const ids = rosterPickIds(roster);
    if (ids.some((id) => !data.picks.has(id))) return null;
    if (!Array.isArray(raw.usedPairs) || raw.usedPairs.some((k) => !data.pairs.has(k))) return null;
    if (raw.current && !data.pairs.has(pairKey(raw.current.year, raw.current.franchiseId))) return null;
    if (!Array.isArray(raw.history)) return null;
    return {
      version: STATE_VERSION,
      settings: normalizeSettings(raw.settings),
      seed: raw.seed,
      rngState: Number(raw.rngState) >>> 0,
      status: raw.status,
      usedPairs: [...raw.usedPairs],
      current: raw.current ? { year: raw.current.year, franchiseId: raw.current.franchiseId } : null,
      roster: {
        lineup: roster.lineup.map((e) => ({ order: e.order, pos: e.pos, pickId: e.pickId })),
        bench: [...roster.bench],
        SP: [...roster.SP],
        RP: [...roster.RP],
        CL: [...roster.CL],
      },
      passesUsed: Math.max(0, Number(raw.passesUsed) || 0),
      history: raw.history.map((h) => ({ ...h })),
    };
  } catch {
    return null;
  }
}
