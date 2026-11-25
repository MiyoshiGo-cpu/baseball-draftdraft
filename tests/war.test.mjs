// 簡易 WAR（js/war.js）とリーグのデータ（data/leagues.json）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  battingWar,
  battingWarParts,
  fieldingBaseline,
  fieldingRuns,
  fmtWar,
  fmtWarSigned,
  leagueContext,
  leagueOf,
  pitchingWar,
  positionFromProfile,
  positionRunsPerGame,
  reliefLeverage,
  wobaScale,
} from "../js/war.js";
import { rowObject } from "../js/stats.js";

const leagues = JSON.parse(readFileSync(new URL("../data/leagues.json", import.meta.url), "utf8"));
const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const { battingColumns: BAT, pitchingColumns: PIT } = players.meta;
const batRow = (key, year) => rowObject(players.players[key].batting.find((r) => r[0] === year), BAT);
const pitRow = (key, year) => rowObject(players.players[key].pitching.find((r) => r[0] === year), PIT);
const bwar = (key, year) => battingWar(batRow(key, year), leagues, players.players[key], players);
const parts = (key, year) => battingWarParts(batRow(key, year), leagues, players.players[key], players);
const fieldRow = (key, year, pos) => {
  const cols = players.meta.fieldingColumns;
  const arr = players.players[key].fieldingYears.find((r) => r[0] === year && r[2] === pos);
  return Object.fromEntries(cols.map((c, i) => [c, arr[i]]));
};
const pwar = (key, year) => pitchingWar(pitRow(key, year), leagues);

test("リーグのデータ：1965〜2026年のセ・パがそろっている", () => {
  for (let y = 1965; y <= 2026; y++) {
    for (const lg of ["C", "P"]) {
      const x = leagues.leagues[y]?.[lg];
      assert.ok(x, `${y} ${lg} がない`);
      assert.equal(x.teams, 6);
      assert.ok(x.games >= 120 && x.games <= 146, `${y} ${lg} 試合数 ${x.games}`);
      for (const k of ["AB", "R", "H", "2B", "3B", "HR", "BB", "HBP", "SF"]) assert.ok(x.bat[k] > 0, `${y} ${lg} ${k}`);
      for (const k of ["outs", "ER", "R"]) assert.ok(x.pit[k] > 0, `${y} ${lg} 投手 ${k}`);
      assert.equal(Boolean(x.estimated), y < 2005, "2005年より前の四球などは推定");
    }
  }
  // 公式の値（1975年セ・リーグの得点の合計）
  assert.equal(leagues.leagues[1975].C.bat.R, 2902);
});

test("球団 → リーグ", () => {
  assert.equal(leagueOf("巨人"), "C");
  assert.equal(leagueOf("DeNA"), "C");
  assert.equal(leagueOf("阪急 オリックス"), "P");
  assert.equal(leagueOf("ソフトバンク"), "P");
});

test("基準値：1勝に必要な得点は打高の年ほど大きい", () => {
  const low = leagueContext(leagues, 2011, "C"); // 統一球の年
  const high = leagueContext(leagues, 1985, "P");
  assert.ok(low.rpw < high.rpw);
  assert.ok(low.lgWoba < high.lgWoba);
  assert.ok(low.rpw > 6 && high.rpw < 12);
  assert.equal(leagueContext(leagues, 1900, "C"), null);
});

test("守備位置の補正：捕手は加点、一塁は減点。守備成績がなければプロフィールの守備位置", () => {
  assert.ok(positionRunsPerGame({ fielding: { 捕手: 1000 } }) > 0);
  assert.ok(positionRunsPerGame({ fielding: { 一塁: 1000 } }) < 0);
  assert.equal(positionRunsPerGame({ fielding: { 投手: 300 } }), 0);
  assert.equal(positionFromProfile("投手→外野手"), "外野");
  assert.equal(positionFromProfile("捕手"), "捕手");
  assert.equal(positionFromProfile("内野手"), "内野");
  assert.ok(positionRunsPerGame({ profile: { position: "捕手" } }) > 0);
});

test("実データ：MVP 級の年は高く、控えの年は低い", () => {
  assert.ok(bwar("松井秀喜", 2002) > 9);
  assert.ok(bwar("鈴木一朗", 1995) > 6);
  assert.ok(bwar("村上宗隆", 2022) > 10 && bwar("村上宗隆", 2022) < 15);
  assert.ok(pwar("田中将大", 2013) > 7);
  assert.ok(pwar("ダルビッシュ有", 2011) > 6);
  const closer = pwar("岩瀬仁紀", 2005);
  assert.ok(closer > 1.5 && closer < 4.5, `岩瀬 2005: ${closer}`);
  // 時代の補正：同じ防御率でも、打高の年のほうが価値が高い
  const base = { year: 0, team: "巨人", G: 28, GS: 28, IP: "180.0", ER: 50, SV: 0, HLD: 0 };
  assert.ok(pitchingWar({ ...base, year: 1985 }, leagues) > pitchingWar({ ...base, year: 2011 }, leagues));
});

