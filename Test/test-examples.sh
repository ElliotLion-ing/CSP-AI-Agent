#!/bin/bash
# Quick test examples using curl and jq
# Usage: ./test-examples.sh

BASE_URL="http://127.0.0.1:6093"
TOKEN=$(jq -r '.["CSP-Jwt-token"]' "$(dirname "$0")/CSP-Jwt-token.json")

if [ -z "$TOKEN" ]; then
  echo "Error: Failed to load token from CSP-Jwt-token.json"
  exit 1
fi

echo "========================================="
echo " CSP Resource API Quick Tests"
echo "========================================="
echo "Base URL: $BASE_URL"
echo "Token: ${TOKEN:0:20}..."
echo "========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test 1: User Permissions (Auth test)
echo -e "${CYAN}[TEST 1]${NC} GET /csp/api/user/permissions"
curl -s -X GET "$BASE_URL/csp/api/user/permissions" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 2: Search resources
echo -e "${CYAN}[TEST 2]${NC} GET /csp/api/resources/search?keyword=debug"
curl -s -X GET "$BASE_URL/csp/api/resources/search?keyword=debug&detail=true" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 3: Get resource details
echo -e "${CYAN}[TEST 3]${NC} GET /csp/api/resources/zCodeReview-skill-001"
curl -s -X GET "$BASE_URL/csp/api/resources/zCodeReview-skill-001" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 4: Download resource
echo -e "${CYAN}[TEST 4]${NC} GET /csp/api/resources/download/zCodeReview-skill-001"
curl -s -X GET "$BASE_URL/csp/api/resources/download/zCodeReview-skill-001" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept-Encoding: gzip" \
  -D - | head -20
echo ""

# Test 5: Upload resource
echo -e "${CYAN}[TEST 5]${NC} POST /csp/api/resources/upload"
UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/csp/api/resources/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Test Command\n\nThis is a test command for demo purposes.",
    "type": "command",
    "name": "test-cmd-'$(date +%s)'"
  }')
echo "$UPLOAD_RESPONSE" | jq '.'
UPLOAD_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.data.upload_id')
echo ""

# Test 6: Finalize upload (if upload_id exists)
if [ -n "$UPLOAD_ID" ] && [ "$UPLOAD_ID" != "null" ]; then
  echo -e "${CYAN}[TEST 6]${NC} POST /csp/api/resources/finalize"
  curl -s -X POST "$BASE_URL/csp/api/resources/finalize" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "upload_id": "'"$UPLOAD_ID"'",
      "commit_message": "Add test command via curl"
    }' | jq '.'
  echo ""
else
  echo -e "${RED}[TEST 6]${NC} Skipped (no upload_id)"
  echo ""
fi

# Test 7: Add subscription
echo -e "${CYAN}[TEST 7]${NC} POST /csp/api/resources/subscriptions/add"
curl -s -X POST "$BASE_URL/csp/api/resources/subscriptions/add" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_ids": ["zCodeReview-skill-001"],
    "scope": "general"
  }' | jq '.'
echo ""

# Test 8: Get subscriptions
echo -e "${CYAN}[TEST 8]${NC} GET /csp/api/resources/subscriptions?detail=true"
curl -s -X GET "$BASE_URL/csp/api/resources/subscriptions?scope=all&detail=true" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 9: Remove subscription
echo -e "${CYAN}[TEST 9]${NC} DELETE /csp/api/resources/subscriptions/remove"
curl -s -X DELETE "$BASE_URL/csp/api/resources/subscriptions/remove" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_ids": ["zCodeReview-skill-001"]
  }' | jq '.'
echo ""

# Test 10: Invalid token (should fail with 401)
echo -e "${CYAN}[TEST 10]${NC} GET /csp/api/user/permissions (invalid token - should fail)"
curl -s -X GET "$BASE_URL/csp/api/user/permissions" \
  -H "Authorization: Bearer invalid_token_xyz" | jq '.'
echo ""

# Test 11: Resource not found (should fail with 404)
echo -e "${CYAN}[TEST 11]${NC} GET /csp/api/resources/nonexistent-id (should fail)"
curl -s -X GET "$BASE_URL/csp/api/resources/nonexistent-id-999" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

echo "========================================="
echo -e "${GREEN}All test examples completed!${NC}"
echo "========================================="
