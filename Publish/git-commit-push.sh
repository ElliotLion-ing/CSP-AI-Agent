#!/bin/bash
#
# git-commit-push.sh
# Commit and push project source code to: git@github.com:ElliotLion-ing/CSP-AI-Agent.git
#
# What gets committed:
#   ✅ SourceCode/    - MCP Server TypeScript source
#   ✅ Test/          - Test scripts and mock server
#   ✅ Docs/          - Design documents
#   ✅ Publish/       - Publish scripts (this file)
#   ✅ openspec/      - OpenSpec change proposals
#   ✅ AGENTS.md      - AI Agent rules
#   ✅ README.md      - Project readme
#   ✅ .cursor/       - Cursor workspace rules (root-level)
#
# What is EXCLUDED:
#   ❌ AI-Resources/  - AI resource files (managed by separate git repos)
#   ❌ */.cursor/     - Per-directory Cursor caches (not project code)
#   ❌ Logs/          - Runtime logs
#   ❌ SourceCode/.env         - Local secrets
#   ❌ SourceCode/node_modules/ - Dependencies
#   ❌ SourceCode/dist/         - Build output (generated)
#
# Usage:
#   ./git-commit-push.sh [commit_message] [branch]
#
# Examples:
#   ./git-commit-push.sh
#   ./git-commit-push.sh "feat: add auto-sync after subscribe"
#   ./git-commit-push.sh "fix: unsubscribe cleanup" "develop"
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_REMOTE="git@github.com:ElliotLion-ing/CSP-AI-Agent.git"
TARGET_REMOTE_HTTPS="https://github.com/ElliotLion-ing/CSP-AI-Agent"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

