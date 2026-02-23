# @file install.ps1
# @description One-click installer for Adytum (Windows).

$ErrorActionPreference = "Stop"

# Colors
$Cyan = "Cyan"
$Green = "Green"
$Yellow = "Yellow"
$Red = "Red"

Write-Host "🚀 Initializing Adytum Setup..." -ForegroundColor $Cyan

# 1. Handle Remote Execution / Cloning
if (-not (Test-Path "package.json") -or -not (Select-String -Path "package.json" -Pattern '"name": "adytum"')) {
    if (Test-Path "adytum") {
        Write-Host "📂 Found 'adytum' directory. Entering..." -ForegroundColor $Yellow
        Set-Location adytum
    } else {
        Write-Host "📂 Cloning Adytum repository..." -ForegroundColor $Cyan
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            Write-Host "❌ Git is not installed. Please install git first." -ForegroundColor $Red
            exit 1
        }
        git clone https://github.com/dewminaudayashan/adytum.git
        Set-Location adytum
    }
}

# 2. Check for Node.js (>=22)
function Check-Node {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $version = node -v
        $major = [int]($version -replace 'v', '' -split '\.')[0]
        if ($major -ge 22) {
            return $true
        }
    }
    return $false
}

if (-not (Check-Node)) {
    Write-Host "⏳ Node.js >= 22 not found. Attempting automatic installation via winget..." -ForegroundColor $Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "📦 Using winget to install Node.js..." -ForegroundColor $Cyan
        winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
        # Refresh env
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        Write-Host "❌ winget not found. Please install Node.js manually: https://nodejs.org/" -ForegroundColor $Red
        exit 1
    }
}

if (-not (Check-Node)) {
    Write-Host "❌ Node.js installation failed or version still too low. Please restart your terminal and try again, or install Node.js 22+ manually." -ForegroundColor $Red
    exit 1
}

Write-Host "✅ Node.js $(node -v) detected." -ForegroundColor $Green

# 3. Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor $Cyan
npm install

# 4. Build everything
Write-Host "🛠️ Building Adytum ecosystem..." -ForegroundColor $Cyan
npm run build

# 5. Define CLI path
$ADYTUM_BIN = "$PWD\packages\gateway\dist\cli\index.js"

# 6. Run initialization
Write-Host "✨ Starting Birth Protocol (Configuration)..." -ForegroundColor $Green
node $ADYTUM_BIN init

# 7. Ask to start
Write-Host "`n🎉 Setup complete!" -ForegroundColor $Green
$run_start = Read-Host "Try running Adytum now? (y/n)"

if ($run_start -match "^[Yy]$") {
    node $ADYTUM_BIN start
} else {
    Write-Host "`nYou can start Adytum anytime by running: node $ADYTUM_BIN start" -ForegroundColor $Cyan
    Write-Host "Or link it globally: cd packages/gateway; npm link" -ForegroundColor $Cyan
}
