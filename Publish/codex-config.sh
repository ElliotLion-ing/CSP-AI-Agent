#!/usr/bin/env bash
set -euo pipefail

TOKEN="${1:-}"
URL="${2:-https://zct-dev.zoomdev.us/csp-agent/mcp}"
NAME="csp-ai-agent"
CONFIG_DIR="${HOME}/.codex"
CONFIG_FILE="${CONFIG_DIR}/config.toml"

if [[ -z "${TOKEN}" ]]; then
  echo "Usage: bash codex-config.sh <UserToken> [McpUrl]"
  exit 1
fi

AUTH="Bearer ${TOKEN}"

mkdir -p "${CONFIG_DIR}"
touch "${CONFIG_FILE}"
cp "${CONFIG_FILE}" "${CONFIG_FILE}.bak.$(date +%Y%m%d%H%M%S)"

python3 - "$CONFIG_FILE" "$NAME" "$URL" "$AUTH" <<'PY'
import pathlib
import re
import sys

config_file = pathlib.Path(sys.argv[1])
name = sys.argv[2]
url = sys.argv[3]
auth = sys.argv[4]

content = config_file.read_text() if config_file.exists() else ""

section = f'''[mcp_servers.{name}]
url = "{url}"
http_headers = {{ "Authorization" = "{auth}" }}
enabled = true
'''

pattern = rf'(?ms)^\[mcp_servers\.{re.escape(name)}\]\n.*?(?=^\[|\Z)'
content = re.sub(pattern, "", content).rstrip()
content = content + "\n\n" + section

config_file.write_text(content)
PY

echo "Installed ${NAME} MCP config to ${CONFIG_FILE}"
echo "Please restart Codex."
