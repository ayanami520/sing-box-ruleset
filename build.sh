#!/bin/sh
#
# 合并 + 去重 构建器
#
#   sources/<name>.txt   (每行一个上游 .srs 地址, # 开头为注释)
#        |
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

# 中间产物与成品分开目录: dist/ 里最终只会出现 dist/<name>.srs
#   全部构建成功后才替换 dist/, 失败不会留下半成品
PARTS="$WORK_DIR/parts"
FINAL="$WORK_DIR/final"
rm -rf "$WORK_DIR"
mkdir -p "$PARTS" "$FINAL"

total=0
for list in "$SRC_DIR"/*.txt; do
	[ -e "$list" ] || die "$SRC_DIR 下没有找到任何 *.txt"
	name=$(basename "$list" .txt)
	log "构建 $name"

	# ---- 1) 逐个上游下载 + 反编译成源 JSON ----
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
		raw="$PARTS/$name.$count.srs"
		json="$PARTS/$name.$count.json"

		[ "$count" -le 1 ] || log "  + 上游 #$count"
		fetch "$url" "$raw" || die "[$name] 下载失败: $url"
		[ -s "$raw" ] || die "[$name] 上游为空文件: $url"

		"$SING_BOX" rule-set decompile "$raw" -o "$json" >/dev/null 2>&1 ||
			die "[$name] decompile 失败: $url"

		inputs="$inputs $json"
	done < "$list"

	[ "$count" -gt 0 ] || die "[$name] 没有任何有效上游地址"

	# ---- 2) 合并 (只有一个上游时直接用) ----
	merged="$PARTS/$name.merged.json"
	if [ "$count" -eq 1 ]; then
		cp "$PARTS/$name.1.json" "$merged"
	else
		# shellcheck disable=SC2086
		"$SING_BOX" rule-set merge "$merged" \
			$(for f in $inputs; do printf -- '-c %s ' "$f"; done) >/dev/null 2>&1 ||
			die "[$name] merge 失败"
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

	# ---- 4) 编译成 .srs ----
	out="$FINAL/$name.srs"
	"$SING_BOX" rule-set compile "$normalized" -o "$out" >/dev/null 2>&1 ||
		die "[$name] compile 失败"

	# ---- 5) 产物校验 (太小 = 规则丢了, 必须拦住) ----
	size=$(wc -c < "$out" | tr -d ' ')
	rules=$(jq '.rules | length' "$normalized")
	[ "$size" -ge 100 ] || die "[$name] 产物仅 ${size}B, 疑似为空, 已中止"
	[ "$rules" -ge 1 ] || die "[$name] 规则条目为 0, 已中止"

	log "  -> dist/$name.srs  ${size}B  规则条目=$rules  上游数=$count"
	total=$((total + 1))
done

# ---- 6) 原子替换: dist/ 内只保留成品 .srs ----
rm -rf "$OUT_DIR"
mv "$FINAL" "$OUT_DIR"
rm -rf "$WORK_DIR"

log "完成: 共 $total 个规则集 -> $OUT_DIR/"
ls -l "$OUT_DIR"
