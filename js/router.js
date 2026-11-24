// 画面遷移（URL のハッシュで切り替える）。例：#/title, #/menu, #/game, #/saved/<id>
// ブラウザの「戻る」と、画面左上の戻るボタンのどちらでも自然に戻れるよう、訪れた画面を積んでおく。

const screens = new Map();
const stack = [];
let handler = null;
let current = null;

export function registerScreen(name, def) {
  screens.set(name, { name, ...def });
}

export function routeFromHash(hash = location.hash) {
  const path = hash.replace(/^#\/?/, "");
  const parts = path.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const name = parts[0] || "title";
  return { name, params: parts.slice(1), key: parts.length ? parts.join("/") : "title" };
}

export function currentRoute() {
  return current;
}

/** 戻れる画面が履歴にあるか。 */
export function canGoBack() {
  return stack.length >= 2;
}

function apply(route) {
  if (!screens.has(route.name)) {
    go("title", { replace: true });
    return;
  }
  current = route;
  handler(route, screens.get(route.name));
}

/** 画面遷移を始める。onRoute(route, screen) が画面ごとに呼ばれる。 */
export function startRouter(onRoute) {
  handler = onRoute;
  window.addEventListener("hashchange", () => {
    const route = routeFromHash();
    if (stack.length >= 2 && stack[stack.length - 2] === route.key) stack.pop();
    else stack.push(route.key);
    apply(route);
  });
  let route = routeFromHash();
  if (!screens.has(route.name)) {
    history.replaceState(null, "", "#/title");
    route = routeFromHash();
  }
  stack.length = 0;
  stack.push(route.key);
  apply(route);
}

/** 画面を進める。replace: true なら今の画面と入れ替える（戻るで戻ってこない）。 */
export function go(path, { replace = false } = {}) {
  const hash = `#/${path}`;
  if (replace) {
    history.replaceState(null, "", hash);
    const route = routeFromHash();
    stack[Math.max(0, stack.length - 1)] = route.key;
    apply(route);
  } else if (location.hash === hash) {
    apply(routeFromHash());
  } else {
    location.hash = hash;
  }
}

/** 1つ前の画面に戻る。履歴がなければ fallback に切り替える。 */
export function goBack(fallback) {
  if (canGoBack()) history.back();
  else go(fallback, { replace: true });
}

/** 上の階層（例：メニュー）へ戻る。直前がその画面なら履歴を戻り、違えば入れ替える。 */
export function goUp(path) {
  if (stack.length >= 2 && stack[stack.length - 2] === path) history.back();
  else go(path, { replace: true });
}
