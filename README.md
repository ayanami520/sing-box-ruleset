# sing-box-ruleset

把多个上游 sing-box 规则集**合并 + 去重**成少量成品 `.srs`，由 GitHub Actions 每日自动重建。

解决的核心问题：在路由器面板里一条一条添加规则集太繁琐、不好维护。
有了这个仓库，**新增一个分类 = 改 `sources/` 里一行，不用动路由器**。

## 目录

```
sources/          # 声明式输入：每个 .txt = 一个成品规则集，一行一个上游 URL
  direct-domain.txt
  direct-ip.txt
  ads.txt
  ai.txt
  google.txt
build.sh          # 构建脚本（POSIX sh，CI 与路由器都能跑）
dist/             # 产物，由 CI 自动提交（不要手动改）
.github/workflows/build.yml
```

## 产物 ↔ 上游对照

| 产物 | 上游 | 路由动作 |
|---|---|---|
| `dist/direct-domain.srs` | `geosite-cn` + `geosite-category-pt` + `geosite-category-game-platforms-download@cn` | `direct` |
| `dist/direct-ip.srs` | `geoip-cn` | `direct` |
| `dist/ads.srs` | `geosite-category-ads-all` | `block` |
| `dist/ai.srs` | `geosite-category-ai-!cn` | AI 出站分组 |
| `dist/google.srs` | `geosite-google` | 指定出站 / urltest 分组 |
| `dist/tailscale.srs` | `geosite-tailscale` | `direct`（否则 Tailscale 打洞端点会变成节点 IP）|

## 新增一个分类

1. 在 `sources/` 下新建 `xxx.txt`，写入上游 `.srs` 地址（一行一个，`#` 注释）
2. 推送到 `main`（或在 Actions 页面手动触发）
3. CI 构建后会把 `dist/xxx.srs` 提交回来
4. 在路由器上引用它（首次需要加一条规则集）

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
```

依赖：`curl`、`jq`、`sing-box`（版本建议与路由器一致）。

## 注意事项

1. **域名规则与 IP 规则必须分开文件**
   除了语义清晰，还因为 sing-box 的 `rule-set match` 在混合类型（域名+IP）的规则集上
   结果**不可靠**（会把域名误判为命中 `ip_cidr`），只有纯类型才能用它做验证。

2. **产物过小会中止构建**
   `build.sh` 会校验每个产物 ≥ 100B 且规则条目 ≥ 1；不满足则整体失败、
   不产出新 `dist/`，从而避免「发出一个空规则集导致全线直连」这种更隐蔽的故障。

3. **`sing-box check` 不校验 `rule_set` 引用名**
   配置里引用了不存在的 tag 时，`check` 依然通过，但启动会
   `FATAL: rule-set not found`。改完 tag 后务必看日志确认。

4. **CI 每次只提交 `dist/`**
   `sources/` 只放链接，不把上游原始文件提交进仓库（否则仓库会迅速膨胀到 GB 级）。

5. **`build.sh` 先在临时目录构建，全部成功后才替换 `dist/`**
   避免失败时留下半成品产物。
