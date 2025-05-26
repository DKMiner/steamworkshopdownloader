# Steam Workshop Collection Downloader

Simple steam workshop collection downloader built using nodejs.
Capable of downloading both Steam Workshop collections and individual workshop items. Follow the instruction below to use this.

# Downloading collections

1. Firstly you will need Node JS installed in your pc. you can get it from [https://nodejs.org/en/download/](https://nodejs.org/en/download/).
2. Download or Clone the repository. (you can do it using the clone or download button and download zip, extract the zip into a folder.)
3. Open cmd or bash in the directory where repository was cloned. *(open cmd or bash and go to the directory. make sure it is prompting on the same drive c: or d: and use `cd <directory where you have the file from git>`.)*
4. Run `npm install` command on cmd or bash to install required libraries.
5. Now open urls.txt using any texteditor and put urls to **collections** as it is provided in given example. *(make sure that the url are to the collection and that they are seperated by line break `<enter>`)*
6. Run `npm start` command to start downloading. All your downloads should be under downloads folder.


*note: sometimes some workshop items are not downloaded using this method. Read the individual workshop item downloader part for that.*
*note 2: if you want to change the default file extension from .zip use `npm start <new extension>` command instead of `npm start`*

# Downloading individual workshop items (via SteamCMD)

1. Download and install SteamCMD and add it to PATH (visit [https://developer.valvesoftware.com/wiki/SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) for more info)
2. Run either download_with_SteamCMD.sh (Linux) or download_with_SteamCMD.bat (Windows) based on your system.
   
*Linux note: you may need to run chmod +x download_with_SteamCMD.sh on Linux before being able to execute the file*

*Windows note: either add SteamCMD to path or copy the directory where the executable is located by clicking on the address bar in the windows explorer*

4. Enter the App ID for the game you want to download the workshop items for.
5. Enter the Workshop IDs for items you wanna download. If there's more than one you can separate them by comma
6. Wait
7. Go to the location pointed out by SteamCMD

*note: conveniently, the node.js script gives you the workshop ID of failed downloads separated by comma. You can use that here easily :D*
