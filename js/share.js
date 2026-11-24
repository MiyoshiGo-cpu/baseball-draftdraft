// 共有：テキストでコピー、シェア画像（Canvas → PNG）。
// buildShareText は DOM に触れないので Node のテストからも使える。

import { KIND_LABELS } from "./game.js";
import { eraShort, shortYear } from "./teams.js";

const EMPTY = "―";

/** 「'12 日本ハム 1位」のような表記。 */
export function pickMeta(player, franchiseShort = "") {
  if (!player) return "";
  return `${shortYear(player.year)} ${eraShort(player.teamName, franchiseShort)} ${player.roundLabel}`;
}

/** 共有テキスト（仕様書 §5.8 の形式）。snapshot は game.teamSnapshot() の戻り値。 */
export function buildShareText(snapshot, shortOf = () => "") {
  const name = (p) => (p ? p.name : EMPTY);
  const lines = ["【ドラフトルーレット】"];
  for (const row of snapshot.lineup) {
    if (row.player) {
      lines.push(`${row.order} ${row.field} ${row.player.name} ${pickMeta(row.player, shortOf(row.player.franchiseId))}`);
    } else {
      lines.push(`${row.order} ${EMPTY} ${EMPTY}`);
    }
  }
  lines.push(`控え ${snapshot.bench.map(name).join(" / ")}`);
  lines.push(`先発 ${snapshot.SP.map(name).join(" / ")}`);
  lines.push(`中継ぎ ${snapshot.RP.map(name).join(" / ")}`);
  lines.push(`抑え ${snapshot.CL.map(name).join(" / ")}`);
  lines.push(`スピン${snapshot.spins}回・パス${snapshot.passes}回${snapshot.complete ? "" : "（未完成）"}`);
  return lines.join("\n");
}

