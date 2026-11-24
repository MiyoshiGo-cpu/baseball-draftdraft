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
  bg: "#123829",
  panel: "#18473a",
  text: "#f6f1e3",
  dim: "#a8c3b6",
  accent: "#f0b84a",
  line: "rgba(246, 241, 227, 0.14)",
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

/** チームをシェア画像として canvas に描く。描いた canvas を返す。 */
export function drawShareImage(snapshot, shortOf = () => "", { title = "ドラフトルーレット", dateText = "" } = {}) {
  const { width: W, pad } = IMG;
  const rowH = 64;
  const smallRowH = 58;
  const headH = 58;
  const top = 200;
  const lowerRows = snapshot.bench.length + snapshot.SP.length + snapshot.RP.length + snapshot.CL.length;
  const H = top + headH + rowH * 9 + 28 + headH * 2 + smallRowH * lowerRows + 110;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";

  ctx.fillStyle = IMG.bg;
  ctx.fillRect(0, 0, W, H);
  // 外枠
  ctx.strokeStyle = IMG.accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(20, 20, W - 40, H - 40);

  ctx.fillStyle = IMG.accent;
  setFont(ctx, 30, 700);
  ctx.fillText("DRAFT ROULETTE", pad, 84);
  ctx.fillStyle = IMG.text;
  setFont(ctx, 60, 800);
  ctx.fillText(title, pad, 136);
  ctx.fillStyle = IMG.dim;
  setFont(ctx, 28, 500);
  const stats = `スピン${snapshot.spins}回・パス${snapshot.passes}回${snapshot.complete ? "" : "（未完成）"}`;
  ctx.textAlign = "right";
  ctx.fillText(stats, W - pad, 84);
  if (dateText) ctx.fillText(dateText, W - pad, 136);
  ctx.textAlign = "left";

  let y = top;
  const sectionHead = (label) => {
    ctx.fillStyle = IMG.accent;
    setFont(ctx, 28, 700);
    ctx.fillText(label, pad, y + headH / 2);
    ctx.strokeStyle = IMG.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad + ctx.measureText(label).width + 20, y + headH / 2);
    ctx.lineTo(W - pad, y + headH / 2);
    ctx.stroke();
    y += headH;
  };
  const rowLine = (h) => {
    ctx.strokeStyle = IMG.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y + h);
    ctx.lineTo(W - pad, y + h);
    ctx.stroke();
  };
  const metaWidth = 360;

  sectionHead("スタメン");
  for (const row of snapshot.lineup) {
    const cy = y + rowH / 2;
    ctx.fillStyle = IMG.accent;
    setFont(ctx, 36, 800);
    ctx.textAlign = "center";
    ctx.fillText(String(row.order), pad + 22, cy);
    ctx.fillStyle = IMG.text;
    setFont(ctx, 32, 700);
    ctx.fillText(row.field || "", pad + 100, cy);
    ctx.textAlign = "left";
    if (row.player) {
      ctx.fillStyle = IMG.text;
      fitText(ctx, row.player.name, pad + 160, cy, W - pad * 2 - 160 - metaWidth - 16, 40, 700);
      ctx.fillStyle = IMG.dim;
      fitText(ctx, pickMeta(row.player, shortOf(row.player.franchiseId)), W - pad, cy, metaWidth, 26, 500, "right");
    } else {
      ctx.fillStyle = IMG.dim;
      setFont(ctx, 32, 400);
      ctx.fillText(EMPTY, pad + 160, cy);
    }
    rowLine(rowH);
    y += rowH;
  }
  y += 28;

  const listRows = (label, players) => {
    for (const p of players) {
      const cy = y + smallRowH / 2;
      ctx.fillStyle = IMG.accent;
      setFont(ctx, 24, 700);
      ctx.fillText(label, pad, cy);
      if (p) {
        ctx.fillStyle = IMG.text;
        fitText(ctx, p.name, pad + 130, cy, W - pad * 2 - 130 - metaWidth - 16, 34, 700);
        ctx.fillStyle = IMG.dim;
        fitText(ctx, pickMeta(p, shortOf(p.franchiseId)), W - pad, cy, metaWidth, 24, 500, "right");
      } else {
        ctx.fillStyle = IMG.dim;
        setFont(ctx, 30, 400);
        ctx.fillText(EMPTY, pad + 130, cy);
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

  ctx.fillStyle = IMG.dim;
  setFont(ctx, 20, 400);
  ctx.textAlign = "center";
  ctx.fillText("指名データ：Wikipedia日本語版「新人選手選択会議 (日本プロ野球)」（CC BY-SA 4.0）", W / 2, H - 58);
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
