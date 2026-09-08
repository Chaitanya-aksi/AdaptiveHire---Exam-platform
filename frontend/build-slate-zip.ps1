<#
.SYNOPSIS
  Builds the frontend and packs dist/ into a zip that Catalyst Slate can read.

.DESCRIPTION
  Run this instead of Compress-Archive. There is one specific reason.

  Windows PowerShell 5.1's Compress-Archive writes zip entries using BACKSLASH
  separators, which the zip spec does not allow. Windows tools read those back
  fine, so the archive looks correct on this machine. Slate extracts on Linux,
  where "assets\index-abc.js" is not a folder plus a file - it is one file whose
  name happens to contain a backslash. Every asset then 404s and the deployed
  page is blank, while index.html itself loads.

  That failure looks exactly like a hosting or routing problem, which is the
  trap: you can spend an afternoon on Slate's settings when the archive was
  wrong before it was ever uploaded.

  This script builds each entry itself with a forward-slashed name, then reopens
  the finished zip and refuses to leave a file behind if any entry still
  contains a backslash. So a zip that exists is a zip that will work.

.PARAMETER SkipBuild
  Pack whatever is already in dist/ instead of running npm run build first.
  Use only when you have just built and know it is current.

.PARAMETER OutFile
  Where to write the archive. Defaults to frontend-slate.zip beside this script.

.EXAMPLE
  .\build-slate-zip.ps1

.EXAMPLE
  .\build-slate-zip.ps1 -SkipBuild -OutFile C:\temp\upload.zip

.NOTES
  Upload the result to Slate using the STATIC preset, not React + Vite.
  Static serves the zip as-is and does the SPA fallback that deep links need.
  React + Vite runs Init/Clone/Install/Build and expects SOURCE - handed a
  built dist it dies at Install with "ENOENT ... /catalyst/source/package.json".
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $here 'dist'
if (-not $OutFile) { $OutFile = Join-Path $here 'frontend-slate.zip' }

# ── 1. Build ───────────────────────────────────────────────────────────────
if ($SkipBuild) {
  Write-Host 'Skipping build, packing the existing dist/.' -ForegroundColor Yellow
} else {
  Write-Host 'Building...' -ForegroundColor Cyan
  Push-Location $here
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $dist)) {
  throw "No dist/ at $dist. Run without -SkipBuild."
}

# The one file whose absence means the whole upload is pointless.
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
  throw "dist/index.html is missing - that build did not produce a site."
}

# ── 2. Pack ────────────────────────────────────────────────────────────────
# Entry by entry, rather than Compress-Archive or CreateFromDirectory, because
# this is the only way to control the separator in the stored name.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $OutFile) { Remove-Item $OutFile -Force }

$files = Get-ChildItem -Path $dist -Recurse -File
if ($files.Count -eq 0) { throw 'dist/ is empty.' }

# Resolve once so the prefix we strip is exactly what Get-ChildItem produced.
$root = (Resolve-Path $dist).Path.TrimEnd('\', '/')

Write-Host "Packing $($files.Count) files..." -ForegroundColor Cyan
$archive = [System.IO.Compression.ZipFile]::Open($OutFile, 'Create')
try {
  foreach ($file in $files) {
    # Path relative to dist/, so the zip contains "index.html" and
    # "assets/index.js" - NOT "dist/index.html". Slate serves the archive root
    # as the site root, so an extra top-level folder means every path is wrong.
    $relative = $file.FullName.Substring($root.Length).TrimStart('\', '/')
    $entryName = $relative -replace '\\', '/'

    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $archive.Dispose()
}

# ── 3. Verify, and delete the file rather than ship a broken one ───────────
$check = [System.IO.Compression.ZipFile]::OpenRead($OutFile)
try {
  $entries = $check.Entries | ForEach-Object { $_.FullName }
} finally {
  $check.Dispose()
}

$bad = $entries | Where-Object { $_ -like '*\*' }
if ($bad) {
  Remove-Item $OutFile -Force
  throw "Backslashes in $($bad.Count) entry name(s), e.g. '$($bad[0])'. Archive deleted rather than uploaded."
}

if ($entries -notcontains 'index.html') {
  Remove-Item $OutFile -Force
  throw "index.html is not at the archive root. Archive deleted."
}

# The face-api models and the JS bundle are the two things that silently break
# when the layout is wrong, so both are named explicitly rather than assumed.
$assets = @($entries | Where-Object { $_ -like 'assets/*' }).Count
$models = @($entries | Where-Object { $_ -like 'models/*' }).Count

Write-Host ''
Write-Host 'OK.' -ForegroundColor Green
Write-Host "  $OutFile"
Write-Host "  $($entries.Count) entries - $assets under assets/, $models under models/"
Write-Host "  $([math]::Round((Get-Item $OutFile).Length / 1MB, 2)) MB, no backslashes, index.html at the root"
Write-Host ''
Write-Host 'Upload to Slate with the STATIC preset (not React + Vite).' -ForegroundColor Cyan
if ($models -eq 0) {
  Write-Host 'WARNING: no models/ entries - the camera check will fail.' -ForegroundColor Yellow
}
