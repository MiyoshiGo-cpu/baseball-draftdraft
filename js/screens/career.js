// 答え合わせ（完成画面と保存したチームの画面）：各選手のキャリアハイと、チームの総合力。
// 選手をタップすると年度を選ぶシートが開き、ほかの年度に選び直せる。

import { $, esc } from "../dom.js";
import { app, loadPlayers } from "../app.js";
import { AUTO_RULE, careerTeam, seasonScore, rankOf, statLine } from "../career.js";
import { KIND_LABELS, POSITION_NAMES } from "../game.js";
import { fmtEra, fmtInt, fmtRate } from "../stats.js";
import { sfx, unlockAudio } from "../sound.js";
import { openPlayerByPickId } from "./player.js";

/**
 * 表示中の答え合わせ（入れ物の id → { snapshot, onChange, result }）。
 * onChange(pickId, year | null) は選び直した後の snapshot を返す。
 */
const mounts = new Map();

/** 年度を選ぶシートで開いている選手 { rootId, pickId } */
let picking = null;

const chevron = `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function statsHTML(season, kind) {
  return statLine(season, kind)
    .map((p) => `<span class="cr-stat${p.lead ? " is-lead" : ""}">${esc(p.text)}</span>`)
    .join("");
}

function gradeHTML(rank, score) {
  return `<span class="grade grade-${rank}"><b>${rank}</b><small>${score}</small></span>`;
}

function slotLabelHTML(slot) {
  if (slot.kind === "lineup") {
    return `<span class="cr-slot"><span class="cr-order">${slot.order}</span><span class="cr-pos">${esc(slot.field || "")}</span></span>`;
  }
  return `<span class="cr-slot"><span class="cr-kind cr-kind-${slot.kind}">${KIND_LABELS[slot.kind]}</span></span>`;
}

function rowHTML(slot, editable) {
  const p = slot.player;
  if (!p) {
    return `<li><div class="cr-row is-empty">${slotLabelHTML(slot)}<span class="cr-main"><span class="cr-empty">空き</span></span>${gradeHTML("E", 0)}<span></span></div></li>`;
  }
  const s = slot.season;
  const year = s
    ? `<span class="cr-year">${s.year}年 ${esc(s.team)}${
        slot.auto ? `<span class="cr-badge">キャリアハイ</span>` : `<span class="cr-badge is-custom">選んだ年</span>`
      }</span>`
    : `<span class="cr-year cr-none">${slot.type === "bat" ? "一軍の打撃成績なし" : "一軍の投手成績なし"}</span>`;
  const inner = `${slotLabelHTML(slot)}
    <span class="cr-main">
      <span class="cr-name">${esc(p.name)}</span>
      ${year}
      ${s ? `<span class="cr-stats">${statsHTML(s, slot.kind)}</span>` : ""}
    </span>
    ${gradeHTML(slot.rank, slot.score)}`;
  if (editable && slot.seasons.length) {
    return `<li><button type="button" class="cr-row" data-season="${esc(p.pickId)}" aria-label="${esc(p.name)}の年度を選び直す">${inner}<span class="cr-chev">${chevron}</span></button></li>`;
  }
  return `<li><div class="cr-row">${inner}<span></span></div></li>`;
}

function barHTML(label, part) {
  return `
    <div class="cbar">
      <span class="cbar-label">${label}</span>
      <span class="cbar-track"><span class="cbar-fill grade-bg-${part.rank}" style="width:${Math.max(2, part.score)}%"></span></span>
      <b class="cbar-score">${part.score}</b>
      <span class="grade grade-${part.rank} grade-small"><b>${part.rank}</b></span>
    </div>`;
}

function sumsHTML(sums) {
  const tile = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  return `
    <div class="career-sums">
      <p class="career-sums-title">スタメン9人の合計</p>
      <dl>${tile("打率", fmtRate(sums.AVG))}${tile("本塁打", fmtInt(sums.HR))}${tile("打点", fmtInt(sums.RBI))}${tile("盗塁", fmtInt(sums.SB))}</dl>
      <p class="career-sums-title">投手陣6人の合計</p>
      <dl>${tile("勝利", fmtInt(sums.W))}${tile("セーブ", fmtInt(sums.SV))}${tile("ホールド", fmtInt(sums.HLD))}${tile("防御率", fmtEra(sums.ERA))}</dl>
    </div>`;
}

/** 答え合わせのカードの中身。 */
export function careerHTML(result, { editable = true } = {}) {
  const { total } = result;
  const rows = (kinds) =>
    result.slots
      .filter((s) => kinds.includes(s.kind))
      .map((s) => rowHTML(s, editable))
      .join("");
  return `
    <div class="career-band">
      <p class="career-kicker">ANSWER CHECK</p>
      <h2 class="career-title">答え合わせ${result.complete ? "" : "（未完成）"}</h2>
      <p class="career-lead">指名した選手のキャリアハイで、チームを採点しました。</p>
    </div>
    <div class="career-score">
      <div class="rank-emblem rank-${total.rank}" aria-label="総合力 ${total.rank}ランク ${total.score}点">
        <span class="re-label">総合力</span>
        <span class="re-rank">${total.rank}</span>
        <span class="re-score">${total.score}<small>/100</small></span>
      </div>
      <div class="career-bars">
        ${barHTML("打線", result.batting)}
        ${barHTML("投手陣", result.pitching)}
      </div>
    </div>
    ${sumsHTML(result.sums)}
    ${editable ? `<p class="career-hint">選手をタップすると、ほかの年度に選び直せます。</p>` : ""}
    <h3 class="team-sub">スタメン</h3>
    <ol class="cr-list">${rows(["lineup"])}</ol>
    <h3 class="team-sub">控え</h3>
    <ul class="cr-list">${rows(["bench"])}</ul>
    <h3 class="team-sub">投手陣</h3>
    <ul class="cr-list">${rows(["SP", "RP", "CL"])}</ul>
    <details class="career-rule">
      <summary>採点のしかた</summary>
      <ul>
        <li>年度は、枠ごとに各選手のキャリアハイを自動で選びます。スタメン・控えは規定打席に届いた年で OPS が最も高い年（届いた年がなければ打席数が最も多い年）、先発は勝利数、中継ぎはセーブとホールドの合計（記録がない時代は登板数）、抑えはセーブ（記録がない時代は登板数）が最も多い年です。</li>
        <li>選手の点数（0〜100）は、打者は OPS と打席数、先発は防御率・勝利数・投球回、中継ぎと抑えは防御率・セーブとホールド・登板数から計算します。S は MVP 級、A はタイトル争い級の成績です。</li>
        <li>総合力は17人の点数の平均です（スタメンと先発を重く、控えを軽く数えます）。投手の枠に一軍の投手成績がない選手を入れると、その枠は0点です（打者の枠も同じ）。</li>
        <li>成績は NPB の一軍のみで、Wikipedia 日本語版の各選手の記事から作っています。赤の太字はリーグ1位です。</li>
      </ul>
    </details>`;
}

function render(rootId) {
  const m = mounts.get(rootId);
  const root = $(rootId);
  if (!m || !root) return;
  m.result = careerTeam(m.snapshot, app.players);
  root.innerHTML = careerHTML(m.result, { editable: Boolean(m.onChange) });
  m.onRender?.(m.result);
}

/**
 * 答え合わせを表示する。選手データがまだなら読み込んでから。
 * options.onChange(pickId, year | null) は選び直した後の snapshot を返す（なければ選び直しできない）。
 * options.onRender(result) は表示のたびに呼ぶ（保存用のまとめを更新するため）。
 */
export async function showCareer(rootId, snapshot, { onChange = null, onRender = null } = {}) {
  const root = $(rootId);
  if (!root) return;
  root.hidden = false;
  mounts.set(rootId, { snapshot, onChange, onRender, result: null });
  if (!app.players) {
    root.innerHTML = `
      <div class="career-band"><p class="career-kicker">ANSWER CHECK</p><h2 class="career-title">答え合わせ</h2></div>
      <div class="pl-loading"><span class="loading-ball" aria-hidden="true"></span><p>選手データを読み込み中…</p></div>`;
    try {
      await loadPlayers();
    } catch {
      if (mounts.get(rootId)?.snapshot !== snapshot) return;
      root.innerHTML = `
        <div class="career-band"><p class="career-kicker">ANSWER CHECK</p><h2 class="career-title">答え合わせ</h2></div>
        <p class="pl-empty">選手データを読み込めませんでした。通信状態を確かめてください。</p>
        <button type="button" class="btn btn-wide" data-career-retry>もう一度読み込む</button>`;
      return;
    }
  }
  if (mounts.get(rootId)?.snapshot !== snapshot) return; // 読み込み中に別のチームを開いた
  render(rootId);
}

export function hideCareer(rootId) {
  mounts.delete(rootId);
  const root = $(rootId);
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
}

// ---------------------------------------------------------------------------
// 年度を選ぶシート
// ---------------------------------------------------------------------------

function seasonExtra(season, kind) {
  if (kind === "lineup" || kind === "bench") return `${season.G}試合・${season.PA}打席`;
  return `${season.G}登板・${season.IP}回`;
}

function openSeasonSheet(rootId, pickId) {
  const m = mounts.get(rootId);
  const slot = m?.result?.slots.find((s) => s.player?.pickId === pickId);
  if (!slot) return;
  unlockAudio();
  sfx.select();
  picking = { rootId, pickId };
  const where = slot.kind === "lineup" ? `${slot.order}番・${POSITION_NAMES[slot.field] || slot.field}` : KIND_LABELS[slot.kind];
  $("sd-title").textContent = slot.player.name;
  $("sd-meta").textContent = `${where}の年度を選ぶ`;
  $("sd-rule").textContent = `自動で選ぶ年度：${AUTO_RULE[slot.kind]}`;
  const options = [...slot.seasons].reverse().map((s) => {
    const score = seasonScore(s, slot.kind);
    const selected = s.year === slot.year;
    const isAuto = s.year === slot.autoYear;
    return `
      <li>
        <button type="button" class="season-opt${selected ? " is-selected" : ""}" data-year="${s.year}" aria-pressed="${selected}">
          <span class="so-year">${s.year}</span>
          <span class="so-main">
            <span class="so-team">${esc(s.team)}<span class="so-extra">${seasonExtra(s, slot.kind)}</span>${
              isAuto ? `<span class="cr-badge">キャリアハイ</span>` : ""
            }</span>
            <span class="cr-stats">${statsHTML(s, slot.kind)}</span>
          </span>
          ${gradeHTML(rankOf(score), score)}
        </button>
      </li>`;
  });
  $("sd-list").innerHTML = options.join("");
  const dlg = $("season-dialog");
  if (!dlg.open) dlg.showModal();
  const sel = $("sd-list").querySelector(".is-selected");
  $("sd-list").scrollTop = 0;
  sel?.scrollIntoView({ block: "center" });
}

function chooseYear(year) {
  if (!picking) return;
  const { rootId, pickId } = picking;
  const m = mounts.get(rootId);
  const slot = m?.result?.slots.find((s) => s.player?.pickId === pickId);
  if (!m || !slot || !m.onChange) return;
  const next = m.onChange(pickId, year === slot.autoYear ? null : year);
  if (next) m.snapshot = next;
  sfx.place();
  $("season-dialog").close();
  render(rootId);
}

export function initCareer() {
  const dlg = $("season-dialog");
  $("sd-close").addEventListener("click", () => dlg.close());
  $("sd-info").addEventListener("click", () => {
    if (picking) openPlayerByPickId(picking.pickId);
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) {
      dlg.close();
      return;
    }
    const opt = e.target.closest("button[data-year]");
    if (opt) chooseYear(Number(opt.dataset.year));
  });
  dlg.addEventListener("close", () => {
    picking = null;
  });
  // 答え合わせの選手をタップしたら年度を選ぶシートを開く（入れ物は描き直されるので document で受ける）
  document.addEventListener("click", (e) => {
    const row = e.target.closest("button[data-season]");
    if (row) {
      const root = row.closest("[data-career-root]");
      if (root) openSeasonSheet(root.id, row.dataset.season);
      return;
    }
    const retry = e.target.closest("button[data-career-retry]");
    if (retry) {
      const root = retry.closest("[data-career-root]");
      const m = root && mounts.get(root.id);
      if (m) showCareer(root.id, m.snapshot, m);
    }
  });
}
