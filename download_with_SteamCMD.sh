#!/usr/bin/env bash
# Compatibility launcher. The unified downloader handles SteamCMD discovery,
# saved configuration, bulk downloads, and logging.
cd "$(dirname "$0")"
exec ./start.sh
