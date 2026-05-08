param(
    [Alias('Ip')]
    [string]$TvIp         = "10.0.0.5",
    [string]$PhoneSerial  = "",
    [string]$PhoneIp      = "",
    [switch]$Build,
    [switch]$TvOnly,
    [switch]$PhoneOnly,
    [switch]$BalloonOnly,
    [switch]$GestureOnly,
    [switch]$TetrisOnly,
    [switch]$ControllerOnly,
    [switch]$Help
)

# Catch --help / -help passed as positional arg
if ($TvIp -in @('--help', '-help', '-h', '/?', '-?')) { $Help = $true }

if ($Help) {
    Write-Host @"
deploy-all.ps1 - Build and deploy all games + unified controller

USAGE
  .\deploy-all.ps1 [options]

OPTIONS
  -Ip <ip>              MiBox IP address (default: 10.0.0.5)  alias: -TvIp
  -PhoneSerial <id>     Phone/tablet USB serial  (use: adb devices)
  -PhoneIp <ip>         Phone/tablet WiFi ADB IP

  -Build                Gradle assembleDebug before deploying
  -TvOnly               Deploy TV APKs only; skip phone controller
  -PhoneOnly            Deploy phone controller APK only; skip TV APKs
  -BalloonOnly          Balloon TV + controller only
  -GestureOnly          Gesture TV + controller only
  -TetrisOnly           Tetris TV + controller only
  -ControllerOnly       Unified phone controller APK only (no TV APKs)

  -Help                 Show this help and exit

ARCHITECTURE (all serverless - no PC needed)
  MiBox   <- hebrew-voice-game  android-balloon-app     (port 8765, UDP 8444)
  MiBox   <- gesture-game       android-gesture-tv      (port 8766, UDP 8445)
  MiBox   <- voice_tetris       android-tv              (port 8767, UDP 8446)
  Phone   <- android-game-controller (this repo)        - unified controller

REPO LAYOUT (all siblings under same parent directory)
  ..\hebrew-voice-game\
  ..\gesture-game\
  ..\voice_tetris\
  .\  (android-game-controller - this script)

EXAMPLES
  .\deploy-all.ps1 -Build                             # build + deploy everything
  .\deploy-all.ps1 -Build -PhoneSerial R52MC0LPZ8H    # specify tablet serial
  .\deploy-all.ps1 -Build -TetrisOnly                 # tetris TV + controller only
  .\deploy-all.ps1 -Build -TvOnly                     # all 3 TV APKs, skip phone
  .\deploy-all.ps1 -Ip 10.0.0.4                       # override MiBox IP
"@
    exit 0
}

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { Write-Error "adb not found at $adb"; exit 1 }

$root = $PSScriptRoot

# Sibling repo paths
$balloonDir  = "$root\..\hebrew-voice-game"
$gestureDir  = "$root\..\gesture-game"
$tetrisDir   = "$root\..\voice_tetris"
$ctrlDir     = $root   # this repo

# APK paths
$balloonApk  = "$balloonDir\android-balloon-app\app\build\outputs\apk\debug\app-debug.apk"
$gestureApk  = "$gestureDir\android-gesture-tv\app\build\outputs\apk\debug\app-debug.apk"
$tetrisApk   = "$tetrisDir\android-tv\app\build\outputs\apk\debug\app-debug.apk"
$ctrlApk     = "$ctrlDir\app\build\outputs\apk\debug\app-debug.apk"

# Package names
$balloonPkg  = "com.barakem.hebrewballoon"
$gesturePkg  = "com.barakem.gesturegame.tv"
$tetrisPkg   = "com.barakem.voicetetris.tv"
$ctrlPkg     = "com.barakem.gamecontroller"

# Determine which games to include
$doBalloon  = -not $GestureOnly -and -not $TetrisOnly  -and -not $ControllerOnly
$doGesture  = -not $BalloonOnly -and -not $TetrisOnly  -and -not $ControllerOnly
$doTetris   = -not $BalloonOnly -and -not $GestureOnly -and -not $ControllerOnly
$doCtrl     = -not $TvOnly

if ($BalloonOnly -or $GestureOnly -or $TetrisOnly) {
    $doCtrl = $true   # specific game flags always include controller unless -TvOnly
    if ($TvOnly) { $doCtrl = $false }
}

# ── Build ────────────────────────────────────────────────────────────────────
function Build-Apk([string]$Dir, [string]$Label) {
    $localProps = "$Dir\local.properties"
    if (-not (Test-Path $localProps)) {
        $sdkDir = "$env:LOCALAPPDATA\Android\Sdk" -replace "\\", "\\\\"
        "sdk.dir=$sdkDir" | Set-Content $localProps
        Write-Host "Created $localProps"
    }
    # Force-delete all build dirs before Gradle runs — avoids Windows file-lock failures on clean
    Get-ChildItem -Path $Dir -Filter "build" -Recurse -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { cmd /c rmdir /s /q $_.FullName 2>$null }
    Push-Location $Dir
    Write-Host "Building $Label..." -ForegroundColor Cyan
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed - cleaning and retrying..." -ForegroundColor Yellow
        & .\gradlew.bat clean assembleDebug
    }
    $ok = $LASTEXITCODE -eq 0
    Pop-Location
    return $ok
}

