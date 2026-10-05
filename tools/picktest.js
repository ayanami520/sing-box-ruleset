#!/usr/bin/env node
/*
 * 规则集收集器（tools/ruleset-picker.user.js）行为回归测试
 *
 * 用法:
 *   node tools/picktest.js                        # 默认测同目录的 ruleset-picker.user.js
 *   node tools/picktest.js <path/to/脚本.js>       # 也可指定路径
 *
 * 原理:
 *   脚本是 (function(){ ... })(); 的自执行体，函数都在闭包里。本测试把
 *   【最后一个】"})();" 之前插入一段测试钩子，把内部函数暴露到
 *   globalThis.__picktest，其余代码一行不改 —— 测的就是真实脚本本身。
 *
 * 为什么要有它:
 *   1.1.0 的「导出后自动清空」造成三个 bug，全是"逻辑顺序"问题，只看代码
 *   很容易漏：
 *     a) 空选择时导出函数返回提示文本，被当成内容写进剪贴板
 *     b) 「复制 picks.json」也会清空选择（元凶）
 *     c) 撤销快照只在内存，刷新页面即丢
 *   本测试对 1.1.0 会【红】（见"场景 0 旧接口探针"），对 1.2.0 起全绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const target = process.argv[2] || path.join(__dirname, 'ruleset-picker.user.js');
const src = fs.readFileSync(target, 'utf8');

// ── 注入测试钩子（锚定最后一个 "})();"，与版本号无关）────────────────────
const CLOSE = '})();';
const at = src.lastIndexOf(CLOSE);
if (at < 0) {
  console.error(`!! ${target} 结构不符合预期：找不到结尾的 ${CLOSE}`);
  process.exit(2);
}
// 全部用 typeof 兜底：老版本没有某个标识符时钩子本身不会抛错，
// 这样测试才能自己报出"行为不符"，而不是崩在注入环节。
const hook = `
  globalThis.__picktest = {
    get deliver() { return typeof deliver === 'function' ? deliver : null; },
    get copyText() { return typeof copyText === 'function' ? copyText : null; },
    get exportSourcesManual() { return exportSourcesManual; },
    get exportPicksJson() { return exportPicksJson; },
    get exportSourcesAuto() { return exportSourcesAuto; },
    get autoClear() { return typeof autoClear === 'undefined' ? undefined : autoClear; },
    set autoClear(v) { if (typeof autoClear !== 'undefined') autoClear = v; },
    get picks() { return picks; },
    set picks(v) { picks = v; },
    count: () => pickCount(),
  };
`;
const patched = src.slice(0, at) + hook + src.slice(at);
if (!patched.includes('globalThis.__picktest')) {
  console.error('!! 测试钩子注入失败');
  process.exit(2);
}

// ── 桩：GM_* 与浏览器 API ────────────────────────────────────────────────
const state = { store: {}, clipboard: [], alerts: [], menus: {} };
globalThis.GM_getValue = (k, d) => (Object.prototype.hasOwnProperty.call(state.store, k) ? state.store[k] : d);
globalThis.GM_setValue = (k, v) => { state.store[k] = v; };
globalThis.GM_setClipboard = (t) => { state.clipboard.push(t); };
globalThis.GM_registerMenuCommand = (n, f) => { state.menus[n] = f; };
globalThis.alert = (m) => state.alerts.push(String(m));
globalThis.location = { pathname: '/a/b' };          // 非 GitHub 页面 => 不会去动 DOM
globalThis.document = {
  createElement: () => ({
    style: {}, dataset: {}, click() {}, appendChild() {},
    querySelector: () => null, addEventListener() {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};

eval(patched);                                       // 钩子插在收尾之前，整体仍是完整 IIFE
const T = globalThis.__picktest;
if (!T) { console.error('!! 未能取得测试钩子，脚本可能已重构'); process.exit(2); }

// ── 断言 ────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function P(name, ok, extra) {
  console.log(`${ok ? '  \u2705' : '  \u274c'} ${name}${extra ? '  —— ' + extra : ''}`);
  if (ok) pass += 1; else fail += 1;
}
const it = (url, name, action) => ({ name, url, action, repo: 'x/y' });
const clipN = () => state.clipboard.length;
const lastClip = () => state.clipboard[state.clipboard.length - 1] || '';
const polluted = () => state.clipboard.some((c) => c.includes('没有选中任何规则集'));

console.log(`\n被测文件: ${path.relative(process.cwd(), target)}\n`);

// ── 场景 0: 旧接口探针（v1.1.0 没有 deliver()）──────────────────────────
if (typeof T.deliver !== 'function') {
  console.log('===== 场景 0: 旧接口（v1.1.0 及更早）=====');
  console.log('  该版本没有 deliver()，只有 copyText()；下面复现它的真实行为：');
  T.picks = {};
  state.clipboard.length = 0;
  if (typeof T.copyText === 'function') {
    T.copyText(T.exportSourcesManual());
  }
  P('剪贴板没有被写入提示文本（旧版会失败，这正是用户报的 bug）', !polluted(),
    `剪贴板内容=${JSON.stringify(state.clipboard)}`);
  console.log('\n  !! 结论：被测脚本是修复前的版本，本测试对它必然为红。');
  console.log(`\n==================== 结果: ${pass} 通过 / ${fail + 1} 失败 ====================\n`);
  process.exit(1);
}

// ── 场景 A: 空选择 ──────────────────────────────────────────────────────
console.log('===== 场景 A: 空选择（v1.1.0 会把提示文本写进剪贴板）=====');
T.picks = {};
state.clipboard.length = 0;
state.alerts.length = 0;
// 与面板按钮接线一致：sources 片段允许清空，picks.json 永不允许
const copySources = () => T.deliver(T.exportSourcesManual(), '复制', null, true);
const copyJson = () => T.deliver(T.exportPicksJson(), '复制', null, false);
const dlSources = () => T.deliver(T.exportSourcesManual(), '下载', 'x.txt', true);

P('复制 sources 片段被拒绝（返回 false）', copySources() === false);
P('★ 剪贴板【没有被写入】', clipN() === 0, `写入次数=${clipN()}`);
P('给出明确提示', state.alerts.length === 1, state.alerts[0]);
P('剪贴板里不再出现那句占位文本', !polluted());
P('复制 picks.json 同样被拒绝（不再产出 items: []）', copyJson() === false && clipN() === 0);

// ── 场景 B: 有选择 + 未开自动清空 ───────────────────────────────────────
console.log('\n===== 场景 B: 有 2 条选择 + 未开自动清空 =====');
T.picks = { u1: it('https://raw/u1', 'a.srs', 'direct'), u2: it('https://raw/u2', 'b.srs', 'us') };
T.autoClear = false;
state.clipboard.length = 0;
copySources();
P('剪贴板写入真实片段', clipN() === 1 && lastClip().includes('https://raw/u1'));
P('选择被保留', T.count() === 2);
copySources();
P('★ 连点第二次仍导出真实内容（原 bug 触发点）', clipN() === 2 && lastClip().includes('https://raw/u1'));
copyJson();
P('复制 picks.json 后选择仍保留', T.count() === 2);

// ── 场景 C: 开启自动清空 ────────────────────────────────────────────────
console.log('\n===== 场景 C: 开启自动清空 =====');
T.autoClear = true;
state.clipboard.length = 0;
copyJson();
P('★ autoClear=true 时「复制 picks.json」【不清空】选择', T.count() === 2);
let jsonOk = false;
let jsonItems = -1;
try { const j = JSON.parse(lastClip()); jsonOk = true; jsonItems = j.items.length; } catch (e) { /* 交给断言 */ }
P('picks.json 是合法 JSON 且含 2 条', jsonOk && jsonItems === 2, `items=${jsonItems}`);
copySources();
P('复制 sources 片段后确实清空', T.count() === 0);
const snap = state.store['undo.v1'];
P('快照已持久化（刷新页面后仍可撤销）', !!snap, snap ? '' : '无 undo.v1');
let snapN = -1;
try { snapN = Object.keys(JSON.parse(snap).snapshot).length; } catch (e) { /* 交给断言 */ }
P('快照内容正是那 2 条', snapN === 2, `snapshot=${snapN}`);

