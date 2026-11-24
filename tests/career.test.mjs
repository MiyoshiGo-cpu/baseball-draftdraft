// キャリアハイと総合力（js/career.js）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PLAYER_RANKS,
  TEAM_RANKS,
  autoSeason,
  battingSeasons,
  careerTeam,
  pitchingSeasons,
  playerSeasons,
  qualifyingPA,
  rankOf,
  seasonGames,
  seasonScore,
  statLine,
  statText,
} from "../js/career.js";
import { teamForYear } from "../js/stats.js";

const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));

const bat = (o) => ({ G: 0, PA: 0, AB: 0, R: 0, H: 0, "2B": 0, "3B": 0, HR: 0, TB: 0, RBI: 0, SB: 0, BB: 0, HBP: 0, SO: 0, SF: 0, lead: new Set(), ...o });
const pit = (o) => ({ G: 0, GS: 0, CG: 0, SHO: 0, W: 0, L: 0, SV: null, HLD: null, IP: "0.0", H: 0, HR: 0, BB: 0, HBP: 0, SO: 0, ER: 0, lead: new Set(), ...o });

test("試合数と規定打席の目安", () => {
  assert.equal(seasonGames(1970), 130);
  assert.equal(seasonGames(2014), 144);
  assert.equal(seasonGames(2020), 120);
  assert.equal(seasonGames(2024), 143);
  assert.equal(qualifyingPA(2014), 446);
  assert.equal(qualifyingPA(1970), 403);
});

test("球団名は年度に合わせる（阪急 オリックス → 1988年は阪急、1989年はオリックス）", () => {
  assert.equal(teamForYear("阪急 オリックス", 1988), "阪急");
  assert.equal(teamForYear("阪急 オリックス", 1989), "オリックス");
  assert.equal(teamForYear("東映 日拓 日本ハム", 1973), "日拓");
  assert.equal(teamForYear("西鉄 太平洋 クラウン 西武", 1980), "西武");
  assert.equal(teamForYear("巨人", 2000), "巨人");
  assert.equal(teamForYear("青宝 謎球団", 2000), "謎球団", "知らない名前なら最後の名前");
});

test("シーズン途中の移籍は1年にまとめ、打率は合計から計算し直す", () => {
  const seasons = battingSeasons([
    bat({ year: 2014, team: "オリックス", G: 2, PA: 1, AB: 1, H: 0, AVG: 0 }),
    bat({ year: 2014, team: "中日", G: 29, PA: 41, AB: 36, H: 9, TB: 12, BB: 4, AVG: 0.25 }),
    bat({ year: 2015, team: "中日", G: 10, PA: 20, AB: 18, H: 6, TB: 6, AVG: 0.333, OPS: 0.7 }),
  ]);
  assert.equal(seasons.length, 2);
  assert.equal(seasons[0].team, "オリックス・中日");
  assert.equal(seasons[0].G, 31);
  assert.equal(seasons[0].AVG, 9 / 37);
  assert.equal(seasons[1].AVG, 0.333, "1行だけなら記事の値");
  assert.equal(seasons[1].OPS, 0.7);
});

test("打者：規定打席に届いた年の中で OPS が最も高い年", () => {
  const seasons = [
    bat({ year: 2010, PA: 500, OPS: 0.8, HR: 20 }),
    bat({ year: 2011, PA: 100, OPS: 1.2, HR: 10 }), // 打席が少ない
    bat({ year: 2012, PA: 450, OPS: 0.9, HR: 25 }),
  ];
  assert.equal(autoSeason(seasons, "lineup").year, 2012);
  assert.equal(autoSeason(seasons, "bench").year, 2012);
  // 規定打席に届いた年がなければ打席が最も多い年
  assert.equal(autoSeason([bat({ year: 2001, PA: 50, OPS: 1.0 }), bat({ year: 2002, PA: 120, OPS: 0.5 })], "lineup").year, 2002);
  assert.equal(autoSeason([], "lineup"), null);
});

test("先発は勝利数、抑えはセーブ、中継ぎはセーブ＋ホールド（記録がない時代は登板数）", () => {
  const ps = pitchingSeasons([
    pit({ year: 2005, G: 60, W: 3, SV: 40, HLD: 2, IP: "60.0", ER: 15 }),
    pit({ year: 2006, G: 70, W: 6, SV: 1, HLD: 35, IP: "70.0", ER: 10 }),
    pit({ year: 2007, G: 25, GS: 25, W: 12, SV: 0, HLD: 0, IP: "150.0", ER: 50 }),
    pit({ year: 2008, G: 25, GS: 25, W: 12, SV: 0, HLD: 0, IP: "160.0", ER: 40 }),
  ]);
  assert.equal(autoSeason(ps, "SP").year, 2008, "勝利数が同じなら防御率が低い年");
  assert.equal(autoSeason(ps, "CL").year, 2005);
  assert.equal(autoSeason(ps, "RP").year, 2005, "40+2 > 1+35");
  const old = pitchingSeasons([pit({ year: 1966, G: 40, IP: "100.0", ER: 30 }), pit({ year: 1967, G: 55, IP: "90.0", ER: 30 })]);
  assert.equal(autoSeason(old, "CL").year, 1967);
  assert.equal(autoSeason(old, "RP").year, 1967);
});

