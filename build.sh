#!/bin/sh
#
# 合并 + 去重 + 覆盖过滤 构建器
#
#   sources/<name>.txt   (每行一个上游地址, # 开头为注释)
#        |                 支持 .srs(二进制) 与 .json(源格式) 混用
#        v
#   dist/<name>.srs        成品 (dist/ 内只会有 .srs)
#   report/report.md       构建报告: 总览 / 匹配器体检 / 与上次提交的差异
#   report/removed/<n>.txt 删除明细 (每次覆盖写 => git diff 就是"增量")
#   report/build.log       完整构建日志 (本地排查用, 不提交)
#
# 依赖: curl, jq, sing-box, awk, grep, sed, sort, wc, cut, tr
# 可在 GitHub Actions (ubuntu) 与 OpenWrt (ash/busybox) 上运行。
#
# 环境变量:
#   SING_BOX          sing-box 可执行文件   (默认 sing-box)
#   SRC_DIR           输入目录              (默认 sources)
#   OUT_DIR           输出目录              (默认 dist)
#   WORK_DIR          临时目录              (默认 .build)
#   REPORT_DIR        报告目录              (默认 report)
#   GH_PROXY          上游代理前缀, 例如 https://gh-proxy.com/   (默认空=直连)
#   WARN_KEYWORD_MAX  domain_keyword 超过此数告警 (默认 300)
#   WARN_REGEX_MAX    domain_regex  超过此数告警 (默认 50)
#   WARN_SHRINK_PCT   产物体积比上次缩小超过此比例告警 (默认 30, 单位 %)
#   DETAIL_MAX        提交的删除明细每规则集上限行数 (默认 2000)
#   STRICT            1 = 出现任何告警即失败 (默认 0)
#
set -eu

SING_BOX="${SING_BOX:-sing-box}"
SRC_DIR="${SRC_DIR:-sources}"
OUT_DIR="${OUT_DIR:-dist}"
WORK_DIR="${WORK_DIR:-.build}"
REPORT_DIR="${REPORT_DIR:-report}"
GH_PROXY="${GH_PROXY:-}"
WARN_KEYWORD_MAX="${WARN_KEYWORD_MAX:-300}"
WARN_REGEX_MAX="${WARN_REGEX_MAX:-50}"
WARN_SHRINK_PCT="${WARN_SHRINK_PCT:-30}"
DETAIL_MAX="${DETAIL_MAX:-2000}"
STRICT="${STRICT:-0}"

mkdir -p "$REPORT_DIR/removed" "$REPORT_DIR/.full"
# 明细文件按 sources/ 现存分组重写; 先清掉, 避免分组被删除后留下孤儿明细
rm -f "$REPORT_DIR"/removed/*.txt "$REPORT_DIR"/.full/*.txt
BUILD_LOG="$REPORT_DIR/build.log"
: > "$BUILD_LOG"

log() {
	printf '%s\n' "==> $*"
	printf '%s\n' "==> $*" >> "$BUILD_LOG"
}
die() {
	printf '%s\n' "!!! $*" >&2
	printf '%s\n' "!!! $*" >> "$BUILD_LOG"
	exit 1
}
warn() {
	printf '%s\n' "!!! [告警] $*" >&2
	printf '%s\n' "!!! [告警] $*" >> "$BUILD_LOG"
	printf '%s\n' "- ⚠️ $*" >> "$WARNS"
	WARN_COUNT=$((WARN_COUNT + 1))
	if [ -n "${GITHUB_ACTIONS:-}" ]; then
		printf '::warning::%s\n' "$*"
	fi
}

command -v curl >/dev/null 2>&1 || die "缺少 curl"
command -v jq   >/dev/null 2>&1 || die "缺少 jq"
command -v awk  >/dev/null 2>&1 || die "缺少 awk"
command -v "$SING_BOX" >/dev/null 2>&1 || die "缺少 sing-box ($SING_BOX)"
[ -d "$SRC_DIR" ] || die "找不到输入目录 $SRC_DIR"

fetch() {
	# fetch <url> <输出文件>
	if [ -n "$GH_PROXY" ]; then
		curl -fsSL --retry 3 --retry-delay 2 -o "$2" "${GH_PROXY}$1"
	else
		curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1"
	fi
}

# 上游短名 (URL 去重后的文件名, 用于报告)
shortname() {
	printf '%s' "$1" | sed -e 's/[?#].*$//' -e 's|.*/||'
}

