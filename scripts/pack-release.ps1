# Distribution Packaging Script for Matcap Maker
# Automatically builds and packages:
# 1. Windows Installer + usage.html + LICENCE folder -> dist-release/MatcapMaker_v<version>.zip
# 2. Web Single-file HTML + usage.html + LICENCE folder -> dist-release/MatcapMaker_forWeb_v<version>.zip

param(
    [switch]$SkipBuild,       # Skip all build commands and package existing artifacts only
    [switch]$SkipWeb,         # Skip Web edition build and packaging
    [switch]$SkipDesktop      # Skip Desktop (Windows) build and packaging
)

$ErrorActionPreference = "Stop"

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $rootDir

try {
    # Helper to run a build step and abort on failure
    function Invoke-Step {
        param(
            [string]$Description,
            [scriptblock]$Command
        )
        Write-Host "`n>>> $Description..." -ForegroundColor Cyan
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        & $Command
        if ($LASTEXITCODE -ne 0) {
            throw "Failed: $Description (Exit Code: $LASTEXITCODE)"
        }
        $sw.Stop()
        Write-Host " [OK] $Description completed in $([math]::Round($sw.Elapsed.TotalSeconds, 1))s" -ForegroundColor Green
    }

    # -----------------------------------------------------------------------------
    # 0. Version & Environment Verification
    # -----------------------------------------------------------------------------
    # version.json is the single source of truth for the app version
    $verPath = Join-Path $rootDir "version.json"
    if (-not (Test-Path $verPath)) {
        throw "version.json not found at $verPath"
    }
    $version = (Get-Content $verPath -Raw | ConvertFrom-Json).version

    Invoke-Step "Verifying version.json" {
        node (Join-Path $rootDir "scripts\check-version.mjs")
    }

    Write-Host "`nStarting release build and packaging for Matcap Maker v$version" -ForegroundColor Magenta

    # -----------------------------------------------------------------------------
    # 1. Build Phase
    # -----------------------------------------------------------------------------
    if (-not $SkipBuild) {
        # Update third-party license notices
        Invoke-Step "Generating updated license notices" {
            pnpm run licenses
        }

        # Build Web Edition (Single-file HTML)
        if (-not $SkipWeb) {
            Invoke-Step "Building Web Edition (Single-file HTML)" {
                pnpm run build:single
            }
        }

        # Build Windows Desktop Edition (Tauri + NSIS Installer)
        if (-not $SkipDesktop) {
            $nsisDir = Join-Path $rootDir "src-tauri\target\release\bundle\nsis"
            if (Test-Path $nsisDir) {
                Remove-Item (Join-Path $nsisDir "*.exe") -Force -ErrorAction SilentlyContinue
            }

            Invoke-Step "Building Desktop Edition (Tauri NSIS Installer)" {
                pnpm tauri build
            }
        }
    } else {
        Write-Host "`nSkipping build steps (-SkipBuild specified)" -ForegroundColor Yellow
    }

    # -----------------------------------------------------------------------------
    # 2. Packaging Phase
    # -----------------------------------------------------------------------------
    $releaseDir = Join-Path $rootDir "dist-release"
    $winStage = Join-Path $releaseDir "staging-windows"
    $webStage = Join-Path $releaseDir "staging-web"

    # Ensure dist-release exists and clean staging folders
    if (Test-Path $releaseDir) {
        Remove-Item -Recurse -Force $winStage, $webStage -ErrorAction SilentlyContinue
    } else {
        New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    }
    New-Item -ItemType Directory -Path $winStage, $webStage -Force | Out-Null

    # 2.1 Package Windows Distribution
    if (-not $SkipDesktop) {
        Write-Host "`nPackaging Windows Distribution..." -ForegroundColor Cyan
        # match the version so a stale installer left by -SkipBuild is never packaged
        $installer = Get-ChildItem (Join-Path $rootDir "src-tauri\target\release\bundle\nsis\*_${version}_*-setup.exe") -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $installer) {
            throw "Windows installer for v$version not found in src-tauri/target/release/bundle/nsis."
        }

        Copy-Item $installer.FullName (Join-Path $winStage $installer.Name)
        Copy-Item (Join-Path $rootDir "USAGE\usage.html") (Join-Path $winStage "usage.html")
        Copy-Item -Recurse (Join-Path $rootDir "LICENCE") (Join-Path $winStage "LICENCE")

        $winZip = Join-Path $releaseDir "MatcapMaker_v$version.zip"
        if (Test-Path $winZip) { Remove-Item -Force $winZip }
        Compress-Archive -Path (Join-Path $winStage "*") -DestinationPath $winZip -Force
        Write-Host " [OK] Windows package created: $winZip" -ForegroundColor Green
    }

    # 2.2 Package Web Edition Distribution
    if (-not $SkipWeb) {
        Write-Host "`nPackaging Web Edition Distribution..." -ForegroundColor Cyan
        $webHtml = Join-Path $rootDir "dist-single\MatcapMaker.html"
        if (-not (Test-Path $webHtml)) {
            throw "Web edition HTML not found in dist-single/MatcapMaker.html."
        }

        Copy-Item $webHtml (Join-Path $webStage "MatcapMaker.html")
        Copy-Item (Join-Path $rootDir "USAGE\usage.html") (Join-Path $webStage "usage.html")
        Copy-Item -Recurse (Join-Path $rootDir "LICENCE") (Join-Path $webStage "LICENCE")

        $webZip = Join-Path $releaseDir "MatcapMaker_forWeb_v$version.zip"
        if (Test-Path $webZip) { Remove-Item -Force $webZip }
        Compress-Archive -Path (Join-Path $webStage "*") -DestinationPath $webZip -Force
        Write-Host " [OK] Web package created: $webZip" -ForegroundColor Green
    }

    # Clean up staging directories
    Remove-Item -Recurse -Force $winStage, $webStage -ErrorAction SilentlyContinue

    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " All release packages created successfully in dist-release!" -ForegroundColor Green
    Write-Host "========================================================`n" -ForegroundColor Green
    Get-Item (Join-Path $releaseDir "*.zip") | Format-Table Name, @{Name="Size (MB)"; Expression={[math]::round($_.Length / 1MB, 2)}}, LastWriteTime
}
finally {
    Pop-Location
}
