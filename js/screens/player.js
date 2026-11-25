// 選手の詳細シート（名鑑・配置モーダル・マイチーム・保存したチームから開く）。
// プロフィール、守れるポジション、通算と年度別の成績（NPB 一軍）、タイトル・表彰を表示する。

import { $, esc } from "../dom.js";
import { app, loadPlayers } from "../app.js";
import { battingTotals, fmtEra, fmtInt, fmtRate, pitchingTotals, positionGames, rowObject, throwsBats } from "../stats.js";
import { battingWar, fmtWar, pitchingWar } from "../war.js";
import { sfx, unlockAudio } from "../sound.js";

let currentKey = null;

function section(title, body) {
  return `<section class="pl-sec"><h3 class="pl-sec-title">${title}</h3>${body}</section>`;
}

function profileHTML(prof) {
  if (!prof) return "";
  const rows = [
    ["投打", throwsBats(prof)],
    ["守備位置", prof.position],
    ["生年月日", prof.born],
    ["出身地", prof.birthplace],
    ["身長・体重", prof.height || prof.weight ? [prof.height && `${prof.height}cm`, prof.weight && `${prof.weight}kg`].filter(Boolean).join("・") : ""],
    ["一軍初出場", prof.debut],
    ["最終出場", prof.lastGame],
  ].filter(([, v]) => v);
  const career = prof.career?.length
    ? `<div class="pl-career"><span class="pl-career-label">経歴</span><ol>${prof.career.map((c) => `<li>${esc(c)}</li>`).join("")}</ol></div>`
    : "";
  return section(
    "プロフィール",
    `<dl class="pl-profile">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>${career}`,
  );
}

function positionsHTML(player, pitchingGames) {
  const list = positionGames(player, pitchingGames);
  if (!list.length) return section("守れるポジション（一軍）", `<p class="pl-empty">一軍の守備記録はありません。</p>`);
  const max = list[0].games;
  return section(
    "守れるポジション（一軍）",
    `<ul class="pl-pos">${list
      .map(
        ({ pos, games }) => `
        <li>
          <span class="pl-pos-name">${esc(pos)}</span>
          <span class="pl-pos-bar"><span style="width:${Math.max(4, (games / max) * 100)}%"></span></span>
          <span class="pl-pos-games">${fmtInt(games)}試合</span>
        </li>`,
      )
      .join("")}</ul>
    <p class="pl-note">一軍の守備成績にある試合数です（指名打者は含みません。投手は登板数）。</p>`,
  );
}

function tiles(items) {
  return `<div class="pl-tiles">${items
    .map(([label, value]) => `<div class="pl-tile"><span class="pl-tile-label">${label}</span><span class="pl-tile-value">${value}</span></div>`)
    .join("")}</div>`;
}

/** 行ごとの WAR の合計（計算できない行は除く）。どの行も計算できなければ null。 */
function totalWar(rows) {
  const vals = rows.map((r) => r.WAR).filter((w) => typeof w === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

function battingHTML(rows) {
  const t = battingTotals(rows);
  const lead = (r, k, text) => (r.lead.has(k) ? `<b class="is-lead">${text}</b>` : text);
  const table = `
    <div class="pl-table-wrap"><table class="pl-table">
      <thead><tr><th>年</th><th class="pl-team">球団</th><th>試合</th><th>打率</th><th>本</th><th>打点</th><th>盗塁</th><th>OPS</th><th>WAR</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
            <td>${r.year}</td><td class="pl-team">${esc(r.team)}</td>
            <td>${lead(r, "G", fmtInt(r.G))}</td><td>${lead(r, "AVG", fmtRate(r.AVG))}</td><td>${lead(r, "HR", fmtInt(r.HR))}</td>
            <td>${lead(r, "RBI", fmtInt(r.RBI))}</td><td>${lead(r, "SB", fmtInt(r.SB))}</td><td>${lead(r, "OPS", fmtRate(r.OPS))}</td>
            <td class="pl-war">${fmtWar(r.WAR)}</td>
          </tr>`,
        )
        .join("")}</tbody>
    </table></div>`;
  return section(
    `打撃成績（一軍・${t.seasons}年）`,
    tiles([
      ["試合", fmtInt(t.G)],
      ["打率", fmtRate(t.AVG)],
      ["安打", fmtInt(t.H)],
      ["本塁打", fmtInt(t.HR)],
      ["打点", fmtInt(t.RBI)],
      ["盗塁", fmtInt(t.SB)],
      ["OPS", fmtRate(t.OPS)],
      ["WAR", fmtWar(totalWar(rows))],
    ]) + table,
  );
}

function pitchingHTML(rows) {
  const t = pitchingTotals(rows);
  const lead = (r, k, text) => (r.lead.has(k) ? `<b class="is-lead">${text}</b>` : text);
  const table = `
    <div class="pl-table-wrap"><table class="pl-table">
      <thead><tr><th>年</th><th class="pl-team">球団</th><th>登板</th><th>勝</th><th>敗</th><th>S</th><th>H</th><th>防御率</th><th>投球回</th><th>三振</th><th>WAR</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
            <td>${r.year}</td><td class="pl-team">${esc(r.team)}</td>
            <td>${lead(r, "G", fmtInt(r.G))}</td><td>${lead(r, "W", fmtInt(r.W))}</td><td>${fmtInt(r.L)}</td>
            <td>${lead(r, "SV", r.SV === null ? "-" : fmtInt(r.SV))}</td><td>${lead(r, "HLD", r.HLD === null ? "-" : fmtInt(r.HLD))}</td>
            <td>${lead(r, "ERA", fmtEra(r.ERA))}</td><td>${r.IP ?? "-"}</td><td>${lead(r, "SO", fmtInt(r.SO))}</td>
            <td class="pl-war">${fmtWar(r.WAR)}</td>
          </tr>`,
        )
        .join("")}</tbody>
    </table></div>`;
  return section(
    `投手成績（一軍・${t.seasons}年）`,
    tiles([
      ["登板", fmtInt(t.G)],
      ["勝利", fmtInt(t.W)],
      ["セーブ", t.SV === null ? "-" : fmtInt(t.SV)],
      ["ホールド", t.HLD === null ? "-" : fmtInt(t.HLD)],
      ["防御率", fmtEra(t.ERA)],
      ["投球回", t.IP],
      ["奪三振", fmtInt(t.SO)],
      ["WAR", fmtWar(totalWar(rows))],
    ]) + table,
  );
}

