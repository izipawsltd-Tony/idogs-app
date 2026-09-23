param(
  [string]$Repo = 'izipawsltd-Tony/idogs-app',
  [string]$Branch = 'feat/mobile-app-foundation',
  [string]$Workflow = 'mobile-android-debug-apk.yml',
  [string]$Package = 'au.com.idogs.app.staging',
  [string]$PreferredAvd = 'Pixel_8',
  [int]$BuildWaitMinutes = 20
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }

function Get-AdbPath {
  $candidates = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if (-not $candidates) { throw 'ADB not found. Open Android Studio once and install Android SDK Platform Tools.' }
  return $candidates[0]
}

function Get-EmulatorPath {
  $candidates = @(
    "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe",
    "$env:ANDROID_HOME\emulator\emulator.exe",
    "$env:ANDROID_SDK_ROOT\emulator\emulator.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates) { return $candidates[0] }
  return $null
}

function Ensure-Device([string]$Adb) {
  $device = (& $Adb devices | Select-String '\sdevice$' | Select-Object -First 1)
  if ($device) { return }
  $emulator = Get-EmulatorPath
  if (-not $emulator) { throw 'No Android emulator is running and emulator.exe was not found.' }
  $avds = @(& $emulator -list-avds) | Where-Object { $_ -and $_.Trim() }
  if (-not $avds) { throw 'No Android Virtual Device found. Create one in Android Studio Device Manager.' }
  $avd = $avds | Where-Object { $_ -eq $PreferredAvd } | Select-Object -First 1
  if (-not $avd) { $avd = $avds | Where-Object { $_ -match 'Pixel' } | Select-Object -First 1 }
  if (-not $avd) { $avd = $avds[0] }
  Write-Step "Starting emulator: $avd"
  Start-Process -FilePath $emulator -ArgumentList @('-avd', $avd) | Out-Null
  & $Adb wait-for-device | Out-Null
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 2
    $boot = (& $Adb shell getprop sys.boot_completed 2>$null).Trim()
  } until ($boot -eq '1' -or (Get-Date) -gt $deadline)
  if ($boot -ne '1') { throw 'Android emulator did not finish booting within 3 minutes.' }
}

function Invoke-GitHubJson([string]$Uri) {
  $headers = @{ 'User-Agent' = 'iDogs-QA-Updater'; 'Accept' = 'application/vnd.github+json' }
  return Invoke-RestMethod -Uri $Uri -Headers $headers -Method Get
}

function Wait-LatestSuccessfulBuild {
  $deadline = (Get-Date).AddMinutes($BuildWaitMinutes)
  $runsUri = "https://api.github.com/repos/$Repo/actions/workflows/$Workflow/runs?branch=$([uri]::EscapeDataString($Branch))&per_page=1"
  do {
    $runs = Invoke-GitHubJson $runsUri
    $run = $runs.workflow_runs | Select-Object -First 1
    if (-not $run) { throw 'No Android QA workflow run found.' }
    Write-Host "Latest workflow: run $($run.id) | $($run.status) | $($run.conclusion) | $($run.head_sha.Substring(0,8))"
    if ($run.status -eq 'completed') {
      if ($run.conclusion -ne 'success') { throw "Latest Android QA build did not pass. Run $($run.id) conclusion: $($run.conclusion)" }
      return $run
    }
    if ((Get-Date) -gt $deadline) { throw "Latest Android QA build did not finish within $BuildWaitMinutes minutes." }
    Start-Sleep -Seconds 10
  } while ($true)
}

function Wait-NativeQaHealth {
  $deadline = (Get-Date).AddMinutes($BuildWaitMinutes)
  $healthUri = 'https://idogs-native-api-qa-izipaws.vercel.app/api/native-qa-health'
  $headers = @{ 'User-Agent' = 'iDogs-QA-Updater'; 'Cache-Control' = 'no-cache'; 'X-iDogs-Native-QA' = '1' }
  do {
    try {
      $health = Invoke-RestMethod -Uri $healthUri -Headers $headers -Method Get -TimeoutSec 20
      if (
        $health.ok -eq $true -and
        $health.firebaseProjectId -eq 'idogs-app-staging' -and
        $health.vercelEnv -eq 'production' -and
        $health.backendMode -eq 'dedicated-qa'
      ) { return $health }
      Write-Host 'Dedicated Native API health mismatch; waiting for safe staging backend...' -ForegroundColor Yellow
    } catch {
      Write-Host 'Dedicated Native API backend not ready/public yet; waiting...' -ForegroundColor Yellow
    }
    if ((Get-Date) -gt $deadline) { throw "Dedicated Native QA API did not verify as public staging backend within $BuildWaitMinutes minutes." }
    Start-Sleep -Seconds 10
  } while ($true)
}