test("実データ：よく知られたキャリアハイを選ぶ", () => {
  const auto = (key, kind) => autoSeason(playerSeasons(players, key, kind === "lineup" ? "bat" : "pit"), kind);
  assert.equal(auto("松井秀喜", "lineup").year, 2002);
  assert.equal(auto("糸井嘉男", "lineup").year, 2014);
  const tanaka = auto("田中将大", "SP");
  assert.equal(tanaka.year, 2013);
  assert.equal(statText(tanaka, "SP").split(" ")[0], "24勝0敗");
  assert.equal(auto("岩瀬仁紀", "CL").SV, 46);
  assert.equal(auto("浅尾拓也", "RP").HLD, 45);
  // 投手成績がない選手を投手の枠に入れても落ちない
  assert.equal(auto("松井秀喜", "SP"), null);
});

test("点数：大活躍の年は高く、出場が少ない年は低い", () => {
  const strong = bat({ year: 2002, PA: 600, OPS: 1.15 });
  const small = bat({ year: 2002, PA: 30, OPS: 1.15 });
  assert.equal(seasonScore(strong, "lineup"), 100);
  assert.ok(seasonScore(small, "lineup") < 50);
  assert.equal(seasonScore(null, "SP"), 0);
  assert.equal(rankOf(95, PLAYER_RANKS), "S");
  assert.equal(rankOf(60, PLAYER_RANKS), "B");
  assert.equal(rankOf(66, TEAM_RANKS), "S");
  assert.equal(rankOf(10, TEAM_RANKS), "E");
});

test("表示：リーグ1位の成績に印が付く", () => {
  const s = bat({ year: 2014, PA: 590, AVG: 0.331, HR: 19, RBI: 81, SB: 31, OPS: 0.948, lead: new Set(["AVG"]) });
  const parts = statLine(s, "lineup");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["打率.331", "19本", "81打点", "31盗塁", "OPS.948"],
  );
  assert.equal(parts[0].lead, true);
  assert.equal(parts[1].lead, false);
});

const pickOf = (pickId, playerKey) => ({ pickId, playerKey, name: playerKey });

function snapshotWith(players_) {
  const [l1, l2, sp, cl] = players_;
  return {
    lineup: Array.from({ length: 9 }, (_, i) => ({ order: i + 1, field: null, player: i === 0 ? l1 : i === 1 ? l2 : null })),
    bench: [null, null],
    SP: [sp, null, null],
    RP: [null, null],
    CL: [cl],
  };
}

test("チームの答え合わせ：年度の選び直し、空き枠、合計", () => {
  const snap = snapshotWith([
    pickOf("a", "松井秀喜"),
    pickOf("b", "糸井嘉男"),
    pickOf("c", "田中将大"),
    pickOf("d", "岩瀬仁紀"),
  ]);
  const r = careerTeam(snap, players);
  assert.equal(r.slots.length, 17);
  assert.equal(r.complete, false);
  const matsui = r.slots[0];
  assert.equal(matsui.year, 2002);
  assert.equal(matsui.auto, true);
  assert.equal(r.slots[2].score, 0, "空き枠は0点");
  assert.equal(r.sums.HR, 50 + 19);
  assert.equal(r.sums.W, 24 + 1);
  assert.ok(r.total.score > 0 && r.total.score < r.batting.score + r.pitching.score);

  // 1996年を選び直す（知らない年は自動のまま）
  const r2 = careerTeam({ ...snap, careerYears: { a: 1996, b: 1900 } }, players);
  assert.equal(r2.slots[0].year, 1996);
  assert.equal(r2.slots[0].auto, false);
  assert.equal(r2.slots[0].autoYear, 2002);
  assert.equal(r2.slots[1].year, 2014);
  assert.equal(r2.slots[1].auto, true);
  assert.ok(r2.slots[0].score <= matsui.score);
});

test("共有テキストの最後に総合力の行が付く", async () => {
  const { buildShareText, ratingText } = await import("../js/share.js");
  const snap = {
    ...snapshotWith([pickOf("a", "松井秀喜"), pickOf("b", "糸井嘉男"), pickOf("c", "田中将大"), pickOf("d", "岩瀬仁紀")]),
    spins: 20,
    passes: 1,
    complete: false,
  };
  for (const row of snap.lineup) if (row.player) Object.assign(row.player, { year: 2000, teamName: "読売ジャイアンツ", roundLabel: "1位" });
  for (const p of [snap.SP[0], snap.CL[0]]) Object.assign(p, { year: 2000, teamName: "読売ジャイアンツ", roundLabel: "1位" });
  const r = careerTeam(snap, players);
  const lines = buildShareText(snap, () => "", r).split("\n");
  assert.equal(lines.at(-1), ratingText(r));
  assert.match(lines.at(-1), /^総合力 [SABCDE]（\d+点）打線 \d+・投手陣 \d+$/);
  assert.equal(buildShareText(snap).split("\n").length, lines.length - 1, "答え合わせがなければ今までどおり");
});
