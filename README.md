# Steam Workshop Downloader

A small cross-platform CLI for downloading public Steam Workshop items. It combines the original collection downloader and the individual SteamCMD retry scripts behind one menu.

## Quick start

**Windows:** extract the repository ZIP, then double-click setup.bat. When setup finishes, run start.bat.

**Linux:** extract/clone the repository and run these commands in a terminal:

    chmod +x setup.sh start.sh
    ./setup.sh
    ./start.sh

The setup script checks for Node.js/npm, attempts installation using the platform's package manager or a portable official Node.js LTS archive where practical, and installs the project's npm dependencies. If automatic installation is unavailable, install a supported Node.js LTS release from https://nodejs.org/en/download and run setup again.

## Menu

1. **Download from urls.txt** — put one Steam Workshop collection URL or individual item URL per line. The downloader detects collection pages by their item list, then attempts each item. Existing non-empty output files are skipped.
2. **Download by App ID + Workshop ID(s)** — enter the App ID, then Workshop IDs separated by commas, e.g. 12345,67890,112233. SteamCMD is started once and uses a runscript for one anonymous login followed by all requested IDs. The script continues after individual failures and avoids command-line length limits on Windows.
3. **Configure / download SteamCMD** — if SteamCMD is not in PATH, enter its folder or executable path (saved in options.ini) or download it into the project folder.
4. Exit.

## Files and output

- urls.txt — collection and individual item URLs for menu option 1.
- options.ini — locally saved SteamCMD executable path.
- downloads/ — output from URL mode.
- downloader.log — latest run log.
- logs/ — timestamped run logs.

Every log contains three sections: general startup/network/program output, completed items grouped by source URL and App ID, and failed or unconfirmed Workshop IDs grouped by App ID. The failed section is formatted so that IDs can be copied into menu option 2. SteamCMD's raw output is included in the general section.

## Notes

- Menu option 1 preserves the original third-party steamworkshop.download URL-resolution method. It depends on Steam Community pages being accessible and on that third-party service continuing to work. This path does not use SteamCMD.
- Menu option 2 uses SteamCMD and is intended for failed items or direct bulk downloads. Anonymous access may not work for every item; SteamCMD's own output is included in the log.
- A SteamCMD process returning exit code 0 is not treated as proof every ID succeeded. The tool looks for item-level success/failure output and checks the expected content directory; ambiguous items are listed as needing review rather than silently marked successful.
- Downloads from the original URL mode are ZIP archives and use .zip by default. To choose another extension, launch with an extension argument, e.g. node index.js .7z. Only the filename extension changes; it does not convert the downloaded archive.
- If SteamCMD's output directory differs from the detected common locations, follow the path printed by SteamCMD. The location can vary by operating system and Steam library configuration.

## Troubleshooting

1. Re-run setup.bat or ./setup.sh if dependencies are missing.
2. Select menu option 3 to update the SteamCMD path if it moved.
3. Inspect downloader.log and logs/ for item-level errors.
4. If an item fails in URL mode, copy its ID from section 3, select menu option 2, enter the matching App ID, and paste the comma-separated IDs.

This project is released under the license in LICENSE.
