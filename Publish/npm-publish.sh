#!/bin/bash
#
# npm-publish.sh
# Publish the SourceCode/ package to npm registry.
#
# Usage:
#   ./npm-publish.sh [tag]
#
# Arguments:
#   tag: npm dist-tag (default: latest)
#        Options: latest, beta, alpha, next
#
# Examples:
#   ./npm-publish.sh            # publish as latest
#   ./npm-publish.sh beta       # publish as beta
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$PROJECT_ROOT/SourceCode"
TEST_DIR="$PROJECT_ROOT/Test"
LOGS_DIR="$PROJECT_ROOT/Logs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TAG="${1:-latest}"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  npm Package Publish Script${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# ── 1. Verify SourceCode/ exists ──────────────────────────────
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo -e "${RED}Error: $SOURCE_DIR/package.json not found.${NC}"
  exit 1
fi

cd "$SOURCE_DIR"

PACKAGE_NAME=$(node -p "require('./package.json').name")
PACKAGE_VERSION=$(node -p "require('./package.json').version")

echo -e "${BLUE}Package Information:${NC}"
echo -e "   Name:    ${GREEN}${PACKAGE_NAME}${NC}"
echo -e "   Version: ${GREEN}${PACKAGE_VERSION}${NC}"
echo -e "   Tag:     ${GREEN}${TAG}${NC}"
echo ""

# ── 2. Confirm ────────────────────────────────────────────────
echo -e "${YELLOW}This will publish ${PACKAGE_NAME}@${PACKAGE_VERSION} to npm (tag: ${TAG}).${NC}"
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}Publish cancelled.${NC}"
  exit 1
fi
echo ""

# ── 3. Check npm auth ─────────────────────────────────────────
echo -e "${BLUE}Checking npm authentication...${NC}"
if ! npm whoami &>/dev/null; then
  echo -e "${RED}Error: Not logged in to npm. Please run: npm login${NC}"
  exit 1
fi
NPM_USER=$(npm whoami)
echo -e "${GREEN}Logged in as: ${NPM_USER}${NC}"
echo ""

# ── 4. Check for log errors ───────────────────────────────────
echo -e "${BLUE}Checking logs for errors...${NC}"
if [ -d "$LOGS_DIR" ] && ls "$LOGS_DIR"/*.log > /dev/null 2>&1; then
  ERROR_COUNT=$(grep -c '"level":50' "$LOGS_DIR"/*.log 2>/dev/null || true)
  FATAL_COUNT=$(grep -c '"level":60' "$LOGS_DIR"/*.log 2>/dev/null || true)
  ERROR_COUNT="${ERROR_COUNT:-0}"
  FATAL_COUNT="${FATAL_COUNT:-0}"

  if [ "$ERROR_COUNT" -gt 0 ] || [ "$FATAL_COUNT" -gt 0 ]; then
    echo -e "${RED}Found ${ERROR_COUNT} errors / ${FATAL_COUNT} fatal entries in logs.${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo -e "${RED}Publish cancelled.${NC}"
      exit 1
    fi
  else
    echo -e "${GREEN}No errors found in logs.${NC}"
  fi
else
  echo -e "${YELLOW}No log files found, skipping log check.${NC}"
fi
echo ""

# ── 5. Build ──────────────────────────────────────────────────
echo -e "${BLUE}Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}Build completed.${NC}"
echo ""

# ── 6. Dry-run pack preview ───────────────────────────────────
echo -e "${BLUE}Package contents preview (dry-run):${NC}"
npm pack --dry-run
echo ""

# ── 7. Publish ────────────────────────────────────────────────
echo -e "${BLUE}Publishing to npm...${NC}"
echo -e "${YELLOW}  npm publish --access public --tag ${TAG}${NC}"
echo ""

npm publish --access public --tag "${TAG}"

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  npm Publish Successful!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}Package: ${GREEN}${PACKAGE_NAME}@${PACKAGE_VERSION}${NC}"
echo -e "${BLUE}Tag:     ${GREEN}${TAG}${NC}"
echo -e "${BLUE}User:    ${GREEN}${NPM_USER}${NC}"
echo -e "${BLUE}Time:    ${GREEN}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""

# ── 8. Verify on registry ────────────────────────────────────
echo -e "${BLUE}Verifying published package on registry...${NC}"
sleep 3
npm view "${PACKAGE_NAME}@${PACKAGE_VERSION}" version 2>/dev/null \
  && echo -e "${GREEN}Verification successful.${NC}" \
  || echo -e "${YELLOW}Version not yet visible on registry — may take a moment to propagate.${NC}"
echo ""

echo -e "${YELLOW}Next step: run ${BLUE}./Publish/git-commit-push.sh${NC}"
echo ""
