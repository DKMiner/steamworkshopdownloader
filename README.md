# Steam Workshop Downloader

A cross-platform command-line tool for downloading Steam Workshop collections and individual items through SteamCMD.

## Getting started

**Windows:** run setup.bat, then run start.bat.

**Linux:** run:

    chmod +x setup.sh start.sh
    ./setup.sh
    ./start.sh

Setup checks for Node.js and npm, attempts automatic installation where practical, and installs the project dependencies. SteamCMD is downloaded automatically into the project's steamcmd directory the first time a download is requested. It does not search PATH or use a SteamCMD installation from the user's regular Steam setup.

## Main menu

1. **Download from urls.txt** — add one Steam Workshop collection URL or individual-item URL per line. The program reads collection contents and downloads the contained Workshop items through SteamCMD.
2. **Download by App ID and Workshop IDs** — enter one App ID and comma-separated Workshop IDs.
3. **Change download folder** — choose where completed downloads should be saved. The path is stored in options.ini.
4. **Install / repair SteamCMD** — download or refresh the application's private SteamCMD installation.
5. Exit.

## Download layout

The default output location is the project's downloads folder. It can be changed from the menu. Completed content uses this structure:

    downloads/
      collections/
        My beautiful collection/
          1234567890/
            Workshop files...
      items/
        Garry's Mod/
          1234567890/
            Workshop files...

- **Collection URLs:** Steam's collection details API supplies the member item IDs. Each item is downloaded with SteamCMD and saved in collections/<collection name>/<Workshop ID>/.
- **Individual item URLs:** the Workshop item ID and App ID are resolved from the Steam Workshop page and Steam's published-file details API, then the files are downloaded through SteamCMD into items/<game name>/<Workshop ID>/.
- **App ID mode:** files downloaded with SteamCMD are copied from its private working area to items/<game name>/<Workshop ID>/. The private working area is inside the project's steamcmd folder, not the user's usual Steam client directory.
- Game names are looked up from Steam Store data, with SteamDB as a fallback. If neither lookup works, the folder uses App <AppID>.

SteamCMD's verbose output is shown once in the terminal. A structured report is written to log.log, with timestamped copies in logs/. The program prints a short completion summary instead of printing the report a second time.

## Notes

- Workshop collections are groups of individual items; SteamCMD downloads those individual items, not the collection ID itself.
- Public items that permit anonymous access can generally be downloaded without signing into a personal Steam account. Some content may require permissions or may be unavailable through anonymous access; those failures are recorded in the report.
- options.ini stores the selected output path. The SteamCMD installation location is fixed to the project's steamcmd directory.
- The repository's .gitignore excludes downloads, SteamCMD runtime data, logs, and local configuration. These generated files should not be committed.

## Troubleshooting

1. Run setup.bat or ./setup.sh if Node.js dependencies are missing.
2. Choose **Install / repair SteamCMD** if the private SteamCMD installation is incomplete.
3. Check log.log or logs/ for the full report.
4. Copy failed Workshop IDs from section 3 and retry with menu option 2, using the correct App ID.

Licensed under the terms in LICENSE.
