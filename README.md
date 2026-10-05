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
  picktest.js              # 收集器的行为回归测试（node tools/picktest.js）
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
4. 页脚三个出口：
   - **复制 sources 片段**（推荐）→ 带粘贴位置提示与占位备注，贴进 `sources/*.txt` 的**自动块之外**
   - **复制 picks.json** → 贴进 `picks/picks.json`，交给 CI 自动 `apply-picks`
   - **下载片段.txt** → 同上，落成文件
5. CI 自动 `apply-picks` → 改写 `sources/` → 构建 → 提交

### 导出行为（v1.2.0 起）

| 行为 | 说明 |
|---|---|
| **空选择不导出** | 没有任何选中时**不写剪贴板、不写文件**，只给一句提示（1.1.0 会把 `(没有选中任何规则集)` 这句提示文本**当成内容写进剪贴板** ✗） |
| **复制 `picks.json` 永不清空** | 它只是给 CI 的元数据，清空选择毫无道理（1.1.0 会连它一起清空 ✗） |
| **「导出后清空」开关** | 默认**关**，勾选后持久化；开启时只有**复制/下载 sources 片段**会清空 |
| **撤销清空** | 清空前把快照写进 `localStorage`，**刷新页面后仍可撤销**（按钮上会显示条数） |
| **菜单命令也有提示** | 面板没打开时走 `alert` 兜底，不再"剪贴板被改了却毫无反馈" |

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

## 自测（收集器回归）

改 `tools/ruleset-picker.user.js` 之前 / 之后都跑一下：

```sh
node tools/picktest.js                                  # 测同目录脚本, 期望 21 通过 / 0 失败
node tools/picktest.js /path/to/旧版脚本.js               # 也可指定文件(测旧版会报红, 见下)
```

它把测试钩子插在脚本**最后一个 `})();` 之前**（与版本号无关），因此测的是**真实脚本本身**，不是副本。
覆盖的行为：

| 场景 | 断言 |
|---|---|
| 空选择 | 复制 sources / `picks.json` 都**拒绝导出**，剪贴板**一次都不写**，只给提示 |
| 有选择、未开自动清空 | 导出真实内容、选择保留、**连点第二次仍正确**（原 bug 触发点）|
| 开启自动清空 | ★「复制 `picks.json`」**仍不清空**；复制 sources 才清空，且快照落 `localStorage` |
| 清空后再次点击 | 剪贴板**不再被提示句覆盖** |
| 菜单命令（面板未开）| 走 `alert` 兜底，剪贴板不被污染 |

> 对 **1.1.0 及更早**的脚本运行本测试会**红**，并打印出它的真实行为，例如：
> `❌ 剪贴板没有被写入提示文本 —— 剪贴板内容=["(没有选中任何规则集)"]`
> 这正是 v1.1.0 那个 bug（导出后无条件清空 + 空选择把提示文本写进剪贴板）。

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

## 致谢

本仓库**只做「合并 + 去重 + 覆盖过滤 + 编译」**，规则内容全部来自下列上游项目，版权归各作者所有。
没有他们日复一日的维护，这个仓库没有任何意义。

| 上游 | 本仓库用到的部分 | 许可证 |
|---|---|---|
| [SagerNet/sing-geosite](https://github.com/SagerNet/sing-geosite) | `cn` / `ads` / `google` / `ai` / `pt` / `tailscale` / 游戏平台国内 CDN | GPL-3.0 |
| [SagerNet/sing-geoip](https://github.com/SagerNet/sing-geoip) | `geoip-cn` | GPL-3.0 |
| [lyc8503/sing-box-rules](https://github.com/lyc8503/sing-box-rules) | `115` / `netdisk-cn` / `social-media-cn` / `speedtest@cn` / `18comic` 等 | 未附许可证文件；其数据移植自 [Loyalsoldier/v2ray-rules-dat](https://github.com/Loyalsoldier/v2ray-rules-dat) |
| [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) | Apple 中国区 / Apple Music CN / AWS CN / bilibili 系列 | 未附许可证文件 |
| [217heidai/adblockfilters](https://github.com/217heidai/adblockfilters) | 去广告增强（`adblocksingboxlite`） | GPL |

还有两个「上游的上游」同样应当被提及：

- [SagerNet/sing-box](https://github.com/SagerNet/sing-box) —— 提供 `rule-set` 工具链（`decompile` / `merge` / `compile`），本仓库整个构建流程都建立在它之上
- [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community)（MIT）—— geosite 系列规则集的原始数据

思路与实现方面，参考并感谢：

**[@sammimk830](https://github.com/sammimk830)** —— [sing-box-ruleset](https://github.com/sammimk830/sing-box-ruleset)（MIT）。
本仓库「`sources/` 声明式清单 + CI 自动合并」的组织方式、以及「在浏览器里点选规则集」的收集器形态，
都受它启发；它的 `config.py` 字段映射表也是我们核对 sing-box 规则字段时的重要参考。

### 关于分发

- 本仓库的产物（`dist/*.srs`）是**上游数据的再打包**，仅供**个人自用**。
- **转发或二次分发前，请先确认各上游仓库当前的许可与说明** —— 部分来源可能要求不得商用或不得再分发。
  若有上游作者提出异议，请开 issue，我会立刻移除对应来源。
- 引用时请**优先引用上游原文**并保留出处，不要把别人的数据当成自己的成果。
- 本仓库公开全部输入清单（`sources/*.txt`）与构建脚本（`build.sh`），
  任何产物都可以从上游**原样复现**，这也是我们对 GPL 类上游的合规方式。
