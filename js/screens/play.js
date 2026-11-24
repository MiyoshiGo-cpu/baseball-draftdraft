// ルール設定画面（#/setup）とゲーム画面（#/game）。

import * as G from "../game.js";
import * as storage from "../storage.js";
import { shortYear } from "../teams.js";
import { sfx, unlockAudio } from "../sound.js";
import { $, esc, isNarrow, reduceMotion, scrollToEl, toast } from "../dom.js";
import { go, goUp } from "../router.js";
import {
  app,
  draftShort,
  groupLabel,
  hasGameInProgress,
  loadRuleSettings,
  persistGame,
  progressText,
  saveRuleSettings,
  settingsBrief,
  shareImage,
  shareText,
  slotLabel,
  startNewGame,
  teamHTML,
  teamId,
} from "../app.js";

/** 画面だけの一時状態（保存しない） */
const ui = {
  setup: null, // ルール設定画面で編集中の設定
  formBuilt: false,
  selected: null, // 名鑑で選んでいる pickId
  spinning: false,
  place: null, // 配置モーダルの選択 { pickId, kind, pos, order }
  justPlaced: null,
};

// ===========================================================================
// ルール設定画面
// ===========================================================================

function buildSettingsForm() {
  if (ui.formBuilt) return;
  const { data } = app;
  const years = [];
  for (let y = data.yearMin; y <= data.yearMax; y++) years.push(`<option value="${y}">${y}年</option>`);
  $("set-year-from").innerHTML = years.join("");
  $("set-year-to").innerHTML = years.join("");
  $("set-pass").innerHTML = Array.from({ length: G.PASS_LIMIT_MAX + 1 }, (_, i) => `<option value="${i}">${i}回</option>`).join(
    "",
  );
  ui.formBuilt = true;
}

function renderSetup() {
  const s = ui.setup;
  $("set-year-from").value = String(s.yearFrom);
  $("set-year-to").value = String(s.yearTo);
  $("set-pass").value = String(s.passLimit);
  $("set-ikusei").checked = s.includeIkusei;
  $("set-unsigned").checked = s.includeUnsigned;
  for (const r of document.querySelectorAll('input[name="rule"]')) r.checked = r.value === s.pitcherFielderRule;

  $("rule-help").textContent =
    s.pitcherFielderRule === "strict"
      ? "投手は投手枠だけ、野手はスタメン・控えだけに入れられます（二刀流の選手は例外）。"
      : "投手もスタメン・控えに入れられます。野手を投手枠に入れることはできません。";

  const check = G.canStart(s, app.data);
  const pc = $("pair-count");
  pc.classList.toggle("is-error", !check.ok);
  pc.textContent = check.ok ? `対象の「球団×年度」：${check.count}組` : check.message;
  $("btn-playball").disabled = !check.ok;

  const warn = $("setup-warning");
  warn.hidden = !hasGameInProgress();
  if (hasGameInProgress()) {
    warn.textContent = `進行中のゲーム（${progressText(app.state)}）は、プレイボールすると消えます。`;
  }
}

function onSetupChange(event) {
  const t = event.target;
  const s = ui.setup;
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
  ui.setup = G.normalizeSettings({ ...s, ...patch });
  saveRuleSettings(ui.setup);
  renderSetup();
}

function onSetupDefault() {
  ui.setup = G.normalizeSettings({ ...G.DEFAULT_SETTINGS, sound: ui.setup.sound });
  saveRuleSettings(ui.setup);
  renderSetup();
  toast("初期設定に戻しました");
}

function onPlayBall() {
  unlockAudio();
  const check = G.canStart(ui.setup, app.data);
  if (!check.ok) {
    sfx.error();
    toast(check.message);
    return;
  }
  if (hasGameInProgress() && !window.confirm("進行中のゲームは消えます。新しく始めますか？")) return;
  startNewGame(ui.setup);
  ui.selected = null;
  ui.place = null;
  sfx.playball();
  go("game", { replace: true });
}

export const setupScreen = {
  title: "ルール設定",
  parent: "menu",
  needsData: true,
  enter() {
    buildSettingsForm();
    ui.setup = loadRuleSettings();
    renderSetup();
  },
};

// ===========================================================================
// ゲーム画面
// ===========================================================================

function renderGame() {
  const { state } = app;
  if (!state) return;
  $("rules-chip").textContent = settingsBrief(state.settings);
  $("footer-seed").textContent = `シード：${state.seed}`;
  renderResult();
  renderRoulette();
  renderDirectory();
  renderTeam();
  renderHistory();
}

