// ルール（js/game.js）のテスト。実行：node --test tests/*.test.mjs（または npm test）
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_SETTINGS,
  GameError,
  TOTAL_SLOTS,
  autoSkip,
  availablePairs,
  canStart,
  createGame,
  currentPicks,
  filledCount,
  freeOrders,
  freePositions,
  hasPickable,
  indexData,
  isComplete,
  isStuck,
  lineupSlot,
  normalizeSettings,
  openSlots,
  pairKey,
  pass,
  passesLeft,
  pickableReason,
  place,
  restoreState,
  rosterPickIds,
  setCareerYear,
  spin,
  teamSnapshot,
  updateSettings,
} from "../js/game.js";
import { createRng, nextRandom, parseSeedParam, seedToState } from "../js/roulette.js";
import { buildShareText } from "../js/share.js";
import { eraShort } from "../js/teams.js";

// ---------------------------------------------------------------------------
// 架空のテストデータ
// ---------------------------------------------------------------------------

const FRANCHISES = [
  "giants", "tigers", "dragons", "carp", "swallows", "baystars",
  "lions", "marines", "fighters", "hawks", "buffaloes", "kintetsu_rakuten",
].map((id) => ({ id, short: id }));

/** picks: [{ name, pos, ...上書き }] */
function draft(year, franchiseId, picks) {
  return {
    year,
    franchiseId,
    teamName: `${franchiseId}チーム`,
    picks: picks.map((p, i) => {
      const order = i + 1;
      const pos = p.pos || "投手";
      return {
        id: `${year}-${franchiseId}-${String(order).padStart(2, "0")}`,
        order,
        roundLabel: `${order}位`,
        name: p.name,
        playerKey: p.playerKey || p.name,
        pos,
        group: pos === "投手" ? "P" : "F",
        from: "テスト高",
        draftType: p.draftType || "regular",
        signed: p.signed ?? true,
        twoWay: p.twoWay ?? false,
        note: "",
      };
    }),
  };
}

/** years の各年度 × 12球団。各ペアに投手2・野手2。extra で特定ペアを差し替え。 */
function makeData({ years = [2000, 2001], extra = {} } = {}) {
  const drafts = [];
  for (const year of years) {
    for (const f of FRANCHISES) {
      const key = pairKey(year, f.id);
      drafts.push(
        extra[key] ||
          draft(year, f.id, [
            { name: `${key}投A` },
            { name: `${key}投B` },
            { name: `${key}野A`, pos: "内野手" },
            { name: `${key}野B`, pos: "外野手" },
          ]),
      );
    }
  }
  return indexData({ meta: {}, franchises: FRANCHISES, drafts });
}

const S = (over = {}) => ({ ...DEFAULT_SETTINGS, yearFrom: 2000, yearTo: 2001, ...over });

/** 指定のペアを current にした状態を作る（抽選を経由せずにテストするため）。 */
function at(state, year, franchiseId) {
  return {
    ...state,
    status: "playing",
    usedPairs: [...state.usedPairs, pairKey(year, franchiseId)],
    current: { year, franchiseId },
  };
}

const pickByName = (data, name) => [...data.picks.values()].find((p) => p.name === name);

// ---------------------------------------------------------------------------
// 乱数
// ---------------------------------------------------------------------------

describe("roulette（シードつき乱数）", () => {
  test("同じシードなら同じ列になる", () => {
    const a = createRng(123);
    const b = createRng(123);
    const xs = Array.from({ length: 5 }, () => a());
    const ys = Array.from({ length: 5 }, () => b());
    assert.deepEqual(xs, ys);
    assert.ok(xs.every((x) => x >= 0 && x < 1));
  });

  test("nextRandom は純粋関数", () => {
    const s = seedToState(42);
    assert.deepEqual(nextRandom(s), nextRandom(s));
    assert.notEqual(nextRandom(s).state, s);
  });

  test("?seed= を読む", () => {
    assert.equal(parseSeedParam("?seed=123"), 123);
    assert.equal(parseSeedParam("?seed=abc"), "abc");
    assert.equal(parseSeedParam("?x=1"), null);
    assert.equal(parseSeedParam(""), null);
  });
});

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

