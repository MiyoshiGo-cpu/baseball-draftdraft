// 画面どうしで共有する状態（データ・ゲーム）と、表示用の部品。

import * as G from "./game.js";
import { parseSeedParam, randomSeed, seedToState } from "./roulette.js";
import * as storage from "./storage.js";
import { buildShareText, copyText, drawShareImage, pickMeta, saveCanvasImage } from "./share.js";
import { eraShort } from "./teams.js";
import { setSoundEnabled } from "./sound.js";
import { esc, fileStamp, formatDate, toast } from "./dom.js";
import { VERSION_LABEL } from "./version.js";
import { careerTeam } from "./career.js";

export const app = {
  /** @type {ReturnType<typeof G.indexData> | null} */
  data: null,
  /** 進行中（または終わった直後）のゲーム。まだ一度も始めていなければ null */
  state: null,
  /** 選手データ（data/players.json）。選手の詳細を開いたときに読み込む */
  players: null,
  /** 年度・リーグ別の合計成績（data/leagues.json）。WAR の計算に使う。選手データと一緒に読み込む */
  leagues: null,
  seedParam: parseSeedParam(location.search),
};

// ---------------------------------------------------------------------------
// データの読み込み
// ---------------------------------------------------------------------------

let dataPromise = null;

/** 指名データを読み込む（1回だけ）。読み込めたら前回のゲームも復元する。 */
export function loadData() {
  if (!dataPromise) {
    dataPromise = (async () => {
      const res = await fetch("data/drafts.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      app.data = G.indexData(await res.json());
      app.state = G.restoreState(storage.loadCurrent(), app.data);
      if (!app.state) storage.clearCurrent();
      document.documentElement.dataset.ready = "1";
      return app.data;
    })();
    dataPromise.catch(() => {
      dataPromise = null; // 次に呼ばれたら読み込み直す
    });
  }
  return dataPromise;
}

let playersPromise = null;

/** 選手データ（成績・プロフィール）と、WAR の計算に使うリーグのデータを読み込む。大きいので、必要になったときに1回だけ読む。 */
export function loadPlayers() {
  if (!playersPromise) {
    playersPromise = (async () => {
      const get = async (url) => {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      const [players, leagues] = await Promise.all([get("data/players.json"), get("data/leagues.json")]);
      app.leagues = leagues;
      app.players = players;
      return app.players;
    })();
    playersPromise.catch(() => {
      playersPromise = null;
    });
  }
  return playersPromise;
}

// ---------------------------------------------------------------------------
// 設定とゲーム
// ---------------------------------------------------------------------------

/** 前回のルール設定（なければ初期値）。効果音の ON/OFF もここに入っている。 */
export function loadRuleSettings() {
  return G.normalizeSettings(storage.loadSettings() || {});
}

export function saveRuleSettings(settings) {
  storage.saveSettings(G.normalizeSettings(settings));
}

export function soundOn() {
  return loadRuleSettings().sound;
}

export function setSound(on) {
  saveRuleSettings({ ...loadRuleSettings(), sound: on });
  if (app.state) {
    app.state = G.updateSettings(app.state, { sound: on });
    persistGame();
  }
  setSoundEnabled(on);
}

export function persistGame() {
  if (app.state) storage.saveCurrent(app.state);
  else storage.clearCurrent();
}

/** 新しいゲームを作る（まだスピンしていない状態）。 */
export function startNewGame(settings) {
  const s = G.normalizeSettings({ ...settings, sound: soundOn() });
  saveRuleSettings(s);
  app.state = G.createGame(s, app.seedParam ?? randomSeed());
  persistGame();
}

export function discardGame() {
  app.state = null;
  storage.clearCurrent();
}

/** 続きから遊べるゲームがあるか（1回以上スピンして、まだ終わっていない）。 */
export function hasGameInProgress() {
  return Boolean(app.state && app.state.status === "playing");
}

/** 「スピン5回・7/17人・パス残り2」のような進み具合。 */
export function progressText(state) {
  return `スピン${G.spinCount(state)}回・${G.filledCount(state.roster)}/${G.TOTAL_SLOTS}人・パス残り${G.passesLeft(state)}`;
}

// ---------------------------------------------------------------------------
// 表示用の部品
// ---------------------------------------------------------------------------

export const slotShort = (franchiseId) => app.data?.franchises.get(franchiseId)?.short || "";
export const draftShort = (d) => eraShort(d.teamName, slotShort(d.franchiseId));

export function settingsBrief(s) {
  return [
    `${s.yearFrom}〜${s.yearTo}年`,
    `パス${s.passLimit}`,
    `育成${s.includeIkusei ? "あり" : "なし"}`,
    `入団拒否${s.includeUnsigned ? "あり" : "なし"}`,
  ].join("・");
}

export function slotLabel(slot) {
  const s = G.parseSlot(slot);
  if (s.kind === "lineup") return `${s.order}番・${G.POSITION_NAMES[s.pos]}`;
  return G.KIND_LABELS[s.kind];
}

export function groupLabel(pick) {
  if (pick.twoWay) return "二刀流";
  return pick.group === "P" ? "投手" : "野手";
}

/** チーム表示（マイチームと保存したチームで共通）。 */
export function teamHTML(snapshot, { highlight = null } = {}) {
  const meta = (p) => esc(pickMeta(p, slotShort(p.franchiseId)));
  const cls = (p) => (p ? `slot is-filled${highlight && p.pickId === highlight ? " is-new" : ""}` : "slot is-empty");
  const attrs = (p) => (p ? ` data-player="${esc(p.pickId)}" role="button" tabindex="0" aria-label="${esc(p.name)}の詳細"` : "");
  const row = (label, p, extra = "") => `
    <li class="${cls(p)}"${attrs(p)}>
      <span class="slot-label">${label}</span>${extra}
      ${
        p
          ? `<span class="slot-player"><span class="slot-name">${esc(p.name)}</span><span class="slot-meta">${meta(p)}</span></span>`
          : `<span class="slot-player slot-empty-text">空き</span>`
      }
      ${p && p.round ? `<span class="slot-round">第${p.round}巡</span>` : "<span></span>"}
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

/** このゲームのチームを表す id（同じチームを二重に保存しないため）。 */
export function teamId(state) {
  const key = JSON.stringify([state.seed, state.usedPairs, state.roster]);
  return `t${seedToState(key).toString(36)}${state.usedPairs.length.toString(36)}`;
}

/** 答え合わせ（選手データを読み込み済みのときだけ。読み込みを待つとコピーや共有が許可されないことがあるため）。 */
function careerIfLoaded(snapshot) {
  try {
    return app.players ? careerTeam(snapshot, app.players, app.leagues) : null;
  } catch {
    return null;
  }
}

export async function shareText(snapshot) {
  const ok = await copyText(buildShareText(snapshot, slotShort, careerIfLoaded(snapshot)));
  toast(ok ? "テキストをコピーしました" : "コピーできませんでした");
}

export async function shareImage(snapshot, date = new Date()) {
  try {
    const canvas = drawShareImage(snapshot, slotShort, {
      dateText: formatDate(date.toISOString()),
      footer: `ドラフトルーレット ${VERSION_LABEL}`,
      career: careerIfLoaded(snapshot),
    });
    const how = await saveCanvasImage(canvas, `draft-roulette-${fileStamp(date)}.png`);
    if (how === "downloaded") toast("画像を保存しました");
    else if (how === "shared") toast("画像を共有しました");
  } catch {
    toast("画像を作れませんでした");
  }
}
