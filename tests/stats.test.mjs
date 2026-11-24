// 成績の計算（js/stats.js）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  battingTotals,
  fmtEra,
  fmtRate,
  ipToOuts,
  outsToIp,
  pitchingTotals,
  positionGames,
  rowObject,
  throwsBats,
} from "../js/stats.js";

const BAT = ["year", "team", "G", "PA", "AB", "R", "H", "2B", "3B", "HR", "TB", "RBI", "SB", "BB", "HBP", "SO", "SF", "AVG", "OBP", "SLG", "OPS"];
const PIT = ["year", "team", "G", "GS", "CG", "SHO", "W", "L", "SV", "HLD", "IP", "H", "HR", "BB", "HBP", "SO", "ER", "ERA", "WHIP"];

test("配列の行をオブジェクトにし、リーグ1位の列を読み取る", () => {
  const r = rowObject([2014, "オリックス", 140, 590, 502, 73, 166, 36, 2, 19, 263, 81, 31, 70, 14, 73, 4, 0.331, 0.424, 0.524, 0.948, [17, 18]], BAT);
  assert.equal(r.year, 2014);
  assert.equal(r.AVG, 0.331);
  assert.deepEqual([...r.lead], ["AVG", "OBP"]);
  const plain = rowObject([2015, "オリックス", 1], BAT);
  assert.equal(plain.lead.size, 0);
});

test("投球回とアウト数の変換（.1 は 1/3 回）", () => {
  assert.equal(ipToOuts("181.0"), 543);
  assert.equal(ipToOuts("206.2"), 620);
  assert.equal(ipToOuts(null), 0);
  assert.equal(outsToIp(620), "206.2");
  assert.equal(outsToIp(ipToOuts("61.1") + ipToOuts("0.2")), "62.0");
});

test("打撃の通算：打率・出塁率・長打率は合計から計算する", () => {
  const rows = [
    { year: 2001, G: 100, PA: 400, AB: 350, H: 100, TB: 150, BB: 40, HBP: 5, SF: 5, HR: 10, RBI: 50, SB: 5 },
    { year: 2002, G: 120, PA: 500, AB: 450, H: 150, TB: 250, BB: 40, HBP: 5, SF: 5, HR: 30, RBI: 90, SB: 2 },
  ].map((r) => ({ ...r, lead: new Set() }));
  const t = battingTotals(rows);
  assert.equal(t.G, 220);
  assert.equal(t.HR, 40);
  assert.equal(t.seasons, 2);
  assert.equal(fmtRate(t.AVG), ".313"); // 250/800
  assert.equal(fmtRate(t.OBP), ".378"); // (250+80+10)/(800+80+10+10) = 340/900
  assert.equal(fmtRate(t.SLG), ".500"); // 400/800
});

test("投手の通算：防御率と WHIP は合計の投球回から計算する", () => {
  const rows = [
    { year: 1966, G: 33, W: 16, L: 2, IP: "181.0", H: 125, BB: 69, ER: 28, SO: 117 },
    { year: 1967, G: 23, W: 12, L: 2, IP: "149.0", H: 126, BB: 59, ER: 36, SO: 82 },
  ];
  const t = pitchingTotals(rows);
  assert.equal(t.W, 28);
  assert.equal(t.IP, "330.0");
  assert.equal(fmtEra(t.ERA), "1.75"); // 64*9/330
  assert.equal(fmtEra(t.WHIP), "1.15"); // (125+126+69+59)/330 = 379/330
  assert.equal(t.SV, null, "セーブの記録がない時代だけなら null");
  assert.equal(pitchingTotals([{ year: 2010, SV: 30, HLD: null }, { year: 2011, SV: 10 }]).SV, 40);
});

test("表示の形", () => {
  assert.equal(fmtRate(0.3), ".300");
  assert.equal(fmtRate(1.153), "1.153");
  assert.equal(fmtRate(null), "-");
  assert.equal(fmtEra(1.385), "1.39");
  assert.equal(throwsBats({ throws: "右", bats: "左" }), "右投左打");
  assert.equal(throwsBats({ throws: "右", bats: "両" }), "右投両打");
});

test("守れるポジションは試合数の多い順", () => {
  assert.deepEqual(positionGames({ fielding: { 遊撃: 9, 外野: 68, 投手: 34, 二塁: 0 } }), [
    { pos: "外野", games: 68 },
    { pos: "投手", games: 34 },
    { pos: "遊撃", games: 9 },
  ]);
  assert.deepEqual(positionGames({}), []);
  assert.deepEqual(positionGames({}, 560), [{ pos: "投手", games: 560 }], "守備成績がない投手は登板数");
});
