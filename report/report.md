# 规则集构建报告

> 由 `build.sh` 自动生成。**不含时间戳**：内容不变时不会产生提交。
> 删除明细见 `report/removed/*.txt`（未截断完整版在 `report/.full/`，不提交）；完整构建日志见 `report/build.log`。

## 总览

| 规则集 | 上游 | 本地 | 产物(B) | 原始条目 | 重复删除 | 覆盖删除 | 最终条目 | 与上次 |
|---|---|---|---|---|---|---|---|---|
| `ads` | 8 | 0 | 172381 | 24173 | 9925 | 220 | 14028 | +60 / -13 |
| `ai` | 1 | 0 | 2069 | 190 | 0 | 0 | 190 | = 无变化 |
| `direct-domain` | 13 | 0 | 40009 | 9901 | 457 | 2589 | 6855 | = 无变化 |
| `direct-ip` | 1 | 0 | 34268 | 8113 | 0 | 0 | 8113 | = 无变化 |
| `google` | 1 | 0 | 7091 | 938 | 0 | 76 | 862 | = 无变化 |
| `tailscale` | 1 | 0 | 80 | 3 | 0 | 0 | 3 | = 无变化 |
| `us` | 1 | 5 | 690 | 56 | 0 | 0 | 56 | = 无变化 |

- `原始条目` = 各上游条目直接相加（`local/` 手写条目也算在内，含重复）；`最终条目` 才是写进 `.srs` 的条数。
- `覆盖删除` = 被更短的 `domain_suffix` 覆盖而剔除的条目（语义等价）。
- `与上次` = 相对**上次提交的 `dist/*.srs`** 的新增/移除条数（`.srs` 是二进制，这里是它唯一的人类可读 diff）。

## 匹配器体检

| 规则集 | domain | domain_suffix | domain_keyword | domain_regex | ip_cidr | 其它 | 判定 |
|---|---|---|---|---|---|---|---|
| `ads` | 136 | 13844 | 25 | 1 | 22 | 0 | ✅ |
| `ai` | 30 | 159 | 0 | 1 | 0 | 0 | ✅ |
| `direct-domain` | 521 | 6325 | 0 | 9 | 0 | 0 | ✅ |
| `direct-ip` | 0 | 0 | 0 | 0 | 8113 | 0 | ✅ |
| `google` | 31 | 829 | 0 | 2 | 0 | 0 | ✅ |
| `tailscale` | 0 | 3 | 0 | 0 | 0 | 0 | ✅ |
| `us` | 0 | 55 | 1 | 0 | 0 | 0 | ✅ |

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
| 产物 | `dist/ads.srs` — 172381 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 24173 / 14248 / 14028 |
| 删除: 上游重复 / 被覆盖 | 9925 / 220 |
| 匹配器 | domain=136, domain_suffix=13844, domain_keyword=25, domain_regex=1, ip_cidr=22 |
| 与上次提交对比 | +60 / -13 |
| 明细 | [`report/removed/ads.txt`](removed/ads.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-category-ads-all.srs` | 8121 B | 903 |
| `adblocksingboxlite.srs` | 62586 B | 8315 |
| `geosite-category-social-media-!cn@ads.srs` | 260 B | 21 |
| `geosite-category-social-media-cn@ads.srs` | 81 B | 2 |
| `BanAD.srs` | 71142 B | 8743 |
| `BanADCompany.srs` | 1473 B | 131 |
| `BanEasyListChina.srs` | 33475 B | 5050 |
| `BanProgramAD.srs` | 7940 B | 1008 |

</details>

与上次相比 **移除 13 条**（前 10 条，完整见明细文件）：

```
domain	rtlog3-applog.fqnovel.com
domain_suffix	ads-vp5-xhscdn.tliveapp.com.cdn.dnsv1.com
domain_suffix	adx-id-ads.realmemobile.com
domain_suffix	bdapi-id-ads.realmemobile.com
domain_suffix	bm.alimama.cn
domain_suffix	bmvip.alimama.cn
domain_suffix	cb.alimama.cn
domain_suffix	data-id-ads.realmemobile.com
domain_suffix	pikacn.com
domain_suffix	sentry.dreambig.work
```

与上次相比 **新增 60 条**（前 10 条）：

```
domain_suffix	0grzr3u2t.com
domain_suffix	126.cn
domain_suffix	1nvnkyg65.com
domain_suffix	3zmb53.fordmodels.cn
domain_suffix	89y84ta6xg.com
domain_suffix	97sky.cn
domain_suffix	9sgckbc7e.com
domain_suffix	a.ac.qq.com
domain_suffix	ads3-normal-xh.zijieapi.com
domain_suffix	advenueplatform.com
```

### ai

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/ai.srs` — 2069 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 190 / 190 / 190 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=30, domain_suffix=159, domain_keyword=0, domain_regex=1, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/ai.txt`](removed/ai.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-category-ai-!cn.srs` | 2069 B | 190 |

</details>

### direct-domain

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 13 / 0 |
| 产物 | `dist/direct-domain.srs` — 40009 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 9901 / 9444 / 6855 |
| 删除: 上游重复 / 被覆盖 | 457 / 2589 |
| 匹配器 | domain=521, domain_suffix=6325, domain_keyword=0, domain_regex=9, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/direct-domain.txt`](removed/direct-domain.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-cn.srs` | 56189 B | 9304 |
| `geosite-category-pt.srs` | 1160 B | 126 |
| `geosite-category-game-platforms-download@cn.srs` | 431 B | 24 |
| `geosite-115.srs` | 172 B | 14 |
| `geosite-category-netdisk-cn.srs` | 770 B | 91 |
| `geosite-category-social-media-cn.srs` | 518 B | 54 |
| `geosite-category-speedtest@cn.srs` | 224 B | 17 |
| `apple-cn.srs` | 1306 B | 165 |
| `apple-music@cn.srs` | 115 B | 7 |
| `aws-cn.srs` | 394 B | 28 |
| `bilibili-cdn.srs` | 184 B | 14 |
| `bilibili.srs` | 463 B | 53 |
| `bilibili2.srs` | 107 B | 4 |

</details>

### direct-ip

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
| 产物 | `dist/direct-ip.srs` — 34268 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 8113 / 8113 / 8113 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=0, domain_keyword=0, domain_regex=0, ip_cidr=8113 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/direct-ip.txt`](removed/direct-ip.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geoip-cn.srs` | 34268 B | 8113 |

</details>

### google

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 0 |
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
| `geosite-tailscale.srs` | 80 B | 3 |

</details>

### us

| 项 | 值 |
|---|---|
| 上游数 / 本地条目 | 1 / 5 |
| 产物 | `dist/us.srs` — 690 B |
| 条目: 原始 / 去重后 / 覆盖过滤后 | 56 / 56 / 56 |
| 删除: 上游重复 / 被覆盖 | 0 / 0 |
| 匹配器 | domain=0, domain_suffix=55, domain_keyword=1, domain_regex=0, ip_cidr=0 |
| 与上次提交对比 | = 无变化 |
| 明细 | [`report/removed/us.txt`](removed/us.txt) |

<details><summary>上游明细</summary>

| 上游 | 原始体积 | 条目 |
|---|---|---|
| `geosite-18comic.srs` | 623 B | 51 |
| `local/us.txt` (本地手写) | - | 5 |

</details>
