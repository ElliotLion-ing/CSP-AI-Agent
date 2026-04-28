#!/bin/bash

################################################################################
# Design Document Compliance Check Script
# 
# This script checks if the codebase complies with design documents:
# 1. Core Architecture Design (CSP-AI-Agent-Core-Design.md)
# 2. MultiThread Architecture (CSP-AI-Agent-MultiThread-Architecture.md)
# 3. Logging Design (CSP-AI-Agent-Logging-Design.md)
# 4. API Mapping (CSP-AI-Agent-API-Mapping.md)
#
# Usage: ./check-design-compliance.sh
# Output: Docs/Compliance-Check-YYYY-MM-DD.md
################################################################################

set -e

# Resolve the project root relative to this script so the check works regardless
# of the user's checkout location. Override with PROJECT_ROOT=... if needed.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$PROJECT_ROOT"

REPORT_FILE="Docs/Compliance-Check-$(date +%Y-%m-%d).md"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
VERSION=$(grep '"version"' SourceCode/package.json | head -1 | cut -d'"' -f4)

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Score tracking
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

echo "🔍 开始设计文档符合性自检..."
echo "   项目根目录: $PROJECT_ROOT"
echo "   代码版本: $VERSION"
echo "   报告文件: $REPORT_FILE"
echo ""

################################################################################
# Initialize Report
################################################################################

cat > "$REPORT_FILE" << EOF
# 设计文档符合性检查报告

**日期**: $TIMESTAMP  
**检查者**: AI Agent  
**代码版本**: $VERSION

---

## 📊 检查摘要

| 检查项 | 状态 | 通过 | 警告 | 失败 |
|--------|------|------|------|------|
EOF

################################################################################
# 1. Core Architecture Design Check
################################################################################

echo "1️⃣ 核心架构设计检查..."
echo "   参考文档: Docs/CSP-AI-Agent-Core-Design.md"

CORE_PASSED=0
CORE_FAILED=0
CORE_WARNINGS=0

{
  echo ""
  echo "## 1. 核心架构设计检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-Core-Design.md\`"
  echo ""
  echo "### 检查项"
  echo ""
} >> "$REPORT_FILE"

