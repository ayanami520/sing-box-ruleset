# sing-box-ruleset

把多个上游 sing-box 规则集**合并 + 去重**成少量成品 `.srs`，由 GitHub Actions 每日自动重建。

解决的核心问题：在路由器面板里一条一条添加规则集太繁琐、不好维护。
有了这个仓库，**新增一个分类 = 改 `sources/` 里一行，不用动路由器**。

## 目录

```
sources/          # 声明式输入：每个 .txt = 一个成品规则集，一行一个上游 URL
  direct-domain.txt   direct-ip.txt   ads.txt   ai.txt
  google.txt          tailscale.txt   us.txt
build.sh          # 构建脚本（POSIX sh，CI 与路由器都能跑）
scripts/
  apply-picks.sh  # 把 picks/picks.json 写进 sources/*.txt 的自动块
picks/
  picks.json      # ← 油猴脚本的导出贴这里，CI 自动生效
tools/
  ruleset-picker.user.js   # 浏览器收集器（Tampermonkey）
dist/             # 产物，由 CI 自动提交（不要手动改）
.github/workflows/build.yml
```

## 产物 ↔ 上游对照

| 产物 | 上游 | 路由动作 |
|---|---|---|
| `dist/direct-domain.srs` | SagerNet: `geosite-cn`/`category-pt`/`game-platforms-download@cn` + lyc8503: `115` + MetaCubeX: `apple-cn`/`apple-music@cn`/`aws-cn`/`bilibili`/`bilibili2`/`bilibili-cdn` | `direct` |
| `dist/direct-ip.srs` | `geoip-cn` | `direct` |
| `dist/ads.srs` | `geosite-category-ads-all` | `block` |
| `dist/ai.srs` | `geosite-category-ai-!cn` | AI 出站分组 |
| `dist/google.srs` | `geosite-google` | 指定出站 / urltest 分组 |
| `dist/tailscale.srs` | `geosite-tailscale` | `direct`（否则 Tailscale 打洞端点会变成节点 IP）|
| `dist/us.srs` | lyc8503: `18comic` | US 分组（JP 节点被 Cloudflare 拒）|

## ① 新增分类（手工方式）

1. 在 `sources/` 下新建 `xxx.txt`，写入上游地址（一行一个，`#` 注释）
2. 推送到 `main`（或在 Actions 页面手动触发）
3. CI 构建后会把 `dist/xxx.srs` 提交回来
4. 在路由器上引用它（首次需要加一条规则集）

## ② 浏览器收集器（推荐方式）

装 `tools/ruleset-picker.user.js` 到 Tampermonkey 后：

1. 打开任意规则集仓库页面（URL 含 `geosite` / `rule-set` 时面板自动展开；
   其它页面右下角有按钮手动打开）
2. 面板会用 GitHub API 拉取**当前目录的完整清单**（不受页面分页限制），支持搜索
3. 每条规则集可以：
   - 点 **预览** —— 内联显示域名条数 + 前 15 个域名（读同名 `.json`）
   - 点 **直连 / US / JP / KR / 拒绝 / AI / Google** 标注去向
   - 标有 **已有** 的表示上游 URL 已经在你的 `sources/*.txt` 里了
4. 点 **下载 picks.json**（或复制），把内容贴进仓库的 `picks/picks.json`
5. CI 自动 `apply-picks` → 改写 `sources/` → 构建 → 提交

> ⚠️ **JP / KR 分组**：脚本可以标注这两个动作，但仓库里原本没有这两个分组。
> 第一次用到时 `apply-picks.sh` 会自动创建 `sources/jp.txt` / `kr.txt`，
> 但**路由器侧还需要加一次对应的规则**（`{"rule_set":["jp"],"outbound":"JP"}`）。

### 自动块长这样

`apply-picks.sh` 只维护下面这个块，块外的手工内容不会被改动：

```
# >>> picks:auto  (以下由 picks/picks.json 自动生成, 请勿手改)
https://raw.githubusercontent.com/lyc8503/sing-box-rules/rule-set-geosite/geosite-115.srs
# <<< picks:auto
```

## 路由器侧引用

```json
{
  "tag": "direct-domain",
  "type": "remote",
  "format": "binary",
  "url": "https://gh-proxy.com/https://raw.githubusercontent.com/ayanami520/sing-box-ruleset/main/dist/direct-domain.srs",
  "update_interval": "1d",
  "download_detour": "direct"
}
```

- `download_detour: "direct"` **必填**：否则规则集下载会走默认出站
  （若默认出站是 selector / urltest 分组，会阻塞启动直到分组就绪，可能导致服务反复重启）
- `update_interval` 建议 `1d`，不要更短
- 通过 `gh-proxy.com` 前缀拉取，避免 GitHub 直连不稳定

## 本地手动构建

```sh
# 直连
sh ./build.sh

# 国内网络环境下套代理拉上游
GH_PROXY=https://gh-proxy.com/ sh ./build.sh

# 先应用 picks 再构建
sh ./scripts/apply-picks.sh && GH_PROXY=https://gh-proxy.com/ sh ./build.sh
```

依赖：`curl`、`jq`、`sing-box`（版本建议与路由器一致）。

## 注意事项

1. **域名规则与 IP 规则必须分开文件**
   除了语义清晰，还因为 sing-box 的 `rule-set match` 在混合类型（域名+IP）的规则集上
   结果**不可靠**（会把域名误判为命中 `ip_cidr`），只有纯类型才能用它做验证。

2. **产物过小/条目为 0 会中止构建**
   `build.sh` 会校验每个产物的**实际规则条目数** ≥ 1（不用文件大小判断，
   因为只有 3 条域名的规则集编译出来也只有 80B）；不满足则整体失败、
   不产出新 `dist/`，避免「发出一个空规则集导致全线直连」这种更隐蔽的故障。

3. **`sing-box check` 不校验 `rule_set` 引用名**
   配置里引用了不存在的 tag 时 `check` 依然通过，但启动会
   `FATAL: rule-set not found`。改完 tag 后务必看日志确认。
   （注意：`dns.rules` 里也会引用 rule_set，改 tag 时别漏）

4. **CI 每次只提交 `dist/` 与 `sources/`**
   不把上游原始文件提交进仓库（否则仓库会迅速膨胀到 GB 级）。

5. **`build.sh` 先在临时目录构建，全部成功后才替换 `dist/`**
   避免失败时留下半成品产物。

6. **上游 JSON 缺 `version` 字段是常态**
   lyc8503 / MetaCubeX 的 `.json` 都是 `{"rules":[...]}`，而 sing-box 的
   `compile` / `merge` 要求必须有 version（且 `rule-set upgrade` 对无 version 的文件
   同样报错）。`build.sh` 会自动补 `version: 1`。
