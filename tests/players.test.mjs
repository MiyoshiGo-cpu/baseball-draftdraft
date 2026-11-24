// 選手データ（data/players.json）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { battingTotals, pitchingTotals, positionGames, rowObject } from "../js/stats.js";

const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const drafts = JSON.parse(readFileSync(new URL("../data/drafts.json", import.meta.url), "utf8"));
const { battingColumns: BAT, pitchingColumns: PIT } = data.meta;
const bat = (key) => (data.players[key]?.batting || []).map((r) => rowObject(r, BAT));
const pit = (key) => (data.players[key]?.pitching || []).map((r) => rowObject(r, PIT));

test("形式：出典・列名・選手の記事名がそろっている", () => {
  assert.equal(data.meta.license, "CC BY-SA 4.0");
  assert.ok(BAT.includes("AVG") && BAT.includes("HR") && PIT.includes("ERA") && PIT.includes("IP"));
  const players = Object.values(data.players);
  assert.ok(players.length > 4000, `選手が少なすぎる: ${players.length}`);
  for (const p of players) {
    assert.ok(p.title, "記事名がない");
    for (const r of p.batting || []) assert.ok(r.length === BAT.length || r.length === BAT.length + 1);
    for (const r of p.pitching || []) assert.ok(r.length === PIT.length || r.length === PIT.length + 1);
  }
});

test("選手のキーは drafts.json の playerKey と一致する", () => {
  const keys = new Set(drafts.drafts.flatMap((d) => d.picks.map((p) => p.playerKey)));
  for (const key of Object.keys(data.players)) assert.ok(keys.has(key), `${key} が drafts.json にない`);
});

test("糸井嘉男：投手から外野手に転向。2014年の打率 .331 はリーグ1位", () => {
  const p = data.players["糸井嘉男"];
  assert.match(p.profile.position, /投手.*外野手/);
  assert.equal(pit("糸井嘉男").length, 0);
  const y2014 = bat("糸井嘉男").find((r) => r.year === 2014);
  assert.equal(y2014.AVG, 0.331);
  assert.ok(y2014.lead.has("AVG"));
  assert.equal(positionGames(p)[0].pos, "外野");
});

test("堀内恒夫：1966年に16勝・防御率1.39", () => {
  const y = pit("堀内恒夫").find((r) => r.year === 1966);
  assert.equal(y.W, 16);
  assert.equal(y.ERA, 1.39);
  assert.ok(pitchingTotals(pit("堀内恒夫")).W >= 200);
});

test("松井秀喜：NPB の一軍成績だけ（MLB の年は入れない）", () => {
  const rows = bat("松井秀喜");
  assert.ok(rows.every((r) => r.year <= 2002));
  assert.equal(rows.find((r) => r.year === 2002).HR, 50);
  assert.equal(battingTotals(rows).HR, 332);
});

test("雄平（高井雄平として指名）：投手と外野手の両方の記録がある", () => {
  const p = data.players["高井雄平"];
  assert.equal(p.title, "雄平");
  assert.ok(pit("高井雄平").length > 0 && bat("高井雄平").length > 0);
  assert.ok(p.fielding["外野"] > p.fielding["投手"]);
});

test("セーブとホールド（縦書きの見出し「セ丨ブ」「ホ丨ルド」）を読み取れている", () => {
  assert.equal(pit("岩瀬仁紀").find((r) => r.year === 2005).SV, 46);
  assert.equal(pit("浅尾拓也").find((r) => r.year === 2011).HLD, 45);
  assert.equal(pit("江夏豊").find((r) => r.year === 1968).SV, null, "セーブの記録がない時代");
  assert.equal(bat("糸井嘉男").find((r) => r.year === 2014).team, "オリックス");
});
