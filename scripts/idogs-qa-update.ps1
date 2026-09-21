param(
  [string]$Repo = 'izipawsltd-Tony/idogs-app',
  [string]$Branch = 'feat/mobile-app-foundation',
  [string]$Workflow = 'mobile-android-debug-apk.yml',
  [string]$Package = 'au.com.idogs.app.staging',
  [string]$PreferredAvd = 'Pixel_8'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$Text) {
  Write-Host "`n==> $Text" -ForegroundColor Cyan
}

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

$adb = Get-AdbPath
Ensure-Device $adb

Write-Step 'Finding latest successful iDogs Android QA build'
$runsUri = "https://api.github.com/repos/$Repo/actions/workflows/$Workflow/runs?branch=$([uri]::EscapeDataString($Branch))&status=success&per_page=10"
$runs = Invoke-GitHubJson $runsUri
$run = $runs.workflow_runs | Where-Object { $_.conclusion -eq 'success' } | Select-Object -First 1
if (-not $run) { throw 'No successful Android QA workflow run found.' }

$sha = $run.head_sha
$runId = $run.id
Write-Host "Run ID : $runId"
Write-Host "Exact SHA: $sha"

Write-Step 'Downloading exact APK artifact'
$artifacts = Invoke-GitHubJson "https://api.github.com/repos/$Repo/actions/runs/$runId/artifacts?per_page=100"
$artifactName = "idogs-android-debug-apk-$sha"
$artifact = $artifacts.artifacts | Where-Object { $_.name -eq $artifactName -and -not $_.expired } | Select-Object -First 1
if (-not $artifact) { throw "Artifact not found: $artifactName" }

$workRoot = Join-Path $env:TEMP 'idogs-qa-auto'
$workDir = Join-Path $workRoot $sha
$zip = Join-Path $workDir 'artifact.zip'
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

$headers = @{ 'User-Agent' = 'iDogs-QA-Updater'; 'Accept' = 'application/vnd.github+json' }
try {
  Invoke-WebRequest -Uri $artifact.archive_download_url -Headers $headers -OutFile $zip -MaximumRedirection 10
} catch {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) {
    throw "GitHub artifact download requires authentication on this machine. Install/login GitHub CLI once with 'gh auth login', then rerun this updater. Original error: $($_.Exception.Message)"
  }
  & $gh.Source run download $runId --repo $Repo --name $artifactName --dir $workDir
  if ($LASTEXITCODE -ne 0) { throw 'gh run download failed.' }
}

if (Test-Path $zip) { Expand-Archive -Path $zip -DestinationPath $workDir -Force }
$apk = Get-ChildItem $workDir -Recurse -Filter '*.apk' | Select-Object -First 1
if (-not $apk) { throw 'Downloaded artifact does not contain an APK.' }

$buildInfo = Get-ChildItem $workDir -Recurse -Filter 'BUILD_INFO.txt' | Select-Object -First 1
if ($buildInfo) {
  $info = Get-Content $buildInfo.FullName -Raw
  if ($info -notmatch [regex]::Escape("Git SHA: $sha")) { throw 'BUILD_INFO SHA does not match workflow SHA.' }
  if ($info -notmatch 'App ID: au\.com\.idogs\.app\.staging') { throw 'BUILD_INFO app ID is not staging.' }
  if ($info -notmatch 'Firebase: idogs-app-staging') { throw 'BUILD_INFO Firebase is not staging.' }
}

$sumFile = Get-ChildItem $workDir -Recurse -Filter 'SHA256SUMS.txt' | Select-Object -First 1
if ($sumFile) {
  $expected = ((Get-Content $sumFile.FullName | Select-Object -First 1) -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash $apk.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw 'APK SHA-256 verification failed.' }
  Write-Host "APK SHA-256: $actual"
}

Write-Step 'Installing iDogs QA'
& $adb install -r $apk.FullName
if ($LASTEXITCODE -ne 0) { throw 'adb install failed.' }

Write-Step 'Launching exact staging package'
& $adb shell am force-stop $Package | Out-Null
& $adb shell monkey -p $Package -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep -Seconds 3

$focus = (& $adb shell dumpsys window | Select-String 'mCurrentFocus|mFocusedApp' | Out-String)
if ($focus -notmatch [regex]::Escape($Package)) {
  throw "QA package is not foreground after launch.`n$focus"
}
Write-Host "Foreground package: $Package" -ForegroundColor Green

Write-Step 'Capturing QA screenshot'
$outDir = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'iDogs-QA'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$remote = '/sdcard/idogs-qa-latest.png'
$local = Join-Path $outDir "iDogs-QA-$($sha.Substring(0,8)).png"
& $adb shell screencap -p $remote | Out-Null
& $adb pull $remote $local | Out-Null
& $adb shell rm -f $remote | Out-Null

Write-Host "`nPASS: iDogs QA updated and launched" -ForegroundColor Green
Write-Host "Exact SHA : $sha"
Write-Host "Screenshot: $local"
Start-Process $local
