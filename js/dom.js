// 画面まわりの小さな共通関数。

export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const media = (q) => Boolean(window.matchMedia?.(q).matches);
export const reduceMotion = () => media("(prefers-reduced-motion: reduce)");
export const isNarrow = () => media("(max-width: 959px)");

let toastTimer = 0;
export function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 2600);
}

/** 画面上部のバーの見出しを変える（保存したチームの詳細など、画面の中身で変わるとき）。 */
export function setBarTitle(text) {
  const el = $("bar-title");
  if (el) el.textContent = text;
}

export function scrollToEl(id) {
  const el = $(id);
  if (!el || el.hidden) return;
  el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
}

const pad = (n) => String(n).padStart(2, "0");

/** ISO 文字列 → 2026/11/24 10:39 */
export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ファイル名用の 20261124-1039 */
export function fileStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
