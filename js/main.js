// 起動・画面遷移・画面上部のバー。
// 各画面の中身は screens/ 以下、ルールは game.js、共有の状態は app.js にある。

import { $, setBarTitle, toast } from "./dom.js";
import { goBack, registerScreen, startRouter } from "./router.js";
import { app, loadData, setSound, soundOn } from "./app.js";
import { setSoundEnabled, sfx, unlockAudio } from "./sound.js";
import { gameScreen, initPlay, setupScreen } from "./screens/play.js";
import { initPlayer } from "./screens/player.js";
import {
  changelogScreen,
  creditsScreen,
  howtoScreen,
  initPages,
  menuScreen,
  optionsScreen,
  savedScreen,
  titleScreen,
} from "./screens/pages.js";

const SCREENS = {
  title: titleScreen,
  menu: menuScreen,
  setup: setupScreen,
  game: gameScreen,
  saved: savedScreen,
  howto: howtoScreen,
  options: optionsScreen,
  changelog: changelogScreen,
  credits: creditsScreen,
};

let activeScreen = null;
let activeRoute = null;
let navToken = 0;

const resolve = (value, route) => (typeof value === "function" ? value(route) : value);

// ---------------------------------------------------------------------------
// 画面上部のバー
// ---------------------------------------------------------------------------

function renderSoundButton() {
  const on = soundOn();
  const btn = $("btn-sound");
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "効果音：ON" : "効果音：OFF");
  btn.title = on ? "効果音：ON（タップでOFF）" : "効果音：OFF（タップでON）";
  const opt = $("opt-sound");
  if (opt) opt.checked = on;
}

function toggleSound(on = !soundOn()) {
  setSound(on);
  unlockAudio();
  if (on) sfx.select();
  renderSoundButton();
  toast(on ? "効果音：ON" : "効果音：OFF");
}

function renderAppBar(route, screen) {
  const bar = $("app-bar");
  bar.hidden = route.name === "title";
  setBarTitle(resolve(screen.title, route));
}

// ---------------------------------------------------------------------------
// 画面の切り替え
// ---------------------------------------------------------------------------

function showLoading(mode) {
  const el = $("screen-loading");
  el.hidden = !mode;
  if (!mode) return;
  const error = mode === "error";
  el.classList.toggle("is-error", error);
  $("loading-text").textContent = error
    ? "指名データを読み込めませんでした。通信状態を確かめてください。ファイルを直接開いている場合は、python3 -m http.server で起動して http://localhost:8000/ を開いてください。"
    : "データを読み込み中…";
  $("btn-retry").hidden = !error;
}

async function onRoute(route, screen) {
  const token = ++navToken;
  if (activeScreen && activeScreen.leave) activeScreen.leave();
  activeScreen = null;
  activeRoute = route;

  for (const el of document.querySelectorAll(".screen")) {
    const on = el.id === `screen-${route.name}`;
    el.hidden = !on;
    if (on) {
      el.classList.remove("is-entering");
      void el.offsetWidth; // アニメーションをやり直す
      el.classList.add("is-entering");
    }
  }
  document.documentElement.dataset.screen = route.name;
  renderAppBar(route, screen);
  window.scrollTo(0, 0);

  if (screen.needsData && !app.data) {
    showLoading("loading");
    $(`screen-${route.name}`).hidden = true;
    try {
      await loadData();
    } catch {
      if (token === navToken) showLoading("error");
      return;
    }
    if (token !== navToken) return;
    showLoading(false);
    $(`screen-${route.name}`).hidden = false;
  } else {
    showLoading(false);
  }

  activeScreen = screen;
  screen.enter(route);
  if (token !== navToken) return; // enter の中で別の画面に移った

  const title = resolve(screen.title, route);
  document.title = route.name === "title" ? "ドラフトルーレット" : `${title}｜ドラフトルーレット`;
}

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

function init() {
  setSoundEnabled(soundOn());
  for (const [name, def] of Object.entries(SCREENS)) registerScreen(name, def);
  initPlay();
  initPages();
  initPlayer();

  $("bar-back").addEventListener("click", () => {
    unlockAudio();
    const parent = activeScreen || SCREENS[activeRoute?.name];
    goBack(resolve(parent?.parent, activeRoute) || "menu");
  });
  $("btn-sound").addEventListener("click", () => toggleSound());
  document.addEventListener("dr:sound-toggle", (e) => toggleSound(e.detail.on));
  document.addEventListener("dr:sound-changed", () => {
    setSoundEnabled(soundOn());
    renderSoundButton();
  });
  $("btn-retry").addEventListener("click", () => {
    if (activeRoute) onRoute(activeRoute, SCREENS[activeRoute.name]);
  });

  renderSoundButton();
  startRouter(onRoute);
  // タイトル画面を見ている間に、指名データを先に読み込んでおく
  loadData().catch(() => {});
}

init();
