// 画面の描画とイベント。ルールは game.js、保存は storage.js、共有は share.js に任せる。

import * as G from "./game.js";
import { parseSeedParam, randomSeed, seedToState } from "./roulette.js";
import * as storage from "./storage.js";
import { buildShareText, copyText, drawShareImage, pickMeta, saveCanvasImage } from "./share.js";
import { eraShort, shortYear } from "./teams.js";
import { setSoundEnabled, sfx, unlockAudio } from "./sound.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const media = (q) => Boolean(window.matchMedia?.(q).matches);
const reduceMotion = () => media("(prefers-reduced-motion: reduce)");
const isNarrow = () => media("(max-width: 959px)");

const seedParam = parseSeedParam(location.search);

/** @type {ReturnType<typeof G.indexData>} */
let data = null;
/** ゲーム状態（localStorage に保存する） */
let state = null;
/** 画面だけの一時状態（保存しない） */
const ui = {
  selected: null, // 名鑑で選んでいる pickId
  spinning: false,
  place: null, // 配置モーダルの選択 { pickId, kind, pos, order }
  justPlaced: null,
  lastStatus: null,
  savedView: null, // 保存一覧で開いているチームの id
};

// ---------------------------------------------------------------------------
// 表示用の小さな関数
// ---------------------------------------------------------------------------

const slotShort = (franchiseId) => data.franchises.get(franchiseId)?.short || "";
const draftShort = (d) => eraShort(d.teamName, slotShort(d.franchiseId));

function settingsBrief(s) {
  return [
    `${s.yearFrom}〜${s.yearTo}年`,
    `パス${s.passLimit}`,
    `育成${s.includeIkusei ? "あり" : "なし"}`,
    `入団拒否${s.includeUnsigned ? "あり" : "なし"}`,
    s.pitcherFielderRule === "strict" ? "厳格" : "ゆるめ",
  ].join("・");
}

function slotLabel(slot) {
  const s = G.parseSlot(slot);
  if (s.kind === "lineup") return `${s.order}番・${G.POSITION_NAMES[s.pos]}`;
  return G.KIND_LABELS[s.kind];
}

function groupLabel(pick) {
  if (pick.twoWay) return "二刀流";
  return pick.group === "P" ? "投手" : "野手";
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fileStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

/** このゲームのチームを表す id（同じチームを二重に保存しないため）。 */
function teamId() {
  const key = JSON.stringify([state.seed, state.usedPairs, state.roster]);
  return `t${seedToState(key).toString(36)}${state.usedPairs.length.toString(36)}`;
}

let toastTimer = 0;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 2600);
}

function scrollToCard(id) {
  const el = $(id);
  if (!el || el.hidden) return;
  el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
}

