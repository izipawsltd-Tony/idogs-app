# Run in Windows PowerShell as the owner of the iDogs Google Play upload key.
# Keeps the private key on this computer and sends it only to the named GitHub repository as encrypted Actions secrets.
param(
  [string]$Repository = 'izipawsltd-Tony/idogs-app',
  [string]$KeyDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'iDogs-Play-Upload-Key')
)

$ErrorActionPreference = 'Stop'
$ExpectedRepository = 'izipawsltd-Tony/idogs-app'
if ($Repository -cne $ExpectedRepository) { throw "Repository mismatch: $Repository" }

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { throw 'GitHub CLI (gh) is required. Install it, run gh auth login, then rerun this script.' }
$keytool = Get-Command keytool -ErrorAction SilentlyContinue
if (-not $keytool -and $env:JAVA_HOME) {
  $candidate = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
  if (Test-Path $candidate) { $keytool = @{ Source = $candidate } }
}
if (-not $keytool) {
  $candidate = 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
  if (Test-Path $candidate) { $keytool = @{ Source = $candidate } }
}
if (-not $keytool) { throw 'Java keytool is required. Install Android Studio or JDK 21, then rerun.' }

& $gh.Source auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not signed in. Run gh auth login, then rerun.' }
$actualRepository = (& $gh.Source repo view $Repository --json nameWithOwner --jq '.nameWithOwner' 2>$null)
if ($LASTEXITCODE -ne 0 -or $actualRepository.Trim() -cne $ExpectedRepository) {
  throw 'GitHub repository identity check failed; no key was created.'
}
& $gh.Source secret list -R $Repository --app actions 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot access repository Actions secrets; no key was created.' }

function Set-ActionSecret([string]$Name, [string]$Value) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $gh.Source
  $start.Arguments = "secret set $Name -R $Repository --app actions"
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardError = $true
  $start.RedirectStandardOutput = $true
  $process = [System.Diagnostics.Process]::Start($start)
  try {
    $process.StandardInput.Write($Value)
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Could not set $Name. The key remains on this computer; rerun this script." }
  } finally {
    $process.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $KeyDirectory | Out-Null
$keyPath = Join-Path $KeyDirectory 'idogs-upload-key.p12'
$existing = Test-Path $keyPath
Write-Host 'Enter a strong password for the iDogs upload key. Save it in your password manager.'
$securePassword = Read-Host 'Upload key password' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($password.Length -lt 12) { throw 'Password must be at least 12 characters.' }
  if (-not $existing) {
    & $keytool.Source -genkeypair -keystore $keyPath -storetype PKCS12 -alias idogs-upload -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=iDogs Upload Key, O=IZIPAWS Pty Ltd, C=AU' -storepass $password -keypass $password
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed; no GitHub secrets were changed.' }
  }
  $report = & $keytool.Source -list -v -keystore $keyPath -storepass $password -alias idogs-upload
  if ($LASTEXITCODE -ne 0) { throw 'The existing upload key or password is invalid.' }
  $match = [regex]::Match(($report -join "`n"), 'SHA256:\s*([0-9A-Fa-f:]+)')
  if (-not $match.Success) { throw 'Could not read the upload certificate fingerprint.' }
  $fingerprint = ($match.Groups[1].Value -replace ':', '').ToLowerInvariant()
  if ($fingerprint.Length -ne 64) { throw 'Invalid certificate fingerprint.' }

  $secrets = [ordered]@{
    IDOGS_RELEASE_KEYSTORE_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyPath))
    IDOGS_RELEASE_STORE_PASSWORD = $password
    IDOGS_RELEASE_KEY_PASSWORD = $password
    IDOGS_RELEASE_KEY_ALIAS = 'idogs-upload'
    IDOGS_RELEASE_CERT_SHA256 = $fingerprint
  }
  foreach ($name in $secrets.Keys) {
    Set-ActionSecret $name $secrets[$name]
    Write-Host "Set $name"
  }
  $names = & $gh.Source secret list -R $Repository --app actions --json name --jq '.[].name'
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify GitHub secret names.' }
  foreach ($name in $secrets.Keys) {
    if ($names -notcontains $name) { throw "Secret $name not visible after upload." }
  }
  Write-Host 'UPLOAD KEY SETUP PASS'
  Write-Host "Repository: $Repository"
  Write-Host "Private key backup location: $keyPath"
  Write-Host "Certificate SHA-256: $fingerprint"
  Write-Host 'Keep the .p12 file backed up securely and retain its password in your password manager.'
  Write-Host 'Do not send the key or password through chat.'
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  Remove-Variable password -ErrorAction SilentlyContinue
}
