# 规则集构建报告

> 由 `build.sh` 自动生成。**不含时间戳**：内容不变时不会产生提交。
> 删除明细见 `report/removed/*.txt`（未截断完整版在 `report/.full/`，不提交）；完整构建日志见 `report/build.log`。

## 总览

| 规则集 | 上游 | 本地 | 产物(B) | 原始条目 | 重复删除 | 覆盖删除 | 最终条目 | 与上次 |
|---|---|---|---|---|---|---|---|---|
| `ads` | 8 | 0 | 180909 | 24973 | 12241 | 220 | 12512 | = 无变化 |
| `ai` | 1 | 0 | 2376 | 220 | 0 | 0 | 220 | = 无变化 |
| `direct-domain` | 14 | 0 | 44381 | 10616 | 459 | 2758 | 7399 | = 无变化 |
| `direct-ip` | 1 | 0 | 34259 | 8101 | 0 | 0 | 8101 | = 无变化 |
| `google` | 1 | 0 | 7099 | 941 | 0 | 78 | 863 | = 无变化 |
| `steam-cn` | 1 | 16 | 527 | 33 | 4 | 2 | 27 | = 无变化 |
| `steam-proxy` | 0 | 38 | 460 | 38 | 0 | 0 | 38 | = 无变化 |
| `tailscale` | 1 | 0 | 80 | 3 | 0 | 0 | 3 | = 无变化 |
| `twitter` | 1 | 0 | 315 | 24 | 0 | 0 | 24 | = 无变化 |
| `us` | 1 | 8 | 714 | 60 | 0 | 0 | 60 | +1 / -0 |
| `youtube` | 1 | 0 | 1279 | 178 | 0 | 1 | 177 | = 无变化 |

- `原始条目` = 各上游条目直接相加（`local/` 手写条目也算在内，含重复）；`最终条目` 才是写进 `.srs` 的条数。
- `覆盖删除` = 被更短的 `domain_suffix` 覆盖而剔除的条目（语义等价）。
- `与上次` = 相对**上次提交的 `dist/*.srs`** 的新增/移除条数（`.srs` 是二进制，这里是它唯一的人类可读 diff）。

## 匹配器体检

| 规则集 | domain | domain_suffix | domain_keyword | domain_regex | ip_cidr | 其它 | 判定 |
|---|---|---|---|---|---|---|---|
| `ads` | 137 | 12328 | 24 | 1 | 22 | 0 | ✅ |
| `ai` | 37 | 182 | 0 | 1 | 0 | 0 | ✅ |
| `direct-domain` | 919 | 6471 | 0 | 9 | 0 | 0 | ✅ |
| `direct-ip` | 0 | 0 | 0 | 0 | 8101 | 0 | ✅ |
| `google` | 31 | 830 | 0 | 2 | 0 | 0 | ✅ |
| `steam-cn` | 1 | 26 | 0 | 0 | 0 | 0 | ✅ |
| `steam-proxy` | 0 | 38 | 0 | 0 | 0 | 0 | ✅ |
| `tailscale` | 0 | 3 | 0 | 0 | 0 | 0 | ✅ |
| `twitter` | 0 | 24 | 0 | 0 | 0 | 0 | ✅ |
| `us` | 0 | 59 | 1 | 0 | 0 | 0 | ✅ |
| `youtube` | 1 | 176 | 0 | 0 | 0 | 0 | ✅ |

- `domain` / `domain_suffix`：简洁字典树查找，**耗时与条数无关**，只看域名长度 ⇒ 放多少条都基本不影响速度。
- `domain_keyword`（阈值 300）：源码为 `for` 循环 + `strings.Contains`，**随条数线性变慢**。
- `domain_regex`（阈值 50）：源码为 `for` 循环 + `MatchString`，**最慢**，尽量改用 `domain_suffix`。

## 告警

无

## 各规则集明细

### ads

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 8 / 0 |
| 产物 | `dist/ads.srs` — 180909 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 24973 / 12732 / 12512 |
| 删除: 上游重复 / 被覆盖 | 12241 / 220 |
| 匹配器 | domain=137, domain_suffix=12328, domain_keyword=24, domain_regex=1, ip_cidr=22 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/ads.txt`](removed/ads.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-category-ads-all.srs` | 8175 B | 910 |
| `adblocksingboxlite.srs` | 63468 B | 8480 |
| `geosite-category-social-media-!cn@ads.srs` | 260 B | 21 |
| `geosite-category-social-media-cn@ads.srs` | 81 B | 2 |
| `BanAD.srs` | 72030 B | 8912 |
| `BanADCompany.srs` | 1473 B | 131 |
| `BanEasyListChina.srs` | 40995 B | 5509 |
| `BanProgramAD.srs` | 7940 B | 1008 |