if ($Build) {
    # Stop all Gradle daemons first
    Write-Host "Stopping Gradle daemons..."
    foreach ($d in @("$balloonDir\android-balloon-app", "$gestureDir\android-gesture-tv",
                     "$tetrisDir\android-tv", $ctrlDir)) {
        if (Test-Path "$d\gradlew.bat") {
            Push-Location $d; & .\gradlew.bat --stop 2>$null | Out-Null; Pop-Location
        }
    }

    # Sync web assets into APK asset folders
    Write-Host "Syncing web assets..."
    if ($doBalloon) {
        Copy-Item "$balloonDir\balloon.html" `
                  "$balloonDir\android-balloon-app\app\src\main\assets\balloon.html" -Force
    }
    if ($doGesture) {
        Copy-Item "$gestureDir\web\game\game.js"    "$gestureDir\android-gesture-tv\app\src\main\assets\game.js"   -Force
        Copy-Item "$gestureDir\web\game\index.html" "$gestureDir\android-gesture-tv\app\src\main\assets\game.html" -Force
    }
    if ($doCtrl) {
        # Bundle standalone games into controller assets
        Copy-Item "$balloonDir\balloon.html" `
                  "$ctrlDir\app\src\main\assets\balloon_standalone.html" -Force
        Copy-Item "$tetrisDir\web\index.html" "$ctrlDir\app\src\main\assets\tetris.html"  -Force
        Copy-Item "$tetrisDir\web\app.js"     "$ctrlDir\app\src\main\assets\app.js"       -Force
        Copy-Item "$tetrisDir\web\style.css"  "$ctrlDir\app\src\main\assets\style.css"    -Force
    }

    if ($doBalloon -and -not $PhoneOnly) {
        if (-not (Build-Apk "$balloonDir\android-balloon-app" "Balloon TV")) {
            Write-Error "Balloon TV build failed"; exit 1
        }
    }
    if ($doGesture -and -not $PhoneOnly) {
        if (-not (Build-Apk "$gestureDir\android-gesture-tv" "Gesture TV")) {
            Write-Error "Gesture TV build failed"; exit 1
        }
    }
    if ($doTetris -and -not $PhoneOnly) {
        if (-not (Build-Apk "$tetrisDir\android-tv" "Tetris TV")) {
            Write-Error "Tetris TV build failed"; exit 1
        }
    }
    if ($doCtrl -and -not $TvOnly) {
        if (-not (Build-Apk $ctrlDir "Game Controller")) {
            Write-Error "Controller build failed"; exit 1
        }
    }
}

# ── Deploy helper ─────────────────────────────────────────────────────────────
function Install-Apk([string]$ApkPath, [string]$Package, [string]$Target, [string]$Label) {
    if (-not (Test-Path $ApkPath)) {
        Write-Warning "$Label APK not found at $ApkPath - run with -Build first."
        return
    }
    Write-Host ""
    Write-Host "=== Deploying $Label ===" -ForegroundColor Cyan
    $adbArgs = if ($Target) { @("-s", $Target) } else { @() }
    $installed = & $adb @adbArgs shell pm list packages $Package 2>&1
    if ($installed -match $Package) {
        Write-Host "Uninstalling $Package..."
        & $adb @adbArgs uninstall $Package | Out-Null
    }
    & $adb @adbArgs install $ApkPath
    if ($LASTEXITCODE -eq 0) {
        Write-Host "$Label installed OK." -ForegroundColor Green
    } else {
        Write-Warning "$Label install failed (exit $LASTEXITCODE)."
    }
}

# ── Deploy TV APKs ────────────────────────────────────────────────────────────
if (-not $PhoneOnly) {
    Write-Host "Connecting to MiBox at ${TvIp}:5555..."
    & $adb connect "${TvIp}:5555"

    if ($doBalloon)  { Install-Apk $balloonApk $balloonPkg "${TvIp}:5555" "Balloon TV ($TvIp)" }
    if ($doGesture)  { Install-Apk $gestureApk $gesturePkg "${TvIp}:5555" "Gesture TV ($TvIp)" }
    if ($doTetris)   { Install-Apk $tetrisApk  $tetrisPkg  "${TvIp}:5555" "Tetris TV ($TvIp)"  }
}

# ── Deploy phone/tablet controller ────────────────────────────────────────────
if ($doCtrl -and -not $TvOnly) {
    $target = ""
    if ($PhoneSerial) {
        $target = $PhoneSerial
    } elseif ($PhoneIp) {
        Write-Host "Connecting to phone at ${PhoneIp}:5555..."
        & $adb connect "${PhoneIp}:5555"
        $target = "${PhoneIp}:5555"
    } else {
        $lines = & $adb devices
        $match = $lines | Where-Object { $_ -match "\tdevice$" -and $_ -notmatch $TvIp }
        if ($match) {
            $target = ($match[0] -split "\t")[0].Trim()
            Write-Host "Auto-selected phone: $target"
        } else {
            Write-Warning "No USB phone found. Connect via USB or pass -PhoneSerial / -PhoneIp."
        }
    }

    if ($target) {
        Install-Apk $ctrlApk $ctrlPkg $target "Game Controller (phone)"
        Write-Host "Granting camera + audio permissions..."
        & $adb -s $target shell pm grant $ctrlPkg android.permission.CAMERA       2>$null
        & $adb -s $target shell pm grant $ctrlPkg android.permission.RECORD_AUDIO  2>$null
    }
}

Write-Host ""
Write-Host "All done!" -ForegroundColor Green
