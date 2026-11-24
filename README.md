# baseball-draftdraft

NPBドラフト指名選手で17人を編成するルーレットゲーム（自分用の再現版）。仕様は [docs/SPEC.md](docs/SPEC.md)。

## 進捗

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 0 | データ整備（`data/drafts.json`） | 完了 |
| Phase 1 | 元祖の再現（MVP） | 未着手 |
| Phase 1.5 | 仕上げ | 未着手 |

## データ（`data/drafts.json`）

- 1965〜2025年度・12球団スロット・731ペア・5,494人（新人 4,868人／育成 626人）
- 1978年の巨人はドラフト不参加のため、ペアを作っていない
- 検証結果（年度×球団の人数表、同姓同名、再指名された選手など）は [scripts/report.md](scripts/report.md) にまとめている

### 作り直す方法

```bash
pip install -r scripts/requirements.txt
python3 scripts/build_drafts.py            # キャッシュがない年度だけ取得して生成
python3 scripts/build_drafts.py --offline  # 取得せず、キャッシュだけで生成
python3 scripts/build_drafts.py --refresh  # 全年度を取り直して生成
```

- 記事 HTML は `scripts/cache/{年}.html` にキャッシュする（コミットしない）。
- MediaWiki API へのリクエストは1秒間隔。HTTP 429 などが返ったときは `Retry-After` に従って待ち、自動で再試行する。
- Claude Code のクラウド環境で動かす場合は、環境のネットワーク設定で `ja.wikipedia.org` を許可しておく。
- 終了コード：0＝成功、1＝生成はしたがチェック（球団数・人数0・抜き取り確認など）に NG がある、2＝対応表にない球団名などで停止。

### 手で直すとき

| ファイル | 用途 |
|---|---|
| `scripts/franchise_map.json` | 当時の球団名 → 球団スロット id の対応表。ここにない球団名が出たら生成を止める |
| `scripts/overrides.json` | 個別の補正（二刀流フラグ、同姓同名の区別、表の崩れの補正）。`match` は1件の指名にだけ一致させる |

`overrides.json` の書き方：

```json
{"match": {"year": 2012, "franchiseId": "fighters", "name": "大谷翔平"}, "set": {"twoWay": true}, "reason": "二刀流"}
```

- `match`：`year` / `franchiseId` / `name`（必要なら `roundLabel`）
- `set`：`roundLabel` `name` `playerKey` `pos` `from` `draftType` `signed` `twoWay` `note` を変更できる
- `remove: true`：その指名を削除する
- 0件または2件以上に一致した上書きはエラーにする（記事が変わって上書きが古くなったことに気づけるように）

### データの決めごと

- `roundLabel`：記事の表記に、区分に応じた接頭辞を付ける
  - 1966年：`1次` / `2次`（例：`1次1位`）
  - 2005〜2007年：`高校` / `大社`（例：`高校1巡目`、`大社希望入団枠`）
  - 育成指名：`育成`（例：`育成1位`）
- `signed: false`：結果・備考の列に「拒否」「交渉権放棄」「指名取消」「指名無効」のいずれかがある指名
- `note`：結果・備考の列の原文（「入団」だけの場合は空）
- 「（選択権なし）」「（指名権剥奪）」の行は指名ではないので除く
- `name`：記事の表記（指名当時の名前）をそのまま使う。例：1991年 オリックス 4位は「鈴木一朗」（のちの登録名「イチロー」ではない）
- `playerKey`：氏名の空白を除いたもの。記事内のリンク先で同一人物かどうかを確かめている
  - リンク先が別の記事になっている同姓同名の別人（16組）は、`overrides.json` で `坂本勇人(捕手)` のように分ける
  - 同じ選手記事にリンクしているのに表記が違うもの（尾形正己／尾形正巳、平田恒雄／平田恒夫）は、playerKey をそろえる
- 脚注番号と、他言語版へのリンク表記（「（英語版）」など）は取り除く

## 出典・クレジット

- 着想：YouTube『日ハムファンが語る。』の企画「ドラフト×ドラフト」、および「ドラフト×ドラフト メーカー」（draft-draft.vercel.app）
- 指名データ：Wikipedia日本語版「新人選手選択会議 (日本プロ野球)」各年度記事（[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ja)）
  - `data/drafts.json` は上記記事をもとに作成した二次的著作物であり、CC BY-SA 4.0 で提供する。
- 非公式のファンメイドツールです。NPB・各球団とは関係ありません。
