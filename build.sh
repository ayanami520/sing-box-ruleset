#!/bin/sh
#
# 合并 + 去重 构建器
#
#   sources/<name>.txt   (每行一个上游地址, # 开头为注释)
#        |                 支持 .srs(二进制) 与 .json(源格式) 混用
#        v
#   dist/<name>.srs      (合并去重后的成品, 目录内只有 .srs)
#
# 依赖: curl, jq, sing-box
# 可在 GitHub Actions (ubuntu) 与 OpenWrt (ash/busybox) 上运行。
#
# 环境变量:
#   SING_BOX    sing-box 可执行文件    (默认 sing-box)
#   SRC_DIR     输入目录               (默认 sources)
#   OUT_DIR     输出目录               (默认 dist)
#   WORK_DIR    临时目录               (默认 .build)
#   GH_PROXY    上游代理前缀, 例如 https://gh-proxy.com/  (默认空=直连)
#
set -eu

SING_BOX="${SING_BOX:-sing-box}"
SRC_DIR="${SRC_DIR:-sources}"
OUT_DIR="${OUT_DIR:-dist}"
WORK_DIR="${WORK_DIR:-.build}"
GH_PROXY="${GH_PROXY:-}"

log() { printf '%s\n' "==> $*"; }
die() { printf '%s\n' "!!! $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "缺少 curl"
command -v jq   >/dev/null 2>&1 || die "缺少 jq"
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

# 统计归一化 JSON 里的实际规则条目数
# (取每条规则中所有"数组型"字段的长度之和, 不依赖固定字段名,
#  因此 port 这类标量字段也不会让它出错)
count_entries() {
	jq '[ .rules[] | [ .[] | select(type == "array") | length ] | add // 0 ] | add // 0' "$1"
}

# 中间产物与成品分开目录: dist/ 里最终只会出现 dist/<name>.srs
# 全部构建成功后才替换 dist/, 失败不会留下半成品
PARTS="$WORK_DIR/parts"
FINAL="$WORK_DIR/final"
rm -rf "$WORK_DIR"
mkdir -p "$PARTS" "$FINAL"

total=0
for list in "$SRC_DIR"/*.txt; do
	[ -e "$list" ] || die "$SRC_DIR 下没有找到任何 *.txt"
	name=$(basename "$list" .txt)
	log "构建 $name"

	# ---- 1) 逐个上游下载, 统一得到"源格式 JSON" ----
	count=0
	inputs=""
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

		inputs="$inputs $json"
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
		.rules = [ .rules[] | with_entries(
			if (.value | type) == "array"
			then .value |= (unique | sort)
			else .
			end
		) ]
		| .rules |= (unique | sort_by(tostring))
	' "$merged" > "$normalized" || die "[$name] jq 去重失败"

	# ---- 4) 编译成 .srs (失败时回显真实报错) ----
	out="$FINAL/$name.srs"
	if ! "$SING_BOX" rule-set compile "$normalized" -o "$out"; then
		die "[$name] compile 失败"
	fi

	# ---- 5) 产物校验 ----
	# 用"实际规则条目数"判断, 不用文件大小 (只有 3 条域名的规则集编译出来也只有 80B)
	size=$(wc -c < "$out" | tr -d ' ')
	rules=$(jq '.rules | length' "$normalized")
	entries=$(count_entries "$normalized")

	[ "$size" -ge 32 ] || die "[$name] 产物仅 ${size}B, 文件级别异常, 已中止"
	[ "$rules" -ge 1 ] || die "[$name] 规则条目为 0, 已中止"
	[ "$entries" -ge 1 ] || die "[$name] 实际规则条目为 0 (空规则集), 已中止"

	log "  -> dist/$name.srs  ${size}B  规则=$rules  实际条目=$entries  上游数=$count"
	total=$((total + 1))
done

# ---- 6) 原子替换: dist/ 内只保留成品 .srs ----
rm -rf "$OUT_DIR"
mv "$FINAL" "$OUT_DIR"
rm -rf "$WORK_DIR"

log "完成: 共 $total 个规则集 -> $OUT_DIR/"
ls -l "$OUT_DIR"