function honorsHTML(player) {
  const parts = [];
  if (player.titles?.length) parts.push(`<p class="pl-honor-label">タイトル</p><ul class="pl-honors">${player.titles.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`);
  if (player.awards?.length) {
    const shown = player.awards.slice(0, 10);
    const more = player.awards.length - shown.length;
    parts.push(
      `<p class="pl-honor-label">表彰</p><ul class="pl-honors">${shown.map((t) => `<li>${esc(t)}</li>`).join("")}${
        more > 0 ? `<li class="pl-more">ほか${more}件</li>` : ""
      }</ul>`,
    );
  }
  return parts.length ? section("タイトル・表彰", parts.join("")) : "";
}

function bodyHTML(pick, player) {
  if (!player) {
    return `<p class="pl-empty pl-empty-big">この選手の記事が Wikipedia にないため、詳しいデータはありません。</p>`;
  }
  const cols = app.players.meta;
  const bat = (player.batting || []).map((r) => rowObject(r, cols.battingColumns));
  const pit = (player.pitching || []).map((r) => rowObject(r, cols.pitchingColumns));
  if (app.leagues) {
    for (const r of bat) r.WAR = battingWar(r, app.leagues, player);
    for (const r of pit) r.WAR = pitchingWar(r, app.leagues);
  }
  const statBlocks = [];
  // 登録が投手の選手は投手成績を先に
  const order = pick.group === "P" ? [pit.length && pitchingHTML(pit), bat.length && battingHTML(bat)] : [bat.length && battingHTML(bat), pit.length && pitchingHTML(pit)];
  for (const b of order) if (b) statBlocks.push(b);
  if (!statBlocks.length) statBlocks.push(section("成績（一軍）", `<p class="pl-empty">一軍の出場記録はありません。</p>`));
  const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(player.title.replaceAll(" ", "_"))}`;
  return `
    ${profileHTML(player.profile)}
    ${positionsHTML(player, pit.reduce((a, r) => a + (r.G || 0), 0))}
    ${statBlocks.join("")}
    ${honorsHTML(player)}
    <a class="btn btn-wide pl-wiki" href="${url}" target="_blank" rel="noopener">Wikipedia で詳しく見る</a>
    <p class="pl-credit">出典：Wikipedia日本語版「${esc(player.title)}」（CC BY-SA 4.0）。成績は NPB の一軍のみで、太字の赤はリーグ1位です。WAR はこのアプリが成績とリーグ平均（NPB.jp）から計算した目安です。</p>`;
}

/** pickId（例：2012-fighters-01）の選手の詳細を開く。 */
export async function openPlayerByPickId(pickId) {
  const pick = app.data?.picks.get(pickId);
  const draft = app.data?.pickDraft.get(pickId);
  if (!pick || !draft) return;
  unlockAudio();
  sfx.select();
  currentKey = pick.playerKey;
  $("pl-name").innerHTML = `${esc(pick.name)}<span class="pill pill-${pick.twoWay ? "W" : pick.group}">${esc(pick.pos)}</span>`;
  $("pl-meta").textContent = `${draft.year}年 ${draft.teamName} ${pick.roundLabel}・${pick.from}`;
  const body = $("pl-body");
  body.innerHTML = `<div class="pl-loading"><span class="loading-ball" aria-hidden="true"></span><p>選手データを読み込み中…</p></div>`;
  body.scrollTop = 0;
  const dlg = $("player-dialog");
  if (!dlg.open) dlg.showModal();
  try {
    await loadPlayers();
  } catch {
    if (currentKey === pick.playerKey) {
      body.innerHTML = `<p class="pl-empty pl-empty-big">選手データを読み込めませんでした。通信状態を確かめてください。</p>`;
    }
    return;
  }
  if (currentKey !== pick.playerKey) return; // 読み込み中に別の選手を開いた
  body.innerHTML = bodyHTML(pick, app.players.players[pick.playerKey]);
  body.scrollTop = 0;
}

export function initPlayer() {
  const dlg = $("player-dialog");
  $("pl-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => {
    currentKey = null;
  });
  // マイチーム・保存したチームの選手をタップしたら詳細を開く
  const onSlot = (e) => {
    const li = e.target.closest("[data-player]");
    if (li) openPlayerByPickId(li.dataset.player);
  };
  const onKey = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-player]")) {
      e.preventDefault();
      openPlayerByPickId(e.target.dataset.player);
    }
  };
  for (const id of ["team-body", "saved-body"]) {
    $(id).addEventListener("click", onSlot);
    $(id).addEventListener("keydown", onKey);
  }
}