</details>

### ai

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/ai.srs` — 2376 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 220 / 220 / 220 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=37, domain_suffix=182, domain_keyword=0, domain_regex=1, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/ai.txt`](removed/ai.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-category-ai-!cn.srs` | 2371 B | 220 |

</details>

### direct-domain

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 14 / 0 |
| 产物 | `dist/direct-domain.srs` — 44381 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 10616 / 10157 / 7399 |
| 删除: 上游重复 / 被覆盖 | 459 / 2758 |
| 匹配器 | domain=919, domain_suffix=6471, domain_keyword=0, domain_regex=9, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/direct-domain.txt`](removed/direct-domain.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-cn.srs` | 60368 B | 9564 |
| `geosite-category-pt.srs` | 1156 B | 126 |
| `geosite-category-game-platforms-download@cn.srs` | 428 B | 24 |
| `geosite-115.srs` | 172 B | 14 |
| `geosite-category-netdisk-cn.srs` | 770 B | 91 |
| `geosite-category-social-media-cn.srs` | 518 B | 54 |
| `geosite-category-speedtest@cn.srs` | 246 B | 18 |
| `apple-cn.srs` | 1306 B | 165 |
| `apple-music@cn.srs` | 115 B | 7 |
| `aws-cn.srs` | 394 B | 28 |
| `bilibili-cdn.srs` | 184 B | 14 |
| `bilibili.srs` | 463 B | 53 |
| `bilibili2.srs` | 107 B | 4 |
| `singbox.json` | 19907 B | 454 |

</details>

### direct-ip

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/direct-ip.srs` — 34259 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 8101 / 8101 / 8101 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=0, domain_keyword=0, domain_regex=0, ip_cidr=8101 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/direct-ip.txt`](removed/direct-ip.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geoip-cn.srs` | 34259 B | 8101 |

</details>

### google

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/google.srs` — 7099 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 941 / 941 / 863 |
| 删除: 上游重复 / 被覆盖 | 0 / 78 |
| 匹配器 | domain=31, domain_suffix=830, domain_keyword=0, domain_regex=2, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/google.txt`](removed/google.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-google.srs` | 7817 B | 941 |

</details>

### steam-cn

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 16 |
| 产物 | `dist/steam-cn.srs` — 527 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 33 / 29 / 27 |
| 删除: 上游重复 / 被覆盖 | 4 / 2 |
| 匹配器 | domain=1, domain_suffix=26, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/steam-cn.txt`](removed/steam-cn.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-steam%40cn.srs` | 305 B | 17 |
| `local/steam-cn.txt` (本地手写) | - | 16 |

</details>

### steam-proxy

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 0 / 38 |
| 产物 | `dist/steam-proxy.srs` — 460 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 38 / 38 / 38 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=38, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/steam-proxy.txt`](removed/steam-proxy.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `local/steam-proxy.txt` (本地手写) | - | 38 |

</details>

### tailscale

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/tailscale.srs` — 80 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 3 / 3 / 3 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=3, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/tailscale.txt`](removed/tailscale.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-tailscale.srs` | 77 B | 3 |

</details>

### twitter

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/twitter.srs` — 315 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 24 / 24 / 24 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=24, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/twitter.txt`](removed/twitter.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-twitter.srs` | 312 B | 24 |

</details>

### us

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 8 |
| 产物 | `dist/us.srs` — 714 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 60 / 60 / 60 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=59, domain_keyword=1, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | +1 / -0 |
| 明细 | [`report/removed/us.txt`](removed/us.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-18comic.srs` | 621 B | 52 |
| `local/us.txt` (本地手写) | - | 8 |

</details>

与上次相比 **新增 1 条**（前 10 条）：

```
domain_suffix	simpcity.cr
```

### youtube

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/youtube.srs` — 1279 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 178 / 178 / 177 |
| 删除: 上游重复 / 被覆盖 | 0 / 1 |
| 匹配器 | domain=1, domain_suffix=176, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/youtube.txt`](removed/youtube.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-youtube.srs` | 1272 B | 178 |

</details>