# 把"源格式 JSON"摊平成 "字段<TAB>值" 行, 去重 + 排序
# (只取数组型字段; port/invert/mode 这类标量字段不会出现也不会报错)
# 摊平后是稳定的文本, 因此可以逐行 diff —— 这正是"增量日志"的基础。
flatten() {
	jq -r '
		[ (.rules // [])[]
		  | to_entries[]
		  | select(.value | type == "array")
		  | .key as $k | .value[] | "\($k)\t\(. | tostring)"
		] | unique | sort | .[]
	' "$1"
}

# 某一字段的条目数
field_count() {
	awk -F'\t' -v f="$1" '$1 == f { n++ } END { print n + 0 }' "$2"
}

# 摊平后按字段计数汇总 (domain=…, domain_suffix=…, …)
compose_counts() {
	awk -F'\t' '
		{ c[$1]++ }
		END {
			known = c["domain"] + c["domain_suffix"] + c["domain_keyword"] + c["domain_regex"] + c["ip_cidr"]
			s = "domain=" c["domain"] ", domain_suffix=" c["domain_suffix"] \
			    ", domain_keyword=" c["domain_keyword"] ", domain_regex=" c["domain_regex"] \
			    ", ip_cidr=" c["ip_cidr"]
			total = 0
			for (k in c) total += c[k]
			if (total > known) s = s ", 其它=" (total - known)
			print s
		}
	' "$1"
}

# 上述五个已知字段之外的条目数
other_count() {
	awk -F'\t' '
		{ c[$1]++ }
		END {
			known = c["domain"] + c["domain_suffix"] + c["domain_keyword"] + c["domain_regex"] + c["ip_cidr"]
			total = 0
			for (k in c) total += c[k]
			print total - known
		}
	' "$1"
}

# 中间产物与成品分开目录: dist/ 里最终只会出现 dist/<name>.srs
# 全部构建成功后才替换 dist/, 失败不会留下半成品
PARTS="$WORK_DIR/parts"
FINAL="$WORK_DIR/final"
RPT="$WORK_DIR/report"
rm -rf "$WORK_DIR"
mkdir -p "$PARTS" "$FINAL" "$RPT"

SUMMARY="$RPT/summary.md"
DETAILS="$RPT/details.md"
INSPECT="$RPT/inspect.md"
WARNS="$RPT/warns.md"
: > "$SUMMARY"
: > "$DETAILS"
: > "$INSPECT"
: > "$WARNS"

WARN_COUNT=0
total=0

for list in "$SRC_DIR"/*.txt; do
	[ -e "$list" ] || die "$SRC_DIR 下没有找到任何 *.txt"
	name=$(basename "$list" .txt)
	log "构建 $name"

	# ---- 1) 逐个上游下载, 统一得到"源格式 JSON", 并摊平成条目表 ----
	count=0
	inputs=""
	flats=""
	: > "$RPT/src.$name.md"
	while IFS= read -r url || [ -n "$url" ]; do
		# 剥离可能的 CR (Windows 行尾), 否则 curl 报 "URL rejected"
		url=$(printf '%s' "$url" | tr -d '\r')
		# 去掉首尾空白
		url=$(printf '%s' "$url" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
		case "$url" in
			'' | '#'*) continue ;;
		esac
		count=$((count + 1))
		raw="$PARTS/$name.$count.raw"
		json="$PARTS/$name.$count.json"
		flat="$PARTS/$name.$count.flat"

		[ "$count" -le 1 ] || log "  + 上游 #$count"
		fetch "$url" "$raw" || die "[$name] 下载失败: $url"
		[ -s "$raw" ] || die "[$name] 上游为空文件: $url"

		case "$url" in
			*.json | *.JSON)
				# 上游 .json 多为源格式, 但普遍缺少 version 字段,
				# 而 sing-box 的 compile/merge 要求必须有 (报 missing rule-set version)。
				# 注意 rule-set upgrade 对"没有 version"的文件同样会失败, 所以只能自己补。
				jq 'if has("version") then . else . + {version: 1} end' "$raw" > "$json" ||
					die "[$name] 上游 JSON 无法解析: $url"
				;;
			*)
				# .srs 二进制先反编译成源格式 JSON
				"$SING_BOX" rule-set decompile "$raw" -o "$json" ||
					die "[$name] decompile 失败: $url"
				;;
		esac

		flatten "$json" > "$flat" || die "[$name] 上游条目无法解析: $url"
		n=$(wc -l < "$flat" | tr -d ' ')
		b=$(wc -c < "$raw" | tr -d ' ')
		log "      $(shortname "$url")  ${b}B  条目=$n"
		printf '| `%s` | %s B | %s |\n' "$(shortname "$url")" "$b" "$n" >> "$RPT/src.$name.md"

		inputs="$inputs $json"
		flats="$flats $flat"
	done < "$list"

	[ "$count" -gt 0 ] || die "[$name] 没有任何有效上游地址"

	# ---- 2) 合并 (只有一个上游时直接用) ----
	merged="$PARTS/$name.merged.json"
	if [ "$count" -eq 1 ]; then
		cp "$PARTS/$name.1.json" "$merged"
	else
		# merge 成功时会把输出路径打到 stdout, 所以重定向到日志, 失败时才回显
		# shellcheck disable=SC2086
		if ! "$SING_BOX" rule-set merge "$merged" \
			$(for f in $inputs; do printf -- '-c %s ' "$f"; done) > "$PARTS/$name.merge.log" 2>&1; then
			cat "$PARTS/$name.merge.log" >&2
			die "[$name] merge 失败"
		fi
	fi

	# ---- 3) 去重 + 排序 (输出稳定 => 内容没变时不会产生多余提交) ----
	normalized="$PARTS/$name.json"
	jq -S '
		.rules = [ (.rules // [])[] | with_entries(
			if (.value | type) == "array"
			then .value |= (unique | sort)
			else .
			end
		) ]
		| .rules |= (unique | sort_by(tostring))
	' "$merged" > "$normalized" || die "[$name] jq 去重失败"

	flat_norm="$PARTS/$name.norm.flat"
	flatten "$normalized" > "$flat_norm"

	# 原始条目总数 (各上游直接相加) 与去重后条数
	raw_total=0
	# shellcheck disable=SC2086
	for f in $flats; do
		raw_total=$((raw_total + $(wc -l < "$f" | tr -d ' ')))
	done
	norm_total=$(wc -l < "$flat_norm" | tr -d ' ')
	dup_removed=$((raw_total - norm_total))

	# 重复条目明细 (只列出现 >1 次的值, 每个值一行)
	# shellcheck disable=SC2086
	sort $flats | uniq -d > "$PARTS/$name.dup.txt"

	# ---- 4) 覆盖过滤: 剔除被更短 domain_suffix 覆盖的条目 ----
	#   domain       a.b.com  被 domain_suffix  b.com / com 覆盖
	#   domain_suffix a.b.com 被 domain_suffix  b.com / com 覆盖
	# 两者语义等价 (sing-box 的后缀匹配按域名段边界判定), 删掉只减内存不减功能。
	# 只对 domain / domain_suffix 生效; domain_keyword / domain_regex 绝不改动。
	drops="$PARTS/$name.covered.txt"
	flat_kept="$PARTS/$name.kept.flat"
	: > "$drops"
	awk -F'\t' -v dropf="$drops" '
		{
			f[NR] = $1; v[NR] = $2
			if ($1 == "domain_suffix") S[$2] = 1
		}
		END {
			# pass 1: 找出"自身也被更短后缀覆盖"的 suffix
			for (i = 1; i <= NR; i++) {
				if (f[i] != "domain_suffix") continue
				rest = v[i]
				while (1) {
					p = index(rest, ".")
					if (p == 0) break
					rest = substr(rest, p + 1)
					if (rest == "") break
					if (rest in S) { dead[v[i]] = rest; break }
				}
			}
			# S2 = 过滤后仍然有效的后缀集合 (覆盖关系链条的末端)
			for (s in S) if (!(s in dead)) S2[s] = 1
			# pass 2: 判定每条
			for (i = 1; i <= NR; i++) {
				t = f[i]; val = v[i]; cover = ""
				if (t == "domain_suffix") {
					if (val in dead) {
						cover = dead[val]
						# 沿着覆盖链走到最终"存活"的那个后缀, 让明细里的覆盖者真实存在
						while (cover in dead) cover = dead[cover]
					}
				} else if (t == "domain") {
					if (val in S2) cover = val
					else {
						rest = val
						while (1) {
							p = index(rest, ".")
							if (p == 0) break
							rest = substr(rest, p + 1)
							if (rest == "") break
							if (rest in S2) { cover = rest; break }
						}
					}
				}
				if (cover != "")
					printf "covered\t%s\t%s\t%s\n", t, val, cover >> dropf
				else
					print t "\t" val
			}
		}
	' "$flat_norm" > "$flat_kept"
	covered=$(wc -l < "$drops" | tr -d ' ')
	kept_total=$(wc -l < "$flat_kept" | tr -d ' ')

	# ---- 5) 按"保留条目"剔除被覆盖项 -> 编译 ----
	kept_json="$PARTS/$name.kept.json"
	if [ "$covered" -gt 0 ]; then
		# 组织成 {字段: {值: true}} 便于 jq 用 has() 做 O(1) 判定
		cut -f2,3 "$drops" | sort -u > "$PARTS/$name.droppairs.tsv"
		jq -R -s '
			split("\n")
			| map(select(length > 0) | split("\t"))
			| group_by(.[0])
			| map({ key: .[0][0], value: ([ .[][1] ] | map({ (.): true }) | add // {}) })
			| from_entries
		' "$PARTS/$name.droppairs.tsv" > "$PARTS/$name.dropmap.json" ||
			die "[$name] 构造覆盖表失败"

		jq --slurpfile d "$PARTS/$name.dropmap.json" '
			($d[0] // {}) as $drop
			| .rules |= map( with_entries(
				.key as $k
				| if ((.value | type) == "array") and ((($drop[$k] // {}) | length) > 0)
				  then .value = [ .value[] as $v | select((($drop[$k]) | has($v)) | not) | $v ]
				  else . end
			) )
		' "$normalized" > "$kept_json" || die "[$name] 剔除被覆盖条目失败"
	else
		cp "$normalized" "$kept_json"
	fi

	out="$FINAL/$name.srs"
	if ! "$SING_BOX" rule-set compile "$kept_json" -o "$out"; then
		die "[$name] compile 失败"
	fi

	# ---- 6) 产物校验 ----
	# 用"实际规则条目数"判断, 不用文件大小 (只有 3 条域名的规则集编译出来也只有 80B)
	size=$(wc -c < "$out" | tr -d ' ')
	rules=$(jq '.rules | length' "$kept_json")

	[ "$size" -ge 32 ] || die "[$name] 产物仅 ${size}B, 文件级别异常, 已中止"
	[ "$rules" -ge 1 ] || die "[$name] 规则条目为 0, 已中止"
	[ "$kept_total" -ge 1 ] || die "[$name] 实际规则条目为 0 (空规则集), 已中止"

	log "  -> dist/$name.srs  ${size}B  规则=$rules  条目=$kept_total(原始 $raw_total / 去重 $norm_total / 覆盖删除 $covered)  上游数=$count"

	# ---- 7) 与上次提交的产物对比 (增量) ----
	prev="$OUT_DIR/$name.srs"
	prev_json="$PARTS/$name.prev.json"
	prev_flat="$PARTS/$name.prev.flat"
	: > "$PARTS/$name.added.txt"
	: > "$PARTS/$name.removed.txt"
	added=0
	removed=0
	has_prev=0
	if [ -s "$prev" ] && "$SING_BOX" rule-set decompile "$prev" -o "$prev_json" 2>/dev/null; then
		flatten "$prev_json" > "$prev_flat"
		if [ -s "$prev_flat" ]; then
			has_prev=1
			awk 'NR == FNR { a[$0] = 1; next } !($0 in a)' "$prev_flat" "$flat_kept" |
				sort > "$PARTS/$name.added.txt"
			awk 'NR == FNR { a[$0] = 1; next } !($0 in a)' "$flat_kept" "$prev_flat" |
				sort > "$PARTS/$name.removed.txt"
			added=$(wc -l < "$PARTS/$name.added.txt" | tr -d ' ')
			removed=$(wc -l < "$PARTS/$name.removed.txt" | tr -d ' ')
		fi
	fi
	if [ "$has_prev" -eq 0 ]; then
		changesum="🆕 首次 (无上次产物可比)"
	elif [ "$added" -eq 0 ] && [ "$removed" -eq 0 ]; then
		changesum="= 无变化"
	else
		changesum="+$added / -$removed"
	fi

	# ---- 8) 删除明细 (每次覆盖写 => git diff 即增量) ----
	#   提交版: report/removed/<name>.txt  (超过 DETAIL_MAX 行会截断)
	#   完整版: report/.full/<name>.txt    (不提交, 但随 CI artifact 上传)
	# 顺序上把 dup 放前面: "去重删掉了哪些" 是最常看的信息, 不能被 covered 挤掉
	body="$PARTS/$name.removed.body"
	{
		awk -F'\t' '{ printf "dup\t%s\t%s\n", $1, $2 }' "$PARTS/$name.dup.txt"
		cat "$drops"
	} > "$body"
	dupn=$(wc -l < "$PARTS/$name.dup.txt" | tr -d ' ')
	dbody=$(wc -l < "$body" | tr -d ' ')

	detail="$REPORT_DIR/removed/$name.txt"
	{
		printf '# %s —— 本次构建删除明细\n' "$name"
		printf '# 每次构建【覆盖写, 不追加】 => 本文件的 git diff 就是"增量变更"\n'
		printf '# 列: 原因<TAB>字段<TAB>值[<TAB>覆盖它的后缀]\n'
		printf '#   dup     = 上游之间重复; 同一值重复多次只列 1 行, 总重复条数见报告"重复删除"列\n'
		printf '#   covered = 被更短的 domain_suffix 覆盖; 语义等价, 删掉只省内存, 命中结果不变\n'
		printf '# 完整未截断清单: report/.full/%s.txt (不提交, 随 CI artifact 上传)\n' "$name"
		printf '# 本次共 %s 行 (dup=%s, covered=%s); 提交版上限 %s 行\n' \
			"$dbody" "$dupn" "$covered" "$DETAIL_MAX"
		if [ "$dbody" -gt "$DETAIL_MAX" ]; then
			head -n "$DETAIL_MAX" "$body"
			printf '# ... 已截断: 共 %s 行, 仅保留前 %s 行 (完整清单见 report/.full/%s.txt)\n' \
				"$dbody" "$DETAIL_MAX" "$name"
		else
			cat "$body"
		fi
	} > "$detail"

	{
		printf '# %s —— 完整删除明细 (未截断, 不提交)\n' "$name"
		printf '# 共 %s 行: dup=%s, covered=%s\n' "$dbody" "$dupn" "$covered"
		cat "$body"
	} > "$REPORT_DIR/.full/$name.txt"

	# ---- 9) 匹配器体检 ----
	kw=$(field_count domain_keyword "$flat_kept")
	re=$(field_count domain_regex "$flat_kept")
	[ "$kw" -le "$WARN_KEYWORD_MAX" ] ||
		warn "$name: domain_keyword $kw 条 > $WARN_KEYWORD_MAX —— 该字段是【逐条线性扫描】, 会随条数变慢"
	[ "$re" -le "$WARN_REGEX_MAX" ] ||
		warn "$name: domain_regex $re 条 > $WARN_REGEX_MAX —— 正则【逐条匹配】最慢, 建议换成 domain_suffix"
	if [ "$has_prev" -eq 1 ]; then
		ps=$(wc -c < "$prev" | tr -d ' ')
		if [ "$ps" -gt 0 ] && [ "$size" -lt $((ps * (100 - WARN_SHRINK_PCT) / 100)) ]; then
			warn "$name: 产物由 ${ps}B 缩小到 ${size}B (超过 $WARN_SHRINK_PCT%) —— 上游可能被截断"
		fi
	fi

	# ---- 10) 汇总表 / 明细 / 体检表 ----
	printf '| `%s` | %s | %s | %s | %s | %s | %s | %s |\n' \
		"$name" "$count" "$size" "$raw_total" "$dup_removed" "$covered" "$kept_total" "$changesum" \
		>> "$SUMMARY"
	printf '| `%s` | %s | %s | %s | %s | %s | %s | %s |\n' \
		"$name" \
		"$(field_count domain "$flat_kept")" \
		"$(field_count domain_suffix "$flat_kept")" \
		"$kw" "$re" \
		"$(field_count ip_cidr "$flat_kept")" \
		"$(other_count "$flat_kept")" \
		"$([ "$kw" -le "$WARN_KEYWORD_MAX" ] && [ "$re" -le "$WARN_REGEX_MAX" ] && echo '✅' || echo '⚠️')" \
		>> "$INSPECT"

	{
		printf '\n### %s\n\n' "$name"
		printf '| 项 | 值 |\n|---|---|\n'
		printf '| 上游数 | %s |\n' "$count"
		printf '| 产物 | `dist/%s.srs` — %s B |\n' "$name" "$size"
		printf '| 条目: 原始 / 去重后 / 覆盖过滤后 | %s / %s / %s |\n' "$raw_total" "$norm_total" "$kept_total"
		printf '| 删除: 上游重复 / 被覆盖 | %s / %s |\n' "$dup_removed" "$covered"
		printf '| 匹配器 | %s |\n' "$(compose_counts "$flat_kept")"
		printf '| 与上次提交对比 | %s |\n' "$changesum"
		printf '| 明细 | [`report/removed/%s.txt`](removed/%s.txt) |\n' "$name" "$name"
		printf '\n<details><summary>上游明细</summary>\n\n| 上游 | 原始体积 | 条目 |\n|---|---|---|\n'
		cat "$RPT/src.$name.md"
		printf '\n</details>\n'
		if [ "$removed" -gt 0 ]; then
			printf '\n与上次相比 **移除 %s 条**（前 10 条，完整见明细文件）：\n\n```\n' "$removed"
			head -n 10 "$PARTS/$name.removed.txt"
			printf '```\n'
		fi
		if [ "$added" -gt 0 ]; then
			printf '\n与上次相比 **新增 %s 条**（前 10 条）：\n\n```\n' "$added"
			head -n 10 "$PARTS/$name.added.txt"
			printf '```\n'
		fi
	} >> "$DETAILS"

	total=$((total + 1))
done

# ---- 11) 组装报告 (不含时间戳 => 内容不变时不会产生多余提交) ----
{
	printf '# 规则集构建报告\n\n'
	printf '> 由 `build.sh` 自动生成。**不含时间戳**：内容不变时不会产生提交。\n'
	printf '> 删除明细见 `report/removed/*.txt`（未截断完整版在 `report/.full/`，不提交）；完整构建日志见 `report/build.log`。\n\n'
	printf '## 总览\n\n'
	printf '| 规则集 | 上游 | 产物(B) | 原始条目 | 重复删除 | 覆盖删除 | 最终条目 | 与上次 |\n'
	printf '|---|---|---|---|---|---|---|---|\n'
	cat "$SUMMARY"
	printf '\n- `原始条目` = 各上游条目直接相加（含重复）；`最终条目` 才是写进 `.srs` 的条数。\n'
	printf '- `覆盖删除` = 被更短的 `domain_suffix` 覆盖而剔除的条目（语义等价）。\n'
	printf '- `与上次` = 相对**上次提交的 `dist/*.srs`** 的新增/移除条数（`.srs` 是二进制，这里是它唯一的人类可读 diff）。\n'
	printf '\n## 匹配器体检\n\n'
	printf '| 规则集 | domain | domain_suffix | domain_keyword | domain_regex | ip_cidr | 其它 | 判定 |\n'
	printf '|---|---|---|---|---|---|---|---|\n'
	cat "$INSPECT"
	printf '\n- `domain` / `domain_suffix`：简洁字典树查找，**耗时与条数无关**，只看域名长度 ⇒ 放多少条都基本不影响速度。\n'
	printf '- `domain_keyword`（阈值 %s）：源码为 `for` 循环 + `strings.Contains`，**随条数线性变慢**。\n' "$WARN_KEYWORD_MAX"
	printf '- `domain_regex`（阈值 %s）：源码为 `for` 循环 + `MatchString`，**最慢**，尽量改用 `domain_suffix`。\n' "$WARN_REGEX_MAX"
	printf '\n## 告警\n\n'
	if [ "$WARN_COUNT" -eq 0 ]; then
		printf '无\n'
	else
		cat "$WARNS"
	fi
	printf '\n## 各规则集明细\n'
	cat "$DETAILS"
} > "$REPORT_DIR/report.md"

# ---- 12) 原子替换: dist/ 内只保留成品 .srs ----
rm -rf "$OUT_DIR"
mv "$FINAL" "$OUT_DIR"
rm -rf "$WORK_DIR"

log "报告: $REPORT_DIR/report.md  告警: $WARN_COUNT 条"
log "完成: 共 $total 个规则集 -> $OUT_DIR/"
ls -l "$OUT_DIR"

if [ "$STRICT" -eq 1 ] && [ "$WARN_COUNT" -gt 0 ]; then
	die "STRICT=1 且有 $WARN_COUNT 条告警"
fi
