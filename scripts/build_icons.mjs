// アプリアイコンを作る。デザインは下の SVG で、Playwright（Chromium）で各サイズの PNG に書き出す。
// 実行：npm run icons
// 出力：icons/icon.svg（ファビコン）、icons/apple-touch-icon.png（180px・iPhone のホーム画面）、
//       icons/icon-192.png / icon-512.png（Android など）、icons/icon-maskable-512.png（丸や角丸に切り抜かれる端末用）、
//       icons/favicon-32.png

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const OUT = new URL("../icons/", import.meta.url);

const NAVY = "#0b2a66";
const NAVY_2 = "#1c4fbf";
const RED = "#e3002b";
const GOLD = "#f5b400";

/** ルーレットの扇形（12球団ぶん）。i=0 が真上。 */
function wedges(r) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const a0 = ((-90 - 15 + i * 30) * Math.PI) / 180;
    const a1 = ((-90 + 15 + i * 30) * Math.PI) / 180;
    const p = (a) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
    const fill = i === 0 ? RED : i % 2 ? "#dbe6fb" : "#ffffff";
    out.push(`<path d="M0 0 L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z" fill="${fill}"/>`);
  }
  return out.join("");
}

/** 外周のランプ（ルーレットの電飾） */
function lights(r, count = 24) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push(`<circle cx="${(Math.cos(a) * r).toFixed(1)}" cy="${(Math.sin(a) * r).toFixed(1)}" r="11" fill="${i % 2 ? GOLD : "#fff6d6"}"/>`);
  }
  return out.join("");
}

/**
 * アイコンの SVG。
 * maskable: true のときは、丸く切り抜かれても欠けないよう中身を 80% に縮める（背景は全面）。
 */
export function iconSvg({ size = 1024, maskable = false } = {}) {
  const content = `
    <g transform="translate(512 455)">
      <circle r="352" fill="${RED}" opacity="0.18"/>
      <circle r="330" fill="${NAVY}" stroke="#ffffff" stroke-width="16"/>
      ${lights(306)}
      <circle r="284" fill="#ffffff"/>
      ${wedges(278)}
      <circle r="278" fill="none" stroke="${NAVY}" stroke-width="6"/>
      <g stroke="${NAVY}" stroke-width="4" opacity="0.35">
        ${Array.from({ length: 12 }, (_, i) => {
          const a = ((-105 + i * 30) * Math.PI) / 180;
          return `<line x1="0" y1="0" x2="${(Math.cos(a) * 278).toFixed(1)}" y2="${(Math.sin(a) * 278).toFixed(1)}"/>`;
        }).join("")}
      </g>
      <circle r="128" fill="#ffffff" stroke="#c9d3e6" stroke-width="8"/>
      <path d="M-62 -100 C-28 -40 -28 40 -62 100 M62 -100 C28 -40 28 40 62 100" fill="none" stroke="${RED}" stroke-width="12" stroke-linecap="round" stroke-dasharray="2 24"/>
      <path d="M-62 -100 C-28 -40 -28 40 -62 100 M62 -100 C28 -40 28 40 62 100" fill="none" stroke="${RED}" stroke-width="5" opacity="0.55"/>
    </g>
    <path d="M512 214 L452 112 L572 112 Z" fill="${RED}" stroke="#ffffff" stroke-width="14" stroke-linejoin="round"/>
    <g transform="translate(512 852) rotate(-7)">
      <rect x="-352" y="-84" width="704" height="162" rx="28" fill="${RED}" stroke="#ffffff" stroke-width="14"/>
      <text x="0" y="40" text-anchor="middle" font-family="'Liberation Sans', Arial, Helvetica, sans-serif" font-size="124" font-weight="900" font-style="italic" letter-spacing="10" fill="#ffffff">DRAFT</text>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${NAVY_2}"/>
      <stop offset="1" stop-color="#081d4a"/>
    </linearGradient>
    <pattern id="stripe" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
      <rect width="8" height="44" fill="#ffffff" opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#stripe)"/>
  ${maskable ? `<g transform="translate(512 512) scale(0.8) translate(-512 -512)">${content}</g>` : content}
</svg>
`;
}

const OUTPUTS = [
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "favicon-32.png", size: 32 },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL("icon.svg", OUT), iconSvg());
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const { file, size, maskable } of OUTPUTS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#000">${iconSvg({ size, maskable })}</body></html>`,
    );
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(new URL(file, OUT), png);
    console.log(`icons/${file}（${size}×${size}）`);
  }
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
