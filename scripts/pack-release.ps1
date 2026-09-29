# Distribution Packaging Script for Matcap Maker
# Packages:
# 1. Windows Installer + usage.html (+ assets) + LICENCE folder -> dist-release/MatcapMaker_v<version>.zip
# 2. Web Single-file HTML + usage.html (+ assets) + LICENCE folder -> dist-release/MatcapMaker_forWeb_v<version>.zip

$ErrorActionPreference = "Stop"

# Retrieve version from package.json
$pkg = Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json
$version = $pkg.version

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseDir = Join-Path $rootDir "dist-release"
$winStage = Join-Path $releaseDir "staging-windows"
$webStage = Join-Path $releaseDir "staging-web"

Write-Host "Creating distribution packages for Matcap Maker v$version..." -ForegroundColor Cyan

# Ensure dist-release exists and clean temporary staging
if (Test-Path $releaseDir) {
    Remove-Item -Recurse -Force $winStage, $webStage -ErrorAction SilentlyContinue
} else {
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
}
New-Item -ItemType Directory -Path $winStage, $webStage -Force | Out-Null

# -----------------------------------------------------------------------------
# 1. Prepare Windows Distribution
# -----------------------------------------------------------------------------
$installer = Get-ChildItem (Join-Path $rootDir "src-tauri\target\release\bundle\nsis\*.exe") -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installer) {
    throw "Windows installer not found in src-tauri/target/release/bundle/nsis. Please run 'pnpm tauri build' first."
}

Copy-Item $installer.FullName (Join-Path $winStage $installer.Name)
Copy-Item (Join-Path $rootDir "USAGE\usage.html") (Join-Path $winStage "usage.html")
Copy-Item -Recurse (Join-Path $rootDir "LICENCE") (Join-Path $winStage "LICENCE")

$winZip = Join-Path $releaseDir "MatcapMaker_v$version.zip"
if (Test-Path $winZip) { Remove-Item -Force $winZip }
Compress-Archive -Path (Join-Path $winStage "*") -DestinationPath $winZip -Force
Write-Host " [OK] Windows package created: $winZip" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 2. Prepare Web Edition Distribution
# -----------------------------------------------------------------------------
$webHtml = Join-Path $rootDir "dist-single\MatcapMaker.html"
if (-not (Test-Path $webHtml)) {
    throw "Web edition HTML not found in dist-single/MatcapMaker.html. Please run 'pnpm build:single' first."
}

Copy-Item $webHtml (Join-Path $webStage "MatcapMaker.html")
Copy-Item (Join-Path $rootDir "USAGE\usage.html") (Join-Path $webStage "usage.html")
Copy-Item -Recurse (Join-Path $rootDir "LICENCE") (Join-Path $webStage "LICENCE")

$webZip = Join-Path $releaseDir "MatcapMaker_forWeb_v$version.zip"
if (Test-Path $webZip) { Remove-Item -Force $webZip }
Compress-Archive -Path (Join-Path $webStage "*") -DestinationPath $webZip -Force
Write-Host " [OK] Web package created: $webZip" -ForegroundColor Green

# -----------------------------------------------------------------------------
# Clean up staging directories
# -----------------------------------------------------------------------------
Remove-Item -Recurse -Force $winStage, $webStage -ErrorAction SilentlyContinue

Write-Host "`nAll release packages created successfully in $releaseDir`n" -ForegroundColor Cyan
Get-Item (Join-Path $releaseDir "*.zip") | Format-Table Name, @{Name="Size (MB)"; Expression={[math]::round($_.Length / 1MB, 2)}}, LastWriteTime
