// 簡易 WAR（js/war.js）とリーグのデータ（data/leagues.json）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { battingWar, fmtWar, leagueContext, leagueOf, pitchingWar, positionFromProfile, positionRunsPerGame, reliefLeverage } from "../js/war.js";
import { rowObject } from "../js/stats.js";

const leagues = JSON.parse(readFileSync(new URL("../data/leagues.json", import.meta.url), "utf8"));
const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const { battingColumns: BAT, pitchingColumns: PIT } = players.meta;
const batRow = (key, year) => rowObject(players.players[key].batting.find((r) => r[0] === year), BAT);
const pitRow = (key, year) => rowObject(players.players[key].pitching.find((r) => r[0] === year), PIT);
const bwar = (key, year) => battingWar(batRow(key, year), leagues, players.players[key]);
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
});
