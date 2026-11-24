// localStorage の読み書き。使えない環境（プライベートモードなど）でも落ちないよう、すべて try/catch で囲む。

export const KEYS = {
  settings: "dr.settings",
  current: "dr.current",
  saved: "dr.saved",
  seenVersion: "dr.seenVersion",
};

export const SAVED_MAX = 50;

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 何もしない
  }
}

export const loadSettings = () => read(KEYS.settings);
export const saveSettings = (settings) => write(KEYS.settings, settings);

/** 更新ログを最後に見たときのバージョン（未読の印を出すため）。 */
export const loadSeenVersion = () => read(KEYS.seenVersion);
export const saveSeenVersion = (version) => write(KEYS.seenVersion, version);

export const loadCurrent = () => read(KEYS.current);
export const saveCurrent = (state) => write(KEYS.current, state);
export const clearCurrent = () => remove(KEYS.current);

/** 保存したチームの一覧（新しい順）。 */
export function loadSaved() {
  const list = read(KEYS.saved);
  return Array.isArray(list) ? list.filter((x) => x && x.id && x.team) : [];
}

/** チームを保存する。最大 SAVED_MAX 件で、古いものから消える。保存できたら true。 */
export function addSaved(entry) {
  const list = [entry, ...loadSaved().filter((x) => x.id !== entry.id)].slice(0, SAVED_MAX);
  return write(KEYS.saved, list);
}

export function removeSaved(id) {
  return write(KEYS.saved, loadSaved().filter((x) => x.id !== id));
}

export function isSaved(id) {
  return loadSaved().some((x) => x.id === id);
}
