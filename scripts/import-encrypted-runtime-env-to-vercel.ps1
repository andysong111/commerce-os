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
    throw "Encrypted runtime environment file was not found. Use -EncryptedFile to specify the path."
  }
  $EncryptedFile = $candidate.FullName
}

$resolvedFile = (Resolve-Path -LiteralPath $EncryptedFile).Path
$nodeScript = Join-Path $PSScriptRoot "import-encrypted-runtime-env-to-vercel.mjs"
if (-not (Test-Path -LiteralPath $nodeScript -PathType Leaf)) {
  throw "The runtime environment import script was not found."
}

$securePassphrase = $null
$plainPassphrase = $null
$passphrasePointer = [IntPtr]::Zero
try {
  $securePassphrase = Read-Host "Encrypted file passphrase" -AsSecureString
  $passphrasePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassphrase)
  $plainPassphrase = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passphrasePointer)
  if ([string]::IsNullOrEmpty($plainPassphrase)) {
    throw "The encrypted file passphrase is empty."
  }

  $env:MIGRATION_ENV_EXPORT_PASSPHRASE = $plainPassphrase
  Write-Host "Decrypting in memory and importing five sensitive values into the existing Ops Center Production project."
  & node $nodeScript $resolvedFile
  if ($LASTEXITCODE -ne 0) {
    throw "Runtime environment import did not complete. Check the error code above."
  }
} finally {
  Remove-Item Env:MIGRATION_ENV_EXPORT_PASSPHRASE -ErrorAction SilentlyContinue
  $plainPassphrase = $null
  $securePassphrase = $null
  if ($passphrasePointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passphrasePointer)
  }
}
