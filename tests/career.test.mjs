// キャリアハイと総合力（js/career.js）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PLAYER_RANKS,
  RELIEF_RANKS,
  REPLACEMENT_WINS,
  TEAM_RANKS,
  autoSeason,
  battingSeasons,
  careerSummary,
  careerTeam,
  pitchingSeasons,
  playerSeasons,
  qualifyingPA,
  rankOf,
  seasonGames,
  seasonValue,
  slotWar,
  statLine,
  statText,
} from "../js/career.js";
import { teamForYear } from "../js/stats.js";

const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
const leagues = JSON.parse(readFileSync(new URL("../data/leagues.json", import.meta.url), "utf8"));

const bat = (o) => ({ G: 0, PA: 0, AB: 0, R: 0, H: 0, "2B": 0, "3B": 0, HR: 0, TB: 0, RBI: 0, SB: 0, BB: 0, HBP: 0, SO: 0, SF: 0, lead: new Set(), ...o });
const pit = (o) => ({ G: 0, GS: 0, CG: 0, SHO: 0, W: 0, L: 0, SV: null, HLD: null, IP: "0.0", H: 0, HR: 0, BB: 0, HBP: 0, SO: 0, ER: 0, lead: new Set(), ...o });
const seasons = (key, kind) => playerSeasons(players, key, kind === "lineup" || kind === "bench" ? "bat" : "pit", leagues);
const auto = (key, kind) => autoSeason(seasons(key, kind), kind);

test("試合数と規定打席の目安", () => {
  assert.equal(seasonGames(1970), 130);
  assert.equal(seasonGames(2014), 144);
  assert.equal(seasonGames(2020), 120);
  assert.equal(qualifyingPA(2014), 446);
});

test("球団名は年度に合わせる（阪急 オリックス → 1988年は阪急、1989年はオリックス）", () => {
  assert.equal(teamForYear("阪急 オリックス", 1988), "阪急");
  assert.equal(teamForYear("阪急 オリックス", 1989), "オリックス");
  assert.equal(teamForYear("東映 日拓 日本ハム", 1973), "日拓");
  assert.equal(teamForYear("西鉄 太平洋 クラウン 西武", 1980), "西武");
  assert.equal(teamForYear("巨人", 2000), "巨人");
});

test("シーズン途中の移籍は1年にまとめ、打率と WAR は合計する", () => {
  const ss = battingSeasons([
    bat({ year: 2014, team: "オリックス", G: 2, PA: 1, AB: 1, H: 0, AVG: 0, WAR: -0.1 }),
    bat({ year: 2014, team: "中日", G: 29, PA: 41, AB: 36, H: 9, TB: 12, BB: 4, AVG: 0.25, WAR: 0.4 }),
    bat({ year: 2015, team: "中日", G: 10, PA: 20, AB: 18, H: 6, TB: 6, AVG: 0.333, OPS: 0.7 }),
  ]);
  assert.equal(ss.length, 2);
  assert.equal(ss[0].team, "オリックス・中日");
  assert.equal(ss[0].AVG, 9 / 37);
  assert.ok(Math.abs(ss[0].WAR - 0.3) < 1e-9);
  assert.equal(ss[1].WAR, null, "WAR がなければ null");
});

test("キャリアハイは、その枠での WAR が最も高い年", () => {
  const ss = [bat({ year: 2010, PA: 500, OPS: 0.8, WAR: 3.1 }), bat({ year: 2011, PA: 600, OPS: 0.75, WAR: 4.2 }), bat({ year: 2012, PA: 100, OPS: 1.2, WAR: 1.0 })];
  assert.equal(autoSeason(ss, "lineup").year, 2011);
  // WAR がない（リーグのデータがない）ときは、OPS などで選ぶ
  const noWar = ss.map((s) => ({ ...s, WAR: null }));
  assert.equal(autoSeason(noWar, "lineup").year, 2010);
  assert.equal(autoSeason([], "lineup"), null);
});

