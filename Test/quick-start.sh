#!/bin/bash
# Quick Start Script for Local MCP Testing
# Usage:
#   ./quick-start.sh mock          # Start Mock Server only (port 6093)
#   ./quick-start.sh mcp           # Start MCP Server only (port 3000, SSE mode)
#   ./quick-start.sh all           # Start both Mock + MCP servers
#   ./quick-start.sh kill          # Kill all running Mock/MCP server processes
#   ./quick-start.sh reload        # Hot-reload resources in running Mock Server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$PROJECT_ROOT/SourceCode"
ENV_FILE="$SOURCE_DIR/.env"

MOCK_PORT="${MOCK_RESOURCE_PORT:-6093}"
MCP_PORT=3000

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

check_port() {
  lsof -ti :"$1" > /dev/null 2>&1
}

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo -e "${YELLOW}  Killing processes on port $port (PIDs: $pids)...${NC}"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
    echo -e "${GREEN}  Port $port is now free.${NC}"
  else
    echo "  Port $port is already free."
  fi
}

wait_for_port() {
  local port=$1
  local max_attempts=15
  local attempt=0
  while ! check_port "$port" && [ $attempt -lt $max_attempts ]; do
    sleep 0.5
    attempt=$((attempt + 1))
  done
  check_port "$port"
}

load_token_from_env() {
  if [ -f "$ENV_FILE" ]; then
    grep '^CSP_API_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'"
  fi
}

print_header() {
  echo ""
  echo -e "${CYAN}=========================================="
  echo "MCP Local Testing - Quick Start"
  echo -e "==========================================${NC}"
  echo ""
}

# ──────────────────────────────────────────────
# Mode: mock — Start Mock Server only
# ──────────────────────────────────────────────

start_mock() {
  echo -e "${CYAN}[Mock Server]${NC} Starting on port $MOCK_PORT..."

  if check_port "$MOCK_PORT"; then
    echo -e "${YELLOW}  Port $MOCK_PORT already in use. Killing existing process...${NC}"
    kill_port "$MOCK_PORT"
  fi

  cd "$SCRIPT_DIR"
  nohup node mock-csp-resource-server.js > "$SCRIPT_DIR/mock-server.log" 2>&1 &
  MOCK_PID=$!
  echo "  Started with PID: $MOCK_PID"

  if wait_for_port "$MOCK_PORT"; then
    echo -e "${GREEN}  ✓ Mock Server is ready at http://127.0.0.1:$MOCK_PORT${NC}"
    echo "  Logs: $SCRIPT_DIR/mock-server.log"
  else
    echo -e "${RED}  ✗ Mock Server failed to start. Check logs:${NC}"
    echo "    tail -n 50 $SCRIPT_DIR/mock-server.log"
    exit 1
  fi
}

# ──────────────────────────────────────────────
# Mode: mcp — Start MCP Server only (SSE mode)
# ──────────────────────────────────────────────

start_mcp() {
  echo -e "${CYAN}[MCP Server]${NC} Building and starting on port $MCP_PORT (SSE)..."

  # Verify .env exists and has a real token
  if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}  ✗ $ENV_FILE not found. Cannot start MCP Server.${NC}"
    exit 1
  fi

  TOKEN=$(load_token_from_env)
  if [ -z "$TOKEN" ] || [ "$TOKEN" = "test-token-12345" ]; then
    echo -e "${YELLOW}  ⚠ Warning: CSP_API_TOKEN in .env looks like a placeholder.${NC}"
    echo "    Make sure it contains a real JWT from CSP-Jwt-token.json."
  fi

  if check_port "$MCP_PORT"; then
    echo -e "${YELLOW}  Port $MCP_PORT already in use. Killing existing process...${NC}"
    kill_port "$MCP_PORT"
  fi

  # Build
  echo "  Building TypeScript..."
  cd "$SOURCE_DIR"
  npm run build > /dev/null 2>&1
  echo -e "${GREEN}  ✓ Build succeeded.${NC}"

  # Start
  nohup npm start > "$SCRIPT_DIR/mcp-server.log" 2>&1 &
  MCP_PID=$!
  echo "  Started with PID: $MCP_PID"

  # Health check
  local attempt=0
  local healthy=false
  while [ $attempt -lt 20 ]; do
    sleep 0.5
    if curl -s "http://localhost:$MCP_PORT/health" > /dev/null 2>&1; then
      healthy=true
      break
    fi
    attempt=$((attempt + 1))
  done

  if $healthy; then
    echo -e "${GREEN}  ✓ MCP Server is ready at http://localhost:$MCP_PORT${NC}"
    echo "  Logs: $SCRIPT_DIR/mcp-server.log"
    echo ""
    echo "  Useful endpoints:"
    echo "    curl http://localhost:$MCP_PORT/health"
    echo "    curl http://localhost:$MCP_PORT/sse  (SSE stream)"
  else
    echo -e "${RED}  ✗ MCP Server failed to start or health check timed out.${NC}"
    echo "    tail -n 50 $SCRIPT_DIR/mcp-server.log"
    kill $MCP_PID 2>/dev/null || true
    exit 1
  fi
}

