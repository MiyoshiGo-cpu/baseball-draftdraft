// タイトル画面・メニューと、そこから開く画面（保存したチーム・遊び方・オプション・更新ログ・クレジット）。

import * as G from "../game.js";
import * as storage from "../storage.js";
import { sfx, unlockAudio } from "../sound.js";
import { CHANGE_TYPES, CHANGELOG, VERSION_ID, VERSION_LABEL, formatChangelogDate, versionLabel } from "../version.js";
import { $, esc, formatDate, setBarTitle, toast } from "../dom.js";
import { go, goUp } from "../router.js";
import {
  app,
  discardGame,
  hasGameInProgress,
  loadData,
  progressText,
  settingsBrief,
  shareImage,
  shareText,
  soundOn,
  teamHTML,
} from "../app.js";

// ---------------------------------------------------------------------------
// アイコン（24×24 の線画）
// ---------------------------------------------------------------------------

const svg = (d) => `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true">${d}</svg>`;
const ICON = {
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  resume: svg(
    '<path d="M4 12a8 8 0 1 0 8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 9v6l5-3z" fill="currentColor"/>',
  ),
  saved: svg('<path d="M6 3h12v18l-6-4.5L6 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  howto: svg(
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>',
  ),
  options: svg(
    '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),
  changelog: svg(
    '<path d="M5 4h14v16H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),
  credits: svg(
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor"/>',
  ),
  chevron: svg('<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
};

// ---------------------------------------------------------------------------
// バージョンと「NEW」
// ---------------------------------------------------------------------------

/** 前回見たときより新しいバージョンになっているか。 */
export function hasUnseenVersion() {
  const seen = storage.loadSeenVersion();
  return seen !== null && seen !== VERSION_ID;
}

function renderVersionBadges() {
  $("version-new").hidden = !hasUnseenVersion();
}

// ===========================================================================
// タイトル画面
// ===========================================================================

const FIRST_ROUND = new Set(["1位", "1巡目", "1次1位", "高校1巡目", "大社1巡目", "自由獲得枠", "希望入団枠", "大社希望入団枠"]);
const MONITOR_INTERVAL_MS = 3600;

let monitorPool = null;
let monitorTimer = 0;

/** 会場モニターで発表する歴代の1位指名（入団した選手）。 */
function firstRoundPool() {
  if (monitorPool || !app.data) return monitorPool;
  monitorPool = [];
  for (const d of app.data.pairList) {
    for (const p of d.picks) {
      if (p.draftType === "regular" && p.signed && FIRST_ROUND.has(p.roundLabel)) monitorPool.push({ d, p });
    }
  }
  return monitorPool;
}

/** 「第1巡選択希望選手」のような見出し。自由獲得枠などは枠の名前をそのまま使う。 */
function roundHeading(label) {
  return /^(1位|1巡目|1次1位|高校1巡目|大社1巡目)$/.test(label) ? "第1巡選択希望選手" : `${label.replace(/^大社/, "")} 選択希望選手`;
}

/** 会場モニターに次の選手を出す。 */
function showNextOnMonitor() {
  const pool = firstRoundPool();
  if (!pool || pool.length === 0) return;
  const { d, p } = pool[Math.floor(Math.random() * pool.length)];
  const el = $("title-monitor");
  el.classList.remove("is-changing");
  void el.offsetWidth; // アニメーションをやり直す
  el.innerHTML = `
    <p class="monitor-round">${esc(roundHeading(p.roundLabel))}</p>
    <p class="monitor-team">${d.year}年 ${esc(d.teamName)}</p>
    <p class="monitor-name">${esc(p.name)}</p>
    <p class="monitor-meta">${esc(p.pos)} ・ ${esc(p.from)}</p>`;
  el.classList.add("is-changing");
}

function startMonitor() {
  stopMonitor();
  if (!app.data) return;
  showNextOnMonitor();
  monitorTimer = setInterval(showNextOnMonitor, MONITOR_INTERVAL_MS);
}

function stopMonitor() {
  clearInterval(monitorTimer);
  monitorTimer = 0;
}

function renderTitle() {
  renderVersionBadges();
  const hint = $("title-continue");
  if (app.data && hasGameInProgress()) {
    hint.hidden = false;
    hint.textContent = `進行中のゲームがあります（${progressText(app.state)}）`;
  } else {
    hint.hidden = true;
  }
}

export const titleScreen = {
  title: "タイトル",
  needsData: false,
  enter() {
    renderTitle();
    // データが読み込めたら、会場モニターと「進行中のゲーム」の表示を始める
    loadData()
      .then(() => {
        renderTitle();
        if (document.documentElement.dataset.screen === "title") startMonitor();
      })
      .catch(() => {});
  },
  leave() {
    stopMonitor();
  },
};

// ===========================================================================
// メニュー
// ===========================================================================

function continueCard() {
  const { state } = app;
  if (!state) return "";
  let label = "続きから";
  let sub = progressText(state);
  let cls = "";
  if (state.status === "setup") sub = "まだスピンしていません";
  if (state.status === "complete") {
    label = "前回のチームを見る";
    sub = `完成・スピン${G.spinCount(state)}回・パス${state.passesUsed}回`;
    cls = " is-done";
  }
  if (state.status === "stuck") {
    label = "前回の結果を見る";
    sub = `未完成で終了・${G.filledCount(state.roster)}/${G.TOTAL_SLOTS}人`;
    cls = " is-done";
  }
  const pct = (G.filledCount(state.roster) / G.TOTAL_SLOTS) * 100;
  return `
    <button type="button" class="menu-continue${cls}" data-go="game">
      <span class="menu-continue-icon">${ICON.resume}</span>
      <span class="menu-continue-text">
        <span class="menu-continue-label">${label}</span>
        <span class="menu-continue-sub">${esc(sub)}</span>
        <span class="menu-continue-rules">${esc(settingsBrief(state.settings))}</span>
        <span class="menu-progress" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </span>
      <span class="menu-chevron">${ICON.chevron}</span>
    </button>`;
}

function renderMenu() {
  const savedCount = storage.loadSaved().length;
  const tiles = [
    { go: "saved", label: "保存したチーム", sub: `${savedCount}件`, icon: ICON.saved },
    { go: "howto", label: "遊び方", sub: "ルールと流れ", icon: ICON.howto },
    { go: "options", label: "オプション", sub: "効果音・データ", icon: ICON.options },
    { go: "changelog", label: "更新ログ", sub: VERSION_LABEL, icon: ICON.changelog, badge: hasUnseenVersion() },
  ];
  $("menu-body").innerHTML = `
    <button type="button" class="menu-hero" data-go="setup">
      <span class="menu-hero-kicker">DRAFT ROULETTE</span>
      <span class="menu-hero-title">${ICON.play}新しく始める</span>
      <span class="menu-hero-desc">ルールを決めてルーレットを回し、<br>ドラフト指名選手で17人のチームを作ります。</span>
    </button>
    ${continueCard()}
    <div class="menu-grid">
      ${tiles
        .map(
          (t) => `
        <button type="button" class="menu-tile" data-go="${t.go}">
          <span class="menu-tile-icon">${t.icon}</span>
          <span class="menu-tile-label">${t.label}${t.badge ? `<span class="version-new">NEW</span>` : ""}</span>
          <span class="menu-tile-sub">${esc(t.sub)}</span>
        </button>`,
        )
        .join("")}
    </div>
    <button type="button" class="menu-link" data-go="credits">${ICON.credits}<span>クレジット・出典</span>${ICON.chevron}</button>
    <p class="menu-foot">ドラフトルーレット ${VERSION_LABEL}<br>非公式のファンメイドツールです。NPB・各球団とは関係ありません。</p>`;
}

export const menuScreen = {
  title: "メニュー",
  parent: "title",
  needsData: true,
  enter() {
    renderMenu();
  },
};

// ===========================================================================
// 保存したチーム
// ===========================================================================

function renderSavedList() {
  const list = storage.loadSaved();
  setBarTitle(`保存したチーム（${list.length}）`);
  $("saved-body").innerHTML = list.length
    ? `<ul class="saved-list">${list
        .map((x) => {
          const names = x.team.lineup.map((r) => r.player?.name).filter(Boolean).join(" / ");
          return `<li><button type="button" class="saved-item" data-saved="${esc(x.id)}">
              <span class="saved-date">${esc(formatDate(x.savedAt))}</span>
              <span class="saved-stats">スピン${x.team.spins}回・パス${x.team.passes}回</span>
              <span class="saved-names">${esc(names)}</span>
              ${x.team.settings ? `<span class="saved-settings">${esc(settingsBrief(x.team.settings))}</span>` : ""}
            </button></li>`;
        })
        .join("")}</ul>`
    : `<div class="empty-state">
        <span class="empty-icon">${ICON.saved}</span>
        <p>まだ保存したチームはありません。<br>完成画面の「この編成を保存」で保存できます（最大${storage.SAVED_MAX}件）。</p>
        <button type="button" class="btn btn-primary" data-go="setup">さっそく遊ぶ</button>
      </div>`;
}

function renderSavedDetail(id) {
  const entry = storage.loadSaved().find((x) => x.id === id);
  if (!entry) {
    toast("このチームは見つかりませんでした");
    go("saved", { replace: true });
    return;
  }
  setBarTitle(formatDate(entry.savedAt));
  $("saved-body").innerHTML = `
    <div class="card">
      <p class="saved-detail-stats">スピン${entry.team.spins}回・パス${entry.team.passes}回${
        entry.team.settings ? `<br><span>${esc(settingsBrief(entry.team.settings))}</span>` : ""
      }</p>
      <div class="team">${teamHTML(entry.team)}</div>
    </div>
    <div class="saved-actions">
      <button type="button" class="btn btn-danger" data-saved-act="delete" data-id="${esc(entry.id)}">削除</button>
      <button type="button" class="btn" data-saved-act="copy" data-id="${esc(entry.id)}">テキストでコピー</button>
      <button type="button" class="btn btn-primary" data-saved-act="image" data-id="${esc(entry.id)}">画像を保存</button>
    </div>`;
}

function onSavedAction(btn) {
  const entry = storage.loadSaved().find((x) => x.id === btn.dataset.id);
  if (!entry) return;
  const act = btn.dataset.savedAct;
  if (act === "copy") shareText(entry.team);
  if (act === "image") shareImage(entry.team, new Date(entry.savedAt));
  if (act === "delete") {
    if (!window.confirm("このチームを削除しますか？")) return;
    storage.removeSaved(entry.id);
    toast("削除しました");
    goUp("saved");
  }
}

export const savedScreen = {
  title: "保存したチーム",
  parent: (route) => (route.params[0] ? "saved" : "menu"),
  needsData: true,
  enter(route) {
    if (route.params[0]) renderSavedDetail(route.params[0]);
    else renderSavedList();
  },
};

// ===========================================================================
// 遊び方・クレジット（中身は index.html に書いてある）
// ===========================================================================

export const howtoScreen = { title: "遊び方", parent: "menu", needsData: false, enter() {} };
export const creditsScreen = {
  title: "クレジット",
  parent: "menu",
  needsData: false,
  enter() {
    $("credits-version").textContent = VERSION_LABEL;
  },
};

// ===========================================================================
// オプション
// ===========================================================================

function renderOptions() {
  const { state, data } = app;
  const savedCount = storage.loadSaved().length;
  const games = data.pairList.length;
  const players = data.picks.size;
  const generated = data.meta?.generatedAt ? formatDate(data.meta.generatedAt).slice(0, 10) : "―";
  $("options-body").innerHTML = `
    <section class="card option-card">
      <h2 class="card-title">サウンド</h2>
      <label class="switch">
        <input type="checkbox" id="opt-sound" ${soundOn() ? "checked" : ""}>
        <span class="switch-track" aria-hidden="true"></span>
        <span>効果音<small>ルーレットや確定のときに鳴る音</small></span>
      </label>
    </section>
    <section class="card option-card">
      <h2 class="card-title">データ</h2>
      <div class="opt-row">
        <div class="opt-text"><b>進行中のゲーム</b><span>${state ? esc(progressText(state)) : "なし"}</span></div>
        <button type="button" class="btn btn-small" data-opt="discard" ${state ? "" : "disabled"}>破棄する</button>
      </div>
      <div class="opt-row">
        <div class="opt-text"><b>保存したチーム</b><span>${savedCount}件</span></div>
        <button type="button" class="btn btn-small" data-opt="clear-saved" ${savedCount ? "" : "disabled"}>すべて削除</button>
      </div>
      <div class="opt-row">
        <div class="opt-text"><b>すべてのデータ</b><span>設定・進行中のゲーム・保存したチームを消して、最初の状態に戻します</span></div>
        <button type="button" class="btn btn-small btn-danger" data-opt="clear-all">初期化</button>
      </div>
    </section>
    <section class="card option-card">
      <h2 class="card-title">このアプリについて</h2>
      <dl class="about-list">
        <div><dt>バージョン</dt><dd>${VERSION_LABEL}</dd></div>
        <div><dt>収録データ</dt><dd>${data.yearMin}〜${data.yearMax}年度<br>${games}組・${players.toLocaleString("ja-JP")}人</dd></div>
        <div><dt>データ作成日</dt><dd>${esc(generated)}</dd></div>
      </dl>
    </section>`;
}

function onOptionsClick(event) {
  const btn = event.target.closest("button[data-opt]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.opt;
  if (act === "discard") {
    if (!window.confirm("進行中のゲームを破棄しますか？")) return;
    discardGame();
    toast("進行中のゲームを破棄しました");
  }
  if (act === "clear-saved") {
    if (!window.confirm("保存したチームをすべて削除しますか？")) return;
    storage.clearSaved();
    toast("保存したチームを削除しました");
  }
  if (act === "clear-all") {
    if (!window.confirm("すべてのデータを消して、最初の状態に戻しますか？\nこの操作は取り消せません。")) return;
    storage.clearAll();
    discardGame();
    storage.saveSeenVersion(VERSION_ID);
    toast("すべてのデータを初期化しました");
    // 効果音などの表示も初期値に戻す
    document.dispatchEvent(new CustomEvent("dr:sound-changed"));
  }
  renderOptions();
}

export const optionsScreen = {
  title: "オプション",
  parent: "menu",
  needsData: true,
  enter() {
    renderOptions();
  },
};

// ===========================================================================
// 更新ログ
// ===========================================================================

function renderChangelog() {
  $("changelog-body").innerHTML = `
    <p class="cl-current">現在のバージョン：<b>${esc(VERSION_LABEL)}</b></p>
    <ol class="changelog">${CHANGELOG.map(
      (entry) => `
      <li class="cl-entry card">
        <div class="cl-head">
          <span class="cl-version">${esc(versionLabel(entry.stage, entry.version))}</span>
          <span class="cl-date">${esc(formatChangelogDate(entry.date))}</span>
        </div>
        <p class="cl-title">${esc(entry.title)}</p>
        <ul class="cl-changes">${entry.changes
          .map(
            (c) =>
              `<li><span class="cl-type cl-type-${esc(c.type)}">${esc(CHANGE_TYPES[c.type] || c.type)}</span><span>${esc(c.text)}</span></li>`,
          )
          .join("")}</ul>
      </li>`,
    ).join("")}</ol>`;
}

export const changelogScreen = {
  title: "更新ログ",
  parent: "menu",
  needsData: false,
  enter() {
    renderChangelog();
    storage.saveSeenVersion(VERSION_ID);
    renderVersionBadges();
  },
};

// ===========================================================================
// イベント（起動時に1回だけ）
// ===========================================================================

export function initPages() {
  // 初めて見たバージョンを記録しておき、次に更新されたときだけ「NEW」を出す
  if (storage.loadSeenVersion() === null) storage.saveSeenVersion(VERSION_ID);
  $("app-version").textContent = VERSION_LABEL;
  $("btn-version").setAttribute("aria-label", `バージョン ${VERSION_LABEL}。更新ログを開く`);
  renderVersionBadges();

  $("btn-play").addEventListener("click", () => {
    unlockAudio();
    sfx.start();
    go("menu");
  });
  $("btn-version").addEventListener("click", () => {
    unlockAudio();
    go("changelog");
  });

  // 画面の中の「data-go」ボタンで移動する
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-go]");
    if (!btn || btn.disabled) return;
    unlockAudio();
    sfx.select();
    go(btn.dataset.go);
  });

  $("saved-body").addEventListener("click", (e) => {
    const open = e.target.closest("button[data-saved]");
    if (open) {
      unlockAudio();
      sfx.select();
      go(`saved/${encodeURIComponent(open.dataset.saved)}`);
      return;
    }
    const act = e.target.closest("button[data-saved-act]");
    if (act) onSavedAction(act);
  });

  $("options-body").addEventListener("click", onOptionsClick);
  $("options-body").addEventListener("change", (e) => {
    if (e.target.id === "opt-sound") {
      document.dispatchEvent(new CustomEvent("dr:sound-toggle", { detail: { on: e.target.checked } }));
    }
  });
}