test("中継ぎ・抑えの枠は、80回を超える年を80回分に割り引いて比べる", () => {
  const ps = pitchingSeasons([
    pit({ year: 2010, G: 28, GS: 28, IP: "200.0", WAR: 6, ER: 50 }),
    pit({ year: 2011, G: 60, GS: 0, IP: "60.0", WAR: 2.5, SV: 40, ER: 10 }),
  ]);
  assert.equal(slotWar(ps[0], "SP"), 6);
  assert.ok(Math.abs(slotWar(ps[0], "CL") - 2.4) < 1e-9);
  assert.equal(autoSeason(ps, "SP").year, 2010);
  assert.equal(autoSeason(ps, "CL").year, 2011, "2010年は 6×80/200=2.4 で、2011年の 2.5 より低い");
  const v = seasonValue(ps[0], "CL");
  assert.equal(v.scaled, true);
  assert.equal(v.seasonWar, 6);
});

test("ランクの区切り", () => {
  assert.equal(rankOf(7.2, PLAYER_RANKS), "S");
  assert.equal(rankOf(3.0, PLAYER_RANKS), "B");
  assert.equal(rankOf(-0.5, PLAYER_RANKS), "E");
  assert.equal(rankOf(2.6, RELIEF_RANKS), "A");
  assert.equal(rankOf(104, TEAM_RANKS), "S");
  assert.equal(rankOf(86, TEAM_RANKS), "B");
  assert.equal(rankOf(50, TEAM_RANKS), "E");
  assert.equal(REPLACEMENT_WINS, 42);
});

test("実データ：よく知られたキャリアハイを選ぶ", () => {
  const matsui = auto("松井秀喜", "lineup");
  assert.equal(matsui.year, 2002);
  assert.ok(matsui.WAR > 9, `松井 2002 の WAR ${matsui.WAR}`);
  const itoi = auto("糸井嘉男", "lineup");
  assert.ok(itoi.WAR >= seasons("糸井嘉男", "lineup").find((x) => x.year === 2014).WAR, "首位打者の2014年以上の年");
  assert.ok(itoi.warParts.fielding !== 0 && itoi.warParts.baserunning !== 0, "守備と走塁も入っている");
  const tanaka = auto("田中将大", "SP");
  assert.equal(tanaka.year, 2013);
  assert.equal(statText(tanaka, "SP").split(" ")[0], "24勝0敗");
  const iwase = auto("岩瀬仁紀", "CL");
  assert.ok(iwase.SV >= 40, "抑えのキャリアハイはセーブの多い年");
  assert.ok(seasonValue(iwase, "CL").war < 4);
  // 投手成績がない選手を投手の枠に入れても落ちない
  assert.equal(auto("松井秀喜", "SP"), null);
  assert.equal(seasonValue(null, "SP").war, 0);
});

test("表示：リーグ1位の成績に印。投手は先発中心の年と救援の年で形を変える", () => {
  const s = bat({ year: 2014, PA: 590, AVG: 0.331, HR: 19, RBI: 81, SB: 31, OPS: 0.948, lead: new Set(["AVG"]) });
  const parts = statLine(s, "lineup");
  assert.deepEqual(parts.map((p) => p.text), ["打率.331", "19本", "81打点", "31盗塁", "OPS.948"]);
  assert.equal(parts[0].lead, true);
  const starter = pit({ year: 2013, G: 28, GS: 27, W: 24, L: 0, ERA: 1.27, IP: "212.0", SO: 183 });
  assert.equal(statText(starter, "CL"), "24勝0敗 防御率1.27 212.0回 183奪三振", "抑えの枠でも先発の年は先発の形");
  const closer = pit({ year: 2005, G: 60, GS: 0, SV: 46, HLD: 2, ERA: 1.88 });
  assert.equal(statText(closer, "SP"), "60登板 46セーブ 2ホールド 防御率1.88");
});

