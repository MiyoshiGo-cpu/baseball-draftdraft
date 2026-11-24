// バージョンと更新ログ（js/version.js / CHANGELOG.md）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHANGE_TYPES,
  CHANGELOG,
  STAGE,
  STAGE_ORDER,
  VERSION,
  VERSION_ID,
  VERSION_LABEL,
  changelogMarkdown,
  formatChangelogDate,
  versionId,
  versionLabel,
  versionRank,
} from "../js/version.js";

const compare = (a, b) => {
  const ra = versionRank(a.stage, a.version);
  const rb = versionRank(b.stage, b.version);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return 0;
};

test("現在のバージョンは「数字.数字」で、更新ログの先頭と同じ", () => {
  assert.match(VERSION, /^\d+\.\d+$/);
  assert.ok(STAGE_ORDER.includes(STAGE));
  assert.equal(CHANGELOG[0].version, VERSION);
  assert.equal(CHANGELOG[0].stage, STAGE);
});

test("ベータ版は「Beta v1.2」、正式版は「v1.0」と表記する", () => {
  assert.equal(versionLabel("beta", "1.2"), "Beta v1.2");
  assert.equal(versionLabel("release", "1.0"), "v1.0");
  assert.equal(versionId("beta", "1.2"), "beta-1.2");
  assert.equal(versionId("release", "1.0"), "1.0");
  assert.equal(VERSION_LABEL, versionLabel(STAGE, VERSION));
  assert.equal(VERSION_ID, versionId(STAGE, VERSION));
});

test("正式版 v1.0 はベータ版のどの版よりも新しい扱い", () => {
  assert.ok(compare({ stage: "release", version: "1.0" }, { stage: "beta", version: "1.9" }) > 0);
  assert.ok(compare({ stage: "beta", version: "1.10" }, { stage: "beta", version: "1.9" }) > 0);
});

test("更新ログは新しい順で、版と日付が正しい", () => {
  const ids = CHANGELOG.map((e) => versionId(e.stage, e.version));
  assert.equal(new Set(ids).size, ids.length, "同じバージョンが2回ある");
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.ok(compare(CHANGELOG[i - 1], CHANGELOG[i]) > 0, "新しい順になっていない");
    assert.ok(CHANGELOG[i - 1].date >= CHANGELOG[i].date, "日付が新しい順になっていない");
  }
  for (const e of CHANGELOG) {
    assert.ok(STAGE_ORDER.includes(e.stage), `未知の段階: ${e.stage}`);
    assert.match(e.version, /^\d+\.\d+$/);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(new Date(`${e.date}T00:00:00Z`).getTime()));
    assert.ok(e.title, "見出しがない");
    assert.ok(e.changes.length > 0, "変更内容がない");
    for (const c of e.changes) {
      assert.ok(c.type in CHANGE_TYPES, `未知の種類: ${c.type}`);
      assert.ok(c.text.trim(), "変更内容が空");
    }
  }
});

test("CHANGELOG.md が js/version.js と一致している（ずれたら npm run changelog）", () => {
  const md = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.equal(md, changelogMarkdown());
});

test("日付の表示", () => {
  assert.equal(formatChangelogDate("2026-11-24"), "2026/11/24");
});