describe("設定", () => {
  test("初期値は仕様どおり", () => {
    assert.deepEqual(normalizeSettings({}), {
      yearFrom: 1965,
      yearTo: 2025,
      passLimit: 3,
      includeIkusei: true,
      includeUnsigned: true,
      sound: true,
    });
  });

  test("範囲外の値は丸め、開始と終了が逆なら入れ替える", () => {
    const s = normalizeSettings({ yearFrom: 2030, yearTo: 1900, passLimit: 99, pitcherFielderRule: "strict" });
    assert.equal(s.yearFrom, 1965);
    assert.equal(s.yearTo, 2025);
    assert.equal(s.passLimit, 10);
    assert.ok(!("pitcherFielderRule" in s), "投手⇔野手の制限は Beta v1.4 でなくした");
  });

  test("1回目のスピンの後は、効果音以外の設定を変えられない", () => {
    const data = makeData();
    let st = spin(createGame(S(), 1), data);
    assert.throws(() => updateSettings(st, { passLimit: 5 }), GameError);
    st = updateSettings(st, { sound: false });
    assert.equal(st.settings.sound, false);
  });

  test("対象のペアが17未満なら開始できない", () => {
    const data = makeData({ years: [2000] }); // 12ペア
    const check = canStart(S({ yearTo: 2000 }), data);
    assert.equal(check.ok, false);
    assert.equal(check.count, 12);
    assert.throws(() => spin(createGame(S({ yearTo: 2000 }), 1), data), GameError);
    assert.equal(canStart(S(), makeData()).ok, true);
  });
});

// ---------------------------------------------------------------------------
// 抽選
// ---------------------------------------------------------------------------

describe("抽選", () => {
  test("同じ「球団×年度」は二度出ない", () => {
    const data = makeData();
    let st = createGame(S({ passLimit: 10 }), 7);
    const seen = new Set();
    for (let i = 0; i < 24 && st.status !== "complete" && st.status !== "stuck"; i++) {
      st = spin(st, data);
      const key = pairKey(st.current.year, st.current.franchiseId);
      assert.ok(!seen.has(key), `${key} が2回出た`);
      seen.add(key);
      st = st.passesUsed < st.settings.passLimit ? pass(st, data) : autoSkipOrPlace(st, data);
    }
    assert.equal(new Set(st.usedPairs).size, st.usedPairs.length);
  });

  test("同じシードなら同じ順に出る", () => {
    const data = makeData();
    const run = (seed) => {
      let st = createGame(S({ passLimit: 5 }), seed);
      const keys = [];
      for (let i = 0; i < 5; i++) {
        st = spin(st, data);
        keys.push(pairKey(st.current.year, st.current.franchiseId));
        st = pass(st, data);
      }
      return keys;
    };
    assert.deepEqual(run(99), run(99));
    assert.notDeepEqual(run(99), run(100));
  });

  test("配置かパスをするまで次のスピンはできない", () => {
    const data = makeData();
    const st = spin(createGame(S(), 1), data);
    assert.throws(() => spin(st, data), GameError);
  });

  test("年度範囲の外と、絞り込みで0人になるペアは出ない", () => {
    const data = makeData({
      years: [1999, 2000, 2001],
      extra: {
        [pairKey(2000, "giants")]: draft(2000, "giants", [{ name: "育成だけ", draftType: "ikusei" }]),
        [pairKey(2000, "tigers")]: draft(2000, "tigers", [{ name: "拒否だけ", signed: false }]),
      },
    });
    const keys = (settings) =>
      availablePairs(createGame(settings, 1), data).map((d) => pairKey(d.year, d.franchiseId));
    const all = keys(S());
    assert.ok(!all.some((k) => k.startsWith("1999-")));
    assert.ok(all.includes("2000-giants") && all.includes("2000-tigers"));
    assert.ok(!keys(S({ includeIkusei: false })).includes("2000-giants"));
    assert.ok(!keys(S({ includeUnsigned: false })).includes("2000-tigers"));
  });

  test("絞り込みは名鑑の一覧にも効く", () => {
    const data = makeData({
      extra: {
        [pairKey(2000, "giants")]: draft(2000, "giants", [
          { name: "普通" },
          { name: "育成", draftType: "ikusei" },
          { name: "拒否", signed: false },
        ]),
      },
    });
    const names = (settings) => currentPicks(at(createGame(settings, 1), 2000, "giants"), data).map((p) => p.name);
    assert.deepEqual(names(S()), ["普通", "育成", "拒否"]);
    assert.deepEqual(names(S({ includeIkusei: false, includeUnsigned: false })), ["普通"]);
  });
});