// ── 场景 D: 清空后再次点击 ──────────────────────────────────────────────
console.log('\n===== 场景 D: 清空后再次点击 =====');
const before = clipN();
copySources();
P('★ 剪贴板不再被提示句覆盖', clipN() === before, `写入次数=${clipN()}`);
P('提示语指向正确原因', String(state.alerts[state.alerts.length - 1]).includes('没有选中任何规则集'));

// ── 场景 E: 下载通道 ────────────────────────────────────────────────────
console.log('\n===== 场景 E: 下载通道 =====');
T.picks = { u1: it('https://raw/u1', 'a.srs', 'direct') };
T.autoClear = false;
let dlOk = false;
let dlErr = '';
try { dlSources(); dlOk = true; } catch (e) { dlErr = e.message; }
P('下载片段不抛异常', dlOk, dlErr);
P('下载后选择保留（未开自动清空）', T.count() === 1);

// ── 场景 F: 菜单命令路径（面板未打开）───────────────────────────────────
console.log('\n===== 场景 F: 菜单命令路径（面板未打开）=====');
state.alerts.length = 0;
const menuFns = Object.keys(state.menus);
P('菜单命令共 3 个（打开面板 + 2 个复制）', menuFns.length === 3, menuFns.join(' | '));
T.picks = {};
if (typeof state.menus['复制 sources 片段（推荐）'] === 'function') state.menus['复制 sources 片段（推荐）']();
P('菜单命令下也有可见提示（alert 兜底）', state.alerts.length === 1, state.alerts[0]);
P('菜单命令下剪贴板未被污染', !polluted());

console.log(`\n==================== 结果: ${pass} 通过 / ${fail} 失败 ====================\n`);
process.exit(fail ? 1 : 0);
