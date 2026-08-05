param(
  [string]$EncryptedFile = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($EncryptedFile)) {
  $purchaseDirectory = Join-Path $HOME "Commerce-OS-Migration\purchase"
  $candidate = Get-ChildItem -Path $purchaseDirectory -Filter "commerce-os-purchase-env-*.enc.json" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($null -eq $candidate) {
    throw "암호화 환경변수 파일을 찾지 못했습니다. -EncryptedFile 경로를 지정하세요."
  }
  $EncryptedFile = $candidate.FullName
}

$resolvedFile = (Resolve-Path -LiteralPath $EncryptedFile).Path
$nodeScript = Join-Path $PSScriptRoot "import-encrypted-runtime-env-to-vercel.mjs"
if (-not (Test-Path -LiteralPath $nodeScript -PathType Leaf)) {
  throw "환경변수 이전 스크립트를 찾지 못했습니다."
}

$securePassphrase = $null
$plainPassphrase = $null
$passphrasePointer = [IntPtr]::Zero
try {
  $securePassphrase = Read-Host "암호화 파일 비밀번호" -AsSecureString
  $passphrasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassphrase)
  $plainPassphrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passphrasePointer)
  if ([string]::IsNullOrEmpty($plainPassphrase)) {
    throw "암호화 파일 비밀번호가 비어 있습니다."
  }

  $env:MIGRATION_ENV_EXPORT_PASSPHRASE = $plainPassphrase
  Write-Host "암호화 파일을 메모리에서 복호화하여 Ops Center Production에 안전하게 이전합니다."
  & node $nodeScript $resolvedFile
  if ($LASTEXITCODE -ne 0) {
    throw "환경변수 이전이 완료되지 않았습니다. 위 오류코드를 확인하세요."
  }
} finally {
  Remove-Item Env:MIGRATION_ENV_EXPORT_PASSPHRASE -ErrorAction SilentlyContinue
  $plainPassphrase = $null
  $securePassphrase = $null
  if ($passphrasePointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passphrasePointer)
  }
}
