// 抽選用のシードつき乱数（mulberry32）。
// 状態は 32bit 整数1つなので、ゲーム状態に入れて localStorage に保存できる。

/** シード（数値または文字列）を乱数の初期状態（uint32）にする。 */
export function seedToState(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return Math.trunc(seed) >>> 0;
  }
  // 文字列は FNV-1a でハッシュする
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 乱数を1つ進める。{ value: [0,1) の値, state: 次の状態 } を返す（純粋関数）。 */
export function nextRandom(state) {
  const next = (state + 0x6d2b79f5) >>> 0;
  let r = next;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { value, state: next };
}

/** 呼ぶたびに [0,1) を返す関数を作る（テストや演出用）。 */
export function createRng(seed) {
  let state = seedToState(seed);
  const rng = () => {
    const r = nextRandom(state);
    state = r.state;
    return r.value;
  };
  rng.getState = () => state;
  return rng;
}

/** シード未指定のときに使う、ランダムなシード（1〜2^31-1）。 */
export function randomSeed() {
  try {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return (buf[0] % 2147483646) + 1;
  } catch {
    return Math.floor(Math.random() * 2147483646) + 1;
  }
}

/** URL の ?seed=123 を読む。なければ null。 */
export function parseSeedParam(search) {
  try {
    const value = new URLSearchParams(search).get("seed");
    if (value === null || value.trim() === "") return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : value.trim();
  } catch {
    return null;
  }
}
