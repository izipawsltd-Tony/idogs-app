$ErrorActionPreference = 'Stop'

$Repo = 'izipawsltd-Tony/idogs-app'
$SecretName = 'IDOGS_ANDROID_UPLOAD_SIGNING_JSON'
$Alias = 'idogs-upload'
$BackupDir = Join-Path $env:USERPROFILE 'Documents\iDogs-Production-Signing'
$KeyPath = Join-Path $BackupDir 'idogs-upload.p12'
$SecretBackupPath = Join-Path $BackupDir 'IDOGS_ANDROID_UPLOAD_SIGNING_JSON.txt'

function Find-Keytool {
  $candidates = @()
  $cmd = Get-Command keytool.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
  $candidates += 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
  $candidates += 'C:\Program Files\Android\Android Studio\jre\bin\keytool.exe'
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw 'keytool.exe was not found. Install Android Studio or a JDK, then run this file again.'
}

function New-SecurePassword {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $value = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','A').Replace('/','B')
  return $value
}

Write-Host 'iDogs Production Android Signing Setup' -ForegroundColor Green
Write-Host 'Package: au.com.idogs.app'
Write-Host 'Alias  : idogs-upload'
Write-Host ''

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$keytool = Find-Keytool
Write-Host "keytool: $keytool"

if (Test-Path $KeyPath) {
  Write-Host ''
  Write-Host 'STOP: A production upload keystore already exists:' -ForegroundColor Yellow
  Write-Host $KeyPath
  Write-Host 'This script will never overwrite or rotate an existing production upload key.'
  Write-Host 'If this is the intended key, use the existing backup JSON in the same folder.'
  exit 2
}

$password = New-SecurePassword

& $keytool -genkeypair `
  -alias $Alias `
  -keyalg RSA `
  -keysize 4096 `
  -sigalg SHA256withRSA `
  -validity 10000 `
  -storetype PKCS12 `
  -keystore $KeyPath `
  -storepass $password `
  -keypass $password `
  -dname 'CN=iDogs Upload, OU=Mobile, O=IZIPAWS PTY LTD, L=Adelaide, ST=South Australia, C=AU'

if ($LASTEXITCODE -ne 0 -or -not (Test-Path $KeyPath)) {
  throw 'Failed to generate production upload keystore.'
}

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($KeyPath))
$payloadObject = [ordered]@{
  format = 'PKCS12'
  alias = $Alias
  password = $password
  keystoreBase64 = $b64
}
$payload = $payloadObject | ConvertTo-Json -Compress
[IO.File]::WriteAllText($SecretBackupPath, $payload, [Text.UTF8Encoding]::new($false))

$certText = & $keytool -list -v -keystore $KeyPath -storetype PKCS12 -storepass $password -alias $Alias
$shaLine = $certText | Select-String 'SHA256:' | Select-Object -First 1
$certSha = if ($shaLine) { (($shaLine.ToString() -split 'SHA256:\s*',2)[1]).Replace(':','').Trim().ToLowerInvariant() } else { '' }

try {
  Set-Clipboard -Value $payload
  $clipboardReady = $true
} catch {
  $clipboardReady = $false
}

$gh = Get-Command gh.exe -ErrorAction SilentlyContinue
$secretSet = $false
if ($gh) {
  & $gh.Source auth status --hostname github.com *> $null
  if ($LASTEXITCODE -eq 0) {
    $payload | & $gh.Source secret set $SecretName --repo $Repo
    if ($LASTEXITCODE -eq 0) { $secretSet = $true }
  }
}

Write-Host ''
Write-Host 'UPLOAD KEY CREATED SUCCESSFULLY' -ForegroundColor Green
Write-Host "Certificate SHA-256: $certSha"
Write-Host "Keystore backup : $KeyPath"
Write-Host "Secret backup   : $SecretBackupPath"
Write-Host ''
Write-Host 'IMPORTANT: Keep BOTH backup files permanently and privately. Do not email or upload them anywhere except the GitHub Actions secret requested below.' -ForegroundColor Yellow
Write-Host ''

if ($secretSet) {
  Write-Host "GitHub secret $SecretName was set automatically." -ForegroundColor Green
  Write-Host 'You can close this window. The next branch build will sign the production AAB automatically.'
} else {
  if ($clipboardReady) {
    Write-Host "The complete secret value is already copied to your clipboard." -ForegroundColor Green
  } else {
    Write-Host "Open this local file and copy its entire single-line JSON value: $SecretBackupPath" -ForegroundColor Yellow
  }
  Write-Host ''
  Write-Host 'GitHub secret name:' -ForegroundColor Cyan
  Write-Host $SecretName
  Write-Host ''
  Write-Host 'A browser will open the GitHub Actions Secrets page. Create ONE repository secret with the exact name above and paste the clipboard value.'
  Start-Process 'https://github.com/izipawsltd-Tony/idogs-app/settings/secrets/actions'
}

Write-Host ''
Write-Host 'Press any key to close...'
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
