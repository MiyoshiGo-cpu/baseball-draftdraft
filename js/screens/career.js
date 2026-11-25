// 答え合わせ（完成画面と保存したチームの画面）：各選手のキャリアハイと、チームの総合力（簡易 WAR）。
// 選手をタップすると年度を選ぶシートが開き、ほかの年度に選び直せる。

import { $, esc } from "../dom.js";
import { app, loadPlayers } from "../app.js";
import { AUTO_RULE, RELIEF_IP, careerTeam, fmtWar, seasonValue, statLine } from "../career.js";
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

/** ランク（S〜E）と WAR の札 */
function gradeHTML(rank, war) {
  return `<span class="grade grade-${rank}"><b>${rank}</b><small>${war === null ? "-" : fmtWar(war)}</small></span>`;
}

/** 中継ぎ・抑えの枠で割り引いたときの注記 */
function scaledNote(value) {
  return value.scaled ? `<span class="cr-note">シーズン WAR ${fmtWar(value.seasonWar)} を${RELIEF_IP}回分に換算</span>` : "";
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
    return `<li><div class="cr-row is-empty">${slotLabelHTML(slot)}<span class="cr-main"><span class="cr-empty">空き</span></span>${gradeHTML("E", null)}<span></span></div></li>`;
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
      ${scaledNote(slot)}
    </span>
    ${gradeHTML(slot.rank, slot.season ? slot.war : null)}`;
  if (editable && slot.seasons.length) {
    return `<li><button type="button" class="cr-row" data-season="${esc(p.pickId)}" aria-label="${esc(p.name)}の年度を選び直す">${inner}<span class="cr-chev">${chevron}</span></button></li>`;
  }
  return `<li><div class="cr-row">${inner}<span></span></div></li>`;
}

/** 打線・投手陣の WAR の棒（full は棒がいっぱいになる WAR） */
function barHTML(label, part, full, cls) {
  const width = Math.max(2, Math.min(100, (part.war / full) * 100));
  return `
    <div class="cbar">
      <span class="cbar-label">${label}</span>
      <span class="cbar-track"><span class="cbar-fill ${cls}" style="width:${width}%"></span></span>
      <b class="cbar-score">${fmtWar(part.war)}</b>
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
      <p class="career-lead">指名した選手のキャリアハイの WAR で、チームの強さを予想しました。</p>
    </div>
    <div class="career-score">
      <div class="rank-emblem rank-${total.rank}" aria-label="総合力 ${total.rank}ランク、予想 ${total.wins}勝">
        <span class="re-label">総合力</span>
        <span class="re-rank">${total.rank}</span>
        <span class="re-score">${total.wins}<small>勝</small></span>
      </div>
      <div class="career-score-main">
        <p class="career-record">予想 <b>${total.wins}</b>勝<b>${total.losses}</b>敗<span class="career-label">${esc(total.label)}</span></p>
        <p class="career-war">チーム WAR <b>${fmtWar(total.war)}</b></p>
        <div class="career-bars">
          ${barHTML("打線", result.batting, 40, "cbar-bat")}
          ${barHTML("投手陣", result.pitching, 25, "cbar-pit")}
        </div>
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
      <summary>WAR と採点のしかた</summary>
      <ul>
        <li><b>WAR</b> は「控えレベルの選手と比べて、その年に何勝ぶん上積みしたか」です。公式の NPB の WAR は公開されていないので、このアプリが成績から計算した目安です。その年のリーグ平均と比べるので、投高打低などの時代の差は補正されます。</li>
        <li>打者は、打撃（出塁と長打の価値）、守備位置（捕手・遊撃は加点、一塁は減点）、出場の多さから計算します。守備の上手さ・走塁・球場の違いは入りません。投手は、防御率がリーグ平均よりどれだけ良いかと投球回から計算し、接戦の終盤に投げた救援（セーブ・ホールド）は少し重く数えます。</li>
        <li>年度は、その枠での WAR が最も高い年を自動で選びます（打者の枠は打撃、投手の枠は投手の WAR）。中継ぎ・抑えの枠は投げる回数が少ないので、${RELIEF_IP}回を超える年は${RELIEF_IP}回分に割り引いて数えます。投手の枠に一軍の投手成績がない選手を入れると、その枠は0です（打者の枠も同じ）。</li>
        <li>ランクは、選手は WAR 7以上で S（MVP 級）、5以上で A、3以上で B、2以上で C、1以上で D です。中継ぎ・抑えは 3.5・2.5・1.5・1・0.5 で区切ります。</li>
        <li>チームは、17人の WAR の合計（控えは出場が少ないので 1/4）に、控えレベルの選手だけのチームの勝ち数（143試合で42勝）を足して、予想勝利数を出します。100勝以上で S、90勝以上で A、82勝以上で B、74勝以上で C、66勝以上で D です。</li>
        <li>成績は NPB の一軍のみで、Wikipedia 日本語版の各選手の記事から、リーグ平均は NPB.jp の年度別成績から作っています。赤の太字はリーグ1位です。</li>
      </ul>
    </details>`;
}

function render(rootId) {
  const m = mounts.get(rootId);
  const root = $(rootId);
  if (!m || !root) return;
  m.result = careerTeam(m.snapshot, app.players, app.leagues);
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
    const value = seasonValue(s, slot.kind);
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
            ${scaledNote(value)}
          </span>
          ${gradeHTML(value.rank, value.seasonWar === null ? null : value.war)}
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
