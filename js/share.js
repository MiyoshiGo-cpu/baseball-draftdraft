// 共有：テキストでコピー、シェア画像（Canvas → PNG）。
// buildShareText は DOM に触れないので Node のテストからも使える。

import { KIND_LABELS } from "./game.js";
import { eraShort, shortYear } from "./teams.js";
import { statLine } from "./career.js";
import { fmtEra, fmtRate } from "./stats.js";

const EMPTY = "―";

/** 「'12 日本ハム 1位」のような表記。 */
export function pickMeta(player, franchiseShort = "") {
  if (!player) return "";
  return `${shortYear(player.year)} ${eraShort(player.teamName, franchiseShort)} ${player.roundLabel}`;
}

/** 「総合力 A（60点）打線 57・投手陣 65」 */
export function ratingText(career) {
  if (!career) return "";
  const { total, batting, pitching } = career;
  return `総合力 ${total.rank}（${total.score}点）打線 ${batting.score}・投手陣 ${pitching.score}`;
}

/**
 * 共有テキスト（仕様書 §5.8 の形式）。snapshot は game.teamSnapshot() の戻り値。
 * career（career.careerTeam() の戻り値）があれば、最後に総合力の行を足す。
 */
export function buildShareText(snapshot, shortOf = () => "", career = null) {
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
  if (career) lines.push(ratingText(career));
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
  ink2: "#33415c",
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

const GRADE_COLORS = {
  S: ["#f5b400", "#5a3c00"],
  A: ["#e3002b", "#ffffff"],
  B: ["#1f5bd8", "#ffffff"],
  C: ["#08857f", "#ffffff"],
  D: ["#8a94a6", "#ffffff"],
  E: ["#eef1f6", "#667085"],
};

/** ランクの角丸（S〜E と点数）。right は右端、cy は縦の中心。 */
function drawGrade(ctx, right, cy, rank, score, size = 64) {
  const [bg, fg] = GRADE_COLORS[rank] || GRADE_COLORS.E;
  const x = right - size;
  ctx.fillStyle = bg;
  roundRect(ctx, x, cy - size / 2, size, size, 12);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  const withScore = score !== "" && score !== null && score !== undefined;
  setFont(ctx, Math.round(size * (withScore ? 0.46 : 0.56)), 900);
  ctx.fillText(rank, x + size / 2, withScore ? cy - size * 0.1 : cy + 1);
  if (withScore) {
    setFont(ctx, Math.round(size * 0.24), 800);
    ctx.fillText(String(score), x + size / 2, cy + size * 0.29);
  }
  ctx.textAlign = "left";
}

/** 成績の並び（リーグ1位は赤の太字）を maxWidth に収めて描く。 */
function drawStatParts(ctx, parts, x, cy, maxWidth, size) {
  const gap = 12;
  let s = size;
  const width = () =>
    parts.reduce((a, p) => {
      setFont(ctx, s, p.lead ? 900 : 700);
      return a + ctx.measureText(p.text).width;
    }, 0) +
    gap * (parts.length - 1);
  while (s > 12 && width() > maxWidth) s -= 1;
  let cx = x;
  for (const p of parts) {
    setFont(ctx, s, p.lead ? 900 : 700);
    ctx.fillStyle = p.lead ? IMG.red : IMG.ink2;
    ctx.fillText(p.text, cx, cy);
    cx += ctx.measureText(p.text).width + gap;
  }
}

/**
 * チームをシェア画像として canvas に描く（白地に紺と赤）。描いた canvas を返す。
 * career（career.careerTeam() の戻り値）があれば、総合力と各選手のキャリアハイも描く。
 */
export function drawShareImage(snapshot, shortOf = () => "", { dateText = "", footer = "ドラフトルーレット", career = null } = {}) {
  const { width: W, pad } = IMG;
  const headerH = 210;
  const ratingH = career ? 236 : 0;
  const rowH = career ? 96 : 66;
  const smallRowH = career ? 90 : 60;
  const headH = 64;
  const lowerRows = snapshot.bench.length + snapshot.SP.length + snapshot.RP.length + snapshot.CL.length;
  const H = headerH + ratingH + 24 + headH + rowH * 9 + 20 + headH * 2 + smallRowH * lowerRows + 120;
  const slotOf = (p) => (career && p ? career.slots.find((s) => s.player?.pickId === p.pickId) : null);

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

  let y = headerH + 10;
  if (career) {
    // 総合力（答え合わせ）
    const top = y + 24;
    const boxH = ratingH - 34;
    ctx.fillStyle = IMG.soft;
    roundRect(ctx, pad, top, W - pad * 2, boxH, 20);
    ctx.fill();
    const { total, batting, pitching, sums } = career;
    const [bg, fg] = GRADE_COLORS[total.rank] || GRADE_COLORS.E;
    const ex = pad + 96;
    const ey = top + boxH / 2;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(ex, ey, 74, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(ex, ey, 66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    setFont(ctx, 20, 900);
    ctx.fillText("総合力", ex, ey - 40);
    setFont(ctx, 72, 900);
    ctx.fillText(total.rank, ex, ey + 4);
    setFont(ctx, 22, 900);
    ctx.fillText(`${total.score}/100`, ex, ey + 46);
    ctx.textAlign = "left";

    const tx = pad + 200;
    const right = W - pad - 28;
    ctx.fillStyle = IMG.navy;
    setFont(ctx, 26, 900);
    ctx.fillText("答え合わせ（キャリアハイで採点）", tx, top + 38);
    const bar = (label, part, cy) => {
      ctx.fillStyle = IMG.navy;
      setFont(ctx, 26, 900);
      ctx.fillText(label, tx, cy);
      const bx = tx + 104;
      const bw = right - bx - 130;
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, bx, cy - 9, bw, 18, 9);
      ctx.fill();
      ctx.fillStyle = (GRADE_COLORS[part.rank] || GRADE_COLORS.E)[0];
      roundRect(ctx, bx, cy - 9, Math.max(18, (bw * part.score) / 100), 18, 9);
      ctx.fill();
      ctx.fillStyle = IMG.ink;
      setFont(ctx, 32, 900);
      ctx.textAlign = "right";
      ctx.fillText(String(part.score), right - 62, cy + 1);
      ctx.textAlign = "left";
      drawGrade(ctx, right, cy, part.rank, "", 44);
    };
    bar("打線", batting, top + 90);
    bar("投手陣", pitching, top + 142);
    ctx.fillStyle = IMG.muted;
    fitText(
      ctx,
      `打率${fmtRate(sums.AVG)}・${sums.HR}本・${sums.RBI}打点 ／ ${sums.W}勝・${sums.SV}S・${sums.HLD}H・防御率${fmtEra(sums.ERA)}`,
      tx,
      top + 186,
      right - tx,
      22,
      700,
    );
    y += ratingH;
  }
  y += 14;

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
  const metaWidth = career ? 300 : 360;
  const gradeW = career ? 76 : 0;

  /** 名前と指名情報（1行目）、キャリアハイ（2行目）、ランク（右端）を描く。 */
  const playerCell = (p, nameX, cy, nameSize, metaSize) => {
    const slot = slotOf(p);
    const right = W - pad - gradeW;
    const line1 = career ? cy - 18 : cy;
    ctx.fillStyle = IMG.ink;
    fitText(ctx, p.name, nameX, line1, right - nameX - metaWidth - 16, nameSize, 900);
    ctx.fillStyle = IMG.muted;
    fitText(ctx, pickMeta(p, shortOf(p.franchiseId)), right, line1, metaWidth, metaSize, 700, "right");
    if (!career) return;
    const line2 = cy + 22;
    if (slot?.season) {
      ctx.fillStyle = IMG.navy;
      setFont(ctx, 24, 900);
      const yearText = `${slot.season.year}`;
      ctx.fillText(yearText, nameX, line2);
      const sx = nameX + ctx.measureText(yearText).width + 14;
      drawStatParts(ctx, statLine(slot.season, slot.kind), sx, line2, right - sx - 12, 24);
    } else {
      ctx.fillStyle = IMG.muted;
      setFont(ctx, 22, 500);
      ctx.fillText(slot?.type === "pit" ? "一軍の投手成績なし" : "一軍の打撃成績なし", nameX, line2);
    }
    drawGrade(ctx, W - pad, cy, slot?.rank || "E", slot?.score ?? 0, 62);
  };

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
      playerCell(row.player, pad + 162, cy, 40, 26);
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
        playerCell(p, pad + 138, cy, 36, 24);
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
  ctx.fillText(career ? "指名・成績データ：Wikipedia日本語版（CC BY-SA 4.0）" : "指名データ：Wikipedia日本語版（CC BY-SA 4.0）", W - pad, H - 35);
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
