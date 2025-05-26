const fs = require("fs");
const jsdom = require("jsdom");
const axios = require("axios").default;
const { DownloaderHelper } = require("node-downloader-helper");

const { JSDOM } = jsdom;

const urls = fs.readFileSync("./urls.txt").toString().split("\n");

const failedDownloads = [];

function last(arr) {
    if (Array.isArray(arr) && arr.length > 0) {
        return arr[arr.length - 1];
    } else {
        return undefined;
    }
}

function validName(name) {
    return name
        .split(/[\*\/\\\|\?\"\'\:\;]/).join(" ")
        .split(/[{[<]/).join("(")
        .split(/[}\]>]/).join(")");
}

async function download(count = 0) {
    const url = urls[count];
    if (count >= urls.length) {
        if (failedDownloads.length > 0) {
            console.log("\n--- Download Summary ---");
            console.log("The following workshop items could not be downloaded:");
            failedDownloads.forEach(item => {
                console.log(`- Collection: "${item.collectionName}", Item: "${item.itemName}" (ID: ${item.workshopId || 'N/A'})`);
            });

            const failedWorkshopIds = failedDownloads
                .filter(item => item.workshopId && item.workshopId !== "N/A")
                .map(item => item.workshopId);

            if (failedWorkshopIds.length > 0) {
                console.log(`\nWorkshop ID for failed items: ${failedWorkshopIds.join(', ')}`);
            }
        } else {
            console.log("\nAll workshop items processed successfully!");
        }
        return;
    }

    const downloadDir = "./downloads";
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
    }

    if (url.includes("http")) {
        try {
            const { data } = await axios.get(url);

            const dom = new JSDOM(data);
            const window = dom.window;
            const document = window.document;
            const linkArray = [].slice.call(document.getElementsByClassName("collectionItemDetails")).map(a => a.children[0]);
            const namedUrlArray = linkArray.map(link => [link.href, link.children[0].textContent]);

            const collectionName = document.getElementsByClassName("workshopItemTitle")[0].textContent;
            const collectionDir = `${downloadDir}/${validName(collectionName)}`;

            if (!fs.existsSync(collectionDir)) {
                fs.mkdirSync(collectionDir);
            }

            const appId = last(
                document.getElementsByClassName('breadcrumbs')[0]
                    .getElementsByTagName('a')[0]
                    .href.split('/')
            );

            console.log(`\nDownloading collection: "${collectionName}"`);

            for (let idx = 0; idx < namedUrlArray.length; idx++) {
                const [link, packageName] = namedUrlArray[idx];
                const workshopId = link.split("?id=")[1];
                const itemDownloadPageUrl = `http://steamworkshop.download/download/view/${workshopId}`;
                const fileName = validName(`${packageName.split("/").join("")}${process.argv[2] || ".zip"}`);

                if (fs.existsSync(collectionDir + '/' + fileName)) {
                    console.log(`  Skipping "${packageName.split("/").join("")}", file already downloaded`);
                    continue; // Skip to the next item
                } else {
                    console.log(`  ${idx + 1}. Attempting to download "${packageName}"`);
                    let directDownloadUrl = null;

                    try {
                        const { data: itemPageData } = await axios.get(itemDownloadPageUrl);
                        const itemDom = new JSDOM(itemPageData);
                        const { window: itemWindow } = itemDom;
                        const { document: itemDocument } = itemWindow;

                        const subDownloadButton = itemDocument.getElementById("steamdownload");

                        if (subDownloadButton) {
                            let response = await axios.post("http://steamworkshop.download/online/steamonline.php", `item=${workshopId}&app=${appId}`);
                            if (response.data && typeof response.data === 'string' && response.data.includes("<a href='")) {
                                directDownloadUrl = last(response.data.split("<a href='")).split("'>")[0];
                            } else {
                                throw new Error("Unexpected response from steamonline.php or no download URL found.");
                            }
                        } else {
                            const linkElement = itemDocument.getElementsByTagName("table")[0]?.children[0]?.children[0]?.children[0]?.children[1]?.children[0];
                            if (linkElement && linkElement.href) {
                                directDownloadUrl = linkElement.href;
                            } else {
                                throw new Error("Direct download link not found on item page (no button, no table link).");
                            }
                        }

                        if (directDownloadUrl) {
                            console.log(`    Found download URL: ${directDownloadUrl}`);
                            await downloadAndSave(directDownloadUrl, collectionDir, fileName);
                            console.log(`    Successfully downloaded "${packageName}"`);
                        } else {
                            throw new Error("No direct download URL obtained after parsing.");
                        }
                    } catch (itemErr) {
                        console.error(`    Error processing or finding download for "${packageName}": ${itemErr.message}`);
                        failedDownloads.push({
                            collectionName,
                            itemName: packageName,
                            workshopId: workshopId,
                            error: itemErr.message
                        });
                    }
                }
            }
        } catch (collectionErr) {
            console.error(`Error processing collection URL "${url}": ${collectionErr.message}`);
            failedDownloads.push({
                collectionName: `Failed to process URL: ${url}`,
                itemName: "N/A",
                workshopId: "N/A",
                error: collectionErr.message
            });
        }
    } else {
        console.warn(`Skipping invalid URL: "${url}" (does not include "http")`);
    }

    await download(count + 1);
}

async function downloadAndSave(url, dir, fileName) {
    return new Promise((res, rej) => {
        if (!url || typeof url !== 'string' || !url.startsWith('http')) {
            const error = new Error(`Invalid download URL provided: ${url}`);
            console.error(`    Pre-download validation failed for ${fileName}:`, error.message);
            return rej(error);
        }

        const helper = new DownloaderHelper(url, dir, { fileName });
        helper.on('end', (...args) => {
            res(args);
        });
        helper.on('error', (err) => {
            console.error(`    DownloaderHelper error for "${fileName}" (URL: ${url}):`, err.message);
            rej(err);
        });
        helper.on('progress', (stats) => {
            process.stdout.write(`\r      Downloading ${fileName}: ${stats.progress.toFixed(2)}% at ${ (stats.speed / 1024 / 1024).toFixed(2) }MB/s`);
        });
        helper.on('skip', (skipStats) => {
            console.log(`      Skipping download for ${skipStats.fileName}. File already exists.`);
        });

        helper.start();
    });
}

download();
