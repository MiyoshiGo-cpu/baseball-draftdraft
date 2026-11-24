// 画面遷移（js/router.js）の URL の読み取りのテスト
import { test } from "node:test";
import assert from "node:assert/strict";

import { routeFromHash } from "../js/router.js";

test("ハッシュがなければタイトル画面", () => {
  assert.deepEqual(routeFromHash(""), { name: "title", params: [], key: "title" });
  assert.deepEqual(routeFromHash("#/"), { name: "title", params: [], key: "title" });
});

test("画面名と追加の値を読み取る", () => {
  assert.deepEqual(routeFromHash("#/menu"), { name: "menu", params: [], key: "menu" });
  assert.deepEqual(routeFromHash("#/saved/t1abc"), { name: "saved", params: ["t1abc"], key: "saved/t1abc" });
  assert.deepEqual(routeFromHash("#menu"), { name: "menu", params: [], key: "menu" });
});

test("エンコードされた値を戻す", () => {
  assert.deepEqual(routeFromHash("#/saved/a%2Fb").params, ["a/b"]);
});