test("救援の重み：抑えは重く、先発は 1", () => {
  assert.equal(reliefLeverage({ G: 28, GS: 28 }), 1);
  assert.ok(reliefLeverage({ G: 60, GS: 0, SV: 45, HLD: 2 }) > 1.35);
  assert.ok(reliefLeverage({ G: 50, GS: 0, SV: 0, HLD: 5 }) < 1.1);
  assert.equal(reliefLeverage({ G: 50, GS: 0, SV: null, HLD: null }), 1.15, "記録がない時代は中くらい");
});

test("表示の形", () => {
  assert.equal(fmtWar(7.25), "7.3");
  assert.equal(fmtWar(-0.04), "0.0");
  assert.equal(fmtWar(-1.26), "-1.3");
  assert.equal(fmtWar(null), "-");
  assert.equal(fmtWarSigned(1.23), "+1.2");
  assert.equal(fmtWarSigned(-0.44), "-0.4");
});

test("点が入りにくい年ほど、wOBA の差を得点に直す割る数が大きい", () => {
  assert.ok(wobaScale(0.1) > wobaScale(0.13));
  assert.ok(Math.abs(wobaScale(0.122) - 1.2) < 1e-9);
  assert.ok(leagueContext(leagues, 2011, "C").wobaScale > leagueContext(leagues, 1985, "P").wobaScale);
});

test("走塁：盗塁が多く盗塁死が少ないほどプラス", () => {
  const ctx = leagueContext(leagues, 2005, "C");
  assert.ok(ctx.runCS < -0.3 && ctx.runCS > -0.6);
  const base = { year: 2005, team: "阪神", G: 140, AB: 500, H: 150, "2B": 20, "3B": 5, HR: 1, BB: 50, HBP: 2, SF: 3 };
  const runner = battingWarParts({ ...base, SB: 60, CS: 10 }, leagues);
  const slow = battingWarParts({ ...base, SB: 0, CS: 0 }, leagues);
  const caught = battingWarParts({ ...base, SB: 10, CS: 15 }, leagues);
  assert.ok(runner.baserunning > 4, `60盗塁: ${runner.baserunning}`);
  assert.ok(slow.baserunning < 0);
  assert.ok(caught.baserunning < slow.baserunning);
  // 盗塁死の記録がない行は、リーグ平均の割合で失敗したとみなす
  const unknown = battingWarParts({ ...base, SB: 30, CS: null }, leagues);
  assert.ok(unknown.baserunning < battingWarParts({ ...base, SB: 30, CS: 0 }, leagues).baserunning);
});

test("守備：同じ年・同じ位置の平均と比べ、名手はプラス", () => {
  const ss = fieldingBaseline(players, 2010, "遊撃");
  assert.ok(ss.A > 2.5 && ss.A < 4, `遊撃の1試合あたりの補殺 ${ss.A}`);
  assert.ok(ss.err > 0 && ss.err < 0.05);
  assert.ok(fieldingBaseline(players, 2000, "捕手").cs > 0.2);
  assert.ok(fieldingRuns(fieldRow("菊池涼介", 2014, "二塁"), players) > 5, "菊池 2014（補殺の記録の年）");
  assert.ok(fieldingRuns(fieldRow("古田敦也", 1993, "捕手"), players) > 3, "古田 1993（盗塁阻止率 .644）");
  // 平均的な成績なら 0 に近く、上限は ±15点
  const avg = { year: 2010, team: "巨人", pos: "遊撃", G: 143, A: ss.A * 143, PO: ss.PO * 143, DP: ss.DP * 143 };
  avg.E = (ss.err * (avg.PO + avg.A)) / (1 - ss.err);
  assert.ok(Math.abs(fieldingRuns(avg, players)) < 0.5);
  assert.equal(fieldingRuns({ ...avg, A: avg.A + 400 }, players), 15);
  assert.equal(fieldingRuns({ year: 2010, team: "巨人", pos: "投手", G: 50 }, players), 0, "投手の守備は数えない");
});

test("実データ：WAR の内訳（打撃・走塁・守備・守備位置）", () => {
  const p = parts("坂本勇人", 2016);
  assert.ok(p.batting > 30 && p.fielding > 0 && p.position > 0, JSON.stringify(p));
  const total = p.batting + p.baserunning + p.fielding + p.position + p.replacement;
  assert.ok(Math.abs(total / p.rpw - p.war) < 1e-9);
  // 守備位置はその年に守った位置で：坂本 2016 は遊撃なので加点、筒香 2016 は外野なので減点
  assert.ok(parts("筒香嘉智", 2016).position < 0);
  // 守備の平均がないとき（playersJson なし）は守備 0
  assert.equal(battingWarParts(batRow("坂本勇人", 2016), leagues, players.players["坂本勇人"]).fielding, 0);
});
