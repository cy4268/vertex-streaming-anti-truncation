#!/bin/sh
command -v node >/dev/null 2>&1 || { echo "没有找到 Node.js，请先安装 Node.js 22.9 或更高版本。"; exit 1; }
exec node "$(dirname "$0")/install.mjs" "$@"