/** クリップボードにコピーする。成功したら true。 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 下の方法で再挑戦する
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// シェア画像
// ---------------------------------------------------------------------------

const IMG = {
  width: 1080,
  pad: 64,
  bg: "#ffffff",
  ink: "#0f1b2d",
  muted: "#667085",
  navy: "#0b2a66",
  navy2: "#163f99",
  red: "#e3002b",
  gold: "#f5b400",
  line: "#e3e7ee",
  soft: "#f3f5f9",
  font: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif',
};

function setFont(ctx, size, weight = 400) {
  ctx.font = `${weight} ${size}px ${IMG.font}`;
}

/** maxWidth に収まるまでフォントを小さくして描く。 */
function fitText(ctx, text, x, y, maxWidth, size, weight = 400, align = "left") {
  let s = size;
  setFont(ctx, s, weight);
  while (s > 12 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    setFont(ctx, s, weight);
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** チームをシェア画像として canvas に描く（白地に紺と赤）。描いた canvas を返す。 */
export function drawShareImage(snapshot, shortOf = () => "", { dateText = "", footer = "ドラフトルーレット" } = {}) {
  const { width: W, pad } = IMG;
  const headerH = 210;
  const rowH = 66;
  const smallRowH = 60;
  const headH = 64;
  const lowerRows = snapshot.bench.length + snapshot.SP.length + snapshot.RP.length + snapshot.CL.length;
  const H = headerH + 24 + headH + rowH * 9 + 20 + headH * 2 + smallRowH * lowerRows + 120;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";

  ctx.fillStyle = IMG.bg;
  ctx.fillRect(0, 0, W, H);

  // 見出しの帯（ドラフト会議の中継画面風）
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, IMG.navy2);
  grad.addColorStop(1, IMG.navy);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, headerH);
  ctx.fillStyle = IMG.red;
  ctx.fillRect(0, headerH, W, 10);
  // 斜めの線の模様
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  for (let x = -headerH; x < W; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, headerH);
    ctx.lineTo(x + headerH * 0.47, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = IMG.gold;
  setFont(ctx, 28, 900);
  ctx.fillText("DRAFT ROULETTE", pad, 62);
  ctx.fillStyle = "#fff";
  setFont(ctx, 64, 900);
  ctx.fillText(snapshot.complete ? "指名選手一覧" : "指名選手一覧（未完成）", pad, 128);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  setFont(ctx, 28, 700);
  ctx.fillText(`スピン${snapshot.spins}回・パス${snapshot.passes}回`, pad, 180);
  if (dateText) {
    ctx.textAlign = "right";
    ctx.fillText(dateText, W - pad, 180);
    ctx.textAlign = "left";
  }
  if (snapshot.complete) {
    // 「選択終了」のはんこ
    ctx.save();
    ctx.translate(W - pad - 120, 96);
    ctx.rotate(-0.2);
    ctx.strokeStyle = IMG.red;
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 6;
    roundRect(ctx, -118, -42, 236, 84, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = IMG.red;
    setFont(ctx, 46, 900);
    ctx.textAlign = "center";
    ctx.fillText("選択終了", 0, 2);
    ctx.restore();
  }

  let y = headerH + 24;
  const sectionHead = (label) => {
    const cy = y + headH / 2;
    ctx.fillStyle = IMG.navy;
    ctx.fillRect(pad, cy - 18, 8, 24);
    ctx.fillStyle = IMG.red;
    ctx.fillRect(pad, cy + 6, 8, 12);
    ctx.fillStyle = IMG.navy;
    setFont(ctx, 30, 900);
    ctx.fillText(label, pad + 22, cy);
    ctx.strokeStyle = IMG.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad + 22 + ctx.measureText(label).width + 18, cy);
    ctx.lineTo(W - pad, cy);
    ctx.stroke();
    y += headH;
  };
  const rowLine = (h) => {
    ctx.strokeStyle = IMG.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad, y + h);
    ctx.lineTo(W - pad, y + h);
    ctx.stroke();
  };
  const metaWidth = 360;

  sectionHead("スタメン");
  for (const row of snapshot.lineup) {
    const cy = y + rowH / 2;
    // 打順（紺の丸）
    ctx.fillStyle = row.player ? IMG.navy : IMG.soft;
    ctx.beginPath();
    ctx.arc(pad + 26, cy, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = row.player ? "#fff" : IMG.muted;
    setFont(ctx, 28, 900);
    ctx.textAlign = "center";
    ctx.fillText(String(row.order), pad + 26, cy + 1);
    // 守備位置（赤の角丸）
    if (row.field) {
      ctx.fillStyle = IMG.red;
      roundRect(ctx, pad + 66, cy - 22, 72, 44, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      setFont(ctx, 28, 900);
      ctx.fillText(row.field, pad + 102, cy + 1);
    }
    ctx.textAlign = "left";
    if (row.player) {
      ctx.fillStyle = IMG.ink;
      fitText(ctx, row.player.name, pad + 162, cy, W - pad * 2 - 162 - metaWidth - 16, 40, 900);
      ctx.fillStyle = IMG.muted;
      fitText(ctx, pickMeta(row.player, shortOf(row.player.franchiseId)), W - pad, cy, metaWidth, 26, 700, "right");
    } else {
      ctx.fillStyle = IMG.muted;
      setFont(ctx, 32, 400);
      ctx.fillText(EMPTY, pad + 162, cy);
    }
    rowLine(rowH);
    y += rowH;
  }
  y += 20;

  const listRows = (label, players) => {
    for (const p of players) {
      const cy = y + smallRowH / 2;
      ctx.fillStyle = IMG.navy;
      setFont(ctx, 26, 900);
      ctx.fillText(label, pad, cy);
      if (p) {
        ctx.fillStyle = IMG.ink;
        fitText(ctx, p.name, pad + 138, cy, W - pad * 2 - 138 - metaWidth - 16, 36, 900);
        ctx.fillStyle = IMG.muted;
        fitText(ctx, pickMeta(p, shortOf(p.franchiseId)), W - pad, cy, metaWidth, 24, 700, "right");
      } else {
        ctx.fillStyle = IMG.muted;
        setFont(ctx, 30, 400);
        ctx.fillText(EMPTY, pad + 138, cy);
      }
      rowLine(smallRowH);
      y += smallRowH;
    }
  };

  sectionHead("控え");
  listRows(KIND_LABELS.bench, snapshot.bench);
  sectionHead("投手陣");
  listRows(KIND_LABELS.SP, snapshot.SP);
  listRows(KIND_LABELS.RP, snapshot.RP);
  listRows(KIND_LABELS.CL, snapshot.CL);

  // フッター
  ctx.fillStyle = IMG.navy;
  ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = "#fff";
  setFont(ctx, 22, 800);
  ctx.fillText(footer, pad, H - 35);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  setFont(ctx, 19, 500);
  ctx.textAlign = "right";
  ctx.fillText("指名データ：Wikipedia日本語版（CC BY-SA 4.0）", W - pad, H - 35);
  ctx.textAlign = "left";
  return canvas;
}

/** canvas を PNG にして保存する（スマホは共有シート、PC はダウンロード）。 */
export async function saveCanvasImage(canvas, filename) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("画像を作れませんでした");
  const file = new File([blob], filename, { type: "image/png" });
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "ドラフトルーレット" });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
      // 共有に失敗したらダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
