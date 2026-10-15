@echo off
setlocal
cd /d "%~dp0"
title Steam Workshop Downloader - Setup

echo ==============================================
echo       Steam Workshop Downloader Setup
echo ==============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js was not found. Attempting automatic installation...
    where winget >nul 2>&1
    if not errorlevel 1 (
        echo Trying Windows Package Manager...
        winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    )
)

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo Package installation did not make Node.js available. Trying the official Node.js LTS MSI...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $release=Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts -ne $false } | Select-Object -First 1; if (-not $release) { throw 'Could not find the latest LTS release.' }; $arch=if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }; if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { $arch='arm64' }; $msi=Join-Path $env:TEMP ('node-' + $release.version + '-' + $arch + '.msi'); $url='https://nodejs.org/dist/' + $release.version + '/node-' + $release.version + '-' + $arch + '.msi'; Write-Host ('Downloading ' + $url); Invoke-WebRequest -Uri $url -OutFile $msi; $p=Start-Process msiexec.exe -ArgumentList @('/i', ('\"' + $msi + '\"'), '/passive', '/norestart') -Wait -PassThru; if ($p.ExitCode -ne 0) { throw ('Node.js MSI exited with code ' + $p.ExitCode) }"
    if errorlevel 1 (
        echo.
        echo Automatic installation failed. Install Node.js LTS manually from https://nodejs.org/en/download
        echo Then close this window, open it again, and run setup.bat.
        pause
        exit /b 1
    )
)

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is installed but is not visible in this command window.
    echo Please close this window and run setup.bat again.
    pause
    exit /b 1
)

echo.
node --version
call npm --version
if errorlevel 1 (
    echo npm was not available. Please reinstall Node.js LTS from https://nodejs.org/en/download
    pause
    exit /b 1
)

echo.
echo Installing project dependencies...
call npm ci
if errorlevel 1 (
    echo npm ci failed. Trying npm install...
    call npm install
)
if errorlevel 1 (
    echo Dependency installation failed. Check your network and try again.
    pause
    exit /b 1
)

if not exist urls.txt (
    >urls.txt echo # Add Steam Workshop collection or individual-item URLs, one per line.
)

echo.
echo Setup completed. Run start.bat to open the menu.
pause
exit /b 0
