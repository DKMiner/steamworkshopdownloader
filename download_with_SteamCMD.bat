@echo off
setlocal enableDelayedExpansion

:: --- Configuration ---
:: Default SteamCMD executable name
set "STEAMCMD_EXE_NAME=steamcmd.exe"
set "STEAMCMD_FULL_PATH="
set "STEAMCMD_DIR_LOCATION=" :: This variable will store the final directory path of SteamCMD

:: --- Main Script Logic ---

echo --- SteamCMD Workshop Downloader (Windows) ---
echo.

echo Checking if %STEAMCMD_EXE_NAME% is in your system PATH...
call :CheckForCommandInPath "%STEAMCMD_EXE_NAME%"

if defined STEAMCMD_FULL_PATH (
    echo %STEAMCMD_EXE_NAME% found in PATH: %STEAMCMD_FULL_PATH%
    :: Extract the directory from STEAMCMD_FULL_PATH if found in PATH
    for %%F in ("!STEAMCMD_FULL_PATH!") do set "STEAMCMD_DIR_LOCATION=%%~dpF"
) else (
    echo %STEAMCMD_EXE_NAME% not found in PATH.
    echo.
    set /p "STEAMCMD_DIR_INPUT=Please enter the full path to your SteamCMD directory (e.g., C:\SteamCMD): "

    set "STEAMCMD_DIR_INPUT=!STEAMCMD_DIR_INPUT:"=!"

    call :CheckForCommandInDirectory "%STEAMCMD_EXE_NAME%" "!STEAMCMD_DIR_INPUT!"

    if not defined STEAMCMD_FULL_PATH (
        echo Error: %STEAMCMD_EXE_NAME% not found in the provided directory "%STEAMCMD_DIR_INPUT%".
        echo Please ensure the path is correct and steamcmd.exe exists there.
        echo.
        echo Download SteamCMD from: https://developer.valvesoftware.com/wiki/SteamCMD
        echo.
        pause
        exit /b 1
    ) else (
        echo %STEAMCMD_EXE_NAME% found at: %STEAMCMD_FULL_PATH%
        :: If found via user input, that's already the directory
        set "STEAMCMD_DIR_LOCATION=!STEAMCMD_DIR_INPUT!"
    )
)

:: Ensure STEAMCMD_DIR_LOCATION has a trailing backslash for consistency
if not "!STEAMCMD_DIR_LOCATION:~-1!"=="\" set "STEAMCMD_DIR_LOCATION=!STEAMCMD_DIR_LOCATION!\"

echo.
echo SteamCMD executable found. Proceeding with download prompts.
echo.

set /p "GAME_STEAMID=Enter the Game SteamID (e.g., 255710 for Cities: Skylines, 730 for CS:GO): "
if "%GAME_STEAMID%"=="" (
    echo Game SteamID cannot be empty. Exiting.
    pause
    exit /b 1
)
set /p "WORKSHOP_IDS_INPUT=Enter Workshop IDs, separated by commas (e.g., 12345,67890): "
if "%WORKSHOP_IDS_INPUT%"=="" (
    echo No Workshop IDs entered. Exiting.
    pause
    exit /b 1
)

echo.
echo Starting downloads for Game SteamID: %GAME_STEAMID%
echo Workshop Items to download: %WORKSHOP_IDS_INPUT%
echo.
set "CURRENT_WORKSHOP_IDS=%WORKSHOP_IDS_INPUT%,"
set "INDEX=0"

:loop_workshop_ids
    :: Check if CURRENT_WORKSHOP_IDS is empty (meaning all processed or was initially empty)
    if "%CURRENT_WORKSHOP_IDS%"=="" goto :end_loop_workshop_ids

    :: Ensure CURRENT_WORKSHOP_IDS always has a trailing comma for this loop to work consistently
    if not "!CURRENT_WORKSHOP_IDS:~-1!"=="," set "CURRENT_WORKSHOP_IDS=!CURRENT_WORKSHOP_IDS!,"

    for /f "tokens=1* delims=," %%a in ("!CURRENT_WORKSHOP_IDS!") do (
        set "WORKSHOP_ID=%%a"
        set "CURRENT_WORKSHOP_IDS=%%b" :: This is the rest of the string after the first ID
    )

    for /f "tokens=* delims= " %%c in ("!WORKSHOP_ID!") do set "WORKSHOP_ID=%%c"

    if not "!WORKSHOP_ID!"=="" (
        echo ----------------------------------------------------
        echo Downloading workshop item: !WORKSHOP_ID!
        echo Command: "%STEAMCMD_FULL_PATH%" +login anonymous +workshop_download_item %GAME_STEAMID% !WORKSHOP_ID! validate +quit
        echo ----------------------------------------------------
        echo.

        "%STEAMCMD_FULL_PATH%" +login anonymous +workshop_download_item %GAME_STEAMID% !WORKSHOP_ID! validate +quit
        if %ERRORLEVEL% neq 0 (
            echo Error: Failed to download workshop item !WORKSHOP_ID!.
            echo This could be due to an invalid Workshop ID, incorrect Game SteamID, or a network issue.
            echo Please check the SteamCMD output above for details.
        ) else (
            echo Successfully initiated download for workshop item !WORKSHOP_ID!.
        )
        echo.
    ) else (
        echo Skipping empty Workshop ID.
        echo.
    )
    goto :loop_workshop_ids

:end_loop_workshop_ids

echo --- All requested workshop item downloads processed. ---
echo.
echo Workshop items are typically downloaded to locations like:
echo "C:\Program Files (x86)\Steam\steamapps\workshop\content\%GAME_STEAMID%\<WORKSHOP_ITEM_ID>\" (if SteamCMD uses main Steam install)
echo OR
echo "%STEAMCMD_DIR_LOCATION%steamapps\workshop\content\%GAME_STEAMID%\<WORKSHOP_ITEM_ID>\" (if SteamCMD is standalone)
echo.
echo The exact location depends on your SteamCMD setup. Look for a 'steamapps\workshop\content' folder.
echo.
pause
exit /b 0


:: --- Subroutines ---

:CheckForCommandInPath
    set "_command_name=%~1"
    set "STEAMCMD_FULL_PATH=" :: Clear previous value

    where "%_command_name%" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        for /f "delims=" %%i in ('where "%_command_name%"') do (
            set "STEAMCMD_FULL_PATH=%%i"
        )
    )
    goto :EOF

:CheckForCommandInDirectory
    set "_command_name=%~1"
    set "_check_dir=%~2"
    set "STEAMCMD_FULL_PATH=" :: Clear previous value

    if exist "%_check_dir%\%_command_name%" (
        set "STEAMCMD_FULL_PATH=%_check_dir%\%_command_name%"
    )
    goto :EOF
