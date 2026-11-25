#!/usr/bin/env python3
"""選手個人の Wikipedia 記事から data/players.json（プロフィール・成績・守備位置・タイトル）を作る。

使い方:
    python3 scripts/build_players.py               # キャッシュがない記事だけ取得して生成
    python3 scripts/build_players.py --offline     # 取得せず、キャッシュだけで生成
    python3 scripts/build_players.py --fetch-only  # 取得だけ（生成しない）

流れ:
    1. ドラフト記事（scripts/cache/{年}.html）の選手名リンクから、選手ごとの記事名を集める
    2. 記事の元の文章（wikitext）を 50 件ずつまとめて取得する（action=query）
    3. 年度別打撃成績・年度別投手成績・年度別守備成績の節だけを、20 人ずつまとめて
       Wikipedia 側で HTML の表に変換する（action=parse）。表の見出しがテンプレートで書かれているため
    4. プロフィール（Infobox）、成績表（NPB の一軍のみ）、守備位置別の試合数、タイトル・表彰を読み取る

出典: 日本語版 Wikipedia の各選手の記事（CC BY-SA 4.0）
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_drafts as bd  # noqa: E402

ROOT = bd.ROOT
CACHE = bd.CACHE_DIR / "players"
WIKI_CACHE = CACHE / "wiki"
HTML_CACHE = CACHE / "html"
OUTPUT_PATH = ROOT / "data" / "players.json"
REPORT_PATH = ROOT / "scripts" / "players_report.md"
DRAFTS_PATH = ROOT / "data" / "drafts.json"

API_URL = bd.API_URL
USER_AGENT = bd.USER_AGENT
REQUEST_INTERVAL_SEC = 1.0
MAX_RETRIES = 10
QUERY_BATCH = 50
RENDER_BATCH = 20
RENDER_MAX_CHARS = 160_000

JST = bd.JST

# 成績表の見出し → キー
BATTING_COLUMNS = {
    "年度": "year", "球団": "team", "試合": "G", "打席": "PA", "打数": "AB", "得点": "R", "安打": "H",
    "二塁打": "2B", "三塁打": "3B", "本塁打": "HR", "塁打": "TB", "打点": "RBI", "盗塁": "SB", "盗塁死": "CS",
    "犠打": "SH", "犠飛": "SF", "四球": "BB", "敬遠": "IBB", "死球": "HBP", "三振": "SO", "併殺打": "GDP",
    "打率": "AVG", "出塁率": "OBP", "長打率": "SLG", "OPS": "OPS",
}
PITCHING_COLUMNS = {
    "年度": "year", "球団": "team", "登板": "G", "先発": "GS", "完投": "CG", "完封": "SHO", "無四球": "NBB",
    "勝利": "W", "敗戦": "L", "セーブ": "SV", "ホールド": "HLD", "勝率": "WPCT", "打者": "BF", "投球回": "IP",
    "被安打": "H", "被本塁打": "HR", "与四球": "BB", "敬遠": "IBB", "与死球": "HBP", "奪三振": "SO",
    "暴投": "WP", "ボーク": "BK", "失点": "R", "自責点": "ER", "防御率": "ERA", "WHIP": "WHIP",
}
# players.json に入れる列（この順で配列にする）
BAT_KEYS = ["year", "team", "G", "PA", "AB", "R", "H", "2B", "3B", "HR", "TB", "RBI", "SB", "BB", "HBP", "SO", "SF", "AVG", "OBP", "SLG", "OPS"]
PIT_KEYS = ["year", "team", "G", "GS", "CG", "SHO", "W", "L", "SV", "HLD", "IP", "H", "HR", "BB", "HBP", "SO", "ER", "ERA", "WHIP"]

# 守備成績の見出しの守備位置
FIELD_POSITIONS = ["投手", "捕手", "一塁", "二塁", "三塁", "遊撃", "外野", "左翼", "中堅", "右翼"]

# NPB の球団（成績表の「球団」欄の表記）。ここにないもの（MLB など）は一軍成績として扱わない
NPB_TEAM_WORDS = [
    "巨人", "読売", "阪神", "大阪", "中日", "名古屋", "広島", "サンケイ", "アトムズ", "ヤクルト", "国鉄",
    "大洋", "横浜", "DeNA", "松竹", "西鉄", "太平洋", "クラウン", "西武", "東京", "毎日", "大毎", "ロッテ",
    "東映", "日拓", "日本ハム", "南海", "ダイエー", "ソフトバンク", "阪急", "オリックス", "近鉄", "楽天",
    "大映", "高橋", "トンボ",
]

SECTION_RE = re.compile(r"^(={2,6})\s*(.+?)\s*\1\s*$", re.M)
STAT_SECTIONS = {"bat": "年度別打撃成績", "pit": "年度別投手成績", "fld": "年度別守備成績"}
SKIP_SECTION_WORDS = (
    "順位", "二軍", "ファーム", "ポストシーズン", "代表", "WBC", "オールスター", "独立", "BC", "四国", "マイナー",
    "MLB", "海外", "韓国", "台湾", "KBO", "CPBL", "社会人", "大学", "高校", "監督", "コーチ",
)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def sha(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:20]


# ---------------------------------------------------------------------------
# 1. 選手ごとの記事名
# ---------------------------------------------------------------------------


def collect_titles() -> dict[str, dict]:
    """playerKey → { title, pickIds }。リンクがない・記事がない（赤リンク）選手は入れない。"""
    fmap = json.loads(bd.FRANCHISE_MAP_PATH.read_text(encoding="utf-8"))
    drafts = json.loads(DRAFTS_PATH.read_text(encoding="utf-8"))
    picks = {p["id"]: p for d in drafts["drafts"] for p in d["picks"]}
    out: dict[str, dict] = {}
    for year in range(bd.YEAR_FROM, bd.YEAR_TO + 1):
        html = (bd.CACHE_DIR / f"{year}.html").read_text(encoding="utf-8")
        soup = BeautifulSoup(html, "html.parser")
        red = {a.get("title", "").replace(" (存在しないページ)", "") for a in soup.select("a.new")}
        result = bd.parse_year(year, html, fmap["teams"])
        counter: Counter = Counter()
        for raw in result.picks:
            counter[raw.franchise_id] += 1
            pick_id = f"{year}-{raw.franchise_id}-{counter[raw.franchise_id]:02d}"
            pick = picks.get(pick_id)
            if not pick or not raw.link or raw.link in red:
                continue
            entry = out.setdefault(pick["playerKey"], {"title": raw.link, "pickIds": []})
            entry["pickIds"].append(pick_id)
    return out


# ---------------------------------------------------------------------------
# 2〜3. 取得（キャッシュつき）
# ---------------------------------------------------------------------------


class Api:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.last = 0.0
        self.requests = 0

    def call(self, method: str, params: dict) -> dict:
        for attempt in range(1, MAX_RETRIES + 1):
            wait = REQUEST_INTERVAL_SEC - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            try:
                if method == "POST":
                    resp = self.session.post(API_URL, data=params, timeout=120)
                else:
                    resp = self.session.get(API_URL, params=params, timeout=120)
            except requests.RequestException as e:
                self.last = time.monotonic()
                log(f"  通信エラー（{e.__class__.__name__}）、{min(2 ** attempt, 60)}秒待って再試行（{attempt}/{MAX_RETRIES}）")
                time.sleep(min(2 ** attempt, 60))
                continue
            self.last = time.monotonic()
            self.requests += 1
            if resp.status_code == 200:
                payload = resp.json()
                if "error" in payload:
                    raise RuntimeError(f"API エラー: {payload['error']}")
                return payload
            if resp.status_code in bd.RETRY_STATUS:
                ra = resp.headers.get("Retry-After")
                wait = int(ra) + 1 if ra and ra.isdigit() else min(2 ** attempt, 60)
                log(f"  HTTP {resp.status_code}、{wait}秒待って再試行（{attempt}/{MAX_RETRIES}）")
                time.sleep(wait)
                continue
            resp.raise_for_status()
        raise RuntimeError("取得に失敗しました")


def wiki_cache_path(title: str) -> Path:
    return WIKI_CACHE / f"{sha(title)}.json"


def fetch_wikitext(api: Api, titles: list[str], offline: bool) -> dict[str, dict]:
    """記事名 → { title（転送先も解決した記事名）, missing, wikitext }"""
    WIKI_CACHE.mkdir(parents=True, exist_ok=True)
    result: dict[str, dict] = {}
    todo = []
    for t in titles:
        p = wiki_cache_path(t)
        if p.exists():
            result[t] = json.loads(p.read_text(encoding="utf-8"))
        else:
            todo.append(t)
    if todo and offline:
        log(f"  キャッシュがない記事 {len(todo)} 件は飛ばします（--offline）")
        return result
    for i in range(0, len(todo), QUERY_BATCH):
        batch = todo[i : i + QUERY_BATCH]
        params = {
            "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
            "titles": "|".join(batch), "redirects": "1", "format": "json", "formatversion": "2",
        }
        pages: dict[str, dict] = {}
        norm: dict[str, str] = {}
        redir: dict[str, str] = {}
        cont: dict = {}
        while True:
            payload = api.call("GET", {**params, **cont})
            q = payload.get("query", {})
            norm.update({n["from"]: n["to"] for n in q.get("normalized", [])})
            redir.update({r["from"]: r["to"] for r in q.get("redirects", [])})
            for page in q.get("pages", []):
                if page.get("revisions"):
                    pages[page["title"]] = page
                elif page["title"] not in pages:
                    pages[page["title"]] = page
            if "continue" not in payload:
                break
            cont = payload["continue"]
        for t in batch:
            resolved = norm.get(t, t)
            resolved = redir.get(resolved, resolved)
            page = pages.get(resolved, {"missing": True})
            entry = {
                "requested": t,
                "title": resolved,
                "missing": bool(page.get("missing")) or not page.get("revisions"),
                "wikitext": page["revisions"][0]["slots"]["main"]["content"] if page.get("revisions") else "",
            }
            wiki_cache_path(t).write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
            result[t] = entry
        log(f"  記事 {min(i + QUERY_BATCH, len(todo))}/{len(todo)} 件を取得（リクエスト {api.requests} 回）")
    return result


def strip_refs(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    return text


def stat_sections(wikitext: str) -> dict[str, str]:
    """年度別打撃成績・年度別投手成績・年度別守備成績の節の本文。"""
    heads = list(SECTION_RE.finditer(wikitext))
    out: dict[str, str] = {}
    for i, m in enumerate(heads):
        level, name = len(m.group(1)), m.group(2)
        # 「年度別打撃成績」のほか「NPB年度別投手成績」なども対象にする（二軍・独立リーグなどは除く）
        key = next((k for k, w in STAT_SECTIONS.items() if w in name), None)
        if not key or key in out or any(w in name for w in SKIP_SECTION_WORDS):
            continue
        end = len(wikitext)
        for n in heads[i + 1 :]:
            if len(n.group(1)) <= level:
                end = n.start()
                break
        body = strip_refs(wikitext[m.end() : end])
        # 子見出し（==== 一軍 ==== など）は残さない。表だけあればよい
        body = SECTION_RE.sub("", body)
        if "{|" in body:
            out[key] = body.strip()
    return out


def html_cache_path(title: str) -> Path:
    return HTML_CACHE / f"{sha(title)}.json"


def render_sections(api: Api, players: dict[str, dict], offline: bool) -> dict[str, dict]:
    """記事名（転送先）→ { bat, pit, fld }（各節の HTML）"""
    HTML_CACHE.mkdir(parents=True, exist_ok=True)
    result: dict[str, dict] = {}
    todo: list[tuple[str, dict]] = []
    for title, sections in players.items():
        p = html_cache_path(title)
        if p.exists():
            result[title] = json.loads(p.read_text(encoding="utf-8"))
        elif sections:
            todo.append((title, sections))
        else:
            result[title] = {}
    if todo and offline:
        log(f"  表の変換がない記事 {len(todo)} 件は飛ばします（--offline）")
        return result

    def flush(batch: list[tuple[str, dict]]) -> None:
        parts = []
        for idx, (_, sections) in enumerate(batch):
            parts.append(f"== DRP{idx} ==")
            for key in ("bat", "pit", "fld"):
                if key in sections:
                    parts.append(f"=== DR{key.upper()} ===\n{sections[key]}\n")
        payload = api.call("POST", {
            "action": "parse", "contentmodel": "wikitext", "text": "\n".join(parts), "prop": "text",
            "format": "json", "formatversion": "2", "disablelimitreport": "1", "disableeditsection": "1",
        })
        soup = BeautifulSoup(payload["parse"]["text"], "html.parser")
        root = soup.select_one(".mw-parser-output") or soup
        found: dict[int, dict] = defaultdict(lambda: defaultdict(list))
        cur_idx, cur_key = None, None
        for el in root.find_all(["h2", "h3", "table"]):
            if el.name == "h2":
                m = re.fullmatch(r"DRP(\d+)", el.get_text(strip=True))
                cur_idx = int(m.group(1)) if m else None
                cur_key = None
            elif el.name == "h3":
                m = re.fullmatch(r"DR(BAT|PIT|FLD)", el.get_text(strip=True))
                cur_key = m.group(1).lower() if m else None
            elif cur_idx is not None and cur_key and el.find_parent("table") is None:
                found[cur_idx][cur_key].append(str(el))
        for idx, (title, _) in enumerate(batch):
            entry = {k: "".join(v) for k, v in found[idx].items()}
            html_cache_path(title).write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
            result[title] = entry

    batch: list[tuple[str, dict]] = []
    size = 0
    done = 0
    for item in todo:
        n = sum(len(v) for v in item[1].values())
        if batch and (len(batch) >= RENDER_BATCH or size + n > RENDER_MAX_CHARS):
            flush(batch)
            done += len(batch)
            log(f"  成績表 {done}/{len(todo)} 人ぶんを変換（リクエスト {api.requests} 回）")
            batch, size = [], 0
        batch.append(item)
        size += n
    if batch:
        flush(batch)
        done += len(batch)
        log(f"  成績表 {done}/{len(todo)} 人ぶんを変換（リクエスト {api.requests} 回）")
    return result


# ---------------------------------------------------------------------------
# 4. 読み取り
# ---------------------------------------------------------------------------


def split_template(text: str, start: int) -> tuple[str, int]:
    """text[start] が '{{' のとき、対応する '}}' までの中身と終わりの位置。"""
    depth = 0
    i = start
    while i < len(text) - 1:
        two = text[i : i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return text[start + 2 : i - 2], i
            continue
        i += 1
    return text[start + 2 :], len(text)


def split_params(body: str) -> dict[str, str]:
    """テンプレートの中身を、深さ0の '|' で分けて名前つき引数にする。"""
    parts, depth_t, depth_l, buf = [], 0, 0, []
    i = 0
    while i < len(body):
        two = body[i : i + 2]
        if two in ("{{", "}}", "[[", "]]"):
            if two == "{{":
                depth_t += 1
            elif two == "}}":
                depth_t -= 1
            elif two == "[[":
                depth_l += 1
            else:
                depth_l -= 1
            buf.append(two)
            i += 2
            continue
        ch = body[i]
        if ch == "|" and depth_t == 0 and depth_l == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    parts.append("".join(buf))
    params = {}
    for part in parts[1:]:
        if "=" in part:
            k, v = part.split("=", 1)
            params[k.strip()] = v.strip()
    return params


def clean_wiki(text: str) -> str:
    """wikitext を読める文字だけにする（リンク・太字・テンプレートなどを外す）。"""
    t = strip_refs(text)
    t = re.sub(r"\{\{\s*生年月日と年齢\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)[^}]*\}\}", r"\1年\2月\3日", t)
    t = re.sub(r"\{\{\s*死亡年月日と没年齢\s*\|[^|}]*\|[^|}]*\|[^|}]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)[^}]*\}\}", r"\1年\2月\3日", t)
    t = re.sub(r"\{\{\s*NPBドラフト\s*\|\s*(\d+)\s*\}\}", r"\1年", t)
    t = re.sub(r"\{\{\s*[Bb]y2?\s*\|\s*(\d+)\s*(年?)\s*\}\}", lambda m: m.group(1) + ("年" if m.group(2) else ""), t)
    t = re.sub(r"\{\{\s*(JPN|日本)\s*\}\}", "日本", t)
    t = re.sub(r"\{\{\s*0\s*\}\}", "", t)
    # 残りのテンプレートは中身ごと消す（入れ子も）
    prev = None
    while prev != t:
        prev = t
        t = re.sub(r"\{\{[^{}]*\}\}", "", t)
    t = re.sub(r"\[\[(?:ファイル|File|画像|Image):[^\]]*\]\]", "", t)
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", t)
    t = re.sub(r"'{2,}", "", t)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("&nbsp;", " ")
    return re.sub(r"[ \t]+", " ", t).strip()


INFOBOX_FIELDS = {
    "守備位置": "position", "利き腕": "throws", "打席": "bats", "身長": "height", "体重": "weight",
    "出身地": "birthplace", "生年月日": "born", "没年月日": "died", "プロ入り年度": "proYear",
    "ドラフト順位": "draftRound", "初出場": "debut", "最終出場": "lastGame", "国籍": "nationality",
}


def parse_profile(wikitext: str) -> dict:
    m = re.search(r"\{\{\s*Infobox[ _]baseball[ _]player", wikitext, re.I)
    if not m:
        return {}
    body, _ = split_template(wikitext, m.start())
    params = split_params(body)
    prof: dict = {}
    for k, key in INFOBOX_FIELDS.items():
        v = params.get(k)
        if v:
            text = clean_wiki(v).replace("\n", " ").strip()
            if text:
                prof[key] = text
    career = params.get("経歴") or params.get("選手歴")
    if career:
        items = []
        for line in strip_refs(career).splitlines():
            line = line.strip()
            if line.startswith("*") and not line.startswith("**"):
                item = clean_wiki(line.lstrip("*")).replace("\n", " ").strip()
                if item:
                    items.append(item)
        if items:
            prof["career"] = items[:12]
    for k in ("height", "weight"):
        if k in prof:
            n = re.search(r"\d+", prof[k])
            prof[k] = int(n.group()) if n else None
            if prof[k] is None:
                del prof[k]
    return prof


def parse_honors(wikitext: str, heading: str) -> list[str]:
    heads = list(SECTION_RE.finditer(wikitext))
    for i, m in enumerate(heads):
        if m.group(2).strip() != heading:
            continue
        level = len(m.group(1))
        end = len(wikitext)
        for n in heads[i + 1 :]:
            if len(n.group(1)) <= level:
                end = n.start()
                break
        items = []
        for line in wikitext[m.end() : end].splitlines():
            line = line.strip()
            if line.startswith("*") and not line.startswith("**"):
                item = clean_wiki(line.lstrip("*")).replace("\n", " ")
                item = re.sub(r"※.*$", "", item).strip()
                if item:
                    items.append(item)
        return items[:20]
    return []


def number(text: str):
    t = text.replace(",", "").strip()
    if t in ("", "-", "--", "―", "－", "‐", "—"):
        return None
    if re.fullmatch(r"-?\d+", t):
        return int(t)
    if re.fullmatch(r"-?\d*\.\d+", t):
        return float(t)
    return None


def innings(text: str):
    """投球回 '206.2' / '206 2/3' / '206{{0}}.2' → 文字列 '206.2'（.1=1/3, .2=2/3）"""
    t = text.replace(" ", "").replace(" ", "")
    m = re.fullmatch(r"(\d+)\.([012])", t)
    if m:
        return f"{int(m.group(1))}.{m.group(2)}"
    m = re.fullmatch(r"(\d+)?([12])/3", t)
    if m:
        return f"{int(m.group(1) or 0)}.{m.group(2)}"
    m = re.fullmatch(r"(\d+)", t)
    if m:
        return f"{int(m.group(1))}.0"
    return None


def header_key(cell) -> str:
    # 縦書きの見出しは長音を「丨」「｜」で書く（セ丨ブ → セーブ、ホ丨ルド → ホールド）
    text = re.sub(r"\s+", "", bd.cell_text(cell, line_sep=""))
    return re.sub(r"[丨｜|]", "ー", text)


# NPB の球団名を含むが、海外の球団の表記（KBO のロッテ・ジャイアンツと青宝・太平洋、CPBL の楽天モンキーズ）
NON_NPB_TEAM_RE = re.compile(r"KBO|CPBL|青宝|ロッテ[（(]?G[)）]?$|楽天M$")
# NPB にその名前の球団があった年（KBO に同じ名前の球団があるもの）
NPB_TEAM_YEARS = {"太平洋": (1973, 1976)}


def is_npb_team(team: str, year: int | None = None) -> bool:
    if NON_NPB_TEAM_RE.search(team):
        return False
    if year is not None and team in NPB_TEAM_YEARS:
        lo, hi = NPB_TEAM_YEARS[team]
        if not lo <= year <= hi:
            return False
    return any(w in team for w in NPB_TEAM_WORDS)


def normalize_team(team: str) -> str:
    """「ロッテ(O)」「ロッテ(M)」「楽天E」のような、海外の同名球団と区別するための印を外す。"""
    team = re.sub(r"[（(][OM][)）]$", "", team)
    return re.sub(r"^楽天E$", "楽天", team)


def parse_stat_tables(html: str, columns: dict[str, str], keys: list[str], unknown_teams: Counter) -> list[dict]:
    if not html:
        return []
    soup = bd.clean_soup(html)
    rows_out = []
    for table in soup.find_all("table"):
        grid = bd.table_grid(table)
        colmap: dict[str, int] | None = None
        for row in grid:
            texts = [header_key(c) for c in row]
            if "年度" in texts and any(t in columns for t in texts if t not in ("年度", "球団")):
                colmap = {}
                for i, t in enumerate(texts):
                    k = columns.get(t)
                    if k and k not in colmap:
                        colmap[k] = i
                continue
            if colmap is None or "year" not in colmap:
                continue
            ycell = row[colmap["year"]] if colmap["year"] < len(row) else None
            if ycell is None:
                continue
            ym = re.match(r"^(\d{4})", bd.cell_text(ycell))
            if not ym:
                continue  # 通算などの行
            team = bd.cell_text(row[colmap["team"]]) if "team" in colmap and colmap["team"] < len(row) else ""
            if team and not is_npb_team(team, int(ym.group(1))):
                unknown_teams[team] += 1
                continue
            rec = {"year": int(ym.group(1)), "team": normalize_team(team)}
            lead = []
            for k, i in colmap.items():
                if k in ("year", "team") or i >= len(row):
                    continue
                cell = row[i]
                text = bd.cell_text(cell)
                rec[k] = innings(text) if k == "IP" else number(text)
                if cell.find(["b", "strong"]) and rec[k] is not None:
                    lead.append(k)
            if lead:
                rec["lead"] = lead
            rows_out.append(rec)
    return rows_out


def parse_fielding(html: str) -> dict[str, int]:
    """守備位置 → 一軍の通算試合数"""
    if not html:
        return {}
    soup = bd.clean_soup(html)
    games: Counter = Counter()
    for table in soup.find_all("table"):
        grid = bd.table_grid(table)
        pos_of: dict[int, str] = {}
        game_cols: dict[int, str] = {}
        year_col = team_col = None
        for row in grid:
            texts = [header_key(c) for c in row]
            if any(t in FIELD_POSITIONS for t in texts):
                pos_of = {i: t for i, t in enumerate(texts) if t in FIELD_POSITIONS}
                if "年度" in texts:
                    year_col = texts.index("年度")
                if "球団" in texts:
                    team_col = texts.index("球団")
                continue
            if pos_of and "試合" in texts:
                game_cols = {i: pos_of[i] for i, t in enumerate(texts) if t == "試合" and i in pos_of}
                continue
            if not game_cols or year_col is None:
                continue
            if year_col >= len(row) or not re.match(r"^\d{4}", bd.cell_text(row[year_col])):
                continue
            if team_col is not None and team_col < len(row) and not is_npb_team(bd.cell_text(row[team_col])):
                continue
            for i, pos in game_cols.items():
                if i < len(row):
                    n = number(bd.cell_text(row[i]))
                    if isinstance(n, int):
                        games[pos] += n
    return dict(games)


def compact(rows: list[dict], keys: list[str]) -> list:
    out = []
    for r in sorted(rows, key=lambda r: r["year"]):
        arr = [r.get(k) for k in keys]
        if r.get("lead"):
            arr.append([keys.index(k) for k in r["lead"] if k in keys])
        out.append(arr)
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


SPOT_CHECKS = [
    # (playerKey, 確認内容, 関数)
    ("糸井嘉男", "2014年の打率 .331（リーグ1位）", lambda p: any(r[0] == 2014 and r[BAT_KEYS.index("AVG")] == 0.331 for r in p.get("batting", []))),
    ("堀内恒夫", "1966年に16勝・防御率1.39", lambda p: any(r[0] == 1966 and r[PIT_KEYS.index("W")] == 16 and r[PIT_KEYS.index("ERA")] == 1.39 for r in p.get("pitching", []))),
    ("田淵幸一", "守備位置に捕手がある", lambda p: p.get("fielding", {}).get("捕手", 0) > 0),
    ("松井秀喜", "NPB の成績だけ（2002年に50本塁打、MLB の年がない）", lambda p: any(r[0] == 2002 and r[BAT_KEYS.index("HR")] == 50 for r in p.get("batting", [])) and all(r[0] <= 2002 for r in p.get("batting", []))),
    ("大谷翔平", "NPB の打撃と投手の両方の成績がある", lambda p: bool(p.get("batting")) and bool(p.get("pitching"))),
]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="取得せず、キャッシュだけで生成する")
    ap.add_argument("--fetch-only", action="store_true", help="取得だけして、生成はしない")
    ap.add_argument("--limit", type=int, default=0, help="（動作確認用）先頭から N 人だけ")
    args = ap.parse_args(argv)

    targets = collect_titles()
    if args.limit:
        targets = dict(list(targets.items())[: args.limit])
    titles = sorted({v["title"] for v in targets.values()})
    log(f"記事のある選手 {len(targets)} 人（記事 {len(titles)} 件）")

    api = Api()
    wiki = fetch_wikitext(api, titles, args.offline)
    resolved_sections: dict[str, dict] = {}
    for t, entry in wiki.items():
        if not entry["missing"]:
            resolved_sections.setdefault(entry["title"], stat_sections(entry["wikitext"]))
    rendered = render_sections(api, resolved_sections, args.offline)
    log(f"取得・変換が終わりました（リクエスト {api.requests} 回）")
    if args.fetch_only:
        return 0

    unknown_teams: Counter = Counter()
    players: dict[str, dict] = {}
    stats = Counter()
    for key, info in sorted(targets.items()):
        entry = wiki.get(info["title"])
        if not entry or entry["missing"]:
            stats["記事が取得できない"] += 1
            continue
        title = entry["title"]
        text = entry["wikitext"]
        tables = rendered.get(title, {})
        rec: dict = {"title": title}
        profile = parse_profile(text)
        if profile:
            rec["profile"] = profile
        batting = parse_stat_tables(tables.get("bat", ""), BATTING_COLUMNS, BAT_KEYS, unknown_teams)
        pitching = parse_stat_tables(tables.get("pit", ""), PITCHING_COLUMNS, PIT_KEYS, unknown_teams)
        fielding = parse_fielding(tables.get("fld", ""))
        if batting:
            rec["batting"] = compact(batting, BAT_KEYS)
        if pitching:
            rec["pitching"] = compact(pitching, PIT_KEYS)
        if fielding:
            rec["fielding"] = fielding
        titles_ = parse_honors(text, "タイトル")
        awards = parse_honors(text, "表彰")
        if titles_:
            rec["titles"] = titles_
        if awards:
            rec["awards"] = awards
        players[key] = rec
        stats["記事あり"] += 1
        stats["プロフィールあり"] += bool(profile)
        stats["一軍の打撃成績あり"] += bool(batting)
        stats["一軍の投手成績あり"] += bool(pitching)
        stats["守備成績あり"] += bool(fielding)
        stats["一軍の成績あり（打撃か投手）"] += bool(batting or pitching)
        stats["タイトルあり"] += bool(titles_)
        stats["成績の節はあるが NPB 一軍の行がない（海外のみなど）"] += bool(tables and not batting and not pitching and (tables.get("bat") or tables.get("pit")))

    generated_at = dt.datetime.now(JST).replace(microsecond=0).isoformat()
    data = {
        "meta": {
            "source": "Wikipedia日本語版 各選手の記事",
            "license": "CC BY-SA 4.0",
            "generatedAt": generated_at,
            "battingColumns": BAT_KEYS,
            "pitchingColumns": PIT_KEYS,
            "note": "成績は NPB の一軍のみ。各行の最後の配列は、リーグ1位（記事で太字）の列の番号",
        },
        "players": players,
    }
    OUTPUT_PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    checks = [(k, label, bool(players.get(k) and fn(players[k]))) for k, label, fn in SPOT_CHECKS]
    lines = [
        "# 選手データ検証レポート",
        "",
        f"- 生成日時：{generated_at}",
        "- 出典：Wikipedia日本語版 各選手の記事（CC BY-SA 4.0）",
        "- このファイルは `scripts/build_players.py` が生成します。手で編集しないでください。",
        "",
        "## 件数",
        "",
        "| 項目 | 人数 |",
        "|---|---:|",
        f"| 指名選手（同一人物はまとめる） | {len({p['playerKey'] for d in json.loads(DRAFTS_PATH.read_text())['drafts'] for p in d['picks']})} |",
        f"| 記事へのリンクがある | {len(targets)} |",
    ]
    lines += [f"| {k} | {v} |" for k, v in stats.items()]
    lines += ["", "## 抜き取り確認", "", "| 選手 | 確認内容 | 結果 |", "|---|---|---|"]
    lines += [f"| {k} | {label} | {'OK' if ok else '**NG**'} |" for k, label, ok in checks]
    lines += ["", "## NPB の球団として扱わなかった表記（上位50）", "", "MLB・韓国・台湾などの成績は入れていません。NPB の球団なのにここに出ていたら、`NPB_TEAM_WORDS` に追加してください。", ""]
    lines += [f"- {t}（{n}行）" for t, n in unknown_teams.most_common(50)] or ["- なし"]
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    size = OUTPUT_PATH.stat().st_size
    log(f"{OUTPUT_PATH.relative_to(ROOT)} に {len(players)} 人を書き出しました（{size / 1024 / 1024:.2f} MB）")
    log(f"{REPORT_PATH.relative_to(ROOT)} に検証レポートを書き出しました")
    for k, label, ok in checks:
        log(f"  {'OK' if ok else 'NG'} {k}: {label}")
    return 0 if all(ok for _, _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
