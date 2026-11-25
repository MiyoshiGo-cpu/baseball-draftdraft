// 成績の計算と表示（DOM に触れない純粋関数。Node のテストからも使う）。
// data/players.json の成績は、meta.battingColumns / meta.pitchingColumns の順の配列で、
// 最後に「リーグ1位（記事で太字）の列の番号」の配列が付くことがある。

// 球団名が変わった年（記事の表で「阪急 オリックス」のようにまとめて書かれている球団を、年度ごとの名前に直す）
const TEAM_FROM = {
  サンケイ: 1965,
  アトムズ: 1969,
  ヤクルト: 1970,
  東京: 1965,
  ロッテ: 1969,
  東映: 1965,
  日拓: 1973,
  日本ハム: 1974,
  西鉄: 1965,
  太平洋: 1973,
  クラウン: 1977,
  西武: 1979,
  南海: 1965,
  ダイエー: 1989,
  ソフトバンク: 2005,
  阪急: 1965,
  オリックス: 1989,
  大洋: 1965,
  横浜: 1993,
  DeNA: 2012,
};

/** 「阪急 オリックス」と 1990 → 「オリックス」。1つだけならそのまま。 */
export function teamForYear(label, year) {
  const names = String(label ?? "").trim().split(/\s+/).filter(Boolean);
  if (names.length <= 1) return names[0] ?? "";
  let best = null;
  for (const name of names) {
    const from = TEAM_FROM[name];
    if (from !== undefined && from <= year && (best === null || from >= TEAM_FROM[best])) best = name;
  }
  return best ?? names.at(-1);
}

/** 配列の1行をオブジェクトにする。lead はリーグ1位の列名の Set。球団名はその年の名前に直す。 */
export function rowObject(arr, columns) {
  const obj = {};
  columns.forEach((c, i) => {
    obj[c] = arr[i];
  });
  if (typeof obj.team === "string" && typeof obj.year === "number") obj.team = teamForYear(obj.team, obj.year);
  const extra = arr[columns.length];
  obj.lead = new Set(Array.isArray(extra) ? extra.map((i) => columns[i]) : []);
  return obj;
}

/** その年のおおよその試合数（1球団あたり。規定打席や守備の「レギュラー」の目安に使う）。 */
export function seasonGames(year) {
  if (year <= 1965) return 140;
  if (year <= 1996) return 130;
  if (year <= 2000) return 135;
  if (year <= 2003) return 140;
  if (year === 2004) return 138;
  if (year <= 2006) return 146;
  if (year <= 2014) return 144;
  if (year === 2020) return 120;
  return 143;
}

/** 投球回 "206.2"（.1=1/3回, .2=2/3回）→ アウト数 */
export function ipToOuts(ip) {
  if (ip === null || ip === undefined) return 0;
  const m = /^(\d+)(?:\.([012]))?$/.exec(String(ip));
  if (!m) return 0;
  return Number(m[1]) * 3 + Number(m[2] || 0);
}

/** アウト数 → "206.2" */
export function outsToIp(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

const sum = (rows, key) => rows.reduce((a, r) => a + (typeof r[key] === "number" ? r[key] : 0), 0);

/** 打撃の通算（rows はオブジェクトの配列）。 */
export function battingTotals(rows) {
  const t = {};
  for (const k of ["G", "PA", "AB", "R", "H", "2B", "3B", "HR", "TB", "RBI", "SB", "BB", "HBP", "SO", "SF"]) t[k] = sum(rows, k);
  t.seasons = new Set(rows.map((r) => r.year)).size;
  t.AVG = t.AB ? t.H / t.AB : null;
  const obpDen = t.AB + t.BB + t.HBP + t.SF;
  t.OBP = obpDen ? (t.H + t.BB + t.HBP) / obpDen : null;
  t.SLG = t.AB ? t.TB / t.AB : null;
  t.OPS = t.OBP !== null && t.SLG !== null ? t.OBP + t.SLG : null;
  return t;
}

/** 投手の通算。 */
export function pitchingTotals(rows) {
  const t = {};
  for (const k of ["G", "GS", "CG", "SHO", "W", "L", "SV", "HLD", "H", "HR", "BB", "HBP", "SO", "ER"]) t[k] = sum(rows, k);
  // セーブ（1974年〜）・ホールド（2005年〜）の記録がない時代だけなら「記録なし」にする
  for (const k of ["SV", "HLD"]) if (!rows.some((r) => typeof r[k] === "number")) t[k] = null;
  t.seasons = new Set(rows.map((r) => r.year)).size;
  t.outs = rows.reduce((a, r) => a + ipToOuts(r.IP), 0);
  t.IP = outsToIp(t.outs);
  t.ERA = t.outs ? (t.ER * 27) / t.outs : null;
  t.WHIP = t.outs ? ((t.H + t.BB) * 3) / t.outs : null;
  return t;
}

/** 打率など：0.331 → ".331"、1.153 → "1.153" */
export function fmtRate(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  const s = Number(x).toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
}

/** 防御率など：1.385 → "1.39" */
export function fmtEra(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  return Number(x).toFixed(2);
}

export function fmtInt(x) {
  if (x === null || x === undefined) return "-";
  return Number(x).toLocaleString("ja-JP");
}

/** 利き腕と打席 → 「右投左打」 */
export function throwsBats(profile) {
  if (!profile) return "";
  const t = profile.throws ? `${profile.throws.replace(/投げ?$/, "")}投` : "";
  const b = profile.bats ? `${profile.bats.replace(/打ち?$/, "")}打` : "";
  return t + b;
}

/** 守備位置の並び（試合数の多い順）。守備成績に投手がなければ、投手成績の登板数を入れる。 */
export function positionGames(player, pitchingGames = 0) {
  const games = { ...(player?.fielding || {}) };
  if (!games["投手"] && pitchingGames > 0) games["投手"] = pitchingGames;
  const list = Object.entries(games)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return list.map(([pos, n]) => ({ pos, games: n }));
}