function renderResult() {
  const { state } = app;
  const el = $("result");
  const done = state.status === "complete" || state.status === "stuck";
  el.hidden = !done;
  if (!done) return;
  const complete = state.status === "complete";
  const filled = G.filledCount(state.roster);
  const saved = complete && storage.isSaved(teamId(state));
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
      <button type="button" class="btn" data-act="menu">メニューへ</button>
    </div>`;
}

function renderRoulette() {
  const { state } = app;
  const done = state.status === "complete" || state.status === "stuck";
  $("roulette").hidden = done;
  if (done) return;
  const btn = $("btn-spin");
  btn.disabled = ui.spinning || Boolean(state.current);
  btn.textContent = ui.spinning ? "回転中…" : "ルーレットを回す";

  $("count-spins").textContent = String(G.spinCount(state));
  $("count-passes").textContent = String(G.passesLeft(state));
  $("count-team").textContent = String(G.filledCount(state.roster));

  let hint = "";
  if (ui.spinning) hint = "";
  else if (state.status === "setup") hint = "ルーレットを回して、最初の「球団×年度」を決めましょう。";
  else if (state.current) hint = "名鑑から1人選んでチームに追加するか、パスしてください。";
  else hint = "ルーレットを回してください。";
  $("spin-hint").textContent = hint;

  if (!ui.spinning) setReelsStatic();
}

function setReelsStatic() {
  const { state, data } = app;
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
  const { state, data } = app;
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

function renderTeam() {
  const { state, data } = app;
  const n = G.filledCount(state.roster);
  $("team-progress").textContent = `${n} / ${G.TOTAL_SLOTS}`;
  $("team-progress-bar").style.width = `${(n / G.TOTAL_SLOTS) * 100}%`;
  $("team-body").innerHTML = teamHTML(G.teamSnapshot(state, data), { highlight: ui.justPlaced });
  ui.justPlaced = null;
}

function renderHistory() {
  const { state, data } = app;
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

// ---- ルーレットの演出 ----

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
  const teamPool = app.data.franchiseList.map((f) => f.short);
  const yearPool = [];
  for (let y = app.state.settings.yearFrom; y <= app.state.settings.yearTo; y++) yearPool.push(String(y));
  const teamItems = [...randomItems(teamPool, short ? 2 : 22, draftShort(draft)), draftShort(draft)];
  const yearItems = [...randomItems(yearPool, short ? 2 : 28, String(draft.year)), String(draft.year)];
  await Promise.all([
    animateReel($("reel-team"), teamItems, short ? 200 : 1150),
    animateReel($("reel-year"), yearItems, short ? 250 : 1500),
  ]);
}

// ---- 操作 ----

async function onSpin() {
  unlockAudio();
  if (ui.spinning) return;
  let next;
  try {
    next = G.spin(app.state, app.data);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  app.state = next;
  ui.selected = null;
  persistGame();
  if (app.state.status === "stuck") {
    renderGame();
    scrollToEl("result");
    return;
  }
  ui.spinning = true;
  renderGame();
  await animateReels(G.currentDraft(app.state, app.data));
  ui.spinning = false;
  sfx.reveal();
  renderGame();
  if (isNarrow()) scrollToEl("directory");
}

function onSelectPick(pickId) {
  const pick = app.data.picks.get(pickId);
  if (!pick) return;
  const reason = G.pickableReason(app.state, pick, app.data);
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
  persistGame();
  renderGame();
  if (app.state.status === "complete") {
    sfx.complete();
    scrollToEl("result");
    return;
  }
  if (app.state.status === "stuck") {
    sfx.error();
    scrollToEl("result");
    return;
  }
  toast(message);
  if (isNarrow()) scrollToEl("roulette");
}

function onPass() {
  unlockAudio();
  try {
    app.state = G.pass(app.state, app.data);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  ui.selected = null;
  sfx.pass();
  afterResolve(`パスしました（残り${G.passesLeft(app.state)}回）`);
}

function onAutoSkip() {
  unlockAudio();
  try {
    app.state = G.autoSkip(app.state, app.data);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  ui.selected = null;
  sfx.pass();
  afterResolve("自動スキップしました（パスは減りません）");
}

// ---- 配置モーダル ----

function openPlaceDialog() {
  unlockAudio();
  const pick = ui.selected ? app.data.picks.get(ui.selected) : null;
  if (!pick) return;
  const reason = G.pickableReason(app.state, pick, app.data);
  if (reason) {
    toast(reason);
    return;
  }
  const slots = G.openSlots(app.state, pick);
  ui.place = { pickId: pick.id, kind: slots.length === 1 ? slots[0].kind : null, pos: null, order: null };
  renderPlaceDialog();
  $("place-dialog").showModal();
}

function renderPlaceDialog() {
  const { state, data } = app;
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
    app.state = G.place(app.state, app.data, p.pickId, slot);
  } catch (e) {
    sfx.error();
    toast(e.message);
    return;
  }
  const name = app.data.picks.get(p.pickId).name;
  ui.justPlaced = p.pickId;
  ui.selected = null;
  ui.place = null;
  $("place-dialog").close();
  if (app.state.status !== "complete") sfx.place();
  afterResolve(`${name}を${slotLabel(slot)}に入れました`);
}

// ---- 完成画面 ----

function onResultClick(event) {
  const btn = event.target.closest("button[data-act]");
  if (!btn) return;
  unlockAudio();
  const snapshot = G.teamSnapshot(app.state, app.data);
  switch (btn.dataset.act) {
    case "copy":
      shareText(snapshot);
      break;
    case "image":
      shareImage(snapshot);
      break;
    case "save": {
      const ok = storage.addSaved({ id: teamId(app.state), savedAt: new Date().toISOString(), team: snapshot });
      toast(ok ? "保存しました（メニューの「保存したチーム」から見られます）" : "保存できませんでした（ブラウザの保存領域が使えません）");
      renderResult();
      break;
    }
    case "again":
      go("setup", { replace: true });
      break;
    case "menu":
      goUp("menu");
      break;
  }
}

export const gameScreen = {
  title: "ドラフトルーレット",
  parent: "menu",
  needsData: true,
  enter() {
    if (!app.state) {
      go("setup", { replace: true });
      return;
    }
    renderGame();
  },
  leave() {
    const dlg = $("place-dialog");
    if (dlg.open) dlg.close();
  },
};

// ===========================================================================
// イベント（起動時に1回だけ）
// ===========================================================================

export function initPlay() {
  $("setup-form").addEventListener("change", onSetupChange);
  $("setup-form").addEventListener("submit", (e) => e.preventDefault());
  $("btn-setup-default").addEventListener("click", onSetupDefault);
  $("btn-playball").addEventListener("click", onPlayBall);

  $("btn-spin").addEventListener("click", onSpin);
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
}
