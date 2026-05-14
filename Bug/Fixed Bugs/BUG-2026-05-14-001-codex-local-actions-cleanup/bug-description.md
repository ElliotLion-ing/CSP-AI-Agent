# BUG-2026-05-14-001: Codex local actions and MCP cleanup regressions

- **发现时间**: 2026-05-14
- **来源**: Release Check 报告 `codex-release-check-report-2026-05-14-rerun-1738.md` 与日志 `app.2026-05-14.1.log`
- **现象 1**: `sync_resources(zoom-build)` 返回 Codex `write_file` local actions，但本地 `~/.csp-ai-agent/codex/skills/zoom-build` 未落地。
- **现象 2**: `sync_resources(acm)` 为 Codex 生成 `mcp_servers.acm-dev` 与 `mcp_servers.acm`，但 unsubscribe 只返回 `remove_toml_entry(acm)`，导致 `acm-dev` 残留。
- **影响范围**: Codex release check 的 C0-3/C3/C8/C9；Cursor 的多 server-name MCP cleanup 也存在同类残留风险。

## Reproduction

1. 部署 Codex profile MCP。
2. 运行 release check C3/C8，同步包含脚本文件的 skill。
3. 观察服务端日志中存在 `write_file` local actions，但若 setup prompt 执行不完整，本地 skill 文件不落地。
4. 运行 release check C9，对 `acm` 做 subscribe/sync/unsubscribe。
5. 观察 `mcp-config.json` 包含 `acm-dev` 和 `acm` 两个 server key，但卸载 action 只覆盖 `acm`。
