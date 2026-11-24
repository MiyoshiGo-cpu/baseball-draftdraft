// ホーム画面に追加したときの設定（manifest.webmanifest・アイコン・index.html）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));

/** PNG の幅と高さ（IHDR チャンク）を読む。 */
function pngSize(path) {
  const buf = read(path);
  assert.equal(buf.toString("ascii", 1, 4), "PNG", `${path} が PNG ではない`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const manifest = JSON.parse(read("manifest.webmanifest").toString("utf8"));
const html = read("index.html").toString("utf8");

test("manifest に必要な項目がある", () => {
  assert.equal(manifest.name, "ドラフトルーレット");
  assert.ok(manifest.short_name && [...manifest.short_name].length <= 6, "short_name はホーム画面で切れないよう6文字以内");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test("manifest のアイコンがあり、PNG は書いてあるとおりの大きさ", () => {
  const sizes = new Set();
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL(icon.src, root)), `${icon.src} がない`);
    if (icon.type === "image/png") {
      const [w, h] = icon.sizes.split("x").map(Number);
      assert.deepEqual(pngSize(icon.src), { width: w, height: h }, icon.src);
      sizes.add(icon.sizes);
    }
  }
  assert.ok(sizes.has("192x192") && sizes.has("512x512"), "192px と 512px のアイコンが必要");
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"), "丸く切り抜かれる端末用（maskable）のアイコンが必要");
});

test("iPhone 用のアイコンは 180px", () => {
  assert.deepEqual(pngSize("icons/apple-touch-icon.png"), { width: 180, height: 180 });
  assert.deepEqual(pngSize("icons/favicon-32.png"), { width: 32, height: 32 });
});

test("index.html から manifest と iPhone 用の設定を読み込んでいる", () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, new RegExp(`<meta name="apple-mobile-web-app-title" content="${manifest.short_name}">`));
  assert.match(html, /viewport-fit=cover/);
});