/** テスト用：置けるなら最初に置ける枠へ置き、置けなければ自動スキップ。 */
function autoSkipOrPlace(st, data) {
  for (const p of currentPicks(st, data)) {
    if (pickableReason(st, p, data)) continue;
    const kind = openSlots(st, p)[0].kind;
    const slot = kind === "lineup" ? lineupSlot(freeOrders(st.roster)[0], freePositions(st.roster)[0]) : kind;
    return place(st, data, p.id, slot);
  }
  return autoSkip(st, data);
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

describe("配置のルール", () => {
  test("投手と野手の区別はなく、どの選手もどの枠にでも入れられる", () => {
    const data = makeData();
    const st = at(createGame(S(), 1), 2000, "giants");
    const pitcher = pickByName(data, "2000-giants投A");
    const fielder = pickByName(data, "2000-giants野A");
    const all = ["lineup", "bench", "SP", "RP", "CL"];
    assert.deepEqual(openSlots(st, pitcher).map((s) => s.kind), all);
    assert.deepEqual(openSlots(st, fielder).map((s) => s.kind), all);
    // 投手登録の選手を野手で（糸井嘉男・雄平のような転向組）
    const a = place(st, data, pitcher.id, lineupSlot(3, "右"));
    assert.deepEqual(a.roster.lineup, [{ order: 3, pos: "右", pickId: pitcher.id }]);
    // 野手登録の選手を投手で
    const b = place(st, data, fielder.id, "CL");
    assert.deepEqual(b.roster.CL, [fielder.id]);
  });

  test("二刀流の選手も、ほかの選手と同じく1枠だけ", () => {
    const data = makeData({
      extra: { [pairKey(2000, "fighters")]: draft(2000, "fighters", [{ name: "二刀流", twoWay: true }]) },
    });
    const st = at(createGame(S(), 1), 2000, "fighters");
    const p = pickByName(data, "二刀流");
    assert.equal(openSlots(st, p).length, 5);
    const next = place(st, data, p.id, lineupSlot(4, "右"));
    assert.equal(filledCount(next.roster), 1);
    assert.equal(next.history.at(-1).slot, "lineup:4:右");
  });

  test("野手の守備位置は登録ポジションと関係なく自由", () => {
    const data = makeData({
      extra: { [pairKey(2000, "giants")]: draft(2000, "giants", [{ name: "捕手さん", pos: "捕手" }]) },
    });
    const st = at(createGame(S(), 1), 2000, "giants");
    const next = place(st, data, pickByName(data, "捕手さん").id, lineupSlot(6, "遊"));
    assert.equal(next.roster.lineup[0].pos, "遊");
  });

  test("打順と守備位置は重複できない", () => {
    const data = makeData();
    let st = at(createGame(S(), 1), 2000, "giants");
    st = place(st, data, pickByName(data, "2000-giants野A").id, lineupSlot(1, "中"));
    st = at(st, 2000, "tigers");
    const p = pickByName(data, "2000-tigers野A");
    assert.throws(() => place(st, data, p.id, lineupSlot(1, "二")), /1番はもう埋まっています/);
    assert.throws(() => place(st, data, p.id, lineupSlot(2, "中")), /中はもう埋まっています/);
    assert.deepEqual(freeOrders(st.roster), [2, 3, 4, 5, 6, 7, 8, 9]);
    assert.ok(!freePositions(st.roster).includes("中"));
  });

  test("同一人物は2回チームに入れられない", () => {
    const data = makeData({
      extra: {
        [pairKey(2000, "giants")]: draft(2000, "giants", [{ name: "江川", playerKey: "江川" }]),
        [pairKey(2001, "tigers")]: draft(2001, "tigers", [{ name: "江川", playerKey: "江川" }, { name: "別人" }]),
      },
    });
    let st = at(createGame(S(), 1), 2000, "giants");
    st = place(st, data, "2000-giants-01", "SP");
    st = at(st, 2001, "tigers");
    const again = data.picks.get("2001-tigers-01");
    assert.equal(pickableReason(st, again, data), "同じ選手がチームにいます");
    assert.throws(() => place(st, data, again.id, "RP"), /同じ選手/);
    assert.equal(hasPickable(st, data), true); // 別人は取れる
  });

  test("投手の枠が埋まっていても、投手をスタメン・控えに入れられる", () => {
    const data = makeData();
    let st = at(createGame(S(), 1), 2000, "giants");
    st = { ...st, roster: { ...st.roster, SP: ["a", "b", "c"], RP: ["d", "e"], CL: ["f"] } };
    // 存在しない pickId でも、空きの判定は枠の数だけで決まる
    const fakeData = { ...data, picks: new Map([...data.picks, ...["a", "b", "c", "d", "e", "f"].map((k) => [k, { playerKey: k }])]) };
    const pitcher = pickByName(data, "2000-giants投A");
    assert.equal(pickableReason(st, pitcher, fakeData), null);
    assert.deepEqual(openSlots(st, pitcher).map((s) => s.kind), ["lineup", "bench"]);
    assert.throws(() => place(st, fakeData, pitcher.id, "SP"), GameError);
  });

  test("今のスピンの一覧にいない選手は配置できない", () => {
    const data = makeData();
    const st = at(createGame(S(), 1), 2000, "giants");
    assert.throws(() => place(st, data, pickByName(data, "2000-tigers投A").id, "SP"), /一覧にいません/);
  });

  test("枠の指定が不正ならエラー", () => {
    const data = makeData();
    const st = at(createGame(S(), 1), 2000, "giants");
    assert.throws(() => place(st, data, pickByName(data, "2000-giants投A").id, "XX"), GameError);
  });

  test("配置は元の状態を書き換えない", () => {
    const data = makeData();
    const st = at(createGame(S(), 1), 2000, "giants");
    const before = JSON.stringify(st);
    place(st, data, pickByName(data, "2000-giants投A").id, "SP");
    assert.equal(JSON.stringify(st), before);
  });
});

// ---------------------------------------------------------------------------
// パス・自動スキップ・終了
// ---------------------------------------------------------------------------

describe("パスと自動スキップ", () => {
  test("パスは上限まで使え、0になったらできない", () => {
    const data = makeData();
    let st = createGame(S({ passLimit: 2 }), 3);
    st = pass(spin(st, data), data);
    st = pass(spin(st, data), data);
    assert.equal(passesLeft(st), 0);
    st = spin(st, data);
    assert.throws(() => pass(st, data), /パスはもう残っていません/);
    assert.deepEqual(
      st.history.map((h) => h.action),
      ["pass", "pass"],
    );
  });

  test("配置できる選手がいれば自動スキップはできない", () => {
    const data = makeData();
    const st = spin(createGame(S(), 1), data);
    assert.throws(() => autoSkip(st, data), GameError);
  });

  test("配置できる選手がいなければ（全員がすでにチームにいる）、パスを消費せずに自動スキップできる", () => {
    const data = makeData({
      extra: {
        [pairKey(2000, "giants")]: draft(2000, "giants", [{ name: "江川", playerKey: "江川" }]),
        [pairKey(2001, "tigers")]: draft(2001, "tigers", [{ name: "江川", playerKey: "江川" }]),
      },
    });
    let st = at(createGame(S({ passLimit: 0 }), 1), 2000, "giants");
    st = place(st, data, "2000-giants-01", "SP");
    st = at(st, 2001, "tigers");
    const d2 = data;
    assert.equal(hasPickable(st, d2), false);
    const next = autoSkip(st, d2);
    assert.equal(next.passesUsed, 0);
    assert.equal(next.current, null);
    assert.equal(next.history.at(-1).action, "skip");
  });
});

describe("終了条件", () => {
  test("17枠が埋まると完成し、それ以上スピンできない", () => {
    const data = makeData();
    let st = createGame(S({ passLimit: 0 }), 11);
    while (st.status !== "complete" && st.status !== "stuck") {
      st = autoSkipOrPlace(spin(st, data), data);
    }
    assert.equal(st.status, "complete");
    assert.equal(isComplete(st), true);
    assert.equal(filledCount(st.roster), TOTAL_SLOTS);
    assert.throws(() => spin(st, data), GameError);
  });

  test("抽選できるペアがなくなって埋まらなければ「未完成で終了」", () => {
    // 17ペアだけのデータで1回パスすると、16ペアでは17枠を埋められない
    const data = makeData({ years: [2000, 2001] });
    const only17 = indexData({
      meta: {},
      franchises: FRANCHISES,
      drafts: [...data.pairList].slice(0, 17),
    });
    let st = createGame(S({ passLimit: 1 }), 5);
    st = pass(spin(st, only17), only17);
    while (st.status === "playing") {
      st = autoSkipOrPlace(spin(st, only17), only17);
    }
    assert.equal(st.status, "stuck");
    assert.equal(isStuck(st, only17), true);
    assert.equal(filledCount(st.roster), 16);
  });
});

// ---------------------------------------------------------------------------
// 保存と共有
// ---------------------------------------------------------------------------

describe("保存と共有", () => {
  test("JSON にして戻しても同じ状態になる", () => {
    const data = makeData();
    let st = createGame(S(), 8);
    st = autoSkipOrPlace(spin(st, data), data);
    st = spin(st, data);
    const restored = restoreState(JSON.parse(JSON.stringify(st)), data);
    assert.deepEqual(restored, st);
  });

  test("壊れた状態やデータにない選手を含む状態は捨てる", () => {
    const data = makeData();
    assert.equal(restoreState(null, data), null);
    assert.equal(restoreState({ version: 999 }, data), null);
    const st = createGame(S(), 1);
    const bad = { ...st, roster: { ...st.roster, SP: ["存在しない"] } };
    assert.equal(restoreState(bad, data), null);
  });

  test("答え合わせで選び直した年度は、保存して戻しても残る（チームにいない選手の分は捨てる）", () => {
    const data = makeData();
    let st = createGame(S({ passLimit: 1 }), 21);
    while (st.status !== "complete" && st.status !== "stuck") st = autoSkipOrPlace(spin(st, data), data);
    const [first, second] = rosterPickIds(st.roster);
    assert.throws(() => setCareerYear(st, "存在しない", 2000), GameError);
    assert.throws(() => setCareerYear(st, first, "2000"), GameError);
    let changed = setCareerYear(st, first, 2003);
    changed = setCareerYear(changed, second, 1999);
    changed = setCareerYear(changed, second, null);
    assert.deepEqual(changed.careerYears, { [first]: 2003 });
    assert.deepEqual(st.careerYears, {}, "元の状態は書き換えない");
    assert.deepEqual(teamSnapshot(changed, data).careerYears, { [first]: 2003 });
    const raw = JSON.parse(JSON.stringify({ ...changed, careerYears: { ...changed.careerYears, ghost: 2001, [second]: "x" } }));
    assert.deepEqual(restoreState(raw, data).careerYears, { [first]: 2003 });
    const old = JSON.parse(JSON.stringify(st));
    delete old.careerYears; // Beta v1.5 までの保存データ
    assert.deepEqual(restoreState(old, data).careerYears, {});
  });

  test("テキストは仕様書の形式", () => {
    const data = makeData();
    let st = createGame(S({ passLimit: 1 }), 21);
    st = pass(spin(st, data), data);
    while (st.status === "playing") st = autoSkipOrPlace(spin(st, data), data);
    const text = buildShareText(teamSnapshot(st, data));
    const lines = text.split("\n");
    assert.equal(lines[0], "【ドラフトルーレット】");
    assert.equal(lines.length, 1 + 9 + 4 + 1);
    assert.match(lines[1], /^1 \S+ \S+ '0[01] \S+ \d+位$/);
    assert.match(lines[10], /^控え \S+ \/ \S+$/);
    assert.match(lines[11], /^先発 \S+ \/ \S+ \/ \S+$/);
    assert.match(lines[12], /^中継ぎ \S+ \/ \S+$/);
    assert.match(lines[13], /^抑え \S+$/);
    assert.equal(lines[14], `スピン${st.usedPairs.length}回・パス1回`);
  });

  test("当時の略称", () => {
    assert.equal(eraShort("北海道日本ハムファイターズ"), "日本ハム");
    assert.equal(eraShort("大阪近鉄バファローズ"), "近鉄");
    assert.equal(eraShort("東北楽天ゴールデンイーグルス"), "楽天");
    assert.equal(eraShort("未知の球団", "スロット名"), "スロット名");
  });
});

// ---------------------------------------------------------------------------
// 実データでの通しプレイ
// ---------------------------------------------------------------------------

describe("実データ（data/drafts.json）", () => {
  const json = JSON.parse(readFileSync(new URL("../data/drafts.json", import.meta.url), "utf8"));
  const data = indexData(json);

  test("初期設定の対象ペアは731（1978年の巨人はない）", () => {
    const st = createGame({}, 1);
    const pairs = availablePairs(st, data);
    assert.equal(pairs.length, 731);
    assert.ok(!pairs.some((d) => d.year === 1978 && d.franchiseId === "giants"));
  });

  test("ランダムに300ゲーム遊んでもルールが守られる", () => {
    for (let g = 0; g < 300; g++) {
      const rnd = createRng(`agent-${g}`);
      const yearFrom = 1965 + Math.floor(rnd() * 55);
      const settings = {
        yearFrom,
        yearTo: Math.min(2025, yearFrom + 2 + Math.floor(rnd() * 20)),
        passLimit: Math.floor(rnd() * 4),
        includeIkusei: rnd() < 0.5,
        includeUnsigned: rnd() < 0.5,
      };
      let st = createGame(settings, g);
      if (!canStart(st.settings, data).ok) continue;
      let guard = 0;
      while (st.status === "setup" || st.status === "playing") {
        assert.ok(guard++ < 1000, "終わらない");
        st = spin(st, data);
        if (st.status === "stuck") break;
        const ok = currentPicks(st, data).filter((p) => !pickableReason(st, p, data));
        if (ok.length === 0) {
          st = autoSkip(st, data);
        } else if (passesLeft(st) > 0 && rnd() < 0.2) {
          st = pass(st, data);
        } else {
          const p = ok[Math.floor(rnd() * ok.length)];
          const slots = openSlots(st, p);
          const kind = slots[Math.floor(rnd() * slots.length)].kind;
          const orders = freeOrders(st.roster);
          const poss = freePositions(st.roster);
          const slot =
            kind === "lineup"
              ? lineupSlot(orders[Math.floor(rnd() * orders.length)], poss[Math.floor(rnd() * poss.length)])
              : kind;
          st = place(st, data, p.id, slot);
        }
      }
      // 不変条件
      const ids = rosterPickIds(st.roster);
      const keys = ids.map((id) => data.picks.get(id).playerKey);
      assert.equal(new Set(keys).size, keys.length, "同一人物が2回いる");
      assert.equal(new Set(st.usedPairs).size, st.usedPairs.length, "同じペアが2回出た");
      assert.equal(new Set(st.roster.lineup.map((e) => e.order)).size, st.roster.lineup.length);
      assert.equal(new Set(st.roster.lineup.map((e) => e.pos)).size, st.roster.lineup.length);
      assert.ok(st.passesUsed <= st.settings.passLimit);
      for (const [kind, size] of Object.entries({ lineup: 9, bench: 2, SP: 3, RP: 2, CL: 1 })) {
        assert.ok(st.roster[kind].length <= size, `${kind} が定員を超えている`);
      }
      for (const id of ids) {
        const p = data.picks.get(id);
        if (!st.settings.includeIkusei) assert.notEqual(p.draftType, "ikusei");
        if (!st.settings.includeUnsigned) assert.equal(p.signed, true);
      }
      assert.ok(st.status === "complete" || st.status === "stuck");
      assert.equal(st.history.length, st.usedPairs.length);
    }
  });
});