const pickOf = (pickId, playerKey) => ({ pickId, playerKey, name: playerKey });

function snapshotWith([l1, l2, sp, cl]) {
  return {
    lineup: Array.from({ length: 9 }, (_, i) => ({ order: i + 1, field: null, player: i === 0 ? l1 : i === 1 ? l2 : null })),
    bench: [null, null],
    SP: [sp, null, null],
    RP: [null, null],
    CL: [cl],
  };
}

test("チームの答え合わせ：WAR の合計と予想勝利数、年度の選び直し", () => {
  const snap = snapshotWith([pickOf("a", "松井秀喜"), pickOf("b", "糸井嘉男"), pickOf("c", "田中将大"), pickOf("d", "岩瀬仁紀")]);
  const r = careerTeam(snap, players, leagues);
  assert.equal(r.slots.length, 17);
  assert.equal(r.complete, false);
  assert.equal(r.slots[0].year, 2002);
  assert.equal(r.slots[0].auto, true);
  assert.equal(r.slots[2].war, 0, "空き枠は0");
  const sum = r.slots.reduce((a, s) => a + s.war, 0);
  assert.ok(Math.abs(r.total.war - sum) < 1e-9, "控えがいなければ単純な合計");
  assert.equal(r.total.wins, Math.round(42 + r.total.war));
  assert.equal(r.total.wins + r.total.losses, 143);
  assert.ok(Math.abs(r.batting.war + r.pitching.war - r.total.war) < 1e-9);
  assert.equal(r.sums.HR, r.slots[0].season.HR + r.slots[1].season.HR);

  const r2 = careerTeam({ ...snap, careerYears: { a: 1996, b: 1900 } }, players, leagues);
  assert.equal(r2.slots[0].year, 1996);
  assert.equal(r2.slots[0].auto, false);
  assert.equal(r2.slots[0].autoYear, 2002);
  assert.equal(r2.slots[1].auto, true, "知らない年は自動のまま");
  assert.ok(r2.total.war < r.total.war);

  const sum2 = careerSummary(r);
  assert.equal(sum2.wins, r.total.wins);
  assert.equal(sum2.rank, r.total.rank);

  // リーグのデータがなければ WAR は出ない（落ちない）
  const r3 = careerTeam(snap, players);
  assert.equal(r3.hasWar, false);
  assert.equal(r3.total.war, 0);
});

test("控えは WAR の 1/4 だけチームに入る", () => {
  const snap = snapshotWith([null, null, null, null]);
  snap.bench = [pickOf("x", "松井秀喜"), null];
  const r = careerTeam(snap, players, leagues);
  assert.ok(Math.abs(r.total.war - r.slots[9].war / 4) < 1e-9);
});

test("共有テキストの最後に総合力の行が付く", async () => {
  const { buildShareText, ratingText } = await import("../js/share.js");
  const snap = {
    ...snapshotWith([pickOf("a", "松井秀喜"), pickOf("b", "糸井嘉男"), pickOf("c", "田中将大"), pickOf("d", "岩瀬仁紀")]),
    spins: 20,
    passes: 1,
    complete: false,
  };
  for (const p of [snap.lineup[0].player, snap.lineup[1].player, snap.SP[0], snap.CL[0]]) {
    Object.assign(p, { year: 2000, teamName: "読売ジャイアンツ", roundLabel: "1位" });
  }
  const r = careerTeam(snap, players, leagues);
  const lines = buildShareText(snap, () => "", r).split("\n");
  assert.equal(lines.at(-1), ratingText(r));
  assert.match(lines.at(-1), /^総合力 [SABCDE]（予想 \d+勝\d+敗・チーム WAR -?\d+\.\d）打線 -?\d+\.\d・投手陣 -?\d+\.\d$/);
  assert.equal(buildShareText(snap).split("\n").length, lines.length - 1, "答え合わせがなければ今までどおり");
});
