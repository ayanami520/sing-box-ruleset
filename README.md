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
report/           # 构建报告（由 CI 自动提交，见下文）
  report.md           # 总览 / 匹配器体检 / 告警 / 与上次的增减
  removed/<name>.txt  # 删除明细（每次覆盖写 ⇒ git diff 就是增量）
  .full/<name>.txt    # 未截断完整明细（gitignore，随 CI artifact 上传）
  build.log           # 完整构建日志（gitignore）
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

## 构建报告与日志（`report/`）

| 文件 | 提交 | 内容 |
|---|---|---|
| `report/report.md` | ✅ | 总览（原始 / 重复删除 / 覆盖删除 / 最终条目 / 与上次的增减）、匹配器体检、告警、各规则集明细 |
| `report/removed/<name>.txt` | ✅ | 删除明细：`dup`（上游之间重复）与 `covered`（被更短后缀覆盖），**每次覆盖写 ⇒ 这个文件的 `git diff` 就是增量** |
| `report/.full/<name>.txt` | ❌ gitignore | 未截断的完整明细，随 CI artifact `build-report` 上传 |
| `report/build.log` | ❌ gitignore | 完整构建日志；CI 里同时把报告与日志尾部打进 Step Summary |

设计要点：

- **报告不含时间戳** ⇒ 上游没变化时报告逐字节不变 ⇒ 工作流里 `git diff --staged --quiet` 成立，
  **不会产生空提交**（实测：连跑两次，`dist/*.srs` 指纹完全一致）。
- `.srs` 是二进制 —— `report/removed/*.txt` 和报告里的「与上次」是它**唯一的人类可读 diff**。
- 删除明细**只列值、不列重复次数**（同一值重复多次只占 1 行），总重复条数看报告「重复删除」列。
- 构建失败时 `.build/` 与报告一起上传，便于排查。

### 阈值（环境变量）

| 变量 | 默认 | 作用 |
|---|---|---|
| `WARN_KEYWORD_MAX` | 300 | `domain_keyword` 超过即告警（该字段是线性扫描，见下文）|
| `WARN_REGEX_MAX` | 50 | `domain_regex` 超过即告警（最慢，建议改写）|
| `WARN_SHRINK_PCT` | 30 | 产物体积比上次缩小超过该比例即告警（上游被截断的征兆）|
| `DETAIL_MAX` | 2000 | **提交版**删除明细每规则集的行数上限（超出截断，完整版在 `.full/`）|
| `STRICT` | 0 | `1` = 出现任何告警即让构建失败 |

## 覆盖过滤（报告里的「覆盖删除」）

`build.sh` 会剔除**语义完全等价**的条目，只减内存、不改命中结果：

| 被删条目 | 覆盖者 | 为什么等价 |
|---|---|---|
| `domain a.b.com` | `domain_suffix b.com` | 后缀匹配本来就会命中 `a.b.com` |
| `domain_suffix a.b.com` | `domain_suffix b.com` / `com` | 后缀匹配按域名段边界判定，`a.b.com` 以 `.b.com` 结尾 |
| `domain x.com` | `domain_suffix com` | 同上 |

实测（本仓库当场构建，11 个上游）：

```
direct-domain: 原始 9752 → 去重 9441 → 覆盖删除 2588 → 最终 6853 条
               产物 53 KB → 39 KB
```

**正确性验证**：被删条目在产物中已不存在（出现次数 0），但仍能命中（由保留下来的覆盖者匹配）。
另外 `domain` / `domain_suffix` 之外的字段（`domain_keyword` / `domain_regex` / `ip_cidr`）**永不改动** —— 改了语义会变。

## 性能：规则条数影响有多大？

实测于 Netcore N60 Pro / sing-box 1.12.25，结论有源码依据（`sing/common/domain`）：

| 匹配器 | 实现 | 复杂度 | 条数影响 |
|---|---|---|---|
| `domain` / `domain_suffix` | 简洁字典树（LOUDS，按反转域名索引）| O(域名长度) | **几乎无影响** |
| `domain_keyword` | `for` + `strings.Contains` | O(关键词数 × 长度) | **线性变慢** |
| `domain_regex` | `for` + `MatchString` | O(正则数 × 单次开销) | **最慢** |

内存实测（独立实例 A/B，同一份配置只换规则集）：

| 规则集 | 条目 | 实例 VmRSS | 峰值 |
|---|---|---|---|
| `direct-domain.srs`（真实数据）| 9,735 | 28,072 kB | 28,072 kB |
| 合成 10 万条 `domain_suffix` | 100,000 | 29,932 kB | 32,000 kB |
| **差值** | +90,265 | **+1.9 MB** | **+3.9 MB** |

约 21 B/条；合成数据共享后缀偏乐观，真实列表按 3~5 倍估 ⇒ **10 万条约 5~15 MB**。

**结论**：域名多的广告列表**不会拖慢正常访问**（查找是字典树、与条数无关）；
真正要避开的是**塞满 `domain_regex` 的列表** —— 这正是 CI 体检要拦的东西。
编译耗时另算（路由器上 10 万条 `compile` 需 36 秒），所以**大列表只在 CI 编译**，路由器只拉成品。

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

4. **CI 只提交 `dist/`、`sources/` 与 `report/`**
   不把上游原始文件、完整构建日志、未截断的删除明细提交进仓库
   （否则仓库会迅速膨胀到 GB 级；这些完整版都走 CI artifact）。

5. **`build.sh` 先在临时目录构建，全部成功后才替换 `dist/`**
   避免失败时留下半成品产物。

6. **上游 JSON 缺 `version` 字段是常态**
   lyc8503 / MetaCubeX 的 `.json` 都是 `{"rules":[...]}`，而 sing-box 的
   `compile` / `merge` 要求必须有 version（且 `rule-set upgrade` 对无 version 的文件
   同样报错）。`build.sh` 会自动补 `version: 1`。
