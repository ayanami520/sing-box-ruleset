// ==UserScript==
// @name         规则集收集器 (sing-box-ruleset picker)
// @namespace    ayanami520/sing-box-ruleset
// @version      1.0.0
// @description  在 GitHub 上浏览规则集仓库时，直接标注每条规则集走哪个出站，一键导出 picks.json / sources 片段
// @author       ayanami520
// @match        https://github.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* eslint-disable no-console */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 配置
  // ─────────────────────────────────────────────────────────────

  // 你自己的仓库（用于标记"已有"和生成 sources 片段）
  const MY_REPO = 'ayanami520/sing-box-ruleset';
  const MY_BRANCH = 'main';
  // sources 下有哪些分组文件（决定了导出片段写到哪个文件）
  const MY_SOURCE_FILES = [
    'direct-domain.txt', 'direct-ip.txt', 'ads.txt', 'ai.txt',
    'google.txt', 'tailscale.txt', 'us.txt',
  ];

  // 可选动作: action -> { label, group(sources 文件名), outbound(路由器里的出站 tag) }
  const ACTIONS = [
    { key: 'direct', label: '直连',   group: 'direct-domain.txt', outbound: 'direct' },
    { key: 'us',     label: 'US',     group: 'us.txt',            outbound: 'US' },
    { key: 'jp',     label: 'JP',     group: 'jp.txt',            outbound: 'JP' },
    { key: 'kr',     label: 'KR',     group: 'kr.txt',            outbound: 'KR' },
    { key: 'block',  label: '拒绝',   group: 'ads.txt',           outbound: 'block' },
    { key: 'ai',     label: 'AI',     group: 'ai.txt',            outbound: '默认出口' },
    { key: 'google', label: 'Google', group: 'google.txt',        outbound: 'AWS-Tokyo' },
  ];
  const ACTION_MAP = Object.fromEntries(ACTIONS.map((a) => [a.key, a]));

  // 页面出现这些关键词时自动展开面板
  const AUTO_OPEN_HINTS = ['geosite', 'geo-site', 'rule-set', 'ruleset', 'rule_set'];

  const LS_PICKS = 'picks.v1';
  const LS_OWNED = 'owned.v1';
  const LS_LISTING = 'listing.v1.';
  const LS_PREVIEW = 'preview.v1.';

  // ─────────────────────────────────────────────────────────────
  // 工具
  // ─────────────────────────────────────────────────────────────

  const store = {
    get(k, d) { try { const v = GM_getValue(k); return v === undefined ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch (e) { return d; } },
    set(k, v) { GM_setValue(k, JSON.stringify(v)); },
  };

  const log = (...a) => console.log('[picker]', ...a);

  function parseGithubUrl(pathname) {
    // /owner/repo/tree|blob/branch/...path
    const p = pathname.split('/').filter(Boolean);
    if (p.length < 4) return null;
    const kind = p[2];
    if (kind !== 'tree' && kind !== 'blob') return null;
    return {
      owner: p[0],
      repo: p[1],
      kind,
      branch: p[3],
      path: p.slice(4).join('/'),
      repoFull: `${p[0]}/${p[1]}`,
    };
  }

  // github.com/o/r/blob/br/path -> raw.githubusercontent.com/o/r/br/path
  const toRaw = (owner, repo, branch, path) =>
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

  async function ghApi(url) {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r;
  }

  async function listDir(ctx, subPath) {
    // 支持分页；GitHub contents API 单页上限 1000
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const url = `https://api.github.com/repos/${ctx.repoFull}/contents/${encodeURI(subPath)}?ref=${encodeURIComponent(ctx.branch)}&per_page=1000&page=${page}`;
      const r = await ghApi(url);
      const j = await r.json();
      if (!Array.isArray(j)) return all; // 单文件
      all.push(...j);
      if (j.length < 1000) break;
    }
    return all;
  }

  // 拉取"我已有"的上游 URL 集合
  async function loadOwned(force) {
    if (!force) {
      const c = store.get(LS_OWNED, null);
      if (c && Date.now() - c.at < 6 * 3600 * 1000) return new Set(c.urls);
    }
    const urls = new Set();
    await Promise.all(MY_SOURCE_FILES.map(async (f) => {
      try {
        const r = await fetch(toRaw(...MY_REPO.split('/'), MY_BRANCH, `sources/${f}`), { cache: 'no-store' });
        if (!r.ok) return;
        const txt = await r.text();
        txt.split('\n').forEach((line) => {
          const s = line.trim();
          if (s && !s.startsWith('#')) urls.add(s);
        });
      } catch (e) { /* 忽略 */ }
    }));
    store.set(LS_OWNED, { at: Date.now(), urls: [...urls] });
    return urls;
  }

  // 预览: 取同名 .json 的域名数与前若干个域名
  async function preview(name, item) {
    // item: { owner, repo, branch, path }  其中 path 指向 .srs
    const jsonPath = item.path.replace(/\.srs$/i, '.json');
    const url = toRaw(item.owner, item.repo, item.branch, jsonPath);
    const key = LS_PREVIEW + url;
    const c = store.get(key, null);
    if (c && Date.now() - c.at < 24 * 3600 * 1000) return c.data;
    try {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) return null;
      const j = await r.json();
      const domains = [];
      let count = 0;
      (j.rules || []).forEach((rule) => {
        ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'].forEach((k) => {
          if (Array.isArray(rule[k])) { count += rule[k].length; domains.push(...rule[k]); }
          else if (rule[k]) { count += 1; domains.push(String(rule[k])); }
        });
        if (Array.isArray(rule.ip_cidr)) count += rule.ip_cidr.length;
      });
      const data = { count, sample: domains.slice(0, 15) };
      store.set(key, { at: Date.now(), data });
      return data;
    } catch (e) { return null; }
  }

  // ─────────────────────────────────────────────────────────────
  // 状态
  // ─────────────────────────────────────────────────────────────

  let picks = store.get(LS_PICKS, {});      // url -> { name, url, action, repo }
  let owned = new Set();
  let items = [];                           // 当前目录下的候选规则集
  let filter = '';
  let ui = null;

  const savePicks = () => store.set(LS_PICKS, picks);
  const pickCount = () => Object.keys(picks).length;

  // ─────────────────────────────────────────────────────────────
  // 导出
  // ─────────────────────────────────────────────────────────────

  function exportJson() {
    const byAction = {};
    Object.values(picks).forEach((p) => { byAction[p.action] = (byAction[p.action] || 0) + 1; });
    return JSON.stringify({
      generated_at: new Date().toISOString(),
      generator: 'ruleset-picker.user.js',
      summary: byAction,
      items: Object.values(picks).sort((a, b) => a.action.localeCompare(b.action) || a.name.localeCompare(b.name)),
    }, null, 2);
  }

  function exportSources() {
    const byGroup = {};
    Object.values(picks).forEach((p) => {
      const a = ACTION_MAP[p.action];
      if (!a) return;
      (byGroup[a.group] = byGroup[a.group] || []).push(p);
    });
    const out = [];
    Object.keys(byGroup).sort().forEach((g) => {
      out.push(`=== 追加到 sources/${g} ===`);
      byGroup[g].sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => out.push(p.url));
      out.push('');
    });
    return out.join('\n') || '(没有选中任何规则集)';
  }

  function exportPicksFile() {
    // 直接给 CI 用的格式（picks/picks.json）
    return exportJson();
  }

  async function copy(text, tip) {
    try { GM_setClipboard(text, 'text'); toast(tip || '已复制到剪贴板'); } catch (e) { toast('复制失败，请手动复制', true); }
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已下载 ' + filename);
  }

  function toast(msg, isErr) {
    if (!ui) return;
    ui.toast.textContent = msg;
    ui.toast.style.color = isErr ? '#d1242f' : '#1a7f37';
    ui.toast.style.opacity = '1';
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => { ui.toast.style.opacity = '0'; }, 2600);
  }

  // ─────────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────────

  const CSS = `
  #rsp-root{position:fixed;top:70px;right:16px;width:560px;max-height:78vh;z-index:2147483000;
    display:flex;flex-direction:column;background:#fff;color:#1f2328;border:1px solid #d0d7de;
    border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);font:12px/1.5 -apple-system,"Segoe UI",sans-serif}
  #rsp-root.rsp-dark{background:#0d1117;color:#e6edf3;border-color:#30363d}
  #rsp-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #d0d7de;cursor:move}
  #rsp-root.rsp-dark #rsp-head{border-color:#30363d}
  #rsp-head b{font-size:13px;flex:1}
  #rsp-root button{cursor:pointer;border:1px solid #d0d7de;background:#f6f8fa;color:inherit;
    border-radius:6px;padding:2px 8px;font-size:11px}
  #rsp-root.rsp-dark button{background:#21262d;border-color:#30363d}
  #rsp-root button:hover{filter:brightness(.96)}
  #rsp-body{padding:8px 10px;overflow:auto}
  #rsp-bar{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
  #rsp-search{flex:1;min-width:150px;padding:3px 8px;border:1px solid #d0d7de;border-radius:6px;
    background:transparent;color:inherit;font-size:12px}
  #rsp-root.rsp-dark #rsp-search{border-color:#30363d}
  #rsp-list{display:flex;flex-direction:column;gap:3px}
  .rsp-item{border:1px solid #eaeef2;border-radius:6px;padding:5px 7px;display:flex;flex-direction:column;gap:3px}
  #rsp-root.rsp-dark .rsp-item{border-color:#21262d}
  .rsp-item.rsp-owned{opacity:.62}
  .rsp-row{display:flex;align-items:center;gap:6px}
  .rsp-name{font-family:ui-monospace,Menlo,monospace;flex:1;word-break:break-all;font-size:11.5px}
  .rsp-meta{color:#57606a;font-size:10.5px;white-space:nowrap}
  #rsp-root.rsp-dark .rsp-meta{color:#8b949e}
  .rsp-tag{background:#1f6feb;color:#fff;border-radius:10px;padding:0 7px;font-size:10.5px}
  .rsp-owned-tag{background:#6e7781}
  .rsp-acts{display:flex;gap:3px;flex-wrap:wrap}
  .rsp-acts button{padding:1px 7px;font-size:10.5px}
  .rsp-acts button.rsp-sel{background:#1f6feb;border-color:#1f6feb;color:#fff}
  .rsp-acts button.rsp-sel-del{background:#d1242f;border-color:#d1242f;color:#fff}
  .rsp-prev{color:#57606a;font-size:10.5px;font-family:ui-monospace,monospace;word-break:break-all}
  #rsp-root.rsp-dark .rsp-prev{color:#8b949e}
  #rsp-foot{border-top:1px solid #d0d7de;padding:7px 10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  #rsp-root.rsp-dark #rsp-foot{border-color:#30363d}
  #rsp-toast{margin-left:auto;font-size:11px;opacity:0;transition:opacity .2s}
  #rsp-fab{position:fixed;right:16px;bottom:20px;z-index:2147483000;padding:8px 12px;border-radius:20px;
    background:#1f6feb;color:#fff;border:none;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer;
    font:12px/1 -apple-system,"Segoe UI",sans-serif}
  `;

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'rsp-root';
    root.innerHTML = `
      <div id="rsp-head"><b>规则集收集器</b><span id="rsp-cnt" class="rsp-meta"></span>
        <button id="rsp-min" title="折叠">—</button></div>
      <div id="rsp-body">
        <div id="rsp-bar">
          <input id="rsp-search" placeholder="搜索规则集名 / 域名关键词…">
          <button id="rsp-reload" title="重新拉取目录">刷新</button>
          <button id="rsp-ownedbtn" title="重新拉取我已有的列表">重读已有</button>
        </div>
        <div id="rsp-list"></div>
      </div>
      <div id="rsp-foot">
        <button id="rsp-copyjson">复制 picks.json</button>
        <button id="rsp-dljson">下载 picks.json</button>
        <button id="rsp-copysrc">复制 sources 片段</button>
        <button id="rsp-clear">清空</button>
        <span id="rsp-toast"></span>
      </div>`;
    document.body.appendChild(root);

    const fab = document.createElement('button');
    fab.id = 'rsp-fab';
    fab.textContent = '规则集收集器';
    fab.style.display = 'none';
    document.body.appendChild(fab);

    const $ = (s) => root.querySelector(s);
    return {
      root, fab,
      list: $('#rsp-list'), search: $('#rsp-search'), cnt: $('#rsp-cnt'), toast: $('#rsp-toast'),
      toastTimer: null,
    };
  }

  function itemKey(it) { return it.raw; }

  function render() {
    if (!ui) return;
    ui.cnt.textContent = `${items.length} 个候选 · 已选 ${pickCount()}`;
    const q = filter.trim().toLowerCase();
    const shown = items.filter((it) => !q || it.name.toLowerCase().includes(q));
    ui.list.innerHTML = '';
    if (!shown.length) {
      ui.list.innerHTML = '<div class="rsp-meta">没有匹配项</div>';
      return;
    }
    shown.forEach((it) => {
      const p = picks[itemKey(it)];
      const div = document.createElement('div');
      div.className = 'rsp-item' + (it.owned ? ' rsp-owned' : '');
      const acts = ACTIONS.map((a) =>
        `<button data-act="${a.key}" class="${p && p.action === a.key ? (a.key === 'block' ? 'rsp-sel-del' : 'rsp-sel') : ''}">${a.label}</button>`
      ).join('');
      div.innerHTML = `
        <div class="rsp-row">
          <span class="rsp-name">${it.name}</span>
          ${p ? `<span class="rsp-tag${p.action === 'block' ? ' rsp-owned-tag' : ''}">${ACTION_MAP[p.action].label}</span>` : ''}
          ${it.owned ? '<span class="rsp-tag rsp-owned-tag">已有</span>' : ''}
          <span class="rsp-meta">${it.size ? (it.size / 1024 >= 1 ? (it.size / 1024).toFixed(1) + 'K' : it.size + 'B') : ''}</span>
        </div>
        <div class="rsp-row rsp-acts">${acts}<button data-prev="1">预览</button></div>
        <div class="rsp-prev" style="display:none"></div>`;
      div.querySelectorAll('button[data-act]').forEach((b) => {
        b.addEventListener('click', () => {
          const key = b.dataset.act;
          if (p && p.action === key) delete picks[itemKey(it)];
          else picks[itemKey(it)] = { name: it.name, url: it.raw, action: key, repo: it.repoFull };
          savePicks(); render();
        });
      });
      const prevBox = div.querySelector('.rsp-prev');
      div.querySelector('button[data-prev]').addEventListener('click', async (e) => {
        if (prevBox.style.display !== 'none') { prevBox.style.display = 'none'; return; }
        prevBox.style.display = 'block';
        if (prevBox.dataset.done) return;
        prevBox.textContent = '加载预览…';
        const d = await preview(it.name, it);
        if (!d) { prevBox.textContent = '（无法读取 .json 预览）'; return; }
        prevBox.dataset.done = '1';
        prevBox.textContent = `共 ${d.count} 条 | ${d.sample.join(', ')}`;
      });
      ui.list.appendChild(div);
    });
  }

  // 拖动 / 折叠
  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      el.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
      el.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // ─────────────────────────────────────────────────────────────
  // 主流程
  // ─────────────────────────────────────────────────────────────

  async function loadItems(ctx) {
    if (!ui) return;
    ui.list.innerHTML = '<div class="rsp-meta">正在读取目录…</div>';
    const cacheKey = LS_LISTING + [ctx.repoFull, ctx.branch, ctx.path].join('|');
    let files = null;
    const c = store.get(cacheKey, null);
    if (c && Date.now() - c.at < 3600 * 1000) files = c.files;
    if (!files) {
      try {
        const j = await listDir(ctx, ctx.path);
        files = j.filter((f) => f.type === 'file').map((f) => ({ name: f.name, size: f.size, path: f.path }));
        store.set(cacheKey, { at: Date.now(), files });
      } catch (e) {
        ui.list.innerHTML = `<div class="rsp-meta">读取目录失败：${e.message}<br>（GitHub 匿名 API 限 60 次/小时，稍后再试或先点"刷新"）</div>`;
        return;
      }
    }
    // 只保留 .srs / .json；同名优先 .srs
    const byBase = {};
    files.forEach((f) => {
      const m = /^(.*)\.(srs|json)$/i.exec(f.name);
      if (!m) return;
      const base = m[1];
      const ext = m[2].toLowerCase();
      const cand = {
        name: f.name, base, ext, size: f.size, path: f.path,
        owner: ctx.owner, repo: ctx.repo, branch: ctx.branch, repoFull: ctx.repoFull,
        raw: toRaw(ctx.owner, ctx.repo, ctx.branch, f.path),
      };
      if (!byBase[base] || ext === 'srs') byBase[base] = cand;
    });
    let list = Object.values(byBase);
    if (!list.length) {
      // 当前是 blob（单个文件）或目录里没有规则集
      if (ctx.kind === 'blob') {
        list = [{
          name: ctx.path.split('/').pop(),
          size: 0, path: ctx.path,
          owner: ctx.owner, repo: ctx.repo, branch: ctx.branch, repoFull: ctx.repoFull,
          raw: toRaw(ctx.owner, ctx.repo, ctx.branch, ctx.path),
        }];
      }
    }
    items = list.sort((a, b) => a.name.localeCompare(b.name));
    owned = await loadOwned(false);
    items.forEach((it) => { it.owned = owned.has(it.raw); });
    filter = ui.search.value || '';
    render();
  }

  function openPanel() {
    if (ui.root.style.display !== 'none') return;
    ui.root.style.display = 'flex';
    ui.fab.style.display = 'none';
  }

  function initUIOnce() {
    if (ui) return;
    ui = buildUI();
    makeDraggable(ui.root, ui.root.querySelector('#rsp-head'));
    ui.root.querySelector('#rsp-min').addEventListener('click', () => {
      const b = ui.root.querySelector('#rsp-body');
      const f = ui.root.querySelector('#rsp-foot');
      const hide = b.style.display !== 'none';
      b.style.display = hide ? 'none' : 'block';
      f.style.display = hide ? 'none' : 'flex';
    });
    ui.search.addEventListener('input', () => { filter = ui.search.value; render(); });
    ui.root.querySelector('#rsp-reload').addEventListener('click', () => {
      const ctx = parseGithubUrl(location.pathname);
      if (ctx) { store.set(LS_LISTING + [ctx.repoFull, ctx.branch, ctx.path].join('|'), null); loadItems(ctx); }
    });
    ui.root.querySelector('#rsp-ownedbtn').addEventListener('click', async () => { owned = await loadOwned(true); items.forEach((it) => { it.owned = owned.has(it.raw); }); render(); });
    ui.root.querySelector('#rsp-copyjson').addEventListener('click', () => copy(exportPicksFile(), 'picks.json 已复制'));
    ui.root.querySelector('#rsp-dljson').addEventListener('click', () => download('picks.json', exportPicksFile()));
    ui.root.querySelector('#rsp-copysrc').addEventListener('click', () => copy(exportSources(), 'sources 片段已复制'));
    ui.root.querySelector('#rsp-clear').addEventListener('click', () => {
      if (confirm('清空已选？')) { picks = {}; savePicks(); render(); }
    });
    ui.fab.addEventListener('click', openPanel);
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      ui.root.classList.add('rsp-dark');
    }
  }

  async function maybeShow() {
    const ctx = parseGithubUrl(location.pathname);
    if (!ctx) { if (ui) { ui.root.style.display = 'none'; ui.fab.style.display = 'none'; } return; }
    initUIOnce();
    const url = location.href.toLowerCase();
    const auto = AUTO_OPEN_HINTS.some((h) => url.includes(h));
    if (auto) { openPanel(); await loadItems(ctx); } else if (ui.root.style.display === 'none') {
      ui.fab.style.display = 'block';
    }
  }

  // SPA 导航
  let lastPath = '';
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; lastPath = location.pathname; maybeShow(); } }, 900);
  lastPath = location.pathname;
  maybeShow();

  GM_registerMenuCommand('打开 规则集收集器', () => { initUIOnce(); openPanel(); const c = parseGithubUrl(location.pathname); if (c) loadItems(c); });
  GM_registerMenuCommand('复制 picks.json', () => copy(exportPicksFile(), 'picks.json 已复制'));
  GM_registerMenuCommand('复制 sources 片段', () => copy(exportSources(), 'sources 片段已复制'));

  log('loaded');
})();
