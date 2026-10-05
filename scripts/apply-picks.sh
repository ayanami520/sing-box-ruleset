#!/bin/sh
#
# 把 picks/picks.json（油猴脚本导出）写进 sources/<分组>.txt 的"自动块"
#
#   # >>> picks:auto  (由 picks/picks.json 自动生成, 请勿手改)
#   # 条目: geosite-115.srs
#   https://.../geosite-115.srs
#   # <<< picks:auto
#
# ⚠️ 自动块每次都会整体重写 —— 想手写备注请写在块【之外】，
#    或者用收集器的「复制 sources 片段」导出到块外。
#
# 自动块之外的内容完全保留。picks 为空时会清掉所有自动块。
# 某个分组只有 picks 时会自动创建对应 sources/<group>.txt；
# 失去全部内容时会自动删除，避免空规则集卡住构建。
#
# 环境变量:
#   PICKS     输入文件 (默认 picks/picks.json)
#   SRC_DIR   输出目录 (默认 sources)
#
set -eu

PICKS="${PICKS:-picks/picks.json}"
SRC_DIR="${SRC_DIR:-sources}"
BM='# >>> picks:auto'
EM='# <<< picks:auto'
TMP="${TMPDIR:-/tmp}/apply-picks.$$"

command -v jq >/dev/null 2>&1 || { echo "!!! 缺少 jq" >&2; exit 1; }

if [ ! -f "$PICKS" ]; then
	echo "==> 没有 $PICKS, 跳过"
	exit 0
fi

# ---- 1) 先清掉所有已存在的自动块 ----
for f in "$SRC_DIR"/*.txt; do
	[ -f "$f" ] || continue
	grep -q "^${BM}" "$f" || continue
	sed "/^${BM}/,/^${EM}/d" "$f" > "$TMP"
	mv "$TMP" "$f"
	echo "  清理自动块: $f"
done

# ---- 2) 按 action 写入对应分组 ----
for pair in direct:direct-domain.txt us:us.txt jp:jp.txt kr:kr.txt block:ads.txt ai:ai.txt google:google.txt; do
	act=${pair%%:*}
	grp=${pair##*:}

	# 用 jq 直接生成带注释的条目（按 url 去重），避免 shell 循环
	jq -r --arg a "$act" '
		[ .items[]? | select(.action == $a) ] | unique_by(.url)
		| .[] | "# \(.note // ("条目: " + ((.name // .url) | split("/") | last)))\n\(.url)"
	' "$PICKS" > "$TMP" 2>/dev/null || : > "$TMP"

	[ -s "$TMP" ] || continue

	f="$SRC_DIR/$grp"
	[ -f "$f" ] || : > "$f"

	printf '\n%s  (由 picks/picks.json 自动生成, 请勿手改)\n' "$BM" >> "$f"
	cat "$TMP" >> "$f"
	printf '%s\n' "$EM" >> "$f"

	echo "  -> $f  追加 $(grep -c '^http' "$TMP") 条"
done
rm -f "$TMP"

# ---- 3) 报告未识别的 action ----
jq -r '.items[]? | .action // ""' "$PICKS" 2>/dev/null | sort -u | while read -r a; do
	[ -n "$a" ] || continue
	case " direct us jp kr block ai google " in
		*" ${a} "*) ;;
		*) echo "!!! 未知 action: $a (已忽略)" >&2 ;;
	esac
done

# ---- 4) 删掉只剩注释/空行的分组文件（避免生成空规则集把构建卡住）----
for f in "$SRC_DIR"/*.txt; do
	[ -f "$f" ] || continue
	body=$(grep -v '^#' "$f" | tr -d ' \t\n' || true)
	if [ -z "$body" ]; then
		rm -f "$f"
		echo "  -> 删除空分组 $f"
	fi
done

echo "==> 完成"
