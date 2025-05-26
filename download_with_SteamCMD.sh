#!/bin/bash

# --- Functions ---

command_exists () {
  command -v "$1" >/dev/null 2>&1
}

# --- Main Script Logic ---

echo "--- SteamCMD Workshop Downloader (Linux) ---"
echo ""

if ! command_exists "steamcmd"; then
    echo "Error: 'steamcmd' command not found."
    echo "SteamCMD is required to download workshop items."
    echo ""
    echo "Please install SteamCMD using your system's package manager or manually:"
    echo "  - For Debian/Ubuntu-based systems: sudo apt install steamcmd"
    echo "  - For Fedora/CentOS/RHEL: sudo dnf install steamcmd (or yum install steamcmd)"
    echo "  - For Arch Linux: sudo pacman -S steamcmd"
    echo "  - For other distributions or manual installation: Refer to the official Valve Developer Wiki:"
    echo "    https://developer.valvesoftware.com/wiki/SteamCMD"
    echo ""
    exit 1
fi

echo "SteamCMD command found. Proceeding with download prompts."
echo ""

read -p "Enter the Game SteamID (e.g., 255710 for Cities: Skylines, 730 for CS:GO): " GAME_STEAMID
if [[ -z "$GAME_STEAMID" ]]; then
    echo "Game SteamID cannot be empty. Exiting."
    exit 1
fi

read -p "Enter Workshop IDs, separated by commas (e.g., 12345,67890): " WORKSHOP_IDS_INPUT
if [[ -z "$WORKSHOP_IDS_INPUT" ]]; then
    echo "No Workshop IDs entered. Exiting."
    exit 1
fi

IFS=',' read -r -a WORKSHOP_ID_ARRAY <<< "$WORKSHOP_IDS_INPUT"

echo ""
echo "Starting downloads for Game SteamID: $GAME_STEAMID"
echo "Workshop Items to download: ${WORKSHOP_ID_ARRAY[*]}"
echo ""

for WORKSHOP_ID in "${WORKSHOP_ID_ARRAY[@]}"; do
    WORKSHOP_ID=$(echo "$WORKSHOP_ID" | xargs) # Trim whitespace

    if [[ -z "$WORKSHOP_ID" ]]; then
        echo "Skipping empty Workshop ID."
        continue
    fi

    echo "----------------------------------------------------"
    echo "Downloading workshop item: $WORKSHOP_ID"
    echo "Command: steamcmd +login anonymous +workshop_download_item $GAME_STEAMID $WORKSHOP_ID validate +quit"
    echo "----------------------------------------------------"

    if ! steamcmd +login anonymous +workshop_download_item "$GAME_STEAMID" "$WORKSHOP_ID" validate +quit; then
        echo "Error: Failed to download workshop item $WORKSHOP_ID."
        echo "This could be due to an invalid Workshop ID, incorrect Game SteamID, or a network issue."
        echo "Please check the SteamCMD output above for details."
    else
        echo "Successfully initiated download for workshop item $WORKSHOP_ID."
    fi
    echo ""
done

echo "--- All requested workshop item downloads processed. ---"
echo "Workshop items are typically downloaded to: "
echo "$HOME/.local/share/Steam/steamapps/workshop/content/$GAME_STEAMID/"
echo "Please check that directory for your downloaded files."
echo ""