# ──────────────────────────────────────────────
# Mode: kill — Kill all related processes
# ──────────────────────────────────────────────

kill_all() {
  echo -e "${CYAN}[Kill]${NC} Stopping all Mock/MCP server processes..."

  kill_port "$MOCK_PORT"
  kill_port "$MCP_PORT"

  # Also kill by process name in case port detection misses them
  pkill -f "mock-csp-resource-server.js" 2>/dev/null && echo "  Killed mock-csp-resource-server.js" || true
  pkill -f "csp-ai-agent-mcp" 2>/dev/null && echo "  Killed csp-ai-agent-mcp" || true

  echo -e "${GREEN}  ✓ Done.${NC}"
}

# ──────────────────────────────────────────────
# Mode: reload — Hot-reload resources in Mock Server
# ──────────────────────────────────────────────

reload_resources() {
  echo -e "${CYAN}[Reload]${NC} Hot-reloading AI-Resources into Mock Server..."

  if ! check_port "$MOCK_PORT"; then
    echo -e "${RED}  ✗ Mock Server is not running on port $MOCK_PORT.${NC}"
    echo "    Start it first: ./quick-start.sh mock"
    exit 1
  fi

  RESULT=$(curl -s -X POST "http://127.0.0.1:$MOCK_PORT/admin/reload-resources")
  echo "  Response: $RESULT"

  BEFORE=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['before'])" 2>/dev/null || echo "?")
  AFTER=$(echo  "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['after'])"  2>/dev/null || echo "?")

  if [ "$AFTER" != "?" ]; then
    echo -e "${GREEN}  ✓ Resources reloaded: $BEFORE → $AFTER${NC}"
  else
    echo -e "${RED}  ✗ Reload failed. Is the Mock Server running?${NC}"
    exit 1
  fi
}

# ──────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────

MODE="${1:-help}"

print_header

case $MODE in
  mock)
    start_mock
    ;;

  mcp)
    # MCP Server needs Mock Server running to talk to CSP API
    if ! check_port "$MOCK_PORT"; then
      echo -e "${YELLOW}Mock Server is not running. Starting it first...${NC}"
      start_mock
      echo ""
    fi
    start_mcp
    ;;

  all)
    start_mock
    echo ""
    start_mcp
    ;;

  kill)
    kill_all
    ;;

  reload)
    reload_resources
    ;;

  status)
    echo "Service status:"
    if check_port "$MOCK_PORT"; then
      echo -e "  Mock Server (port $MOCK_PORT): ${GREEN}RUNNING${NC}"
    else
      echo -e "  Mock Server (port $MOCK_PORT): ${RED}STOPPED${NC}"
    fi
    if check_port "$MCP_PORT"; then
      echo -e "  MCP Server  (port $MCP_PORT):  ${GREEN}RUNNING${NC}"
    else
      echo -e "  MCP Server  (port $MCP_PORT):  ${RED}STOPPED${NC}"
    fi
    ;;

  *)
    echo "Usage: $0 <mode>"
    echo ""
    echo "Modes:"
    echo "  mock     Start Mock Server only          (port $MOCK_PORT)"
    echo "  mcp      Start MCP Server only           (port $MCP_PORT, SSE)"
    echo "           (also starts Mock Server if not running)"
    echo "  all      Start Mock Server + MCP Server"
    echo "  kill     Kill all Mock/MCP server processes"
    echo "  reload   Hot-reload AI-Resources into running Mock Server"
    echo "  status   Show running status of both servers"
    echo ""
    echo "Examples:"
    echo "  $0 all              # Start everything"
    echo "  $0 mock             # Mock Server only for curl testing"
    echo "  $0 kill             # Clean up before manual testing"
    echo "  $0 reload           # Pick up newly added resources without restart"
    echo "  MOCK_RESOURCE_PORT=8080 $0 mock  # Custom port"
    echo ""
    ;;
esac

echo ""
