# 世界树 · Windows 离线准备/启动
#
# 用法（PowerShell）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -NoStart
#
# 不要求管理员权限；默认使用系统 Node >= 18，
# 没有或版本太旧时解压包内 runtime\node-v22.14.0-win-x64.zip 到 .runtime\node。

param(
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$NodeDir = Join-Path $Root ".runtime\node"
$NodeExe = Join-Path $NodeDir "node.exe"
$NodeZip = Join-Path $Root "runtime\node-v22.14.0-win-x64.zip"

$needBundled = $true
$sysNode = Get-Command node -ErrorAction SilentlyContinue
if ($sysNode) {
  try {
    $major = [int](& node -p "process.versions.node.split('.')[0]")
    if ($major -ge 18) {
      $needBundled = $false
      Write-Host "Using system Node: $($sysNode.Source) (v$(node -v))"
    }
  } catch {}
}

if ($needBundled) {
  if (-not (Test-Path $NodeExe)) {
    if (-not (Test-Path $NodeZip)) {
      throw "Missing bundled Node: $NodeZip"
    }
    if (-not (Get-Command Expand-Archive -ErrorAction SilentlyContinue)) {
      throw "PowerShell Expand-Archive is unavailable. Extract $NodeZip manually to .runtime\node, or install Node 18+."
    }
    Write-Host "Extracting bundled Node 22.14.0 ..."
    $Tmp = Join-Path $Root ".runtime\node-tmp"
    if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
    Expand-Archive -Path $NodeZip -DestinationPath $Tmp -Force
    $inner = Get-ChildItem $Tmp -Directory | Select-Object -First 1
    if (-not $inner) { throw "Unexpected Node zip layout" }
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $NodeDir) | Out-Null
    Move-Item $inner.FullName $NodeDir
    Remove-Item $Tmp -Recurse -Force
  }
  if (-not (Test-Path $NodeExe)) { throw "Bundled Node extraction failed" }
  $env:PATH = "$NodeDir;$env:PATH"
  Write-Host "Using bundled Node: $(& $NodeExe -v)"
}

# 创建运行时目录；不覆盖 claims.jsonl
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root ".run") | Out-Null

if (-not $NoStart) {
  & (Join-Path $Root "start-windows.cmd")
}
