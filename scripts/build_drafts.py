#!/usr/bin/env python3
"""Wikipedia の各年度ドラフト記事から data/drafts.json を作る。

使い方:
    python3 scripts/build_drafts.py             # キャッシュがない年度だけ取得して生成
    python3 scripts/build_drafts.py --offline   # 取得せずキャッシュだけで生成
    python3 scripts/build_drafts.py --refresh   # 全年度を取り直して生成

出典: 日本語版 Wikipedia「{年}年度新人選手選択会議 (日本プロ野球)」（CC BY-SA 4.0）
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
import urllib.parse
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
CACHE_DIR = SCRIPTS_DIR / "cache"
FRANCHISE_MAP_PATH = SCRIPTS_DIR / "franchise_map.json"
OVERRIDES_PATH = SCRIPTS_DIR / "overrides.json"
REPORT_PATH = SCRIPTS_DIR / "report.md"
OUTPUT_PATH = ROOT / "data" / "drafts.json"

YEAR_FROM = 1965
YEAR_TO = 2025

API_URL = "https://ja.wikipedia.org/w/api.php"
USER_AGENT = "baseball-draftdraft/0.1 (personal project)"
REQUEST_INTERVAL_SEC = 1.0
MAX_RETRIES = 8
RETRY_STATUS = {429, 500, 502, 503, 504}

SOURCE_TEXT = "Wikipedia日本語版「新人選手選択会議 (日本プロ野球)」各年度記事"
LICENSE_TEXT = "CC BY-SA 4.0"
JST = dt.timezone(dt.timedelta(hours=9))

POS_GROUP = {"投手": "P", "捕手": "F", "内野手": "F", "外野手": "F"}

# 表のヘッダー文字列 → 列の意味。年代で表記が違うので別名をまとめる。
COLUMN_ALIASES = {
    "順位": "round",
    "選手名": "name",
    "守備": "pos",
    "守備位置": "pos",
    "ポジション": "pos",
    "所属": "from",
    "結果": "result",
}
REQUIRED_COLUMNS = {"round", "name", "pos", "from", "result"}

# 表の中の区切り行（または caption）→ (draftType, roundLabel の接頭辞)
SECTIONS = {
    "新人選手選択会議": ("regular", ""),
    "第1次ドラフト": ("regular", "1次"),
    "第2次ドラフト": ("regular", "2次"),
    "高校生ドラフト": ("regular", "高校"),
    "大学生・社会人ドラフト": ("regular", "大社"),
    "育成選手選択会議": ("ikusei", "育成"),
    "育成選手ドラフト": ("ikusei", "育成"),
}
DEFAULT_SECTION = SECTIONS["新人選手選択会議"]

# 結果・備考の列にこれらの語があれば signed=false（入団しなかった指名）とする。
UNSIGNED_MARKERS = ("拒否", "交渉権放棄", "指名取消", "指名無効")

# 上書きで変更してよいフィールド
OVERRIDABLE_FIELDS = {
    "roundLabel", "name", "playerKey", "pos", "from", "draftType", "signed", "twoWay", "note",
}


class BuildError(Exception):
    """データ作成を止めるべき問題。"""


# ---------------------------------------------------------------------------
# 取得（MediaWiki API + キャッシュ）
# ---------------------------------------------------------------------------


def article_title(year: int) -> str:
    return f"{year}年度新人選手選択会議 (日本プロ野球)"


class Fetcher:
    def __init__(self, refresh: bool, offline: bool) -> None:
        self.refresh = refresh
        self.offline = offline
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self._last_request = 0.0
        self.fetched: list[int] = []

    def _wait_interval(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < REQUEST_INTERVAL_SEC:
            time.sleep(REQUEST_INTERVAL_SEC - elapsed)

    def get(self, year: int) -> str:
        path = CACHE_DIR / f"{year}.html"
        if path.exists() and not self.refresh:
            return path.read_text(encoding="utf-8")
        if self.offline:
            raise BuildError(f"{year}年のキャッシュがありません（--offline 指定中）: {path}")

        params = {
            "action": "parse",
            "page": article_title(year),
            "prop": "text",
            "format": "json",
            "formatversion": "2",
            "redirects": "1",
        }
        for attempt in range(1, MAX_RETRIES + 1):
            self._wait_interval()
            resp = self.session.get(API_URL, params=params, timeout=60)
            self._last_request = time.monotonic()
            if resp.status_code == 200:
                payload = resp.json()
                if "error" in payload:
                    raise BuildError(f"{year}年の取得でAPIエラー: {payload['error']}")
                html = payload["parse"]["text"]
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                path.write_text(html, encoding="utf-8")
                self.fetched.append(year)
                log(f"  {year}: 取得しました（{len(html):,} 文字）")
                return html
            if resp.status_code in RETRY_STATUS:
                wait = _retry_after(resp) or min(2 ** attempt, 60)
                log(f"  {year}: HTTP {resp.status_code}、{wait}秒待って再試行します（{attempt}/{MAX_RETRIES}）")
                time.sleep(wait)
                continue
            resp.raise_for_status()
        raise BuildError(f"{year}年の取得に{MAX_RETRIES}回失敗しました")


def _retry_after(resp: requests.Response) -> int | None:
    value = resp.headers.get("Retry-After")
    if value and value.isdigit():
        return int(value) + 1
    return None


# ---------------------------------------------------------------------------
# HTML の解析
# ---------------------------------------------------------------------------


def clean_soup(html: str) -> BeautifulSoup:
    soup = BeautifulSoup(html, "html.parser")
    # 脚注番号・他言語版リンク（「（英語版）」など）・編集リンクは本文ではないので除く
    for el in soup.select("sup.reference, .noprint, .mw-editsection, style"):
        el.decompose()
    for br in soup.find_all("br"):
        br.replace_with("\n")
    return soup


def cell_text(el: Tag, line_sep: str = " ") -> str:
    raw = el.get_text("").replace(" ", " ")
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in raw.split("\n")]
    return line_sep.join(ln for ln in lines if ln)


def _span(cell: Tag, attr: str) -> int:
    try:
        return max(1, int(str(cell.get(attr, "1")).strip() or "1"))
    except ValueError:
        return 1


def table_grid(table: Tag) -> list[list[Tag]]:
    """rowspan/colspan を展開して、行ごとのセル配列にする（結合セルは同じ Tag が並ぶ）。"""
    rows = [tr for tr in table.find_all("tr") if tr.find_parent("table") is table]
    carry: dict[int, list] = {}  # 列番号 → [残り行数, セル]
    grid: list[list[Tag]] = []
    for tr in rows:
        cells = tr.find_all(["th", "td"], recursive=False)
        out: list[Tag] = []
        col = 0
        idx = 0
        while idx < len(cells) or col in carry:
            if col in carry:
                remaining, cell = carry[col]
                out.append(cell)
                if remaining <= 1:
                    del carry[col]
                else:
                    carry[col][0] = remaining - 1
                col += 1
                continue
            cell = cells[idx]
            idx += 1
            rs, cs = _span(cell, "rowspan"), _span(cell, "colspan")
            for _ in range(cs):
                out.append(cell)
                if rs > 1:
                    carry[col] = [rs - 1, cell]
                col += 1
        grid.append(out)
    return grid


def link_target(cell: Tag) -> str | None:
    """選手名セルのリンク先（記事名）。同姓同名の見分けに使う。"""
    a = cell.find("a", href=True)
    if not a:
        return None
    href = a["href"]
    if href.startswith("/wiki/"):
        title = urllib.parse.unquote(href[len("/wiki/"):])
    else:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
        if "title" not in qs:
            return None
        title = qs["title"][0]
    return title.split("#")[0].replace("_", " ")


@dataclass
class RawPick:
    year: int
    franchise_id: str
    team_name: str
    round_label: str
    name: str
    pos: str
    from_: str
    result: str
    draft_type: str
    link: str | None


@dataclass
class YearResult:
    year: int
    team_headings: list[tuple[str, str]] = field(default_factory=list)  # (見出し, スロットid)
    picks: list[RawPick] = field(default_factory=list)
    skipped_rows: list[tuple[str, str, str]] = field(default_factory=list)  # (球団, 順位, 内容)
    unknown_teams: list[str] = field(default_factory=list)
    unknown_sections: list[str] = field(default_factory=list)
    unknown_positions: list[str] = field(default_factory=list)
    bad_tables: list[str] = field(default_factory=list)


def is_draft_table(grid: list[list[Tag]]) -> bool:
    for row in grid:
        texts = {cell_text(c) for c in row}
        if {"順位", "選手名", "所属"} <= texts:
            return True
    return False


def parse_year(year: int, html: str, team_map: dict[str, str]) -> YearResult:
    res = YearResult(year)
    soup = clean_soup(html)
    root = soup.select_one(".mw-parser-output") or soup
    heading: str | None = None

    for el in root.find_all(["h2", "h3", "h4", "h5", "h6", "table"]):
        if el.name != "table":
            heading = cell_text(el)
            if heading in team_map:
                res.team_headings.append((heading, team_map[heading]))
            continue
        if "wikitable" not in (el.get("class") or []):
            continue
        grid = table_grid(el)
        if not is_draft_table(grid):
            continue
        if heading not in team_map:
            res.unknown_teams.append(heading or "(見出しなし)")
            continue
        _parse_team_table(res, el, grid, heading, team_map[heading])
    return res


def _parse_team_table(res: YearResult, table: Tag, grid: list[list[Tag]], team: str, fid: str) -> None:
    section = DEFAULT_SECTION
    caption = table.find("caption")
    if caption and cell_text(caption):
        label = cell_text(caption)
        if label in SECTIONS:
            section = SECTIONS[label]
        else:
            res.unknown_sections.append(f"{team}: {label}")

    columns: dict[str, int] | None = None
    for row in grid:
        if not row:
            continue
        texts = [cell_text(c) for c in row]

        # 区切り行（1つのセルが行全体を占める）
        if len({id(c) for c in row}) == 1:
            label = texts[0]
            if label in SECTIONS:
                section = SECTIONS[label]
            else:
                res.unknown_sections.append(f"{team}: {label}")
            continue

        # ヘッダー行
        if "選手名" in texts:
            columns = {}
            for i, t in enumerate(texts):
                key = COLUMN_ALIASES.get(t)
                if key and key not in columns:
                    columns[key] = i
            missing = REQUIRED_COLUMNS - columns.keys()
            if missing:
                res.bad_tables.append(f"{team}: 列が見つかりません {sorted(missing)} / ヘッダー={texts}")
                return
            continue

        if columns is None:
            res.bad_tables.append(f"{team}: ヘッダーより前にデータ行があります {texts}")
            return

        name_cell = row[columns["name"]]
        if name_cell is row[columns["pos"]]:
            # 「（選択権なし）」「（指名権剥奪）」など、名前の列から右が結合された行
            res.skipped_rows.append((team, texts[columns["round"]], texts[columns["name"]]))
            continue

        pos = texts[columns["pos"]]
        if pos not in POS_GROUP:
            res.unknown_positions.append(f"{team} {texts[columns['round']]} {texts[columns['name']]}: 「{pos}」")
            continue

        draft_type, prefix = section
        res.picks.append(RawPick(
            year=res.year,
            franchise_id=fid,
            team_name=team,
            round_label=prefix + texts[columns["round"]],
            name=cell_text(name_cell, line_sep=""),
            pos=pos,
            from_=texts[columns["from"]],
            result=texts[columns["result"]],
            draft_type=draft_type,
            link=link_target(name_cell),
        ))


# ---------------------------------------------------------------------------
# 組み立て
# ---------------------------------------------------------------------------


def player_key(name: str) -> str:
    return re.sub(r"\s+", "", name)


def to_pick(raw: RawPick, order: int) -> dict:
    return {
        "id": f"{raw.year}-{raw.franchise_id}-{order:02d}",
        "order": order,
        "roundLabel": raw.round_label,
        "name": raw.name,
        "playerKey": player_key(raw.name),
        "pos": raw.pos,
        "group": POS_GROUP[raw.pos],
        "from": raw.from_,
        "draftType": raw.draft_type,
        "signed": not any(m in raw.result for m in UNSIGNED_MARKERS),
        "twoWay": False,
        "note": "" if raw.result == "入団" else raw.result,
        "_link": raw.link,  # 出力前に消す
    }


def apply_overrides(drafts: list[dict], overrides: list[dict]) -> list[str]:
    """overrides.json を適用する。1件にだけ一致しない上書きはエラーにする。"""
    errors: list[str] = []
    applied: list[str] = []
    for i, ov in enumerate(overrides):
        match = ov.get("match") or {}
        label = json.dumps(match, ensure_ascii=False)
        if not {"year", "franchiseId", "name"} <= match.keys():
            errors.append(f"#{i} match には year / franchiseId / name が必要です: {label}")
            continue
        hits = []
        for d in drafts:
            if d["year"] != match["year"] or d["franchiseId"] != match["franchiseId"]:
                continue
            for p in d["picks"]:
                if p["name"] != match["name"]:
                    continue
                if "roundLabel" in match and p["roundLabel"] != match["roundLabel"]:
                    continue
                hits.append((d, p))
        if len(hits) != 1:
            errors.append(f"#{i} 一致した指名が{len(hits)}件です（1件である必要があります）: {label}")
            continue
        d, p = hits[0]
        if ov.get("remove"):
            d["picks"].remove(p)
            applied.append(f"{label} → 削除（{ov.get('reason', '')}）")
            continue
        changes = ov.get("set") or {}
        bad = set(changes) - OVERRIDABLE_FIELDS
        if bad:
            errors.append(f"#{i} 変更できないフィールドです {sorted(bad)}: {label}")
            continue
        if "pos" in changes and changes["pos"] not in POS_GROUP:
            errors.append(f"#{i} pos の値が不正です: {changes['pos']}")
            continue
        for k, v in changes.items():
            p[k] = v
        if "name" in changes and "playerKey" not in changes:
            p["playerKey"] = player_key(p["name"])
        if "pos" in changes:
            p["group"] = POS_GROUP[p["pos"]]
        applied.append(f"{label} → {json.dumps(changes, ensure_ascii=False)}（{ov.get('reason', '')}）")
    if errors:
        raise BuildError("overrides.json に問題があります:\n  " + "\n  ".join(errors))
    # 削除で並びに穴があいた球団は order と id を振り直す
    for d in drafts:
        for n, p in enumerate(d["picks"], start=1):
            p["order"] = n
            p["id"] = f"{d['year']}-{d['franchiseId']}-{n:02d}"
    return applied


# ---------------------------------------------------------------------------
# 出力
# ---------------------------------------------------------------------------


def dump_drafts_json(data: dict) -> str:
    """見やすさと差分の取りやすさのため、指名1件を1行にして書き出す。"""
    def j(v):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))

    lines = ["{"]
    lines.append(f'  "meta": {json.dumps(data["meta"], ensure_ascii=False)},')
    lines.append('  "franchises": [')
    lines.append(",\n".join(f"    {j(f)}" for f in data["franchises"]))
    lines.append("  ],")
    lines.append('  "drafts": [')
    blocks = []
    for d in data["drafts"]:
        head = {k: d[k] for k in ("year", "franchiseId", "teamName")}
        inner = ",\n".join(f"        {j(p)}" for p in d["picks"])
        blocks.append(f"    {j(head)[:-1]},\"picks\":[\n{inner}\n    ]}}")
    lines.append(",\n".join(blocks))
    lines.append("  ]")
    lines.append("}")
    return "\n".join(lines) + "\n"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# 検証レポート
# ---------------------------------------------------------------------------


SPOT_CHECKS = [
    # (年度, スロット, 選手名, roundLabel または None)
    (2012, "fighters", "大谷翔平", "1位"),
    (2006, "giants", "坂本勇人", None),
    (1968, "tigers", "田淵幸一", "1位"),
]


def build_report(ctx: dict) -> tuple[str, list[str]]:
    """report.md の本文と、受け入れ条件を満たさない問題の一覧を返す。"""
    drafts: list[dict] = ctx["drafts"]
    slots: list[dict] = ctx["slots"]
    results: list[YearResult] = ctx["results"]
    problems: list[str] = []
    slot_short = {s["id"]: s["short"] for s in slots}
    by_pair = {(d["year"], d["franchiseId"]): d for d in drafts}
    years = list(range(YEAR_FROM, YEAR_TO + 1))

    all_picks = [p for d in drafts for p in d["picks"]]
    out: list[str] = []
    w = out.append

    # 同一人物の判定（playerKey）の確認用
    groups: dict[str, list[tuple[dict, dict]]] = defaultdict(list)
    by_link: dict[str, list[tuple[dict, dict]]] = defaultdict(list)
    for d in drafts:
        for p in d["picks"]:
            groups[p["playerKey"]].append((d, p))
            if p["_link"]:
                by_link[p["_link"]].append((d, p))
    multi = {k: v for k, v in groups.items() if len(v) > 1}
    # 同じ playerKey なのにリンク先が違う → 同姓同名の別人かもしれない
    homonym = {k: v for k, v in multi.items() if len({p["_link"] for _, p in v if p["_link"]}) > 1}
    redraft = {k: v for k, v in multi.items() if k not in homonym}
    # 同じリンク先なのに playerKey が違う → 同一人物の表記ゆれかもしれない
    variant = {k: v for k, v in by_link.items() if len({p["playerKey"] for _, p in v}) > 1}

    w("# ドラフトデータ検証レポート")
    w("")
    w(f"- 生成日時：{ctx['generated_at']}")
    w(f"- 対象年度：{YEAR_FROM}〜{YEAR_TO}（{len(years)}年度）")
    w(f"- 出典：{SOURCE_TEXT}（{LICENSE_TEXT}）")
    w("- このファイルは `scripts/build_drafts.py` が生成します。手で編集しないでください。")
    w("")

    # ---- 概要
    n_ikusei = sum(1 for p in all_picks if p["draftType"] == "ikusei")
    n_unsigned = sum(1 for p in all_picks if not p["signed"])
    w("## 概要")
    w("")
    w("| 項目 | 値 |")
    w("|---|---|")
    w(f"| 球団×年度のペア数 | {len(drafts)} |")
    w(f"| 指名の総数 | {len(all_picks)} |")
    w(f"| うち新人（regular） | {len(all_picks) - n_ikusei} |")
    w(f"| うち育成（ikusei） | {n_ikusei} |")
    w(f"| 入団しなかった指名（signed=false） | {n_unsigned} |")
    w(f"| 二刀流フラグ（twoWay=true） | {sum(1 for p in all_picks if p['twoWay'])} |")
    w(f"| 投手（P） / 野手（F） | {sum(1 for p in all_picks if p['group'] == 'P')} / {sum(1 for p in all_picks if p['group'] == 'F')} |")
    w(f"| 読み飛ばした行（選択権なし等） | {sum(len(r.skipped_rows) for r in results)} |")
    w("")

    # ---- 受け入れ条件
    w("## チェック結果")
    w("")
    w("| チェック | 結果 | 詳細 |")
    w("|---|---|---|")

    missing_years = [y for y in years if not any(d["year"] == y for d in drafts)]
    w(f"| 全年度のデータがある | {_ok(not missing_years)} | {('不足：' + ', '.join(map(str, missing_years))) if missing_years else f'{len(years)}年度'} |")
    if missing_years:
        problems.append(f"データがない年度: {missing_years}")

    unexpected_counts = []
    for y in years:
        n = sum(1 for d in drafts if d["year"] == y)
        expected = 11 if y == 1978 else 12
        if n != expected:
            unexpected_counts.append(f"{y}年 {n}球団（想定{expected}）")
    w(f"| 年度ごとの球団数が想定どおり（1978年は11、ほかは12） | {_ok(not unexpected_counts)} | {'; '.join(unexpected_counts) or '一致'} |")
    if unexpected_counts:
        problems.append("球団数が想定と違う年度: " + "; ".join(unexpected_counts))

    empty_pairs = [f"{d['year']} {d['teamName']}" for d in drafts if not d["picks"]]
    w(f"| 人数0のペアがない | {_ok(not empty_pairs)} | {', '.join(empty_pairs) or '0件'} |")
    if empty_pairs:
        problems.append("人数0のペア: " + ", ".join(empty_pairs))

    unknown = sorted({f"{r.year} {t}" for r in results for t in r.unknown_teams})
    w(f"| 対応表にない球団名が0件 | {_ok(not unknown)} | {', '.join(unknown) or '0件'} |")

    overlap = [y for y in years if (y, "kintetsu_rakuten") in by_pair
               and len({t for t, f in next(r for r in results if r.year == y).team_headings if f == "kintetsu_rakuten"}) > 1]
    w(f"| 近鉄と楽天が同じ年度に重ならない | {_ok(not overlap)} | {', '.join(map(str, overlap)) or '重なりなし'} |")
    if overlap:
        problems.append(f"近鉄と楽天が重なった年度: {overlap}")

    for year, fid, name, rl in SPOT_CHECKS:
        d = by_pair.get((year, fid))
        hit = [p for p in (d["picks"] if d else []) if p["name"] == name and (rl is None or p["roundLabel"] == rl)]
        where = f"{year}年 {slot_short[fid]}" + (f" {rl}" if rl else "")
        detail = f"{hit[0]['id']} {hit[0]['roundLabel']} {hit[0]['name']}（{hit[0]['pos']}・{hit[0]['from']}）" if hit else "見つかりません"
        w(f"| 抜き取り：{where} に{name} | {_ok(bool(hit))} | {detail} |")
        if not hit:
            problems.append(f"抜き取り確認の失敗: {where} {name}")
    w(f"| 同姓同名の可能性（同じ playerKey でリンク先が違う） | {_ok(not homonym, '要確認')} | {len(homonym)}件 |")
    w(f"| 表記ゆれの可能性（同じリンク先で playerKey が違う） | {_ok(not variant, '要確認')} | {len(variant)}件 |")
    w("")

    # ---- 年度×球団の人数表
    w("## 年度×球団の人数")
    w("")
    w("数字は指名人数です。括弧内はそのうち育成指名の人数、`-` はペアなし（不参加）です。")
    w("")
    w("| 年度 | " + " | ".join(s["short"] for s in slots) + " | 計 |")
    w("|---|" + "---:|" * (len(slots) + 1))
    for y in years:
        cells = []
        total = 0
        for s in slots:
            d = by_pair.get((y, s["id"]))
            if not d:
                cells.append("-")
                continue
            n = len(d["picks"])
            ik = sum(1 for p in d["picks"] if p["draftType"] == "ikusei")
            total += n
            cells.append(f"{n}({ik})" if ik else str(n))
        w(f"| {y} | " + " | ".join(cells) + f" | {total} |")
    w("")

    # ---- 球団名（当時）の使用年度
    w("## 当時の球団名と年度")
    w("")
    w("| スロット | 当時の球団名 | 年度 |")
    w("|---|---|---|")
    names_years: dict[tuple[str, str], list[int]] = defaultdict(list)
    for d in drafts:
        names_years[(d["franchiseId"], d["teamName"])].append(d["year"])
    order = {s["id"]: i for i, s in enumerate(slots)}
    for (fid, team), ys in sorted(names_years.items(), key=lambda kv: (order[kv[0][0]], min(kv[1]))):
        w(f"| {slot_short[fid]} | {team} | {_year_ranges(ys)} |")
    w("")

    # ---- 見出しはあるが表がない
    no_table = []
    for r in results:
        for team, fid in r.team_headings:
            if (r.year, fid) not in by_pair:
                no_table.append(f"{r.year} {team}")
    w("## 見出しはあるが指名表がない球団（ペアを作らない）")
    w("")
    w("\n".join(f"- {x}" for x in no_table) if no_table else "- なし")
    w("")

    # ---- 年度ごとの育成・入団しなかった件数
    w("## 年度ごとの育成指名・入団しなかった指名の件数")
    w("")
    w("| 年度 | 指名数 | 育成 | 入団しなかった |")
    w("|---|---:|---:|---:|")
    for y in years:
        ps = [p for d in drafts if d["year"] == y for p in d["picks"]]
        w(f"| {y} | {len(ps)} | {sum(1 for p in ps if p['draftType'] == 'ikusei')} | {sum(1 for p in ps if not p['signed'])} |")
    w("")

    # ---- signed=false の判定内訳
    w("## 入団しなかった指名（signed=false）の判定内訳")
    w("")
    w("結果・備考の列に次の語を含む指名を `signed: false` にしています。")
    w("")
    w("| 語 | 件数 |")
    w("|---|---:|")
    for m in UNSIGNED_MARKERS:
        w(f"| {m} | {sum(1 for p in all_picks if m in p['note'])} |")
    w("")

    # ---- roundLabel の種類
    w("## roundLabel の種類")
    w("")
    rl_counts = Counter(p["roundLabel"] for p in all_picks)
    w(", ".join(f"`{k}`×{v}" for k, v in sorted(rl_counts.items(), key=lambda kv: _round_sort_key(kv[0]))))
    w("")

    # ---- 同一人物の判定
    w("## 同姓同名の可能性がある playerKey（要確認）")
    w("")
    w("同じ playerKey なのに、記事内の選手名のリンク先が異なるものです。別人であれば `overrides.json` で playerKey を分けてください。")
    w("同一人物（リダイレクトなどでリンク先の表記だけが違う）なら、そのままでかまいません。")
    w("")
    if homonym:
        w("| playerKey | 指名 | リンク先 |")
        w("|---|---|---|")
        for k in sorted(homonym):
            for d, p in homonym[k]:
                w(f"| {k} | {p['id']} {p['roundLabel']}（{p['pos']}・{p['from']}） | {p['_link'] or '(リンクなし)'} |")
    else:
        w("- なし")
    w("")

    w("## 表記ゆれの可能性がある選手（要確認）")
    w("")
    w("記事内の選手名のリンク先が同じなのに、playerKey が違うものです。同一人物なら `overrides.json` で playerKey をそろえてください。")
    w("")
    if variant:
        w("| リンク先 | 指名 | playerKey |")
        w("|---|---|---|")
        for link in sorted(variant):
            for d, p in variant[link]:
                w(f"| {link} | {p['id']} {p['roundLabel']} {p['name']} | {p['playerKey']} |")
    else:
        w("- なし")
    w("")

    w("## 複数回指名された選手（同一人物とみなすもの）")
    w("")
    w(f"{len(redraft)}人。入団拒否のあと別年度で再指名された選手などです。同じ playerKey なので、チームには1回しか入れられません。")
    w("")
    if redraft:
        w("| playerKey | 指名 |")
        w("|---|---|")
        for k in sorted(redraft, key=lambda k: (redraft[k][0][0]["year"], k)):
            items = " / ".join(f"{p['id']} {p['roundLabel']}{'（入団せず）' if not p['signed'] else ''}" for _, p in redraft[k])
            w(f"| {k} | {items} |")
    w("")

    # ---- 読み飛ばした行
    w("## 読み飛ばした行")
    w("")
    skipped = Counter(content for r in results for _, _, content in r.skipped_rows)
    if skipped:
        w("| 内容 | 件数 |")
        w("|---|---:|")
        for k, v in skipped.most_common():
            w(f"| {k} | {v} |")
    else:
        w("- なし")
    w("")

    # ---- 適用した上書き
    w("## 適用した上書き（overrides.json）")
    w("")
    w("\n".join(f"- {a}" for a in ctx["applied_overrides"]) if ctx["applied_overrides"] else "- なし")
    w("")

    return "\n".join(out), problems


def _ok(flag: bool, ng: str = "NG") -> str:
    return "OK" if flag else f"**{ng}**"


def _year_ranges(ys: list[int]) -> str:
    ys = sorted(ys)
    parts = []
    start = prev = ys[0]
    for y in ys[1:]:
        if y == prev + 1:
            prev = y
            continue
        parts.append(f"{start}" if start == prev else f"{start}〜{prev}")
        start = prev = y
    parts.append(f"{start}" if start == prev else f"{start}〜{prev}")
    return ", ".join(parts)


def _round_sort_key(label: str):
    m = re.search(r"(\d+)", label)
    prefix = re.sub(r"\d+.*", "", label)
    return (prefix, int(m.group(1)) if m else -1, label)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--offline", action="store_true", help="取得せず、キャッシュだけで生成する")
    g.add_argument("--refresh", action="store_true", help="キャッシュを使わず全年度を取り直す")
    args = ap.parse_args(argv)

    fmap = json.loads(FRANCHISE_MAP_PATH.read_text(encoding="utf-8"))
    slots = fmap["slots"]
    team_map: dict[str, str] = fmap["teams"]
    slot_ids = {s["id"] for s in slots}
    bad_ids = sorted({v for v in team_map.values() if v not in slot_ids})
    if bad_ids:
        raise BuildError(f"franchise_map.json に未定義のスロット id があります: {bad_ids}")
    overrides = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8")).get("picks", [])

    fetcher = Fetcher(refresh=args.refresh, offline=args.offline)
    log(f"{YEAR_FROM}〜{YEAR_TO}年の記事を読み込みます（キャッシュ: {CACHE_DIR.relative_to(ROOT)}）")
    results = [parse_year(y, fetcher.get(y), team_map) for y in range(YEAR_FROM, YEAR_TO + 1)]
    if fetcher.fetched:
        log(f"  新たに取得した年度: {len(fetcher.fetched)}件")

    # ---- 止めるべき問題
    fatal: list[str] = []
    for r in results:
        fatal += [f"{r.year}: 対応表にない球団名「{t}」" for t in r.unknown_teams]
        fatal += [f"{r.year}: 想定外の区切り「{s}」" for s in r.unknown_sections]
        fatal += [f"{r.year}: 想定外の守備表記 {s}" for s in r.unknown_positions]
        fatal += [f"{r.year}: 表の形式が想定外 {s}" for s in r.bad_tables]
    if fatal:
        raise BuildError("次の問題を解決してから再実行してください（franchise_map.json / build_drafts.py を確認）:\n  " + "\n  ".join(fatal))

    # ---- 球団×年度ごとにまとめる
    drafts: list[dict] = []
    for r in results:
        per_team: dict[str, list[RawPick]] = defaultdict(list)
        team_name: dict[str, str] = {}
        for p in r.picks:
            if p.franchise_id in team_name and team_name[p.franchise_id] != p.team_name:
                fatal.append(f"{r.year}: スロット {p.franchise_id} に複数の球団（{team_name[p.franchise_id]} / {p.team_name}）")
            team_name.setdefault(p.franchise_id, p.team_name)
            per_team[p.franchise_id].append(p)
        for s in slots:
            if s["id"] not in per_team:
                continue
            picks = [to_pick(p, i) for i, p in enumerate(per_team[s["id"]], start=1)]
            drafts.append({"year": r.year, "franchiseId": s["id"], "teamName": team_name[s["id"]], "picks": picks})
    if fatal:
        raise BuildError("\n  ".join(["スロットの重複があります:"] + fatal))

    applied = apply_overrides(drafts, overrides)

    generated_at = dt.datetime.now(JST).replace(microsecond=0).isoformat()
    report, problems = build_report({
        "drafts": drafts,
        "slots": slots,
        "results": results,
        "applied_overrides": applied,
        "generated_at": generated_at,
    })

    for d in drafts:
        for p in d["picks"]:
            p.pop("_link", None)
    data = {
        "meta": {
            "source": SOURCE_TEXT,
            "license": LICENSE_TEXT,
            "generatedAt": generated_at,
            "yearFrom": YEAR_FROM,
            "yearTo": YEAR_TO,
        },
        "franchises": [{"id": s["id"], "short": s["short"]} for s in slots],
        "drafts": drafts,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(dump_drafts_json(data), encoding="utf-8")
    REPORT_PATH.write_text(report + "\n", encoding="utf-8")

    n_picks = sum(len(d["picks"]) for d in drafts)
    log(f"{OUTPUT_PATH.relative_to(ROOT)} に {len(drafts)}ペア・{n_picks}人を書き出しました")
    log(f"{REPORT_PATH.relative_to(ROOT)} に検証レポートを書き出しました")
    if problems:
        log("受け入れ条件を満たしていない項目があります:")
        for p in problems:
            log(f"  - {p}")
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BuildError as e:
        log(f"エラー: {e}")
        sys.exit(2)