function persist() {
  storage.saveCurrent(state);
  storage.saveSettings(state.settings);
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

async function init() {
  try {
    const res = await fetch("data/drafts.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = G.indexData(await res.json());
  } catch {
    const el = $("loading");
    el.classList.add("is-error");
    el.textContent =
      "指名データを読み込めませんでした。ファイルを直接開いている場合は、python3 -m http.server で起動して http://localhost:8000/ を開いてください。";
    return;
  }

  const restored = G.restoreState(storage.loadCurrent(), data);
  if (restored && (seedParam === null || restored.seed === seedParam)) {
    state = restored;
  } else {
    state = G.createGame(storage.loadSettings() || {}, seedParam ?? randomSeed());
  }
  setSoundEnabled(state.settings.sound);

  buildSettingsForm();
  bindEvents();
  $("loading").remove();
  for (const id of ["settings", "roulette", "team", "history"]) $(id).hidden = false;
  $("app").setAttribute("aria-busy", "false");
  persist();
  render();
  document.documentElement.dataset.ready = "1";
}

function buildSettingsForm() {
  const years = [];
  for (let y = data.yearMin; y <= data.yearMax; y++) years.push(`<option value="${y}">${y}年</option>`);
  $("set-year-from").innerHTML = years.join("");
  $("set-year-to").innerHTML = years.join("");
  $("set-pass").innerHTML = Array.from({ length: G.PASS_LIMIT_MAX + 1 }, (_, i) => `<option value="${i}">${i}回</option>`).join("");
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

function render() {
  renderHeader();
  renderSettings();
  renderResult();
  renderRoulette();
  renderDirectory();
  renderTeam();
  renderHistory();
  ui.lastStatus = state.status;
}

function renderHeader() {
  const on = state.settings.sound;
  const btn = $("btn-sound");
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "効果音：ON" : "効果音：OFF");
  btn.title = on ? "効果音：ON（タップでOFF）" : "効果音：OFF（タップでON）";
  $("footer-seed").textContent = `シード：${state.seed}`;
}

function renderSettings() {
  const s = state.settings;
  const locked = state.status !== "setup";
  const details = $("settings");
  if (ui.lastStatus !== state.status) details.open = !locked;
  details.classList.toggle("is-locked", locked);
  $("settings-brief").textContent = locked ? `${settingsBrief(s)}（変更はリセット後）` : settingsBrief(s);

  $("set-year-from").value = String(s.yearFrom);
  $("set-year-to").value = String(s.yearTo);
  $("set-pass").value = String(s.passLimit);
  $("set-ikusei").checked = s.includeIkusei;
  $("set-unsigned").checked = s.includeUnsigned;
  for (const r of document.querySelectorAll('input[name="rule"]')) r.checked = r.value === s.pitcherFielderRule;
  for (const el of $("settings-form").querySelectorAll("input, select")) el.disabled = locked;

  $("rule-help").textContent =
    s.pitcherFielderRule === "strict"
      ? "投手は投手枠だけ、野手はスタメン・控えだけに入れられます（二刀流の選手は例外）。"
      : "投手もスタメン・控えに入れられます。野手を投手枠に入れることはできません。";

  const check = G.canStart(s, data);
  const pc = $("pair-count");
  pc.classList.toggle("is-error", !check.ok);
  pc.textContent = check.ok ? `対象の「球団×年度」：${check.count}組` : check.message;
}

function renderResult() {
  const el = $("result");
  const done = state.status === "complete" || state.status === "stuck";
  el.hidden = !done;
  if (!done) return;
  const complete = state.status === "complete";
  const filled = G.filledCount(state.roster);
  const saved = complete && storage.isSaved(teamId());
  el.classList.toggle("is-stuck", !complete);
  el.innerHTML = `
    <p class="result-kicker">${complete ? "TEAM COMPLETE" : "GAME OVER"}</p>
    <h2 class="result-title">${complete ? "完成！" : "未完成で終了"}</h2>
    <p class="result-stats">スピン<b>${G.spinCount(state)}</b>回・パス<b>${state.passesUsed}</b>回${
      complete ? "" : `・${filled}/${G.TOTAL_SLOTS}人`
    }</p>
    ${complete ? "" : `<p class="result-note">抽選できる「球団×年度」がなくなりました。</p>`}
    <div class="result-actions">
      <button type="button" class="btn" data-act="copy">テキストでコピー</button>
      <button type="button" class="btn" data-act="image">画像を保存</button>
      ${
        complete
          ? `<button type="button" class="btn" data-act="save" ${saved ? "disabled" : ""}>${saved ? "保存済み" : "この編成を保存"}</button>`
          : ""
      }
      <button type="button" class="btn btn-primary" data-act="again">もう一度遊ぶ</button>
    </div>`;
}

function renderRoulette() {
  const done = state.status === "complete" || state.status === "stuck";
  $("roulette").hidden = done;
  if (done) return;
  const check = state.status === "setup" ? G.canStart(state.settings, data) : { ok: true };
  const btn = $("btn-spin");
  btn.disabled = ui.spinning || Boolean(state.current) || !check.ok;
  btn.textContent = ui.spinning ? "回転中…" : "ルーレットを回す";
  btn.classList.toggle("is-waiting", Boolean(state.current) && !ui.spinning);

  $("count-spins").textContent = String(G.spinCount(state));
  $("count-passes").textContent = String(G.passesLeft(state));
  $("count-team").textContent = String(G.filledCount(state.roster));

  let hint = "";
  if (ui.spinning) hint = "";
  else if (state.status === "setup") hint = check.ok ? "設定を確かめて、ルーレットを回してください。" : "年度範囲を広げてください。";
  else if (state.current) hint = "名鑑から1人選んでチームに追加するか、パスしてください。";
  else hint = "ルーレットを回してください。";
  $("spin-hint").textContent = hint;

  if (!ui.spinning) setReelsStatic();
}

function setReelsStatic() {
  const last = state.current || state.history.at(-1) || null;
  const d = last ? data.pairs.get(G.pairKey(last.year, last.franchiseId)) : null;
  const dim = !state.current;
  setReel($("reel-team"), d ? draftShort(d) : "？", dim);
  setReel($("reel-year"), d ? `${d.year}` : "？", dim);
}

function setReel(reel, text, dim) {
  const strip = reel.querySelector(".reel-strip");
  for (const a of strip.getAnimations?.() || []) a.cancel();
  strip.style.transform = "";
  strip.innerHTML = `<div class="reel-item">${esc(text)}</div>`;
  reel.classList.toggle("is-dim", dim);
  reel.classList.remove("is-spinning");
}

function renderDirectory() {
  const el = $("directory");
  const d = G.currentDraft(state, data);
  el.hidden = !d || ui.spinning;
  if (!d || ui.spinning) return;

  const picks = G.currentPicks(state, data);
  $("directory-title").innerHTML = `${d.year}年 ${esc(d.teamName)}<span class="directory-count">（指名${picks.length}人）</span>`;
  if (ui.selected && !picks.some((p) => p.id === ui.selected && !G.pickableReason(state, p, data))) ui.selected = null;

  let anyPickable = false;
  const rows = picks.map((p) => {
    const reason = G.pickableReason(state, p, data);
    if (!reason) anyPickable = true;
    const selected = ui.selected === p.id;
    const badges = [
      p.twoWay ? `<span class="badge badge-twoway">二刀流</span>` : "",
      p.draftType === "ikusei" ? `<span class="badge badge-ikusei">育成</span>` : "",
      p.signed ? "" : `<span class="badge badge-unsigned">入団せず</span>`,
    ].join("");
    return `
      <li>
        <button type="button" class="pick${selected ? " is-selected" : ""}${reason ? " is-disabled" : ""}"
          data-pick="${esc(p.id)}" aria-pressed="${selected}" ${reason ? 'aria-disabled="true"' : ""}>
          <span class="pick-round">${esc(p.roundLabel)}</span>
          <span class="pick-main">
            <span class="pick-name">${esc(p.name)}</span>
            <span class="pick-sub"><span class="pos pos-${p.group}">${esc(p.pos)}</span>${esc(p.from)}</span>
            ${p.note && !p.signed ? `<span class="pick-note">${esc(p.note)}</span>` : ""}
            ${reason ? `<span class="pick-reason">${esc(reason)}</span>` : ""}
          </span>
          <span class="pick-badges">${badges}</span>
        </button>
      </li>`;
  });
  $("pick-list").innerHTML = rows.join("");

  const left = G.passesLeft(state);
  const bar = $("action-bar");
  if (!anyPickable) {
    bar.innerHTML = `
      <p class="action-note">この中に配置できる選手がいません。パスを使わずに次へ進めます。</p>
      <button type="button" class="btn btn-primary btn-wide" data-act="skip">自動スキップして次へ</button>`;
  } else {
    const sel = ui.selected ? data.picks.get(ui.selected) : null;
    bar.innerHTML = `
      <p class="action-note">${sel ? `選択中：<b>${esc(sel.name)}</b>（${esc(sel.pos)}）` : "選手をタップして選んでください"}</p>
      <div class="action-buttons">
        <button type="button" class="btn" data-act="pass" ${left === 0 ? "disabled" : ""}>パス（残り${left}）</button>
        <button type="button" class="btn btn-primary" data-act="add" ${sel ? "" : "disabled"}>チームに追加</button>
      </div>`;
  }
}

/** チーム表示（マイチームと保存一覧で共通）。 */
function teamHTML(snapshot, { highlight = null } = {}) {
  const meta = (p) => esc(pickMeta(p, slotShort(p.franchiseId)));
  const cls = (p) => (p ? `slot is-filled${highlight && p.pickId === highlight ? " is-new" : ""}` : "slot is-empty");
  const row = (label, p, extra = "") => `
    <li class="${cls(p)}">
      <span class="slot-label">${label}</span>${extra}
      ${
        p
          ? `<span class="slot-player"><span class="slot-name">${esc(p.name)}</span><span class="slot-meta">${meta(p)}</span></span>`
          : `<span class="slot-player slot-empty-text">空き</span>`
      }
    </li>`;
  const lineup = snapshot.lineup
    .map((r) => row(`${r.order}`, r.player, `<span class="slot-pos">${r.field ? esc(r.field) : ""}</span>`))
    .join("");
  const list = (label, players) => players.map((p) => row(label, p)).join("");
  return `
    <h3 class="team-sub">スタメン</h3>
    <ol class="slot-list slot-lineup">${lineup}</ol>
    <h3 class="team-sub">控え</h3>
    <ul class="slot-list">${list("控え", snapshot.bench)}</ul>
    <h3 class="team-sub">投手陣</h3>
    <ul class="slot-list">${list("先発", snapshot.SP)}${list("中継ぎ", snapshot.RP)}${list("抑え", snapshot.CL)}</ul>`;
}

function renderTeam() {
  const n = G.filledCount(state.roster);
  $("team-progress").textContent = `${n} / ${G.TOTAL_SLOTS}`;
  $("team-progress-bar").style.width = `${(n / G.TOTAL_SLOTS) * 100}%`;
  $("team-body").innerHTML = teamHTML(G.teamSnapshot(state, data), { highlight: ui.justPlaced });
  ui.justPlaced = null;
}

function renderHistory() {
  const list = $("history-list");
  if (state.history.length === 0) {
    list.innerHTML = `<li class="history-empty">まだスピンしていません。</li>`;
    return;
  }
  list.innerHTML = [...state.history]
    .reverse()
    .map((h) => {
      const d = data.pairs.get(G.pairKey(h.year, h.franchiseId));
      let result;
      let cls = "";
      if (h.action === "pick") {
        const p = data.picks.get(h.pickId);
        result = `<b>${esc(p?.name)}</b> → ${esc(slotLabel(h.slot))}`;
      } else if (h.action === "pass") {
        result = "パス";
        cls = " is-pass";
      } else {
        result = "自動スキップ";
        cls = " is-skip";
      }
      return `
        <li class="history-item${cls}">
          <span class="history-n">${h.n}</span>
          <span class="history-pair">${h.year}年 ${esc(d?.teamName)}</span>
          <span class="history-result">${result}</span>
        </li>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// ルーレットの演出
// ---------------------------------------------------------------------------

function randomItems(pool, count, avoid) {
  const out = [];
  let prev = avoid;
  for (let i = 0; i < count; i++) {
    let v = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) while (v === prev) v = pool[Math.floor(Math.random() * pool.length)];
    out.push(v);
    prev = v;
  }
  return out;
}

function animateReel(reel, items, duration) {
  return new Promise((resolve) => {
    const strip = reel.querySelector(".reel-strip");
    const win = reel.querySelector(".reel-window");
    for (const a of strip.getAnimations?.() || []) a.cancel();
    strip.innerHTML = items.map((t) => `<div class="reel-item">${esc(t)}</div>`).join("");
    reel.classList.remove("is-dim");
    reel.classList.add("is-spinning");
    const h = win.clientHeight || 64;
    const dist = (items.length - 1) * h;
    const finish = () => {
      setReel(reel, items.at(-1), false);
      reel.classList.add("is-landed");
      setTimeout(() => reel.classList.remove("is-landed"), 500);
      sfx.stop();
      resolve();
    };
    if (!strip.animate || duration <= 0) {
      finish();
      return;
    }
    const anim = strip.animate([{ transform: "translateY(0)" }, { transform: `translateY(-${dist}px)` }], {
      duration,
      easing: "cubic-bezier(0.1, 0.55, 0.15, 1)",
      fill: "forwards",
    });
    let lastIndex = 0;
    let raf = 0;
    const loop = () => {
      try {
        const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
        const idx = Math.round(-m.m42 / h);
        if (idx !== lastIndex) {
          lastIndex = idx;
          sfx.tick();
        }
      } catch {
        // 位置が読めなくても演出は続ける
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    anim.finished
      .catch(() => {})
      .then(() => {
        cancelAnimationFrame(raf);
        finish();
      });
  });
}

async function animateReels(draft) {
  const short = reduceMotion();
  const teamPool = data.franchiseList.map((f) => f.short);
  const yearPool = [];
  for (let y = state.settings.yearFrom; y <= state.settings.yearTo; y++) yearPool.push(String(y));
  const teamItems = [...randomItems(teamPool, short ? 2 : 22, draftShort(draft)), draftShort(draft)];
  const yearItems = [...randomItems(yearPool, short ? 2 : 28, String(draft.year)), String(draft.year)];
  await Promise.all([
    animateReel($("reel-team"), teamItems, short ? 200 : 1150),
    animateReel($("reel-year"), yearItems, short ? 250 : 1500),
  ]);
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

async function onSpin() {
  unlockAudio();
  if (ui.spinning) return;
  let next;
  try {
    next = G.spin(state, data);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  state = next;
  ui.selected = null;
  persist();
  if (state.status === "stuck") {
    render();
    scrollToCard("result");
    return;
  }
  ui.spinning = true;
  render();
  await animateReels(G.currentDraft(state, data));
  ui.spinning = false;
  sfx.reveal();
  render();
  if (isNarrow()) scrollToCard("directory");
}

function onSelectPick(pickId) {
  const pick = data.picks.get(pickId);
  if (!pick) return;
  const reason = G.pickableReason(state, pick, data);
  if (reason) {
    sfx.error();
    toast(`${pick.name}：${reason}`);
    return;
  }
  ui.selected = ui.selected === pickId ? null : pickId;
  if (ui.selected) sfx.select();
  renderDirectory();
}

function afterResolve(message) {
  persist();
  render();
  if (state.status === "complete") {
    sfx.complete();
    scrollToCard("result");
    return;
  }
  if (state.status === "stuck") {
    sfx.error();
    scrollToCard("result");
    return;
  }
  toast(message);
  if (isNarrow()) scrollToCard("roulette");
}

function onPass() {
  unlockAudio();
  try {
    state = G.pass(state, data);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  ui.selected = null;
  sfx.pass();
  afterResolve(`パスしました（残り${G.passesLeft(state)}回）`);
}

function onAutoSkip() {
  unlockAudio();
  try {
    state = G.autoSkip(state, data);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  ui.selected = null;
  sfx.pass();
  afterResolve("自動スキップしました（パスは減りません）");
}

function newGame() {
  state = G.createGame(state.settings, seedParam ?? randomSeed());
  ui.selected = null;
  ui.place = null;
  ui.lastStatus = null;
  persist();
  render();
  window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
}

function onReset() {
  unlockAudio();
  if (ui.spinning) return;
  if (state.status === "playing" && !window.confirm("ゲームをリセットしますか？\n進行中のチームは消えます。")) return;
  newGame();
  toast("リセットしました");
}

function onSettingChange(event) {
  const t = event.target;
  const s = state.settings;
  let patch = null;
  if (t.id === "set-year-from") {
    const v = Number(t.value);
    patch = { yearFrom: v, yearTo: Math.max(v, s.yearTo) };
  } else if (t.id === "set-year-to") {
    const v = Number(t.value);
    patch = { yearTo: v, yearFrom: Math.min(v, s.yearFrom) };
  } else if (t.id === "set-pass") patch = { passLimit: Number(t.value) };
  else if (t.id === "set-ikusei") patch = { includeIkusei: t.checked };
  else if (t.id === "set-unsigned") patch = { includeUnsigned: t.checked };
  else if (t.name === "rule") patch = { pitcherFielderRule: t.value };
  if (!patch) return;
  try {
    state = G.updateSettings(state, patch);
  } catch (e) {
    toast(e.message);
  }
  persist();
  render();
}

function onToggleSound() {
  state = G.updateSettings(state, { sound: !state.settings.sound });
  setSoundEnabled(state.settings.sound);
  unlockAudio();
  if (state.settings.sound) sfx.select();
  persist();
  renderHeader();
  toast(state.settings.sound ? "効果音：ON" : "効果音：OFF");
}

// ---- 配置モーダル ----

function openPlaceDialog() {
  unlockAudio();
  const pick = ui.selected ? data.picks.get(ui.selected) : null;
  if (!pick) return;
  const reason = G.pickableReason(state, pick, data);
  if (reason) {
    toast(reason);
    return;
  }
  const slots = G.openSlots(state, pick);
  ui.place = { pickId: pick.id, kind: slots.length === 1 ? slots[0].kind : null, pos: null, order: null };
  renderPlaceDialog();
  $("place-dialog").showModal();
}

function renderPlaceDialog() {
  const p = ui.place;
  const pick = data.picks.get(p.pickId);
  const d = data.pickDraft.get(p.pickId);
  $("pd-title").innerHTML = `${esc(pick.name)}<span class="pill pill-${pick.twoWay ? "W" : pick.group}">${groupLabel(pick)}</span>`;
  $("pd-meta").textContent = `${shortYear(d.year)} ${draftShort(d)} ${pick.roundLabel}・${pick.pos}・${pick.from}`;

  const open = new Map(G.openSlots(state, pick).map((s) => [s.kind, s.free]));
  const kinds = G.allowedKinds(pick, state.settings);
  $("pd-kinds").innerHTML = kinds
    .map((kind) => {
      const free = open.get(kind) || 0;
      const on = p.kind === kind;
      return `<button type="button" class="choice${on ? " is-on" : ""}" data-kind="${kind}" aria-pressed="${on}" ${free ? "" : "disabled"}>
          <span class="choice-label">${G.KIND_LABELS[kind]}</span><span class="choice-sub">${free ? `空き${free}` : "満杯"}</span>
        </button>`;
    })
    .join("");

  const lineup = p.kind === "lineup";
  $("pd-lineup").hidden = !lineup;
  if (lineup) {
    const freePos = new Set(G.freePositions(state.roster));
    const freeOrd = new Set(G.freeOrders(state.roster));
    $("pd-pos").innerHTML = G.POSITIONS.map((pos) => {
      const on = p.pos === pos;
      return `<button type="button" class="choice choice-sq${on ? " is-on" : ""}" data-pos="${pos}" aria-pressed="${on}" aria-label="${G.POSITION_NAMES[pos]}" ${freePos.has(pos) ? "" : "disabled"}>${pos}</button>`;
    }).join("");
    $("pd-order").innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((n) => {
        const on = p.order === n;
        return `<button type="button" class="choice choice-sq${on ? " is-on" : ""}" data-order="${n}" aria-pressed="${on}" aria-label="${n}番" ${freeOrd.has(n) ? "" : "disabled"}>${n}</button>`;
      })
      .join("");
  }

  let ready = false;
  let summary = "入れる枠を選んでください。";
  if (lineup) {
    if (p.pos && p.order) {
      ready = true;
      summary = `<b>${p.order}番・${G.POSITION_NAMES[p.pos]}</b>に入れます。`;
    } else {
      summary = "守備位置と打順を選んでください。";
    }
  } else if (p.kind) {
    ready = true;
    summary = `<b>${G.KIND_LABELS[p.kind]}</b>に入れます。`;
  }
  $("pd-summary").innerHTML = `${summary}<span class="warn">確定すると変更できません。</span>`;
  $("pd-confirm").disabled = !ready;
}

function onPlaceDialogClick(event) {
  const btn = event.target.closest("button[data-kind], button[data-pos], button[data-order]");
  if (!btn || btn.disabled || !ui.place) return;
  if (btn.dataset.kind) {
    ui.place.kind = btn.dataset.kind;
    if (ui.place.kind !== "lineup") {
      ui.place.pos = null;
      ui.place.order = null;
    }
  }
  if (btn.dataset.pos) ui.place.pos = btn.dataset.pos;
  if (btn.dataset.order) ui.place.order = Number(btn.dataset.order);
  sfx.select();
  renderPlaceDialog();
}

function onConfirmPlace() {
  const p = ui.place;
  if (!p) return;
  const slot = p.kind === "lineup" ? G.lineupSlot(p.order, p.pos) : p.kind;
  try {
    state = G.place(state, data, p.pickId, slot);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  const name = data.picks.get(p.pickId).name;
  ui.justPlaced = p.pickId;
  ui.selected = null;
  ui.place = null;
  $("place-dialog").close();
  if (state.status !== "complete") sfx.place();
  afterResolve(`${name}を${slotLabel(slot)}に入れました`);
}

// ---- 完成画面・共有 ----

async function shareText(snapshot) {
  const ok = await copyText(buildShareText(snapshot, slotShort));
  toast(ok ? "テキストをコピーしました" : "コピーできませんでした");
}

async function shareImage(snapshot, date = new Date()) {
  try {
    const canvas = drawShareImage(snapshot, slotShort, { dateText: formatDate(date.toISOString()) });
    const how = await saveCanvasImage(canvas, `draft-roulette-${fileStamp(date)}.png`);
    if (how === "downloaded") toast("画像を保存しました");
    else if (how === "shared") toast("画像を共有しました");
  } catch {
    toast("画像を作れませんでした");
  }
}

function onResultClick(event) {
  const btn = event.target.closest("button[data-act]");
  if (!btn) return;
  unlockAudio();
  const snapshot = G.teamSnapshot(state, data);
  switch (btn.dataset.act) {
    case "copy":
      shareText(snapshot);
      break;
    case "image":
      shareImage(snapshot);
      break;
    case "save": {
      const ok = storage.addSaved({ id: teamId(), savedAt: new Date().toISOString(), team: snapshot });
      toast(ok ? "保存しました（ヘッダーの「保存一覧」から見られます）" : "保存できませんでした（ブラウザの保存領域が使えません）");
      renderResult();
      break;
    }
    case "again":
      newGame();
      break;
  }
}

// ---- 保存一覧 ----

function openSavedDialog() {
  ui.savedView = null;
  renderSavedDialog();
  $("saved-dialog").showModal();
}

function renderSavedDialog() {
  const list = storage.loadSaved();
  const body = $("sd-body");
  const actions = $("sd-actions");
  const entry = ui.savedView ? list.find((x) => x.id === ui.savedView) : null;
  $("sd-back").hidden = !entry;
  if (!entry) {
    ui.savedView = null;
    $("sd-title").textContent = `保存したチーム（${list.length}）`;
    actions.hidden = true;
    body.innerHTML = list.length
      ? `<ul class="saved-list">${list
          .map((x) => {
            const names = x.team.lineup.map((r) => r.player?.name).filter(Boolean).join(" / ");
            return `<li><button type="button" class="saved-item" data-open="${esc(x.id)}">
                <span class="saved-date">${esc(formatDate(x.savedAt))}</span>
                <span class="saved-stats">スピン${x.team.spins}回・パス${x.team.passes}回</span>
                <span class="saved-names">${esc(names)}</span>
                ${x.team.settings ? `<span class="saved-settings">${esc(settingsBrief(x.team.settings))}</span>` : ""}
              </button></li>`;
          })
          .join("")}</ul>`
      : `<p class="empty-note">まだ保存したチームはありません。<br>完成画面の「この編成を保存」で保存できます（最大${storage.SAVED_MAX}件）。</p>`;
    return;
  }
  $("sd-title").textContent = formatDate(entry.savedAt);
  body.innerHTML = `
    <p class="saved-detail-stats">スピン${entry.team.spins}回・パス${entry.team.passes}回${
      entry.team.settings ? `<br><span>${esc(settingsBrief(entry.team.settings))}</span>` : ""
    }</p>
    <div class="team">${teamHTML(entry.team)}</div>`;
  actions.hidden = false;
  actions.innerHTML = `
    <button type="button" class="btn btn-danger" data-saved-act="delete">削除</button>
    <button type="button" class="btn" data-saved-act="copy">テキストでコピー</button>
    <button type="button" class="btn btn-primary" data-saved-act="image">画像を保存</button>`;
}

function onSavedClick(event) {
  const open = event.target.closest("button[data-open]");
  if (open) {
    ui.savedView = open.dataset.open;
    renderSavedDialog();
    $("sd-body").scrollTop = 0;
    return;
  }
  const act = event.target.closest("button[data-saved-act]");
  if (!act) return;
  const entry = storage.loadSaved().find((x) => x.id === ui.savedView);
  if (!entry) return;
  if (act.dataset.savedAct === "copy") shareText(entry.team);
  if (act.dataset.savedAct === "image") shareImage(entry.team, new Date(entry.savedAt));
  if (act.dataset.savedAct === "delete") {
    if (!window.confirm("このチームを削除しますか？")) return;
    storage.removeSaved(entry.id);
    ui.savedView = null;
    renderSavedDialog();
    if (state.status === "complete") renderResult();
    toast("削除しました");
  }
}

// ---------------------------------------------------------------------------
// イベント
// ---------------------------------------------------------------------------

function bindEvents() {
  $("btn-spin").addEventListener("click", onSpin);
  $("btn-reset").addEventListener("click", onReset);
  $("btn-sound").addEventListener("click", onToggleSound);
  $("btn-saved").addEventListener("click", openSavedDialog);
  $("settings-form").addEventListener("change", onSettingChange);
  $("settings-form").addEventListener("submit", (e) => e.preventDefault());

  $("pick-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-pick]");
    if (btn) onSelectPick(btn.dataset.pick);
  });
  $("action-bar").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === "add") openPlaceDialog();
    if (btn.dataset.act === "pass") onPass();
    if (btn.dataset.act === "skip") onAutoSkip();
  });

  const pd = $("place-dialog");
  pd.addEventListener("click", (e) => {
    if (e.target === pd) pd.close(); // 背景をタップしたら閉じる
    else onPlaceDialogClick(e);
  });
  pd.addEventListener("close", () => {
    ui.place = null;
  });
  $("pd-confirm").addEventListener("click", onConfirmPlace);

  $("result").addEventListener("click", onResultClick);

  const sd = $("saved-dialog");
  sd.addEventListener("click", (e) => {
    if (e.target === sd) sd.close();
    else onSavedClick(e);
  });
  $("sd-close").addEventListener("click", () => sd.close());
  $("sd-back").addEventListener("click", () => {
    ui.savedView = null;
    renderSavedDialog();
  });

  // 別のタブで進めた場合などに備え、戻ってきたら保存内容と揃える
  window.addEventListener("storage", (e) => {
    if (e.key !== storage.KEYS.current || ui.spinning) return;
    const next = G.restoreState(storage.loadCurrent(), data);
    if (next) {
      state = next;
      render();
    }
  });
}

init();
