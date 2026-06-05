$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

$distributionDir = Join-Path $projectRoot "dist"
$buildTempDir = Join-Path $projectRoot "build\temp"
$buildLogDir = Join-Path $buildTempDir "logs"
$releaseRootDir = Join-Path $buildTempDir "release"
$releaseDir = Join-Path $releaseRootDir (".build-" + [DateTime]::Now.ToString("yyyyMMddHHmmss"))
$asciiIconPath = Join-Path $releaseDir ("serial-assistant-icon-" + [DateTime]::Now.ToString("yyyyMMddHHmmss") + ".ico")
$unpackedSelfTestLog = Join-Path $buildLogDir "unpacked-selftest.log"
$portableSelfTestLog = Join-Path $buildLogDir "portable-selftest.log"
$finalExeName = "SerialAssistant-V2.1-portable.exe"
$finalExe = Join-Path $distributionDir $finalExeName
$unpackedDir = Join-Path $releaseDir "win-unpacked"

function Stop-SerialAssistantProcesses {
  Get-Process SerialAssistant -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-Process "SerialAssistant-portable" -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*$projectRoot*" -and $_.Name -like "SerialAssistant*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Remove-PathWithRetry($pathToRemove) {
  if (-not (Test-Path -LiteralPath $pathToRemove)) {
    return
  }
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Remove-Item -LiteralPath $pathToRemove -Recurse -Force -ErrorAction Stop
      return
    }
    catch {
      if ($attempt -eq 5) {
        throw
      }
      Start-Sleep -Milliseconds (300 * $attempt)
    }
  }
}

function Clear-DirectoryContentsWithRetry($directoryPath) {
  if (-not (Test-Path -LiteralPath $directoryPath)) {
    return
  }
  Get-ChildItem -LiteralPath $directoryPath -Force |
    ForEach-Object { Remove-PathWithRetry $_.FullName }
}

Write-Host "[1/6] Checking dependencies..."
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
  npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }
}

Write-Host "[2/6] Closing old SerialAssistant processes..."
Stop-SerialAssistantProcesses

Write-Host "[3/6] Preparing distribution workspace..."
if (-not (Test-Path -LiteralPath $distributionDir)) {
  New-Item -ItemType Directory -Path $distributionDir | Out-Null
}
Clear-DirectoryContentsWithRetry $distributionDir
if (Test-Path -LiteralPath $buildTempDir) {
  Remove-PathWithRetry $buildTempDir
}
New-Item -ItemType Directory -Path $buildLogDir | Out-Null
New-Item -ItemType Directory -Path $releaseRootDir | Out-Null

$legacyDistributionDir = Join-Path $projectRoot (([string][char]0x5206) + ([string][char]0x53D1))
if (Test-Path -LiteralPath $legacyDistributionDir) {
  try {
    Remove-Item -LiteralPath $legacyDistributionDir -Recurse -Force -ErrorAction Stop
  }
  catch {
    Write-Host "Legacy distribution folder is locked, leaving it for manual cleanup: $legacyDistributionDir"
  }
}

New-Item -ItemType Directory -Path $releaseDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "icon.ico") -Destination $asciiIconPath -Force
$env:SERIAL_ASSISTANT_ICON = $asciiIconPath
$env:SERIAL_ASSISTANT_OUTPUT = $releaseDir

Write-Host "[4/6] Building portable EXE..."
npm.cmd run package:portable
if ($LASTEXITCODE -ne 0) {
  throw "npm run package:portable failed with exit code $LASTEXITCODE"
}

$artifact = Get-ChildItem -LiteralPath $releaseDir -Filter "*-portable.exe" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $artifact) {
  throw "Portable EXE was not produced under $releaseDir"
}

Write-Host "[5/6] Running unpacked EXE self-test..."
if (Test-Path -LiteralPath $unpackedSelfTestLog) {
  Remove-Item -LiteralPath $unpackedSelfTestLog -Force
}
$env:SERIAL_ASSISTANT_SELFTEST = "1"
$env:SERIAL_ASSISTANT_SELFTEST_LOG = $unpackedSelfTestLog
$p = Start-Process -FilePath (Join-Path $unpackedDir "SerialAssistant.exe") -PassThru
$p.WaitForExit()
$selfTestExitCode = $p.ExitCode
$p.Dispose()
Start-Sleep -Milliseconds 500
Stop-SerialAssistantProcesses
Write-Host "Self-test exit code: $selfTestExitCode"
if (Test-Path -LiteralPath $unpackedSelfTestLog) {
  Write-Host "Self-test log:"
  Get-Content -LiteralPath $unpackedSelfTestLog
}
if ($selfTestExitCode -ne 0) {
  throw "Unpacked EXE self-test failed with exit code $selfTestExitCode"
}

Write-Host "[6/6] Keeping only final deliverable..."
Copy-Item -LiteralPath $artifact.FullName -Destination $finalExe -Force

Write-Host "Running final portable EXE self-test..."
if (Test-Path -LiteralPath $portableSelfTestLog) {
  Remove-Item -LiteralPath $portableSelfTestLog -Force
}
$env:SERIAL_ASSISTANT_SELFTEST = "1"
$env:SERIAL_ASSISTANT_SELFTEST_LOG = $portableSelfTestLog
$portableProcess = Start-Process -FilePath $finalExe -PassThru -WindowStyle Hidden
if (-not $portableProcess.WaitForExit(90000)) {
  Stop-Process -Id $portableProcess.Id -Force -ErrorAction SilentlyContinue
  throw "Final portable EXE self-test timed out"
}
$portableSelfTestExitCode = $portableProcess.ExitCode
$portableProcess.Dispose()
Start-Sleep -Milliseconds 500
Stop-SerialAssistantProcesses
Write-Host "Final portable self-test exit code: $portableSelfTestExitCode"
if (Test-Path -LiteralPath $portableSelfTestLog) {
  Write-Host "Final portable self-test log:"
  Get-Content -LiteralPath $portableSelfTestLog
}
if ($portableSelfTestExitCode -ne 0) {
  throw "Final portable EXE self-test failed with exit code $portableSelfTestExitCode"
}

@(
  (Join-Path $projectRoot "SerialAssistant-portable.exe"),
  (Join-Path $projectRoot $finalExeName),
  (Join-Path $distributionDir "SerialAssistant-portable.exe")
) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
  Remove-Item -LiteralPath $_ -Force
}

if (Test-Path -LiteralPath $releaseDir) {
  Remove-PathWithRetry $releaseDir
}

$rendererBuildDir = Join-Path $projectRoot "renderer-dist"
if (Test-Path -LiteralPath $rendererBuildDir) {
  Remove-PathWithRetry $rendererBuildDir
}

Get-ChildItem -LiteralPath $distributionDir -Force |
  Where-Object { $_.Name -ne $finalExeName } |
  ForEach-Object { Remove-PathWithRetry $_.FullName }

if (Test-Path -LiteralPath $buildTempDir) {
  Remove-PathWithRetry $buildTempDir
}

Write-Host "Portable EXE: $finalExe"
Write-Host "Standalone web index: $(Join-Path $projectRoot 'index.html')"