$adb = Get-AdbPath
Ensure-Device $adb

Write-Step 'Waiting for latest successful iDogs Android QA build'
$run = Wait-LatestSuccessfulBuild
$sha = $run.head_sha
$runId = $run.id
Write-Host "Run ID   : $runId"
Write-Host "Exact SHA: $sha"

Write-Step 'Downloading fixed latest QA release'
$releaseBase = "https://github.com/$Repo/releases/download/idogs-qa-latest"
$workRoot = Join-Path $env:TEMP 'idogs-qa-auto'
$workDir = Join-Path $workRoot $sha
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
$apk = Join-Path $workDir 'iDogs-QA-latest.apk'
$buildInfo = Join-Path $workDir 'iDogs-QA-latest-BUILD_INFO.txt'
$sumFile = Join-Path $workDir 'iDogs-QA-latest-SHA256SUMS.txt'
$signingReport = Join-Path $workDir 'iDogs-QA-latest-SIGNING_REPORT.txt'
Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/iDogs-QA-latest.apk" -OutFile $apk
Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/iDogs-QA-latest-BUILD_INFO.txt" -OutFile $buildInfo
Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/iDogs-QA-latest-SHA256SUMS.txt" -OutFile $sumFile
Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/iDogs-QA-latest-SIGNING_REPORT.txt" -OutFile $signingReport

Write-Step 'Verifying exact SHA, staging identity, Firebase and APK hash'
$info = Get-Content $buildInfo -Raw
if ($info -notmatch [regex]::Escape("Git SHA: $sha")) { throw 'BUILD_INFO SHA does not match latest successful workflow SHA.' }
if ($info -notmatch 'App ID: au\.com\.idogs\.app\.staging') { throw 'BUILD_INFO app ID is not staging.' }
if ($info -notmatch 'Firebase: idogs-app-staging') { throw 'BUILD_INFO Firebase is not staging.' }
if ($info -notmatch 'Payments: disabled') { throw 'BUILD_INFO does not confirm payments are disabled.' }
$expected = ((Get-Content $sumFile | Select-Object -First 1) -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not $expected -or $expected -ne $actual) { throw 'APK SHA-256 verification failed.' }
Write-Host "APK SHA-256: $actual" -ForegroundColor Green

Write-Step 'Verifying dedicated public staging Native API backend'
$health = Wait-NativeQaHealth
Write-Host "Native API: $($health.backendMode) / $($health.vercelEnv) / $($health.firebaseProjectId)" -ForegroundColor Green

Write-Step 'Installing or updating iDogs QA'
$installOutput = & $adb install -r $apk 2>&1
$installOutput | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0 -or ($installOutput -join "`n") -notmatch 'Success') { throw 'adb install -r failed.' }

Write-Step 'Launching exact staging package'
& $adb shell am force-stop $Package | Out-Null
& $adb shell monkey -p $Package -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep -Seconds 5
$focus = (& $adb shell dumpsys window | Select-String 'mCurrentFocus|mFocusedApp' | Out-String)
if ($focus -notmatch [regex]::Escape($Package)) { throw "QA package is not foreground after launch.`n$focus" }
Write-Host "Foreground package: $Package" -ForegroundColor Green

Write-Step 'Capturing QA screenshot'
$outDir = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'iDogs-QA'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$remote = '/sdcard/idogs-qa-latest.png'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$local = Join-Path $outDir "iDogs-QA-$($sha.Substring(0,8))-$stamp.png"
& $adb shell screencap -p $remote | Out-Null
& $adb pull $remote $local | Out-Null
& $adb shell rm -f $remote | Out-Null
if (-not (Test-Path $local)) { throw 'Screenshot capture failed.' }

$resultFile = Join-Path $outDir 'LATEST-QA-RESULT.txt'
@"
iDogs QA AUTO RESULT
Status: PASS
Workflow run: $runId
Exact SHA: $sha
Package: $Package
APK SHA-256: $actual
Native API: $($health.backendMode) / $($health.vercelEnv) / $($health.firebaseProjectId)
External payment/message side effects: blocked by native routing layer; backend contains no Stripe/Resend/SMS secrets
Screenshot: $local
Completed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
"@ | Set-Content -Path $resultFile -Encoding UTF8

Write-Host "`nPASS: latest iDogs QA build verified, dedicated staging API verified, installed and launched" -ForegroundColor Green
Write-Host "Exact SHA : $sha"
Write-Host "Screenshot: $local"
Write-Host "Result    : $resultFile"
Start-Process $local
