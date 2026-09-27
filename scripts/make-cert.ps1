# Creates a self-signed code-signing certificate for the MSIX and trusts it on this PC.
# Run once in an elevated PowerShell on the Windows box:
#   powershell -ExecutionPolicy Bypass -File scripts\make-cert.ps1
# The subject must match `appx.publisher` in electron-builder.yml (CN=REDFC).

param([string]$Password = "discord-pager")
$ErrorActionPreference = "Stop"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Error "Run this from PowerShell opened with 'Run as administrator' (it needs to trust the certificate for the whole PC)."
}

$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=REDFC" `
  -KeyUsage DigitalSignature -FriendlyName "Discord Pager (self-signed)" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

$pwd = ConvertTo-SecureString -String $Password -Force -AsPlainText
$pfx = Join-Path $PSScriptRoot "..\build\discord-pager.pfx"
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null

# Trust it so Windows will install the MSIX.
$cer = Join-Path $env:TEMP "discord-pager.cer"
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null

Write-Host "Certificate written to $pfx and trusted on this PC."
Write-Host "Build with:  `$env:CSC_LINK='$pfx'; `$env:CSC_KEY_PASSWORD='$Password'; npm run dist:win"
