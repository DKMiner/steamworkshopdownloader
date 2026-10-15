@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0.runtime\node\node.exe" set "PATH=%~dp0.runtime\node;%PATH%"
title Steam Workshop Downloader

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found. Running setup...
    call setup.bat
    if errorlevel 1 exit /b 1
)
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%~dp0.runtime\node\node.exe" set "PATH=%~dp0.runtime\node;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js still isn't available. Close this window and rerun start.bat after installing it.
    pause
    exit /b 1
)
if not exist node_modules (
    echo Project dependencies are missing. Running setup...
    call setup.bat
    if errorlevel 1 exit /b 1
)
node index.js
if errorlevel 1 echo The downloader exited with an error.
pause
