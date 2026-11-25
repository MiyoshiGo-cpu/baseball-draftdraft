#!/usr/bin/env python3
"""NPB 公式サイトの年度別成績から、年度・リーグ別の合計成績を作る（簡易 WAR の基準に使う）。

出力：data/leagues.json
  leagues["1975"]["C"] = {
    "teams": 6, "games": 130,                       # 球団数、1球団の試合数
    "W": 364, "L": 364, "T": 52,                    # 勝敗表の合計
    "bat": { "AB", "R", "H", "2B", "3B", "HR", "SB", ("PA", "BB", "HBP", "SF", "SH") },
    "pit": { "outs", "ER", "R", "SO", ("BB", "HBP", "HR", "H") },
  }
  四球・死球・犠飛は、2005年以降だけ公式の表にある。それより前は、選手データ（data/players.json）の
  その年・そのリーグの「打数あたりの四球・死球・犠飛」から推定して入れ、"estimated": true を付ける
  （2005年以降で試すと、推定と公式の差はおおむね ±5% 以内）。

取得元：
  1965〜2026年 … https://npb.jp/bis/yearly/{central,pacific}league_{年}.html（勝敗表・チーム打撃・チーム投手）
  2005〜2026年 … https://npb.jp/bis/{年}/stats/tm{b,p}_{c,p}.html（四球・死球などを含む詳しい表）

使い方：
  python3 scripts/build_leagues.py            # キャッシュがないページだけ取得して作る
  python3 scripts/build_leagues.py --offline  # キャッシュだけで作る
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "scripts" / "cache" / "npb"
OUT_PATH = ROOT / "data" / "leagues.json"
PLAYERS_PATH = ROOT / "data" / "players.json"
CENTRAL_WORDS = ["巨人", "阪神", "中日", "広島", "ヤクルト", "サンケイ", "アトムズ", "大洋", "横浜", "DeNA"]
SHRINK_AB = 15000  # 推定のとき、選手データの打数が少ない年は、近い10年の平均に寄せる
BASE = "https://npb.jp/"
USER_AGENT = "baseball-draftdraft/0.1 (personal project)"
YEAR_FROM, YEAR_TO = 1965, 2026
DETAIL_FROM = 2005  # 詳しいチーム成績のページがある最初の年
INTERVAL = 1.5  # 秒
JST = dt.timezone(dt.timedelta(hours=9))
LEAGUES = {"C": ("centralleague", "c"), "P": ("pacificleague", "p")}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


class Fetcher:
    def __init__(self, offline: bool) -> None:
        self.offline = offline
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.last = 0.0
        self.fetched = 0

    def get(self, path: str) -> str:
        cache = CACHE_DIR / path.replace("/", "__")
        if cache.exists():
            return cache.read_text(encoding="utf-8")
        if self.offline:
            raise RuntimeError(f"キャッシュがありません: {path}")
        for attempt in range(5):
            wait = INTERVAL - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                resp = self.session.get(BASE + path, timeout=30)
            except requests.RequestException as e:
                log(f"  通信エラー（{e}）。再試行します")
                time.sleep(5 * (attempt + 1))
                continue
            if resp.status_code == 200:
                resp.encoding = "utf-8"
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                cache.write_text(resp.text, encoding="utf-8")
                self.fetched += 1
                return resp.text
            if resp.status_code in (429, 500, 502, 503, 504):
                retry = int(resp.headers.get("Retry-After", "0") or 0)
                log(f"  HTTP {resp.status_code}。{max(retry, 10)}秒待って再試行します")
                time.sleep(max(retry, 10))
                continue
            raise RuntimeError(f"HTTP {resp.status_code}: {path}")
        raise RuntimeError(f"取得できませんでした: {path}")


# ---------------------------------------------------------------------------
# 表の読み取り
# ---------------------------------------------------------------------------


def cell_text(cell) -> str:
    return re.sub(r"\s+", "", cell.get_text("", strip=True)).replace("｜", "ー").replace("|", "ー")


def to_num(text: str):
    t = text.replace(",", "")
    if re.fullmatch(r"-?\d+", t):
        return int(t)
    if re.fullmatch(r"-?\d*\.\d+", t):
        return float(t)
    return None


def read_tables(html: str) -> list[list[list[str]]]:
    """ページの表を、セルの文字列の2次元配列にして返す（入れ子の表は内側だけ）。"""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for table in soup.find_all("table"):
        if table.find("table"):
            continue
        rows = [[cell_text(c) for c in tr.find_all(["th", "td"])] for tr in table.find_all("tr")]
        rows = [r for r in rows if any(r)]
        if rows:
            out.append(rows)
    return out


def find_table(tables, must: list[str]):
    for rows in tables:
        head = rows[0]
        if head and head[0] == "チーム" and all(m in head for m in must):
            return rows
    return None


def records(rows) -> list[dict]:
    """見出し行で列名を付ける。投球回は「1285」「.1」の2つのセルに分かれているのでまとめる。"""
    head = rows[0]
    out = []
    for r in rows[1:]:
        if len(r) < len(head) - 1 or not r[0]:
            continue
        rec = {"team": r[0]}
        i = 1
        while i < len(head):
            name = head[i]
            val = r[i] if i < len(r) else ""
            if name == "投球回":
                frac = r[i + 1] if i + 1 < len(r) and i + 1 < len(head) and head[i + 1] == "" else ""
                whole = to_num(val) or 0
                thirds = {".1": 1, ".2": 2}.get(frac, 0)
                rec["outs"] = whole * 3 + thirds
                i += 2 if i + 1 < len(head) and head[i + 1] == "" else 1
                continue
            if name:
                rec[name] = to_num(val)
            i += 1
        out.append(rec)
    return out


def total(recs: list[dict], key: str):
    vals = [r.get(key) for r in recs]
    if not vals or any(v is None for v in vals):
        return None
    return sum(vals)


BAT_MAP = {"打数": "AB", "得点": "R", "安打": "H", "二塁打": "2B", "三塁打": "3B", "本塁打": "HR", "盗塁": "SB"}
BAT_DETAIL = {"打席": "PA", "四球": "BB", "死球": "HBP", "犠飛": "SF", "犠打": "SH", "盗塁刺": "CS"}
PIT_DETAIL = {"四球": "BB", "死球": "HBP", "本塁打": "HR", "安打": "H", "自責点": "ER"}


def parse_year(fetch: Fetcher, year: int, lg: str) -> dict:
    prefix, short = LEAGUES[lg]
    tables = read_tables(fetch.get(f"bis/yearly/{prefix}_{year}.html"))
    std = find_table(tables, ["勝率"])
    bat = find_table(tables, ["打率", "打数"])
    pit = find_table(tables, ["防御率", "投球回"])
    if not (std and bat and pit):
        raise RuntimeError(f"{year} {lg}: 表が見つかりません")
    std_r, bat_r, pit_r = records(std), records(bat), records(pit)
    result = {
        "teams": len(std_r),
        "games": max(r.get("試合") or 0 for r in std_r),
        "W": total(std_r, "勝利"),
        "L": total(std_r, "敗北"),
        "T": total(std_r, "引分") or 0,
        "bat": {v: total(bat_r, k) for k, v in BAT_MAP.items()},
        "pit": {"outs": sum(r["outs"] for r in pit_r), "R": total(pit_r, "失点"), "SO": total(pit_r, "奪三振")},
    }
    # 自責点：詳しい表がない年は、球団ごとの防御率×投球回÷9 から出す
    result["pit"]["ER"] = round(sum((r.get("防御率") or 0) * r["outs"] / 27 for r in pit_r))
    for v in BAT_DETAIL.values():
        result["bat"][v] = None
    for v in ("BB", "HBP", "HR", "H"):
        result["pit"][v] = None

    if year >= DETAIL_FROM:
        tb = records(find_table(read_tables(fetch.get(f"bis/{year}/stats/tmb_{short}.html")), ["打席", "四球"]))
        tp = records(find_table(read_tables(fetch.get(f"bis/{year}/stats/tmp_{short}.html")), ["自責点", "四球"]))
        for k, v in BAT_DETAIL.items():
            result["bat"][v] = total(tb, k)
        for k, v in PIT_DETAIL.items():
            result["pit"][v] = total(tp, k)
        # 詳しい表の値で確かめる（年度別ページと食い違っていないか）
        for k, v in BAT_MAP.items():
            if total(tb, k) != result["bat"][v]:
                log(f"  注意 {year} {lg} 打撃 {k}: 年度別 {result['bat'][v]} / 詳細 {total(tb, k)}")
    return result


def league_of(team: str) -> str:
    return "C" if any(w in team for w in CENTRAL_WORDS) else "P"


def sample_rates() -> dict[tuple[int, str], dict[str, int]]:
    """選手データの打撃成績を、年度・リーグごとに合計する（四球・死球・犠飛の推定に使う）。"""
    data = json.loads(PLAYERS_PATH.read_text(encoding="utf-8"))
    cols = data["meta"]["battingColumns"]
    idx = {k: cols.index(k) for k in ("AB", "BB", "HBP", "SF")}
    out: dict[tuple[int, str], dict[str, int]] = {}
    for p in data["players"].values():
        for r in p.get("batting", []):
            key = (r[0], league_of(r[1]))
            agg = out.setdefault(key, {k: 0 for k in idx})
            for k, i in idx.items():
                if isinstance(r[i], (int, float)):
                    agg[k] += r[i]
    return out


def estimate_walks(leagues: dict[str, dict]) -> None:
    """2005年より前の四球・死球・犠飛を推定して入れる。"""
    rates = sample_rates()
    for year_s, by_lg in leagues.items():
        year = int(year_s)
        for lg, x in by_lg.items():
            if x["bat"]["BB"] is not None:
                continue
            window = [rates.get((y, lg)) for y in range(year, year + 10) if y < DETAIL_FROM + 5]
            window = [w for w in window if w]
            own = rates.get((year, lg), {"AB": 0, "BB": 0, "HBP": 0, "SF": 0})
            pooled_ab = sum(w["AB"] for w in window) or 1
            for k in ("BB", "HBP", "SF"):
                prior = sum(w[k] for w in window) / pooled_ab
                rate = (own[k] + prior * SHRINK_AB) / (own["AB"] + SHRINK_AB)
                x["bat"][k] = round(rate * x["bat"]["AB"])
            x["estimated"] = True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="キャッシュだけで作る")
    args = ap.parse_args()

    fetch = Fetcher(args.offline)
    leagues: dict[str, dict] = {}
    for year in range(YEAR_FROM, YEAR_TO + 1):
        leagues[str(year)] = {lg: parse_year(fetch, year, lg) for lg in LEAGUES}
        c, p = leagues[str(year)]["C"], leagues[str(year)]["P"]
        log(f"{year}: セ {c['teams']}球団 {c['games']}試合 得点{c['bat']['R']} ／ パ {p['teams']}球団 {p['games']}試合 得点{p['bat']['R']}")
    estimate_walks(leagues)

    data = {
        "meta": {
            "source": "NPB.jp 日本野球機構 年度別成績（https://npb.jp/bis/yearly/）",
            "generatedAt": dt.datetime.now(JST).replace(microsecond=0).isoformat(),
            "note": "年度・リーグ別のチーム成績の合計。C=セ・リーグ、P=パ・リーグ。2005年より前の四球・死球・犠飛は選手データからの推定（estimated: true）。打席・犠打・盗塁刺などは 2005年以降のみ。",
        },
        "leagues": leagues,
    }
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    log(f"書き出し: {OUT_PATH.relative_to(ROOT)}（{OUT_PATH.stat().st_size:,} バイト、新しく取得したページ {fetch.fetched}）")


if __name__ == "__main__":
    main()
