#!/bin/bash
# Quick start script for Mock CSP Resource API Server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================="
echo " CSP Resource API - Quick Start"
echo "========================================="
echo ""

# Check if token file exists
if [ ! -f "CSP-Jwt-token.json" ]; then
  echo "Error: CSP-Jwt-token.json not found!"
  exit 1
fi

# Check if port is in use
PORT=${MOCK_RESOURCE_PORT:-6093}
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
  echo "Warning: Port $PORT is already in use."
  echo "Options:"
  echo "  1. Kill existing process: lsof -ti :$PORT | xargs kill"
  echo "  2. Use different port: MOCK_RESOURCE_PORT=8080 ./start-server.sh"
  exit 1
fi

# Start server
echo "Starting Mock CSP Resource API Server on port $PORT..."
echo ""
node mock-csp-resource-server.js
