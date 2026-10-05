# 规则集构建报告

> 由 `build.sh` 自动生成。**不含时间戳**：内容不变时不会产生提交。
> 删除明细见 `report/removed/*.txt`（未截断完整版在 `report/.full/`，不提交）；完整构建日志见 `report/build.log`。

## 总览

| 规则集 | 上游 | 产物(B) | 原始条目 | 重复删除 | 覆盖删除 | 最终条目 | 与上次 |
|---|---|---|---|---|---|---|---|
| `ads` | 4 | 51268 | 6425 | 305 | 55 | 6065 | = 无变化 |
| `ai` | 1 | 2053 | 188 | 0 | 0 | 188 | = 无变化 |
| `direct-domain` | 13 | 40009 | 9897 | 456 | 2588 | 6853 | = 无变化 |
| `direct-ip` | 1 | 34185 | 8045 | 0 | 0 | 8045 | = 无变化 |
| `google` | 1 | 7091 | 938 | 0 | 76 | 862 | = 无变化 |
| `tailscale` | 1 | 80 | 3 | 0 | 0 | 3 | = 无变化 |
| `us` | 1 | 623 | 51 | 0 | 0 | 51 | = 无变化 |

- `原始条目` = 各上游条目直接相加（含重复）；`最终条目` 才是写进 `.srs` 的条数。
- `覆盖删除` = 被更短的 `domain_suffix` 覆盖而剔除的条目（语义等价）。
- `与上次` = 相对**上次提交的 `dist/*.srs`** 的新增/移除条数（`.srs` 是二进制，这里是它唯一的人类可读 diff）。

## 匹配器体检

| 规则集 | domain | domain_suffix | domain_keyword | domain_regex | ip_cidr | 其它 | 判定 |
|---|---|---|---|---|---|---|---|
| `ads` | 142 | 5923 | 0 | 0 | 0 | 0 | ✅ |
| `ai` | 30 | 158 | 0 | 0 | 0 | 0 | ✅ |
| `direct-domain` | 520 | 6325 | 0 | 8 | 0 | 0 | ✅ |
| `direct-ip` | 0 | 0 | 0 | 0 | 8045 | 0 | ✅ |
| `google` | 31 | 829 | 0 | 2 | 0 | 0 | ✅ |
| `tailscale` | 0 | 3 | 0 | 0 | 0 | 0 | ✅ |
| `us` | 0 | 51 | 0 | 0 | 0 | 0 | ✅ |

- `domain` / `domain_suffix`：简洁字典树查找，**耗时与条数无关**，只看域名长度 ⇒ 放多少条都基本不影响速度。
- `domain_keyword`（阈值 300）：源码为 `for` 循环 + `strings.Contains`，**随条数线性变慢**。
- `domain_regex`（阈值 50）：源码为 `for` 循环 + `MatchString`，**最慢**，尽量改用 `domain_suffix`。

## 告警

无

## 各规则集明细

### ads

| 项 | 值 |
|---|---|
| 上游数 | 4 |
| 产物 | `dist/ads.srs` — 51268 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 6425 / 6120 / 6065 |
| 删除: 上游重复 / 被覆盖 | 305 / 55 |
| 匹配器 | domain=142, domain_suffix=5923, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/ads.txt`](removed/ads.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-category-ads-all.srs` | 8244 B | 910 |
| `adblocksingboxlite.srs` | 43563 B | 5492 |
| `geosite-category-social-media-!cn@ads.srs` | 260 B | 21 |
| `geosite-category-social-media-cn@ads.srs` | 81 B | 2 |

</details>

### ai

| 项 | 值 |
|---|---|
| 上游数 | 1 |
| 产物 | `dist/ai.srs` — 2053 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 188 / 188 / 188 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=30, domain_suffix=158, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/ai.txt`](removed/ai.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-category-ai-!cn.srs` | 2053 B | 188 |

</details>

### direct-domain

| 项 | 值 |
|---|---|
| 上游数 | 13 |
| 产物 | `dist/direct-domain.srs` — 40009 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 9897 / 9441 / 6853 |
| 删除: 上游重复 / 被覆盖 | 456 / 2588 |
| 匹配器 | domain=520, domain_suffix=6325, domain_keyword=0, domain_regex=8, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/direct-domain.txt`](removed/direct-domain.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-cn.srs` | 56145 B | 9303 |
| `geosite-category-pt.srs` | 1160 B | 126 |
| `geosite-category-game-platforms-download@cn.srs` | 431 B | 24 |
| `geosite-115.srs` | 172 B | 14 |
| `geosite-category-netdisk-cn.srs` | 770 B | 91 |
| `geosite-category-social-media-cn.srs` | 518 B | 54 |
| `geosite-category-speedtest@cn.srs` | 224 B | 17 |
| `apple-cn.srs` | 1306 B | 165 |
| `apple-music@cn.srs` | 115 B | 7 |
| `aws-cn.srs` | 394 B | 28 |
| `bilibili-cdn.srs` | 184 B | 13 |
| `bilibili.srs` | 463 B | 52 |
| `bilibili2.srs` | 107 B | 3 |

</details>

### direct-ip

| 项 | 值 |
|---|---|
| 上游数 | 1 |
| 产物 | `dist/direct-ip.srs` — 34185 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 8045 / 8045 / 8045 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=0, domain_keyword=0, domain_regex=0, ip_cidr=8045 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/direct-ip.txt`](removed/direct-ip.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geoip-cn.srs` | 34185 B | 8045 |

</details>

### google

| 项 | 值 |
|---|---|
| 上游数 | 1 |
| 产物 | `dist/google.srs` — 7091 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 938 / 938 / 862 |
| 删除: 上游重复 / 被覆盖 | 0 / 76 |
| 匹配器 | domain=31, domain_suffix=829, domain_keyword=0, domain_regex=2, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/google.txt`](removed/google.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-google.srs` | 7752 B | 938 |

</details>

### tailscale

| 项 | 值 |
|---|---|
| 上游数 | 1 |
| 产物 | `dist/tailscale.srs` — 80 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 3 / 3 / 3 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=3, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/tailscale.txt`](removed/tailscale.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-tailscale.srs` | 80 B | 3 |

</details>

### us

| 项 | 值 |
|---|---|
| 上游数 | 1 |
| 产物 | `dist/us.srs` — 623 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 51 / 51 / 51 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=51, domain_keyword=0, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/us.txt`](removed/us.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-18comic.srs` | 623 B | 51 |

</details>
