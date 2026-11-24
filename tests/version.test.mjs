// バージョンと更新ログ（js/version.js / CHANGELOG.md）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHANGE_TYPES, CHANGELOG, VERSION, changelogMarkdown, formatChangelogDate } from "../js/version.js";

const parse = (v) => v.split(".").map(Number);
const compare = (a, b) => {
  const [a1, a2] = parse(a);
  const [b1, b2] = parse(b);
  return a1 - b1 || a2 - b2;
};

test("バージョンは「数字.数字」で、更新ログの先頭と同じ", () => {
  assert.match(VERSION, /^\d+\.\d+$/);
  assert.equal(CHANGELOG[0].version, VERSION);
});

test("更新ログは新しい順で、バージョンと日付が正しい", () => {
  const versions = CHANGELOG.map((e) => e.version);
  assert.equal(new Set(versions).size, versions.length, "同じバージョンが2回ある");
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.ok(compare(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0, "新しい順になっていない");
    assert.ok(CHANGELOG[i - 1].date >= CHANGELOG[i].date, "日付が新しい順になっていない");
  }
  for (const e of CHANGELOG) {
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
