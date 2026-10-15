#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=============================================="
echo "       Steam Workshop Downloader Setup"
echo "=============================================="
echo

have_node() { command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; }

if ! have_node; then
    echo "Node.js/npm were not found. Attempting to install them with the system package manager..."
    if command -v apt-get >/dev/null 2>&1; then
        if [ "$(id -u)" -eq 0 ]; then
            apt-get update
            apt-get install -y nodejs npm
        elif command -v sudo >/dev/null 2>&1; then
            sudo apt-get update
            sudo apt-get install -y nodejs npm
        else
            echo "Need root privileges to install Node.js. Install Node.js LTS from https://nodejs.org/en/download and rerun this script."
            exit 1
        fi
    elif command -v dnf >/dev/null 2>&1; then
        if [ "$(id -u)" -eq 0 ]; then
            dnf install -y nodejs npm
        elif command -v sudo >/dev/null 2>&1; then
            sudo dnf install -y nodejs npm
        else
            echo "Need root privileges to install Node.js. Install Node.js LTS from https://nodejs.org/en/download and rerun this script."
            exit 1
        fi
    elif command -v pacman >/dev/null 2>&1; then
        if [ "$(id -u)" -eq 0 ]; then
            pacman -Sy --needed --noconfirm nodejs npm
        elif command -v sudo >/dev/null 2>&1; then
            sudo pacman -Sy --needed --noconfirm nodejs npm
        else
            echo "Need root privileges to install Node.js. Install Node.js LTS from https://nodejs.org/en/download and rerun this script."
            exit 1
        fi
    else
        echo "Could not find a supported package manager (apt, dnf, pacman)."
        echo "Install Node.js LTS from https://nodejs.org/en/download and rerun this script."
        exit 1
    fi
fi

if ! have_node; then
    echo "Node.js/npm still aren't available in this shell."
    echo "Try opening a new terminal, or install Node.js LTS from https://nodejs.org/en/download."
    exit 1
fi

node --version
npm --version
echo
echo "Installing project dependencies..."
if ! npm ci; then
    echo "npm ci failed; trying npm install..."
    npm install
fi

if [ ! -f urls.txt ]; then
    printf '%s\n' '# Add Steam Workshop collection or individual-item URLs, one per line.' > urls.txt
fi

echo
echo "Setup completed. Run ./start.sh to open the menu."
