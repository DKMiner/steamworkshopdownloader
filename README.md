# Steam Workshop Downloader

A cross-platform command-line tool for downloading Steam Workshop collections and individual items.

## Getting started

**Windows:** run setup.bat, then run start.bat.

**Linux:** run:

    chmod +x setup.sh start.sh
    ./setup.sh
    ./start.sh

Setup checks for Node.js and npm, attempts automatic installation where practical, then installs the project dependencies. SteamCMD is configured separately from the main menu when direct Workshop downloads are needed.

## Main menu

1. **Download from urls.txt** — add one Steam Workshop collection URL or individual-item URL per line. The program detects collection pages automatically.
2. **Download by App ID and Workshop IDs** — enter one App ID and comma-separated Workshop IDs.
3. **Change download folder** — choose where downloaded content should be saved. The path is stored in options.ini.
4. **SteamCMD settings** — select an existing SteamCMD installation or download a private copy.
5. Exit.

## Download layout

The default download location is the project's downloads folder. It can be changed from the menu. Both modes use the following structure:

    downloads/
      collections/
        TTT maps/
          item-name.zip
      items/
        Garry's Mod/
          1234567890/
            Workshop item files...

- **Collection URLs:** downloaded archives are stored in collections/<collection name>/. The name is read from the Workshop collection page, so a collection such as "TTT maps" gets that folder name.
- **Individual URLs:** archives are stored in items/<game name>/.
- **App ID mode:** SteamCMD's item files are staged in an application-managed SteamCMD runtime, then moved into items/<game name>/<Workshop ID>/. The code does not search the user's regular Steam library locations. SteamCMD's runtime is kept separate from the chosen output folder.
- The game name is looked up from Steam Store data, with SteamDB as a fallback. If neither lookup works, the folder uses App <AppID>.

options.ini stores the chosen output path and SteamCMD configuration. Download reports are printed after a run and saved to downloader.log; timestamped reports go in logs/.

## Notes

- URL mode keeps the original third-party steamworkshop.download resolver. It depends on Steam Community pages and that external service being available.
- App ID mode uses SteamCMD and may fail on items that do not permit anonymous downloads. Failed or unconfirmed IDs are grouped by App ID in the report so they can be retried.
- ZIP mode downloads archives; changing the extension argument (for example, node index.js .7z) changes the filename extension only, it does not convert the archive.
- The repository includes .gitignore entries for downloads, logs, local SteamCMD runtimes, temporary scripts, and local configuration. These files are generated locally and should not be committed.

## Troubleshooting

1. Run setup.bat or ./setup.sh if Node.js dependencies are missing.
2. Use SteamCMD settings to update the configured SteamCMD location.
3. Check downloader.log and logs/ for the full report.
4. Copy failed IDs from report section 3 and retry them with menu option 2.

Licensed under the terms in LICENSE.