# Check 1.1: Module structure
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -d "SourceCode/src/config" ] && \
   [ -d "SourceCode/src/utils" ] && \
   [ -d "SourceCode/src/tools" ] && \
   [ -d "SourceCode/src/api" ] && \
   [ -d "SourceCode/src/git" ] && \
   [ -d "SourceCode/src/filesystem" ]; then
  echo -e "   ${GREEN}✅ 模块结构完整${NC}"
  echo "✅ **通过**: 核心模块结构完整（config, utils, tools, api, git, filesystem）" >> "$REPORT_FILE"
  CORE_PASSED=$((CORE_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${RED}❌ 模块结构不完整${NC}"
  echo "❌ **失败**: 核心模块结构不完整，缺少必需模块" >> "$REPORT_FILE"
  CORE_FAILED=$((CORE_FAILED + 1))
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 1.2: Type definitions
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -f "SourceCode/src/types/errors.ts" ] && \
   [ -f "SourceCode/src/types/tools.ts" ]; then
  echo -e "   ${GREEN}✅ 类型定义文件存在${NC}"
  echo "✅ **通过**: 核心类型定义文件存在（errors.ts, tools.ts）" >> "$REPORT_FILE"
  CORE_PASSED=$((CORE_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${YELLOW}⚠️ 类型定义文件缺失${NC}"
  echo "⚠️ **警告**: 类型定义文件缺失或位置不正确" >> "$REPORT_FILE"
  CORE_WARNINGS=$((CORE_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 1.3: Direct filesystem access (should use filesystemManager)
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
DIRECT_FS_COUNT=$(grep -r "fs\.\(readFile\|writeFile\|mkdir\|rmdir\|unlink\)" SourceCode/src/tools/ 2>/dev/null | wc -l | xargs)
if [ -z "$DIRECT_FS_COUNT" ] || [ "$DIRECT_FS_COUNT" -eq 0 ]; then
  echo -e "   ${GREEN}✅ 工具模块无直接文件系统操作${NC}"
  echo "✅ **通过**: 工具模块未直接调用 fs 模块，使用 filesystemManager" >> "$REPORT_FILE"
  CORE_PASSED=$((CORE_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${YELLOW}⚠️ 发现 $DIRECT_FS_COUNT 处直接文件系统操作${NC}"
  echo "⚠️ **警告**: 工具模块中发现 $DIRECT_FS_COUNT 处直接文件系统操作" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "建议使用 \`filesystemManager\` 代替直接 fs 调用：" >> "$REPORT_FILE"
  echo "\`\`\`" >> "$REPORT_FILE"
  grep -rn "fs\.\(readFile\|writeFile\|mkdir\|rmdir\|unlink\)" SourceCode/src/tools/ 2>/dev/null | head -5 >> "$REPORT_FILE"
  echo "\`\`\`" >> "$REPORT_FILE"
  CORE_WARNINGS=$((CORE_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

################################################################################
# 2. MultiThread Architecture Check
################################################################################

echo ""
echo "2️⃣ 多线程架构检查..."
echo "   参考文档: Docs/CSP-AI-Agent-MultiThread-Architecture.md"

THREAD_PASSED=0
THREAD_FAILED=0
THREAD_WARNINGS=0

{
  echo "## 2. 多线程架构检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-MultiThread-Architecture.md\`"
  echo ""
  echo "### 检查项"
  echo ""
} >> "$REPORT_FILE"

# Check 2.1: Async/Await usage
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
ASYNC_COUNT=$(grep -r "async function" SourceCode/src/ 2>/dev/null | wc -l | xargs)
AWAIT_COUNT=$(grep -r "await " SourceCode/src/ 2>/dev/null | wc -l | xargs)
if [ "$ASYNC_COUNT" -gt 50 ] && [ "$AWAIT_COUNT" -gt 100 ]; then
  echo -e "   ${GREEN}✅ 广泛使用异步模式${NC} (async: $ASYNC_COUNT, await: $AWAIT_COUNT)"
  echo "✅ **通过**: 广泛使用异步模式（async: $ASYNC_COUNT, await: $AWAIT_COUNT）" >> "$REPORT_FILE"
  THREAD_PASSED=$((THREAD_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${YELLOW}⚠️ 异步模式使用较少${NC} (async: $ASYNC_COUNT, await: $AWAIT_COUNT)"
  echo "⚠️ **警告**: 异步模式使用较少（async: $ASYNC_COUNT, await: $AWAIT_COUNT），建议增加异步处理" >> "$REPORT_FILE"
  THREAD_WARNINGS=$((THREAD_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 2.2: Synchronous blocking calls
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
SYNC_COUNT=$(grep -r "\.sync(" SourceCode/src/ 2>/dev/null | wc -l | xargs)
if [ -z "$SYNC_COUNT" ] || [ "$SYNC_COUNT" -eq 0 ]; then
  echo -e "   ${GREEN}✅ 无同步阻塞调用${NC}"
  echo "✅ **通过**: 未发现同步阻塞调用（.sync()）" >> "$REPORT_FILE"
  THREAD_PASSED=$((THREAD_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${RED}❌ 发现 $SYNC_COUNT 处同步阻塞调用${NC}"
  echo "❌ **失败**: 发现 $SYNC_COUNT 处同步阻塞调用" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "同步调用位置：" >> "$REPORT_FILE"
  echo "\`\`\`" >> "$REPORT_FILE"
  grep -rn "\.sync(" SourceCode/src/ 2>/dev/null | head -5 >> "$REPORT_FILE"
  echo "\`\`\`" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "**建议**: 将同步调用改为异步（使用 async/await）" >> "$REPORT_FILE"
  THREAD_FAILED=$((THREAD_FAILED + 1))
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 2.3: HTTP Server concurrency
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if grep -q "fastify" SourceCode/src/server/http.ts 2>/dev/null || \
   grep -q "express" SourceCode/src/server/http.ts 2>/dev/null; then
  echo -e "   ${GREEN}✅ HTTP Server 支持并发${NC}"
  echo "✅ **通过**: HTTP Server 使用 Fastify/Express，支持并发请求" >> "$REPORT_FILE"
  THREAD_PASSED=$((THREAD_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${YELLOW}⚠️ HTTP Server 实现不明确${NC}"
  echo "⚠️ **警告**: 未检测到 Fastify 或 Express，请确认 HTTP Server 实现" >> "$REPORT_FILE"
  THREAD_WARNINGS=$((THREAD_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

################################################################################
# 3. Logging Design Check
################################################################################

echo ""
echo "3️⃣ 日志规范检查..."
echo "   参考文档: Docs/CSP-AI-Agent-Logging-Design.md"

LOG_PASSED=0
LOG_FAILED=0
LOG_WARNINGS=0

{
  echo "## 3. 日志规范检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-Logging-Design.md\`"
  echo ""
  echo "### 检查项"
  echo ""
} >> "$REPORT_FILE"

# Check 3.1: Use of pino logger
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
PINO_IMPORT_COUNT=$(grep -r "from.*logger\|import.*logger" SourceCode/src/ 2>/dev/null | wc -l | xargs)
LOGGER_USAGE=$(grep -r "logger\.\(debug\|info\|warn\|error\)" SourceCode/src/ 2>/dev/null | wc -l | xargs)
if [ "$PINO_IMPORT_COUNT" -gt 10 ] && [ "$LOGGER_USAGE" -gt 50 ]; then
  echo -e "   ${GREEN}✅ 使用结构化日志（pino）${NC} (使用次数: $LOGGER_USAGE)"
  echo "✅ **通过**: 广泛使用 pino 结构化日志（使用次数: $LOGGER_USAGE）" >> "$REPORT_FILE"
  LOG_PASSED=$((LOG_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${YELLOW}⚠️ 日志使用不够广泛${NC} (使用次数: $LOGGER_USAGE)"
  echo "⚠️ **警告**: pino logger 使用不够广泛（使用次数: $LOGGER_USAGE）" >> "$REPORT_FILE"
  LOG_WARNINGS=$((LOG_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 3.2: console.log usage (anti-pattern)
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
CONSOLE_COUNT=$(grep -r "console\.\(log\|error\|warn\|debug\)" SourceCode/src/ 2>/dev/null | wc -l | xargs)
if [ -z "$CONSOLE_COUNT" ] || [ "$CONSOLE_COUNT" -eq 0 ]; then
  echo -e "   ${GREEN}✅ 无 console.log${NC}"
  echo "✅ **通过**: 未使用 console.log（符合日志规范）" >> "$REPORT_FILE"
  LOG_PASSED=$((LOG_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${RED}❌ 发现 $CONSOLE_COUNT 处 console.log${NC}"
  echo "❌ **失败**: 发现 $CONSOLE_COUNT 处 console.log，违反日志规范" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "console.log 位置：" >> "$REPORT_FILE"
  echo "\`\`\`" >> "$REPORT_FILE"
  grep -rn "console\.\(log\|error\|warn\|debug\)" SourceCode/src/ 2>/dev/null | head -10 >> "$REPORT_FILE"
  echo "\`\`\`" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "**建议**: 将 console.log 替换为 logger.info/debug/warn/error" >> "$REPORT_FILE"
  LOG_FAILED=$((LOG_FAILED + 1))
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 3.3: Structured logging with context
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
STRUCTURED_LOG_COUNT=$(grep -r "logger\.\(info\|error\|warn\)" SourceCode/src/ 2>/dev/null | grep -c "{" | xargs)
if [ "$STRUCTURED_LOG_COUNT" -gt 30 ]; then
  echo -e "   ${GREEN}✅ 使用结构化日志上下文${NC} (结构化日志: $STRUCTURED_LOG_COUNT)"
  echo "✅ **通过**: 日志包含结构化上下文（结构化日志数: $STRUCTURED_LOG_COUNT）" >> "$REPORT_FILE"
  LOG_PASSED=$((LOG_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${YELLOW}⚠️ 结构化日志较少${NC} (结构化日志: $STRUCTURED_LOG_COUNT)"
  echo "⚠️ **警告**: 结构化日志较少（$STRUCTURED_LOG_COUNT），建议增加上下文字段（type, userId, operation）" >> "$REPORT_FILE"
  LOG_WARNINGS=$((LOG_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 3.4: Tool call logging (logToolCall)
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
TOOL_CALL_LOG_COUNT=$(grep -r "logToolCall" SourceCode/src/tools/ 2>/dev/null | wc -l | xargs)
if [ -z "$TOOL_CALL_LOG_COUNT" ] || [ "$TOOL_CALL_LOG_COUNT" -eq 0 ]; then
  echo -e "   ${YELLOW}⚠️ 未使用 logToolCall${NC}"
  echo "⚠️ **警告**: 工具模块未使用 logToolCall 记录工具调用" >> "$REPORT_FILE"
  LOG_WARNINGS=$((LOG_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
else
  echo -e "   ${GREEN}✅ 使用 logToolCall 记录工具调用${NC} (使用次数: $TOOL_CALL_LOG_COUNT)"
  echo "✅ **通过**: 使用 logToolCall 记录工具调用（使用次数: $TOOL_CALL_LOG_COUNT）" >> "$REPORT_FILE"
  LOG_PASSED=$((LOG_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

################################################################################
# 4. API Mapping Check
################################################################################

echo ""
echo "4️⃣ API 使用符合性检查..."
echo "   参考文档: Docs/CSP-AI-Agent-API-Mapping.md"

API_PASSED=0
API_FAILED=0
API_WARNINGS=0

{
  echo "## 4. API 使用符合性检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-API-Mapping.md\`"
  echo ""
  echo "### 检查项"
  echo ""
} >> "$REPORT_FILE"

# Check 4.1: API client implementation
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -f "SourceCode/src/api/client.ts" ]; then
  API_COUNT=$(grep -c "async \(get\|post\|put\|delete\)" SourceCode/src/api/client.ts 2>/dev/null | xargs)
  echo -e "   ${GREEN}✅ API Client 已实现${NC} (API 方法数: $API_COUNT)"
  echo "✅ **通过**: API Client 已实现（api/client.ts），方法数: $API_COUNT" >> "$REPORT_FILE"
  API_PASSED=$((API_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${RED}❌ API Client 不存在${NC}"
  echo "❌ **失败**: API Client 文件不存在（api/client.ts）" >> "$REPORT_FILE"
  API_FAILED=$((API_FAILED + 1))
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

# Check 4.2: API path comparison (manual check needed)
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
{
  echo "### 4.2 API 端点路径对比"
  echo ""
  echo "⚠️ **提示**: 此项需要手动对比 API 端点与文档一致性"
  echo ""
  echo "#### 文档定义的 API 端点"
  echo ""
  echo "\`\`\`"
  grep "URL.*:" Docs/CSP-AI-Agent-API-Mapping.md 2>/dev/null | head -15
  echo "\`\`\`"
  echo ""
  echo "#### 实际实现的 API 调用"
  echo ""
  echo "\`\`\`"
  grep -n "/resources/\|/subscriptions/\|/user/" SourceCode/src/api/client.ts 2>/dev/null | head -15
  echo "\`\`\`"
  echo ""
  echo "**建议**: 请手动核对上述 API 路径是否与文档一致"
  echo ""
} >> "$REPORT_FILE"
echo -e "   ${YELLOW}⚠️ 需要手动对比 API 端点${NC}"
API_WARNINGS=$((API_WARNINGS + 1))
WARNING_CHECKS=$((WARNING_CHECKS + 1))

# Check 4.3: Authentication implementation
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
AUTH_COUNT=$(grep -r "Authorization.*Bearer" SourceCode/src/ 2>/dev/null | wc -l | xargs)
if [ "$AUTH_COUNT" -gt 3 ]; then
  echo -e "   ${GREEN}✅ 认证实现正确${NC} (Bearer Token 使用次数: $AUTH_COUNT)"
  echo "✅ **通过**: 使用 Bearer Token 认证（使用次数: $AUTH_COUNT）" >> "$REPORT_FILE"
  API_PASSED=$((API_PASSED + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  echo -e "   ${YELLOW}⚠️ Bearer Token 使用较少${NC} (使用次数: $AUTH_COUNT)"
  echo "⚠️ **警告**: Bearer Token 使用较少（$AUTH_COUNT），请确认认证实现" >> "$REPORT_FILE"
  API_WARNINGS=$((API_WARNINGS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi
echo "" >> "$REPORT_FILE"

################################################################################
# Calculate Compliance Score
################################################################################

COMPLIANCE_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED_CHECKS / $TOTAL_CHECKS) * 100}")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 自检完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "总检查项: $TOTAL_CHECKS"
echo -e "${GREEN}✅ 通过: $PASSED_CHECKS${NC}"
echo -e "${YELLOW}⚠️ 警告: $WARNING_CHECKS${NC}"
echo -e "${RED}❌ 失败: $FAILED_CHECKS${NC}"
echo ""
echo -e "符合度: ${BLUE}${COMPLIANCE_RATE}%${NC}"
echo ""

# Compare compliance rate with threshold (90.0)
if awk "BEGIN {exit !($COMPLIANCE_RATE >= 90.0)}"; then
  echo -e "${GREEN}✅ 符合度达标（>= 90%），可以继续后续流程${NC}"
  STATUS_EMOJI="✅"
  STATUS_TEXT="达标"
else
  echo -e "${RED}⚠️ 符合度不达标（< 90%），需要修复问题后重新检查${NC}"
  STATUS_EMOJI="⚠️"
  STATUS_TEXT="需要改进"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

################################################################################
# Generate Summary Table
################################################################################

# Insert summary table at the beginning
# Use a temp file to avoid in-place editing issues
TMP_REPORT="${REPORT_FILE}.tmp"
head -7 "$REPORT_FILE" > "$TMP_REPORT"

cat >> "$TMP_REPORT" << EOF
| 核心架构设计 | $(if [ "$CORE_FAILED" -eq 0 ]; then echo "✅"; else echo "⚠️"; fi) | $CORE_PASSED | $CORE_WARNINGS | $CORE_FAILED |
| 多线程架构 | $(if [ "$THREAD_FAILED" -eq 0 ]; then echo "✅"; else echo "⚠️"; fi) | $THREAD_PASSED | $THREAD_WARNINGS | $THREAD_FAILED |
| 日志规范 | $(if [ "$LOG_FAILED" -eq 0 ]; then echo "✅"; else echo "⚠️"; fi) | $LOG_PASSED | $LOG_WARNINGS | $LOG_FAILED |
| API 使用 | $(if [ "$API_FAILED" -eq 0 ]; then echo "✅"; else echo "⚠️"; fi) | $API_PASSED | $API_WARNINGS | $API_FAILED |

**总计**: $TOTAL_CHECKS 项检查，通过 $PASSED_CHECKS 项，警告 $WARNING_CHECKS 项，失败 $FAILED_CHECKS 项

**符合度**: **${COMPLIANCE_RATE}%**

**状态**: $STATUS_EMOJI **$STATUS_TEXT**

EOF

tail -n +8 "$REPORT_FILE" >> "$TMP_REPORT"
mv "$TMP_REPORT" "$REPORT_FILE"

################################################################################
# Add Recommendations
################################################################################

{
  echo "---"
  echo ""
  echo "## 📋 改进建议"
  echo ""
  
  if [ "$FAILED_CHECKS" -gt 0 ]; then
    echo "### 🔴 高优先级（必须修复）"
    echo ""
    if [ "$CORE_FAILED" -gt 0 ]; then
      echo "- **核心架构**: 修复模块结构或依赖问题"
    fi
    if [ "$THREAD_FAILED" -gt 0 ]; then
      echo "- **多线程架构**: 消除同步阻塞调用，改用 async/await"
    fi
    if [ "$LOG_FAILED" -gt 0 ]; then
      echo "- **日志规范**: 将所有 console.log 替换为 logger"
    fi
    if [ "$API_FAILED" -gt 0 ]; then
      echo "- **API 使用**: 补充缺失的 API Client 实现"
    fi
    echo ""
  fi
  
  if [ "$WARNING_CHECKS" -gt 0 ]; then
    echo "### 🟡 中优先级（建议改进）"
    echo ""
    echo "- 增加结构化日志的使用（包含 type, userId, operation 字段）"
    echo "- 使用 \`filesystemManager\` 代替直接 fs 调用"
    echo "- 增加 \`logToolCall\` 记录工具调用"
    echo "- 手动对比 API 端点与文档一致性"
    echo ""
  fi
  
  echo "---"
  echo ""
  echo "## 🎯 总体评价"
  echo ""
  echo "符合度: **${COMPLIANCE_RATE}%**"
  echo ""
  if [ "$COMPLIANCE_RATE" -ge 90 ]; then
    echo "状态: **✅ 达标** - 代码实现符合设计文档规范，可以继续后续流程（归档、提交、发布）"
  else
    echo "状态: **⚠️ 需要改进** - 请修复高优先级问题并重新执行自检，达到 90% 符合度后再继续"
  fi
  echo ""
  echo "---"
  echo ""
  echo "**报告生成时间**: $TIMESTAMP"
  echo ""
  echo "**生成工具**: Test/check-design-compliance.sh"
} >> "$REPORT_FILE"

################################################################################
# Output Report Location
################################################################################

echo "📄 完整报告已生成："
echo "   $REPORT_FILE"
echo ""
echo "使用以下命令查看报告："
echo "   cat \"$REPORT_FILE\""
echo ""

# Exit with appropriate code
if awk "BEGIN {exit !($COMPLIANCE_RATE >= 90.0)}"; then
  exit 0
else
  exit 1
fi