COMMIT_MSG="${1:-"chore: release new version"}"
BRANCH="${2:-main}"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Git Commit & Push — Project Source Code${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo -e "${CYAN}Project dir: ${PROJECT_DIR}${NC}"
echo -e "${CYAN}Target:      ${TARGET_REMOTE}${NC}"
echo -e "${CYAN}Branch:      ${BRANCH}${NC}"
echo ""

# ── 0. Must run from within the project directory ────────────
cd "$PROJECT_DIR"

# ── 1. Locate git root ───────────────────────────────────────
# NOTE: The git root may be the home directory (~/) because there is no
#       dedicated .git inside the project yet. This script handles BOTH
#       cases: dedicated project repo and home-level repo.
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")

if [ -z "$GIT_ROOT" ]; then
  echo -e "${RED}Error: Not inside any git repository.${NC}"
  echo "Please initialize a git repo first:"
  echo "  cd \"$PROJECT_DIR\""
  echo "  git init"
  echo "  git remote add origin $TARGET_REMOTE"
  exit 1
fi

echo -e "${BLUE}Git root: ${GREEN}${GIT_ROOT}${NC}"
echo ""

# ── 2. Check / set remote ────────────────────────────────────
echo -e "${BLUE}Checking remote configuration...${NC}"

CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")

if [ -z "$CURRENT_REMOTE" ]; then
  echo -e "${YELLOW}No remote 'origin' configured. Adding target remote...${NC}"
  git remote add origin "$TARGET_REMOTE"
  CURRENT_REMOTE="$TARGET_REMOTE"
  echo -e "${GREEN}  Remote 'origin' set to: $TARGET_REMOTE${NC}"
elif [[ "$CURRENT_REMOTE" != *"ElliotLion-ing/CSP-AI-Agent"* ]]; then
  echo -e "${RED}Error: Remote 'origin' does NOT point to the expected repository.${NC}"
  echo -e "   Expected (contains): ${GREEN}ElliotLion-ing/CSP-AI-Agent${NC}"
  echo -e "   Actual:              ${YELLOW}${CURRENT_REMOTE}${NC}"
  echo ""
  read -p "Update remote to $TARGET_REMOTE ? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git remote set-url origin "$TARGET_REMOTE"
    CURRENT_REMOTE="$TARGET_REMOTE"
    echo -e "${GREEN}  Remote updated.${NC}"
  else
    echo -e "${RED}Push cancelled.${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}  Remote: $CURRENT_REMOTE${NC}"
fi
echo ""

# ── 3. Ensure .gitignore excludes the right paths ────────────
echo -e "${BLUE}Verifying .gitignore rules in project...${NC}"

GITIGNORE="$PROJECT_DIR/.gitignore"

# Lines that must be present in the project-level .gitignore
declare -a REQUIRED_IGNORES=(
  "AI-Resources/"
  "Logs/"
  "SourceCode/.env"
  "SourceCode/node_modules/"
  "SourceCode/dist/"
  "Test/.cursor/"
)

GITIGNORE_UPDATED=false

for rule in "${REQUIRED_IGNORES[@]}"; do
  if [ ! -f "$GITIGNORE" ] || ! grep -qxF "$rule" "$GITIGNORE" 2>/dev/null; then
    echo "$rule" >> "$GITIGNORE"
    echo -e "${YELLOW}  Added to .gitignore: $rule${NC}"
    GITIGNORE_UPDATED=true
  fi
done

if ! $GITIGNORE_UPDATED; then
  echo -e "${GREEN}  .gitignore is up to date.${NC}"
fi
echo ""

# ── 4. Sensitive file check ───────────────────────────────────
echo -e "${BLUE}Checking for sensitive files...${NC}"
SENSITIVE=false

# Check files that are staged or new (relative to project dir)
while IFS= read -r line; do
  file="${line:3}"
  if [[ "$file" == *.env || "$file" == *.key || "$file" == *.pem || \
        "$file" == *credentials* || "$file" == *secret* ]]; then
    echo -e "${RED}  Warning: sensitive file detected: $file${NC}"
    SENSITIVE=true
  fi
done < <(git status --porcelain "$PROJECT_DIR" 2>/dev/null)

if $SENSITIVE; then
  read -p "Sensitive files detected. Continue? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Push cancelled.${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}  No sensitive files found.${NC}"
fi
echo ""

# ── 5. Show what will be staged ──────────────────────────────
echo -e "${BLUE}Files to be included in commit:${NC}"
echo "(Paths inside $PROJECT_DIR, excluding AI-Resources/ and */. cursor/)"
echo ""

# Collect the paths we care about (relative to project dir, not git root)
PROJECT_REL=""
if [ "$GIT_ROOT" != "$PROJECT_DIR" ]; then
  # git root is a parent (e.g. home dir). Compute relative path.
  PROJECT_REL=$(realpath --relative-to="$GIT_ROOT" "$PROJECT_DIR" 2>/dev/null \
    || python3 -c "import os; print(os.path.relpath('$PROJECT_DIR', '$GIT_ROOT'))")
fi

# Build the list of paths to add (scoped to project directory only)
ADD_PATHS=()
for item in AGENTS.md README.md .cursor .gitignore SourceCode Test Docs Publish openspec; do
  full_path="$PROJECT_DIR/$item"
  if [ -e "$full_path" ]; then
    if [ -n "$PROJECT_REL" ]; then
      ADD_PATHS+=("$PROJECT_REL/$item")
    else
      ADD_PATHS+=("$item")
    fi
  fi
done

git status --short "${ADD_PATHS[@]}" 2>/dev/null || git status --short
echo ""

# ── 6. Summary + confirm ──────────────────────────────────────
echo -e "${YELLOW}Commit message: \"${COMMIT_MSG}\"${NC}"
echo -e "${YELLOW}Target branch:  ${BRANCH}${NC}"
echo -e "${YELLOW}Remote:         ${CURRENT_REMOTE}${NC}"
echo ""
read -p "Proceed with commit and push? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}Push cancelled.${NC}"
  exit 1
fi
echo ""

# ── 7. Stage only project files ──────────────────────────────
echo -e "${BLUE}Staging files...${NC}"

if [ ${#ADD_PATHS[@]} -gt 0 ]; then
  git add "${ADD_PATHS[@]}"
else
  # fallback: stage everything inside project dir with exclusions
  git add "$PROJECT_DIR"
  git reset HEAD "$PROJECT_DIR/AI-Resources" 2>/dev/null || true
  git reset HEAD "$PROJECT_DIR/Logs" 2>/dev/null || true
  git reset HEAD "$PROJECT_DIR/Test/.cursor" 2>/dev/null || true
fi

echo -e "${GREEN}  Staged. Summary:${NC}"
git diff --cached --stat
echo ""

# ── 8. Commit ─────────────────────────────────────────────────
echo -e "${BLUE}Committing...${NC}"
git commit -m "$COMMIT_MSG"
COMMIT_HASH=$(git rev-parse --short HEAD)
echo -e "${GREEN}  Committed: ${COMMIT_HASH}${NC}"
echo ""

# ── 9. Push ───────────────────────────────────────────────────
echo -e "${BLUE}Pushing to origin/${BRANCH}...${NC}"
git push -u origin "$BRANCH"

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Git Push Successful!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}Commit:  ${GREEN}${COMMIT_HASH}${NC}"
echo -e "${BLUE}Message: ${GREEN}${COMMIT_MSG}${NC}"
echo -e "${BLUE}Branch:  ${GREEN}${BRANCH}${NC}"
echo -e "${BLUE}Remote:  ${GREEN}${CURRENT_REMOTE}${NC}"
echo -e "${BLUE}Time:    ${GREEN}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""

echo -e "${BLUE}View on GitHub:${NC}"
echo "  ${TARGET_REMOTE_HTTPS}/tree/${BRANCH}"
echo ""

echo -e "${GREEN}All done! Release process complete.${NC}"
echo ""
