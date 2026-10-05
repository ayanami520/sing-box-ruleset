// ==UserScript==
// @name         规则集收集器 (sing-box-ruleset picker)
// @namespace    ayanami520/sing-box-ruleset
// @version      1.1.0
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

  const MY_REPO = 'ayanami520/sing-box-ruleset';   // 你的仓库（用于"已有"标记）
  const MY_BRANCH = 'main';
  const MY_SOURCE_FILES = [
    'direct-domain.txt', 'direct-ip.txt', 'ads.txt', 'ai.txt',
    'google.txt', 'tailscale.txt', 'us.txt',
  ];

  // action -> { label, group(sources 文件名), outbound }
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

  const AUTO_OPEN_HINTS = ['geosite', 'geo-site', 'rule-set', 'ruleset', 'rule_set'];

  const MAX_RENDER = 300;    // 面板一次最多渲染多少条（其余靠搜索）

  const LS_PICKS = 'picks.v1';
  const LS_OWNED = 'owned.v1';
  const LS_TREE = 'tree.v2.';
  const LS_PREVIEW = 'preview.v1.';

  // ─────────────────────────────────────────────────────────────
  // 工具
  // ─────────────────────────────────────────────────────────────

  const store = {
    get(k, d) { try { const v = GM_getValue(k); return v === undefined ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch (e) { return d; } },
    set(k, v) { GM_setValue(k, JSON.stringify(v)); },
    del(k) { try { GM_setValue(k, ''); } catch (e) { /* noop */ } },
  };

  const log = (...a) => console.log('[picker]', ...a);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function parseGithubUrl(pathname) {
    const p = pathname.split('/').filter(Boolean);
    if (p.length < 4) return null;
    const kind = p[2];
    if (kind !== 'tree' && kind !== 'blob') return null;
    return {
      owner: p[0], repo: p[1], kind, branch: p[3],
      path: p.slice(4).join('/'),
      repoFull: `${p[0]}/${p[1]}`,
    };
  }

  const toRaw = (owner, repo, branch, path) =>
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

  async function ghJson(url) {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) {
      const err = new Error(`${r.status} ${r.statusText}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  // ★ 用 Git Trees API 一次拿到整棵分支树
  //   contents API 单目录上限 1000 条（3800 个文件会被截断成 ~500 对），不能用
  async function getBranchTree(ctx) {
    const key = LS_TREE + ctx.repoFull + '@' + ctx.branch;
    const c = store.get(key, null);
    if (c && Date.now() - c.at < 6 * 3600 * 1000) return c;
    const url = `https://api.github.com/repos/${ctx.repoFull}/git/trees/${encodeURIComponent(ctx.branch)}?recursive=1`;
    const j = await ghJson(url);
    const data = {
      at: Date.now(),
      truncated: !!j.truncated,
      files: (j.tree || []).filter((t) => t.type === 'blob')
        .map((t) => ({ path: t.path, size: t.size || 0 })),
    };
    store.set(key, data);
    return data;
  }

  // 取"当前目录"下的文件（只保留同级，不递归进子目录）
  function filesInDir(tree, dirPath) {
    const prefix = dirPath ? dirPath.replace(/\/+$/, '') + '/' : '';
    const out = [];
    tree.files.forEach((f) => {
      if (!f.path.startsWith(prefix)) return;
      if (f.path.slice(prefix.length).includes('/')) return; // 子目录里的不算
      out.push(f);
    });
    return out;
  }

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
        (await r.text()).split('\n').forEach((line) => {
          const s = line.trim();
          if (s && !s.startsWith('#')) urls.add(s);
        });
      } catch (e) { /* 忽略 */ }
    }));
    store.set(LS_OWNED, { at: Date.now(), urls: [...urls] });
    return urls;
  }

  async function preview(item) {
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

  let picks = store.get(LS_PICKS, {});
  let lastExport = null;          // { text, picksSnapshot, kind }
  let owned = new Set();
  let items = [];
  let filter = '';
  let ui = null;

  const savePicks = () => store.set(LS_PICKS, picks);
  const pickCount = () => Object.keys(picks).length;

  // ─────────────────────────────────────────────────────────────
  // 导出
  // ─────────────────────────────────────────────────────────────

  function sortedPicks() {
    return Object.values(picks).sort(
      (a, b) => a.action.localeCompare(b.action) || a.name.localeCompare(b.name)
    );
  }

  function exportPicksJson() {
    const byAction = {};
    sortedPicks().forEach((p) => { byAction[p.action] = (byAction[p.action] || 0) + 1; });
    return JSON.stringify({
      generated_at: new Date().toISOString(),
      generator: 'ruleset-picker.user.js',
      summary: byAction,
      items: sortedPicks(),
    }, null, 2);
  }

  // ★ 手动片段：带粘贴位置提示 + 每条一个占位备注
  function exportSourcesManual() {
    const list = sortedPicks();
    if (!list.length) return '(没有选中任何规则集)';
    const byGroup = {};
    list.forEach((p) => {
      const a = ACTION_MAP[p.action];
      if (!a) return;
      (byGroup[a.group] = byGroup[a.group] || []).push(p);
    });
    const out = [];
    Object.keys(byGroup).sort().forEach((g) => {
      out.push('################################################################');
      out.push(`# 粘贴到 sources/${g}`);
      out.push('#');
      out.push('# ⚠️ 请贴在文件末尾的 "picks:auto" 自动块【之外】—— 自动块每次 CI');
      out.push('#    重建都会被整体重写，写在里面的备注会丢失。');
      out.push('#    本段里带 "TODO" 的注释都是占位，改完即可（也可删掉）。');
      out.push('################################################################');
      out.push('');
      byGroup[g].forEach((p) => {
        out.push(`# TODO 备注: ${p.name}`);
        out.push(`#   用途/原因: （占位，改成你自己的说明，例如「XX 站点，JP 节点被拒」）`);
        out.push(`#   来源仓库 : ${p.repo || '-'}   出口: ${ACTION_MAP[p.action].outbound}`);
        out.push(p.url);
        out.push('');
      });
      out.push(`# ── sources/${g} 粘贴段结束 ──`);
      out.push('');
    });
    return out.join('\n');
  }

  // 供 CI 全自动消费的格式（备注字段留空，由用户自行决定是否手改）
  function exportSourcesAuto() {
    const list = sortedPicks();
    if (!list.length) return '(没有选中任何规则集)';
    const byGroup = {};
    list.forEach((p) => {
      const a = ACTION_MAP[p.action];
      if (!a) return;
      (byGroup[a.group] = byGroup[a.group] || []).push(p);
    });
    const out = [];
    Object.keys(byGroup).sort().forEach((g) => {
      out.push(`=== 追加到 sources/${g} 的 picks:auto 块（会被 CI 重写，不要手改）===`);
      byGroup[g].forEach((p) => out.push(p.url));
      out.push('');
    });
    return out.join('\n');
  }

  // ─────────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────────

  const CSS = `
  #rsp-root{position:fixed;top:70px;right:16px;width:600px;max-height:78vh;z-index:2147483000;
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
  #rsp-foot .rsp-primary{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}
  #rsp-toast{margin-left:auto;font-size:11px;opacity:0;transition:opacity .2s;max-width:230px}
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
          <input id="rsp-search" placeholder="搜索规则集名 / 域名关键词（支持 1900+ 条）…">
          <button id="rsp-reload" title="重新拉取目录">刷新</button>
          <button id="rsp-ownedbtn" title="重新拉取我已有的列表">重读已有</button>
        </div>
        <div id="rsp-list"></div>
      </div>
      <div id="rsp-foot">
        <button id="rsp-copyman" class="rsp-primary" title="带粘贴位置提示与占位备注，推荐">复制 sources 片段</button>
        <button id="rsp-copyjson">复制 picks.json</button>
        <button id="rsp-dlman">下载片段.txt</button>
        <button id="rsp-undo" style="display:none">撤销清空</button>
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
      undo: $('#rsp-undo'), toastTimer: null,
    };
  }

  const itemKey = (it) => it.raw;

  function render() {
    if (!ui) return;
    const q = filter.trim().toLowerCase();
    const shown = items.filter((it) => !q || it.name.toLowerCase().includes(q));
    const head = shown.slice(0, MAX_RENDER);
    ui.cnt.textContent = `${items.length} 个候选${q ? ` · 匹配 ${shown.length}` : ''} · 已选 ${pickCount()}`;
    ui.list.innerHTML = '';
    if (!shown.length) {
      ui.list.innerHTML = '<div class="rsp-meta">没有匹配项</div>';
      return;
    }
    if (shown.length > head.length) {
      const tip = document.createElement('div');
      tip.className = 'rsp-meta';
      tip.textContent = `仅显示前 ${head.length} 条（共 ${shown.length} 条），输入关键词可缩小范围`;
      ui.list.appendChild(tip);
    }
    head.forEach((it) => {
      const p = picks[itemKey(it)];
      const div = document.createElement('div');
      div.className = 'rsp-item' + (it.owned ? ' rsp-owned' : '');
      const acts = ACTIONS.map((a) =>
        `<button data-act="${a.key}" class="${p && p.action === a.key ? (a.key === 'block' ? 'rsp-sel-del' : 'rsp-sel') : ''}">${a.label}</button>`
      ).join('');
      div.innerHTML = `
        <div class="rsp-row">
          <span class="rsp-name">${esc(it.name)}</span>
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
      div.querySelector('button[data-prev]').addEventListener('click', async () => {
        if (prevBox.style.display !== 'none') { prevBox.style.display = 'none'; return; }
        prevBox.style.display = 'block';
        if (prevBox.dataset.done) return;
        prevBox.textContent = '加载预览…';
        const d = await preview(it);
        if (!d) { prevBox.textContent = '（无法读取 .json 预览）'; return; }
        prevBox.dataset.done = '1';
        prevBox.textContent = `共 ${d.count} 条 | ${d.sample.join(', ')}`;
      });
      ui.list.appendChild(div);
    });
    ui.undo.style.display = lastExport ? '' : 'none';
  }

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

  function toast(msg, isErr) {
    if (!ui) return;
    ui.toast.textContent = msg;
    ui.toast.style.color = isErr ? '#d1242f' : '#1a7f37';
    ui.toast.style.opacity = '1';
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => { ui.toast.style.opacity = '0'; }, 3400);
  }

  // 复制/下载成功后：记录一份快照供撤销，并清空选择
  function afterExport(kind, text) {
    lastExport = { kind, text, snapshot: JSON.parse(JSON.stringify(picks)) };
    picks = {};
    savePicks();
    render();
    toast(`已${kind === 'clip' ? '复制' : '下载'}，选择已自动清空（可点「撤销清空」找回）`);
  }

  function copyText(text, kind) {
    try {
      GM_setClipboard(text, 'text');
      afterExport(kind || 'clip', text);
    } catch (e) {
      toast('复制失败，选择已保留', true);
    }
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    afterExport('下载', text);
  }

  // ─────────────────────────────────────────────────────────────
  // 主流程
  // ─────────────────────────────────────────────────────────────

  async function loadItems(ctx) {
    if (!ui) return;
    ui.list.innerHTML = '<div class="rsp-meta">正在读取仓库文件树…</div>';
    let tree;
    try {
      tree = await getBranchTree(ctx);
    } catch (e) {
      ui.list.innerHTML = `<div class="rsp-meta">读取失败：${esc(e.message)}<br>`
        + '（GitHub 匿名 API 限 60 次/小时；稍后再点「刷新」）</div>';
      return;
    }
    if (tree.truncated) {
      ui.list.innerHTML = '<div class="rsp-meta">⚠️ 该仓库文件树过大，GitHub 返回被截断，清单可能不全</div>';
    }
    let files = filesInDir(tree, ctx.path);
    if (!files.length && ctx.kind === 'blob') {
      files = [{ path: ctx.path, size: 0 }];
    }
    // 只保留 .srs / .json，同名优先 .srs
    const byBase = {};
    files.forEach((f) => {
      const m = /^(.*)\.(srs|json)$/i.exec(f.path.split('/').pop());
      if (!m) return;
      const base = m[1];
      const ext = m[2].toLowerCase();
      const cand = {
        name: f.path.split('/').pop(),
        ext, size: f.size, path: f.path,
        owner: ctx.owner, repo: ctx.repo, branch: ctx.branch, repoFull: ctx.repoFull,
        raw: toRaw(ctx.owner, ctx.repo, ctx.branch, f.path),
      };
      if (!byBase[base] || ext === 'srs') byBase[base] = cand;
    });
    items = Object.values(byBase).sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length && ctx.kind === 'blob') {
      items = [{
        name: ctx.path.split('/').pop(), ext: 'file', size: 0, path: ctx.path,
        owner: ctx.owner, repo: ctx.repo, branch: ctx.branch, repoFull: ctx.repoFull,
        raw: toRaw(ctx.owner, ctx.repo, ctx.branch, ctx.path),
      }];
    }
    owned = await loadOwned(false);
    items.forEach((it) => { it.owned = owned.has(it.raw); });
    filter = ui.search.value || '';
    render();
  }

  function openPanel() {
    if (!ui) return;
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
      if (!ctx) return;
      store.del(LS_TREE + ctx.repoFull + '@' + ctx.branch);
      loadItems(ctx);
    });
    ui.root.querySelector('#rsp-ownedbtn').addEventListener('click', async () => {
      owned = await loadOwned(true);
      items.forEach((it) => { it.owned = owned.has(it.raw); });
      render();
    });
    ui.root.querySelector('#rsp-copyman').addEventListener('click', () => copyText(exportSourcesManual()));
    ui.root.querySelector('#rsp-copyjson').addEventListener('click', () => copyText(exportPicksJson()));
    ui.root.querySelector('#rsp-dlman').addEventListener('click', () => {
      const d = new Date().toISOString().slice(0, 10);
      downloadText(`pick-sources-${d}.txt`, exportSourcesManual());
    });
    ui.root.querySelector('#rsp-undo').addEventListener('click', () => {
      if (!lastExport) return;
      picks = lastExport.snapshot;
      savePicks();
      lastExport = null;
      render();
      toast('已恢复上次导出的选择');
    });
    ui.root.querySelector('#rsp-clear').addEventListener('click', () => {
      if (confirm('清空已选？')) { picks = {}; savePicks(); lastExport = null; render(); }
    });
    ui.fab.addEventListener('click', openPanel);
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      ui.root.classList.add('rsp-dark');
    }
  }

  async function maybeShow() {
    const ctx = parseGithubUrl(location.pathname);
    if (!ctx) {
      if (ui) { ui.root.style.display = 'none'; ui.fab.style.display = 'none'; }
      return;
    }
    initUIOnce();
    const url = location.href.toLowerCase();
    if (AUTO_OPEN_HINTS.some((h) => url.includes(h))) {
      openPanel();
      await loadItems(ctx);
    } else if (ui.root.style.display === 'none') {
      ui.fab.style.display = 'block';
    }
  }

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; maybeShow(); }
  }, 900);
  maybeShow();

  GM_registerMenuCommand('打开 规则集收集器', () => { initUIOnce(); openPanel(); const c = parseGithubUrl(location.pathname); if (c) loadItems(c); });
  GM_registerMenuCommand('复制 sources 片段（推荐）', () => copyText(exportSourcesManual()));
  GM_registerMenuCommand('复制 picks.json', () => copyText(exportPicksJson()));

  log('loaded v1.1.0');
})();
