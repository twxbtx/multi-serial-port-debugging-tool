$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $projectRoot

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

@(
  (Join-Path $projectRoot "renderer-dist"),
  (Join-Path $projectRoot ".playwright-mcp"),
  (Join-Path $projectRoot "build\temp"),
  (Join-Path $projectRoot "SerialAssistant-portable.exe"),
  (Join-Path $projectRoot "SerialAssistant-V2.1-portable.exe")
) | ForEach-Object { Remove-PathWithRetry $_ }

if (Test-Path -LiteralPath (Join-Path $projectRoot "dist")) {
  Get-ChildItem -LiteralPath (Join-Path $projectRoot "dist") -Force |
    Where-Object {
      $_.Name -like ".build-*" -or
      $_.Name -eq "win-unpacked" -or
      ($_.Extension -eq ".blockmap")
    } |
    ForEach-Object { Remove-PathWithRetry $_.FullName }
}

Write-Host "Workspace cleanup complete."
