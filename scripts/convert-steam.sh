#!/bin/sh
#
# 把 Surge / Clash 的 Steam 规则清单转换成 local/<group>.txt（PR1 手写条目格式）
#
#   Steam-Direct.list     -> local/steam-cn.txt       （直连侧 ✓）
#   Steam-Community.list  -> local/steam-proxy.txt    （代理侧 ✓）
#
# 只转换"能无损表达"的类型：
#   DOMAIN-SUFFIX,x        -> suffix:x      (domain_suffix)
#   DOMAIN,x               -> full:x        (domain)
#   DOMAIN-KEYWORD,x       -> keyword:x     (domain_keyword)
#   IP-CIDR(6),x[,opts]    -> ip:x          (ip_cidr)
#
# 其它类型（USER-AGENT / PROCESS-NAME / AND / URL-REGEX ...）一律【报错退出】✗
#   —— sing-box 没有对应字段，静默丢弃会让规则语义悄悄改变（比少一条更难查）。
#
# 幂等：输出不含时间戳 ⇒ 上游没变时重跑不会产生 diff ✓
#
# 用法：
#   sh scripts/convert-steam.sh
#   GH_PROXY=https://gh-proxy.com/ sh scripts/convert-steam.sh     # 国内网络
#
set -eu

GH_PROXY="${GH_PROXY:-}"
LOCAL_DIR="${LOCAL_DIR:-local}"
BASE="https://raw.githubusercontent.com/mrblack0407/surge_rules/main/rules"

fetch() {
	if [ -n "$GH_PROXY" ]; then
		curl -fsSL --retry 3 --retry-delay 2 "${GH_PROXY}$1"
	else
		curl -fsSL --retry 3 --retry-delay 2 "$1"
	fi
}

# convert <url> <policy-note> <outfile>
convert() {
	url="$1"
	note="$2"
	out="$3"
	raw="${TMPDIR:-/tmp}/convert-steam.$$.raw"
	body="${TMPDIR:-/tmp}/convert-steam.$$.body"

	fetch "$url" > "$raw" || { echo "!!! 下载失败: $url" >&2; rm -f "$raw"; exit 1; }

	awk -v src="$url" '
		function bad(m) { printf "%s:%d: %s\n", src, NR, m > "/dev/stderr"; bad_n++ }
		{
			line = $0
			sub(/\r$/, "", line)
			sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
			if (line == "" || substr(line, 1, 1) == "#") next
			if (line == "payload:") next
			sub(/^-[ \t]+/, "", line)
			p = index(line, ",")
			if (p == 0) { bad("不是 TYPE,VALUE 形式"); next }
			t = toupper(substr(line, 1, p - 1))
			v = substr(line, p + 1)
			q = index(v, ",")
			if (q > 0) v = substr(v, 1, q - 1)      # 去掉 ,no-resolve 之类
			sub(/[ \t]+$/, "", v)
			if (v == "") { bad("值为空"); next }
			if (t == "DOMAIN-SUFFIX") print "suffix:" v
			else if (t == "DOMAIN") print "full:" v
			else if (t == "DOMAIN-KEYWORD") print "keyword:" v
			else if (t == "IP-CIDR" || t == "IP-CIDR6") print "ip:" v
			else bad("无法转换的规则类型 " t "（sing-box 没有对应字段）")
		}
		END { if (bad_n > 0) exit 1 }
	' "$raw" > "$body" || {
		echo "!!! 存在无法转换的规则，已中止（上面的 文件:行号 就是原因）: $url" >&2
		rm -f "$raw" "$body"
		exit 1
	}

	{
		printf '# ⚠️ 本文件由 scripts/convert-steam.sh 生成，请勿手动修改\n'
		printf '# 上游: %s\n' "$url"
		printf '# 策略: %s\n' "$note"
		printf '# 格式: PR1 手写条目 —— suffix:=domain_suffix / full:=domain / keyword:=domain_keyword / ip:=ip_cidr\n'
		cat "$body"
	} > "$out"

	n=$(grep -c '^[a-z]' "$out" || true)
	echo "  -> $out  ${n} 条"
	rm -f "$raw" "$body"
}

mkdir -p "$LOCAL_DIR"

echo "==> 转换 Steam 规则清单"
convert "$BASE/Steam-Direct.list" \
	"Steam-cn: 直连（配合 DNS -> dns-china，否则下载仍会拿到境外 CDN）" \
	"$LOCAL_DIR/steam-cn.txt"
convert "$BASE/Steam-Community.list" \
	"Steam-proxy: 走代理（社区 / 创意工坊 / 聊天 / 直播）" \
	"$LOCAL_DIR/steam-proxy.txt"
echo "==> 完成（重跑到这里说明幂等：git diff 应为空）"
