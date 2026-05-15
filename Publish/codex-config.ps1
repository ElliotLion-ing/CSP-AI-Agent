param(
  [Parameter(Mandatory = $true)]
  [string]$UserToken,

  [string]$McpUrl = "https://zct-dev.zoomdev.us/csp-agent/mcp"
)

$Name = "csp-ai-agent"
$ConfigDir = Join-Path $HOME ".codex"
$ConfigFile = Join-Path $ConfigDir "config.toml"
$Auth = "Bearer $UserToken"

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

if (-not (Test-Path $ConfigFile)) {
  New-Item -ItemType File -Force -Path $ConfigFile | Out-Null
}

$BackupFile = "$ConfigFile.bak.$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item $ConfigFile $BackupFile -Force

$Content = Get-Content $ConfigFile -Raw
if ($null -eq $Content) {
  $Content = ""
}

$Section = @"
[mcp_servers.$Name]
url = "$McpUrl"
http_headers = { "Authorization" = "$Auth" }
enabled = true
"@

$EscapedName = [regex]::Escape($Name)
$Pattern = "(?ms)^\[mcp_servers\.$EscapedName\]\r?\n.*?(?=^\[|\z)"
$Content = [regex]::Replace($Content, $Pattern, "").TrimEnd()
$Content = $Content + "`r`n`r`n" + $Section + "`r`n"

Set-Content -Path $ConfigFile -Value $Content -Encoding UTF8

Write-Host "Installed $Name MCP config to $ConfigFile"
Write-Host "Please restart Codex."
