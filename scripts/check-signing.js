// Stops `npm run dist:win` before a long build if the MSIX would come out unsigned.
// Windows refuses to install an unsigned or untrusted MSIX ("Publisher: Unknown").
const fs = require('fs')
const link = process.env.CSC_LINK
if (!link || !process.env.CSC_KEY_PASSWORD || !fs.existsSync(link)) {
  console.error('\nCSC_LINK / CSC_KEY_PASSWORD are not set (or the .pfx is missing), so the MSIX would be unsigned.')
  console.error('In an elevated PowerShell, from the project folder:')
  console.error('  powershell -ExecutionPolicy Bypass -File scripts\\make-cert.ps1   # once')
  console.error('  $env:CSC_LINK = "$PWD\\build\\discord-pager.pfx"')
  console.error('  $env:CSC_KEY_PASSWORD = "discord-pager"')
  console.error('  npm run dist:win\n')
  process.exit(1)
}
