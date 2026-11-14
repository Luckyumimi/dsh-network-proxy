# 把本仓库以 link: 方式接入某个 DSH profile。
#
# 为什么需要它：
#   DSH profile 的 node_modules/<plugin> 由 pnpm 管理。若 profile 里对该插件保留
#   托管来源声明（github:... / 版本号），任何一次 pnpm install 或插件启停都会把
#   node_modules 里的副本重新拉成上游发布版，本地改动会被整体覆盖。
#   把依赖改成本仓库的本地路径（link:）后，改动才会稳定生效。
#
# 用法：
#   pwsh -File .\deploy-to-profile.ps1                 # 只改声明并显示结果，不安装
#   pwsh -File .\deploy-to-profile.ps1 -Install        # 改完顺手跑 pnpm install
#   pwsh -File .\deploy-to-profile.ps1 -Profile web    # 指定 profile 名（默认 web）

[CmdletBinding()]
param(
  [switch]$Install,
  [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

# 本脚本所在的仓库目录即插件源码目录。
$localSrc = $PSScriptRoot
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgPath = Join-Path $profileDir 'package.json'

if (-not (Test-Path -LiteralPath $pkgPath)) { throw "profile 清单不存在: $pkgPath" }

$raw = Get-Content -LiteralPath $pkgPath -Raw
if ($raw -match '"dsh-network-proxy"\s*:\s*"link:') {
  Write-Host '依赖已是 link: 声明，无需修改。' -ForegroundColor Yellow
} else {
  $backup = "$pkgPath.bak-before-network-proxy-link-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item -LiteralPath $pkgPath -Destination $backup
  Write-Host "已备份: $backup"

  $linkValue = 'link:' + ($localSrc -replace '\\', '/')
  $updated = $raw -replace '("dsh-network-proxy"\s*:\s*)"[^"]*"', ('$1"' + $linkValue + '"')
  if ($updated -eq $raw) {
    Write-Host '未找到 dsh-network-proxy 依赖行，请手动把它加到 dependencies：' -ForegroundColor Yellow
    Write-Host "  `"dsh-network-proxy`": `"$linkValue`""
  } else {
    Set-Content -LiteralPath $pkgPath -Value $updated -Encoding utf8 -NoNewline
    Write-Host "已改声明 -> $linkValue" -ForegroundColor Green
  }
}

Write-Host ''
Write-Host '当前依赖行:'
Select-String -LiteralPath $pkgPath -Pattern 'dsh-network-proxy' |
  ForEach-Object { "  $($_.LineNumber): $($_.Line.Trim())" }

Write-Host ''
Write-Host '依赖解析:'
$junction = Join-Path $localSrc 'node_modules'
if (Test-Path -LiteralPath $junction) {
  Write-Host "  已就绪 -> $((Get-Item $junction -Force).Target)" -ForegroundColor Green
} else {
  Write-Host '  尚未建立。本仓库自身没有 node_modules 时，peer 依赖按下面的方式解析：' -ForegroundColor Yellow
  Write-Host "    cmd /c mklink /J `"$junction`" `"$profileDir\node_modules`""
  Write-Host '  （或在该目录执行 npm install --omit=dev 自行安装 undici / schemastery）'
}

if ($Install) {
  Write-Host ''
  Write-Host '正在安装（会重写 node_modules）...' -ForegroundColor Cyan
  Push-Location $profileDir
  try {
    # 若本机需要代理访问 npm registry，取消下面两行注释并改成自己的地址。
    # $env:HTTP_PROXY = 'http://127.0.0.1:7890'
    # $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
    & pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败: exit $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  Write-Host ''
  Write-Host '安装结果核对:' -ForegroundColor Cyan
  $installed = Join-Path $profileDir 'node_modules\dsh-network-proxy'
  if (-not (Test-Path -LiteralPath $installed)) { throw "未安装到 $installed" }
  Get-ChildItem -LiteralPath $installed -File | Select-Object Name, Length | Format-Table -AutoSize
  (Get-Content -LiteralPath (Join-Path $installed 'package.json') -Raw | ConvertFrom-Json) |
    Select-Object name, version | Format-List
  $entry = Join-Path $installed 'index.js'
  if ((Get-Content -LiteralPath $entry -Raw) -match 'settingsNamespace') {
    Write-Host '  仍是 1.0.1（含已删除的 settingsNamespace）—— link 未生效' -ForegroundColor Red
  } else {
    Write-Host '  已是 2.x volatile Config 版本' -ForegroundColor Green
  }
  Write-Host ''
  Write-Host '重启 DSH 后，设置页「通用」里会出现可用的「网络代理」行。' -ForegroundColor Cyan
} else {
  Write-Host ''
  Write-Host '未安装。要生效请执行：' -ForegroundColor Yellow
  Write-Host "  pwsh -File `"$PSCommandPath`" -Install"
  Write-Host '或手动：'
  Write-Host "  cd `"$profileDir`"; pnpm install"
}
