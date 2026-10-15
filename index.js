'use strict';

const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { spawn } = require('child_process');
const readline = require('readline');
const axios = require('axios').default;
const { JSDOM } = require('jsdom');

const ROOT = __dirname;
const URLS_FILE = path.join(ROOT, 'urls.txt');
const DEFAULT_DOWNLOAD_DIR = path.join(ROOT, 'downloads');
const STEAMCMD_DIR = path.join(ROOT, 'steamcmd');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(ROOT, 'log.log');
const OPTIONS_FILE = path.join(ROOT, 'options.ini');
const gameNameCache = new Map();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise(function (resolve) {
        rl.question(question, function (answer) { resolve(answer.trim()); });
    });
}

function validName(name) {
    const cleaned = String(name || 'Workshop item')
        .replace(/[\*\/\\\|\?"'\:\;]/g, ' ')
        .replace(/[{[<]/g, '(')
        .replace(/[}\]>]/g, ')')
        .replace(/[\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '')
        .slice(0, 120);
    return cleaned || 'Workshop item';
}

function readOptions() {
    const options = {};
    if (!fs.existsSync(OPTIONS_FILE)) return options;
    const lines = fs.readFileSync(OPTIONS_FILE, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        options[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return options;
}

function saveOption(key, value) {
    const options = readOptions();
    options[key] = value;
    const lines = [
        '# Steam Workshop Downloader settings',
        '# This file is maintained by the application.'
    ];
    for (const name of Object.keys(options).sort()) lines.push(name + '=' + options[name]);
    fs.writeFileSync(OPTIONS_FILE, lines.join('\n') + '\n', 'utf8');
}

function getOutputPath() {
    const options = readOptions();
    const configured = String(options.outputPath || '').trim().replace(/^["']|["']$/g, '');
    return path.resolve(configured || DEFAULT_DOWNLOAD_DIR);
}

function ensureOutputDirectories() {
    const root = getOutputPath();
    fs.mkdirSync(path.join(root, 'collections'), { recursive: true });
    fs.mkdirSync(path.join(root, 'items'), { recursive: true });
    return root;
}

async function changeOutputFolder() {
    console.log('\nCurrent download folder: ' + getOutputPath());
    const entered = await ask('Enter the new folder path (leave empty to cancel): ');
    if (!entered) {
        console.log('No changes made.');
        return;
    }

    const selected = path.resolve(entered.replace(/^["']|["']$/g, ''));
    try {
        fs.mkdirSync(path.join(selected, 'collections'), { recursive: true });
        fs.mkdirSync(path.join(selected, 'items'), { recursive: true });
        saveOption('outputPath', selected);
        console.log('Download folder saved: ' + selected);
    } catch (err) {
        console.error('Could not use that folder: ' + err.message);
    }
}

function expectedSteamCmdNames() {
    return process.platform === 'win32' ? ['steamcmd.exe'] : ['steamcmd.sh', 'steamcmd'];
}

function resolveSteamCmdCandidate(candidate) {
    if (!candidate) return null;
    const expanded = path.resolve(candidate);
    const names = expectedSteamCmdNames();

    try {
        if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
            const base = path.basename(expanded).toLowerCase();
            if (names.some(function (name) { return name.toLowerCase() === base; })) return expanded;
        }
    } catch (_) {}

    try {
        if (fs.existsSync(expanded) && fs.statSync(expanded).isDirectory()) {
            for (const name of names) {
                const possible = path.join(expanded, name);
                if (fs.existsSync(possible) && fs.statSync(possible).isFile()) return possible;
            }
        }
    } catch (_) {}

    return null;
}

// SteamCMD is always installed and run from this project's own directory.
// System PATH entries and externally supplied SteamCMD paths are deliberately ignored.
function findSteamCmd() {
    return resolveSteamCmdCandidate(STEAMCMD_DIR);
}

function createRun(mode) {
    return { started: new Date(), mode: mode, general: [], completed: [], failed: [], otherFailures: [] };
}

function logInfo(run, message) {
    console.log(message);
    run.general.push(message);
}

function addSuccess(run, item) { run.completed.push(item); }
function addFailure(run, item) { run.failed.push(item); }

function saveReport(run) {
    const output = [];
    output.push('STEAM WORKSHOP DOWNLOADER LOG');
    output.push('Started: ' + run.started.toISOString());
    output.push('Finished: ' + new Date().toISOString());
    output.push('Mode: ' + run.mode);
    output.push('');
    output.push('========== 1. GENERAL INFORMATION ==========');
    output.push.apply(output, run.general.length ? run.general : ['No general messages recorded.']);
    output.push('');
    output.push('========== 2. SUCCESSFUL ITEMS ==========');

    if (!run.completed.length) {
        output.push('No items were confirmed as completed.');
    } else {
        const groups = new Map();
        for (const item of run.completed) {
            const key = [
                item.sourceType || 'Source',
                item.sourceLabel || '(not specified)',
                item.appId || 'UNKNOWN'
            ].join('\n');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        }

        for (const entries of groups.values()) {
            const first = entries[0];
            output.push((first.sourceType || 'Source') + ': ' + (first.sourceLabel || '(not specified)'));
            if (first.collectionName) output.push('  Collection name: ' + first.collectionName);
            output.push('  App ID: ' + (first.appId || 'UNKNOWN'));
            output.push('  Workshop IDs: ' + entries.map(function (item) { return item.workshopId; }).join(', '));
            for (const item of entries) {
                if (item.note) output.push('  Note for ' + item.workshopId + ': ' + item.note);
            }
        }
    }

    output.push('');
    output.push('========== 3. ITEMS THAT FAILED OR NEED REVIEW ==========');

    if (!run.failed.length && !run.otherFailures.length) {
        output.push('No failures were recorded.');
    } else {
        const groups = new Map();
        for (const item of run.failed) {
            const appId = item.appId || 'UNKNOWN';
            if (!groups.has(appId)) groups.set(appId, []);
            groups.get(appId).push(item);
        }

        for (const pair of groups.entries()) {
            output.push('App ID: ' + pair[0]);
            output.push('Workshop IDs: ' + pair[1].map(function (item) { return item.workshopId; }).join(', '));
            for (const item of pair[1]) {
                output.push('  - ' + item.workshopId + ': ' + item.error);
                if (item.sourceLabel) output.push('    Source: ' + item.sourceLabel);
            }
        }

        if (run.otherFailures.length) {
            output.push('Other URL / collection failures:');
            for (const item of run.otherFailures) output.push('  - ' + item.sourceLabel + ': ' + item.error);
        }
    }

    output.push('');
    const report = output.join('\n') + '\n';

    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.writeFileSync(LOG_FILE, report, 'utf8');
        const stamp = run.started.toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(LOG_DIR, 'run-' + stamp + '.log'), report, 'utf8');
        console.log('\nRun summary: ' + run.completed.length + ' completed, ' + run.failed.length + ' failed or unconfirmed.');
        console.log('Logs saved to ' + LOG_FILE + ' and ' + LOG_DIR + path.sep);
    } catch (err) {
        console.error('Could not save the log file: ' + err.message);
    }
}

function parseWorkshopIds(input) {
    const ids = [];
    const seen = new Set();
    for (const raw of String(input || '').split(',')) {
        const id = raw.trim();
        if (!id) continue;
        if (!/^\d+$/.test(id) || /^0+$/.test(id)) {
            throw new Error('Invalid Workshop ID: "' + id + '". IDs must be positive numbers separated by commas.');
        }
        if (!seen.has(id)) {
            ids.push(id);
            seen.add(id);
        }
    }
    if (!ids.length) throw new Error('Enter at least one Workshop ID.');
    return ids;
}

function parseAppId(input) {
    const appId = String(input || '').trim();
    if (!/^\d+$/.test(appId) || /^0+$/.test(appId)) throw new Error('App ID must be a positive number.');
    return appId;
}

function runProcess(executable, args, options) {
    return new Promise(function (resolve, reject) {
        const child = spawn(executable, args, Object.assign({ windowsHide: true }, options || {}));
        let stdout = '';
        let stderr = '';
        if (child.stdout) child.stdout.on('data', function (chunk) { stdout += chunk.toString(); });
        if (child.stderr) child.stderr.on('data', function (chunk) { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', function (code) {
            if (code === 0) resolve({ stdout: stdout, stderr: stderr, code: code });
            else reject(new Error((stderr || stdout || (executable + ' exited with code ' + code)).trim()));
        });
    });
}

function downloadToFile(url, destination) {
    return axios.get(url, { responseType: 'stream', timeout: 120000, maxRedirects: 5 }).then(function (response) {
        return new Promise(function (resolve, reject) {
            const file = fs.createWriteStream(destination);
            let settled = false;
            function fail(err) {
                if (settled) return;
                settled = true;
                try { file.close(); } catch (_) {}
                reject(err);
            }
            response.data.on('error', fail);
            file.on('error', fail);
            file.on('finish', function () {
                if (settled) return;
                settled = true;
                resolve();
            });
            response.data.pipe(file);
        });
    });
}

async function downloadSteamCMD() {
    if (process.platform !== 'win32' && process.platform !== 'linux') {
        throw new Error('Automatic SteamCMD installation currently supports Windows and Linux.');
    }

    fs.mkdirSync(STEAMCMD_DIR, { recursive: true });
    console.log('Installing SteamCMD into the project folder...');

    if (process.platform === 'win32') {
        const archive = path.join(ROOT, '.steamcmd-download.zip');
        try {
            await downloadToFile('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip', archive);
            const psPath = archive.replace(/'/g, "''");
            const psDir = STEAMCMD_DIR.replace(/'/g, "''");
            const command = "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '" + psPath + "' -DestinationPath '" + psDir + "' -Force";
            await runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: ROOT });
        } finally {
            try { fs.unlinkSync(archive); } catch (_) {}
        }
    } else {
        const archive = path.join(ROOT, '.steamcmd-download.tar.gz');
        try {
            await downloadToFile('https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz', archive);
            await runProcess('tar', ['-xzf', archive, '-C', STEAMCMD_DIR], { cwd: ROOT });
        } finally {
            try { fs.unlinkSync(archive); } catch (_) {}
        }

        const shellPath = path.join(STEAMCMD_DIR, 'steamcmd.sh');
        if (fs.existsSync(shellPath)) fs.chmodSync(shellPath, 0o755);
    }

    const found = findSteamCmd();
    if (!found) throw new Error('SteamCMD was downloaded, but its executable was not found in ' + STEAMCMD_DIR);
    console.log('SteamCMD is ready.');
    return found;
}

async function ensureSteamCMD() {
    const installed = findSteamCmd();
    if (installed) return installed;

    console.log('SteamCMD has not been installed for this downloader yet. It will be downloaded automatically.');
    return downloadSteamCMD();
}

async function getGameName(appId) {
    const key = String(appId);
    if (gameNameCache.has(key)) return gameNameCache.get(key);

    let name = null;
    try {
        const response = await axios.get('https://store.steampowered.com/api/appdetails', {
            params: { appids: key, l: 'english' },
            timeout: 15000,
            headers: { 'User-Agent': 'SteamWorkshopDownloader/1.0' }
        });
        const details = response.data && response.data[key];
        if (details && details.success && details.data && details.data.name) name = details.data.name;
    } catch (_) {}

    if (!name) {
        try {
            const response = await axios.get('https://steamdb.info/app/' + encodeURIComponent(key) + '/', {
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SteamWorkshopDownloader/1.0)' }
            });
            const dom = new JSDOM(response.data);
            const meta = dom.window.document.querySelector('meta[property="og:title"], meta[name="title"]');
            name = meta && meta.content ? meta.content.replace(/\s*[|·-]\s*SteamDB.*$/i, '').trim() : null;
            if (!name) {
                const title = dom.window.document.title || '';
                name = title.replace(/\s*[|·-]\s*SteamDB.*$/i, '').trim() || null;
            }
            dom.window.close();
        } catch (_) {}
    }

    const safeName = validName(name || ('App ' + key));
    gameNameCache.set(key, safeName);
    return safeName;
}

function parseWorkshopIdFromUrl(value) {
    try {
        const url = new URL(value);
        const id = url.searchParams.get('id');
        return id && /^\d+$/.test(id) && !/^0+$/.test(id) ? id : null;
    } catch (_) {
        return null;
    }
}

function extractAppId(document) {
    const selectors = [
        '.breadcrumbs a[href*="/app/"]',
        'a[href*="steamcommunity.com/app/"]',
        'a[href*="/app/"]'
    ];
    for (const selector of selectors) {
        const anchors = Array.from(document.querySelectorAll(selector));
        for (const anchor of anchors) {
            const match = String(anchor.href || '').match(/\/app\/(\d+)(?:\/|$|[?#])/);
            if (match) return match[1];
        }
    }
    return null;
}

function getHtmlCollectionItems(document) {
    const result = [];
    const seen = new Set();
    const containers = Array.from(document.getElementsByClassName('collectionItemDetails'));
    for (const container of containers) {
        const link = container.querySelector('a[href*="sharedfiles/filedetails"], a[href*="?id="]') || container.querySelector('a[href]');
        if (!link || !link.href) continue;
        const id = parseWorkshopIdFromUrl(link.href);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const name = (link.textContent || container.textContent || '').replace(/\s+/g, ' ').trim();
        result.push({ workshopId: id, name: name || ('Workshop item ' + id) });
    }
    return result;
}

async function fetchCollectionChildren(collectionId) {
    const body = querystring.stringify({
        collectioncount: '1',
        'publishedfileids[0]': String(collectionId)
    });
    const response = await axios.post(
        'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/',
        body,
        {
            timeout: 30000,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SteamWorkshopDownloader/1.0' }
        }
    );

    const details = response.data &&
        response.data.response &&
        response.data.response.collectiondetails &&
        response.data.response.collectiondetails[0];

    if (!details || Number(details.result) !== 1 || !Array.isArray(details.children)) return [];
    return details.children.map(function (child) {
        return { workshopId: String(child.publishedfileid), name: 'Workshop item ' + String(child.publishedfileid) };
    }).filter(function (child) { return /^\d+$/.test(child.workshopId); });
}

async function fetchPublishedFileDetails(ids) {
    const results = new Map();
    const uniqueIds = Array.from(new Set(ids.map(String)));

    for (let offset = 0; offset < uniqueIds.length; offset += 100) {
        const batch = uniqueIds.slice(offset, offset + 100);
        const form = { itemcount: String(batch.length) };
        batch.forEach(function (id, index) { form['publishedfileids[' + index + ']'] = id; });

        try {
            const response = await axios.post(
                'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
                querystring.stringify(form),
                {
                    timeout: 30000,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SteamWorkshopDownloader/1.0' }
                }
            );
            const items = response.data &&
                response.data.response &&
                response.data.response.publishedfiledetails;

            if (Array.isArray(items)) {
                for (const item of items) {
                    const id = String(item.publishedfileid || '');
                    if (!id) continue;
                    const appId = item.consumer_app_id || item.creator_app_id || '';
                    results.set(id, {
                        workshopId: id,
                        name: item.title ? String(item.title) : ('Workshop item ' + id),
                        appId: appId ? String(appId) : null
                    });
                }
            }
        } catch (_) {
            // Keep the URL/page metadata as a fallback if Steam's details API is unavailable.
        }
    }

    return results;
}

function getStagedWorkshopContent(appId, workshopId) {
    const itemDir = path.join(STEAMCMD_DIR, 'steamapps', 'workshop', 'content', String(appId), String(workshopId));
    try {
        if (fs.existsSync(itemDir) && fs.statSync(itemDir).isDirectory() && fs.readdirSync(itemDir).length > 0) {
            return itemDir;
        }
    } catch (_) {}
    return null;
}

function copyWorkshopContent(sourceDir, destinationDir) {
    fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
    const temporaryDestination = destinationDir + '.partial-' + process.pid;

    fs.rmSync(temporaryDestination, { recursive: true, force: true });
    fs.cpSync(sourceDir, temporaryDestination, { recursive: true, force: true });

    if (fs.existsSync(destinationDir)) fs.rmSync(destinationDir, { recursive: true, force: true });
    fs.renameSync(temporaryDestination, destinationDir);
}

async function downloadViaSteamCMD(run, requests) {
    if (!requests.length) return;

    const steamcmdPath = await ensureSteamCMD();
    const outputRoot = ensureOutputDirectories();
    const downloads = new Map();

    for (const request of requests) {
        const appId = String(request.appId || '');
        const workshopId = String(request.workshopId || '');

        if (!/^\d+$/.test(appId) || /^0+$/.test(appId)) {
            addFailure(run, {
                appId: appId || 'UNKNOWN',
                workshopId: workshopId || 'UNKNOWN',
                sourceLabel: request.sourceLabel || '',
                error: 'Could not determine a valid App ID for this Workshop item.'
            });
            continue;
        }
        if (!/^\d+$/.test(workshopId) || /^0+$/.test(workshopId)) {
            addFailure(run, {
                appId: appId,
                workshopId: workshopId || 'UNKNOWN',
                sourceLabel: request.sourceLabel || '',
                error: 'Invalid Workshop item ID.'
            });
            continue;
        }

        const key = appId + ':' + workshopId;
        if (!downloads.has(key)) {
            downloads.set(key, { appId: appId, workshopId: workshopId, targets: [] });
        }

        const target = downloads.get(key);
        const targetKey = [
            request.collectionName ? 'collection' : 'item',
            request.collectionName || '',
            request.sourceLabel || '',
            request.sourceType || '',
            request.itemName || ''
        ].join('|');

        if (!target.targets.some(function (existing) { return existing.targetKey === targetKey; })) {
            target.targets.push(Object.assign({}, request, { targetKey: targetKey }));
        }
    }

    const workItems = Array.from(downloads.values());
    if (!workItems.length) return;

    for (const workItem of workItems) {
        workItem.gameName = await getGameName(workItem.appId);
    }

    const scriptPath = path.join(STEAMCMD_DIR, 'batch-' + Date.now() + '.txt');
    const scriptLines = [
        '@ShutdownOnFailedCommand 0',
        '@NoPromptForPassword 1',
        'login anonymous'
    ];

    for (const item of workItems) {
        scriptLines.push('workshop_download_item ' + item.appId + ' ' + item.workshopId + ' validate');
    }
    scriptLines.push('quit');
    fs.writeFileSync(scriptPath, scriptLines.join('\n') + '\n', 'utf8');

    logInfo(run, 'Output folder: ' + outputRoot);
    logInfo(run, 'SteamCMD: ' + steamcmdPath);
    logInfo(run, 'Workshop items queued: ' + workItems.length);
    logInfo(run, 'SteamCMD will continue processing after individual item failures.');
    console.log('\nStarting SteamCMD...\n');

    let combinedOutput = '';
    let spawnError = null;
    const exitCode = await new Promise(function (resolve) {
        let settled = false;
        function finish(code) {
            if (settled) return;
            settled = true;
            resolve(code);
        }

        let child;
        try {
            child = spawn(steamcmdPath, ['+runscript', path.basename(scriptPath)], {
                cwd: STEAMCMD_DIR,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });
        } catch (err) {
            spawnError = err;
            finish(-1);
            return;
        }

        function capture(chunk) {
            const chunkText = chunk.toString();
            combinedOutput += chunkText;
            // Keep SteamCMD verbose, but only send its output to the terminal once.
            process.stdout.write(chunkText);
            chunkText.split(/[\r\n]+/).forEach(function (line) {
                if (line.trim()) run.general.push('[SteamCMD] ' + line.trim());
            });
        }

        if (child.stdout) child.stdout.on('data', capture);
        if (child.stderr) child.stderr.on('data', capture);
        child.on('error', function (err) {
            spawnError = err;
            finish(-1);
        });
        child.on('close', finish);
    });

    try { fs.unlinkSync(scriptPath); } catch (_) {}
    if (spawnError) logInfo(run, 'Could not start SteamCMD: ' + spawnError.message);
    else logInfo(run, 'SteamCMD process exited with code: ' + exitCode);

    const outputLines = combinedOutput.split(/[\r\n]+/);

    for (const item of workItems) {
        const failureRegex = new RegExp('(ERROR!.*\\b' + item.workshopId + '\\b|failed.*\\b' + item.workshopId + '\\b)', 'i');
        let failureLine = null;

        for (const line of outputLines) {
            if (failureRegex.test(line)) {
                failureLine = line.trim();
                break;
            }
        }

        const stagedDir = getStagedWorkshopContent(item.appId, item.workshopId);
        if (failureLine || !stagedDir) {
            const reason = failureLine
                ? 'SteamCMD reported: ' + failureLine
                : (spawnError
                    ? spawnError.message
                    : 'SteamCMD did not leave item files in ' + path.join(STEAMCMD_DIR, 'steamapps', 'workshop', 'content', item.appId, item.workshopId));

            for (const target of item.targets) {
                addFailure(run, {
                    sourceType: target.sourceType || 'Manual AppID entry',
                    sourceLabel: target.sourceLabel || 'Manual AppID entry',
                    collectionName: target.collectionName || '',
                    appId: item.appId,
                    workshopId: item.workshopId,
                    error: reason
                });
            }
            continue;
        }

        let allTargetsSaved = true;
        for (const target of item.targets) {
            const destination = target.collectionName
                ? path.join(outputRoot, 'collections', validName(target.collectionName), item.workshopId)
                : path.join(outputRoot, 'items', item.gameName, item.workshopId);

            try {
                copyWorkshopContent(stagedDir, destination);
                logInfo(run, 'Saved Workshop item ' + item.workshopId + ' to ' + destination);
                addSuccess(run, {
                    sourceType: target.sourceType || 'Manual AppID entry',
                    sourceLabel: target.sourceLabel || 'Manual AppID entry',
                    collectionName: target.collectionName || '',
                    appId: item.appId,
                    gameName: item.gameName,
                    workshopId: item.workshopId,
                    note: 'Downloaded using SteamCMD.'
                });
            } catch (err) {
                allTargetsSaved = false;
                addFailure(run, {
                    sourceType: target.sourceType || 'Manual AppID entry',
                    sourceLabel: target.sourceLabel || 'Manual AppID entry',
                    collectionName: target.collectionName || '',
                    appId: item.appId,
                    workshopId: item.workshopId,
                    error: 'Downloaded by SteamCMD, but could not save to the output folder: ' + err.message
                });
            }
        }

        if (allTargetsSaved) {
            try { fs.rmSync(stagedDir, { recursive: true, force: true }); } catch (_) {}
        }
    }
}

async function runUrlMode() {
    const run = createRun('Download from urls.txt');
    const requests = [];

    try {
        logInfo(run, 'Reading URLs from ' + URLS_FILE);
        logInfo(run, 'Output folder: ' + getOutputPath());

        if (!fs.existsSync(URLS_FILE)) {
            fs.writeFileSync(URLS_FILE, '# Add Steam Workshop collection URLs or individual item URLs, one per line.\n', 'utf8');
            throw new Error('Created urls.txt because it did not exist. Add URLs and run this option again.');
        }

        const urls = fs.readFileSync(URLS_FILE, 'utf8').split(/\r?\n/)
            .map(function (line) { return line.trim(); })
            .filter(function (line) { return line && !line.startsWith('#'); });

        if (!urls.length) throw new Error('urls.txt contains no URLs.');

        logInfo(run, 'Checking ' + urls.length + ' URL(s) and preparing Workshop items.');
        ensureOutputDirectories();

        for (const url of urls) {
            let parsed;
            try {
                parsed = new URL(url);
            } catch (_) {
                run.otherFailures.push({ sourceLabel: url, error: 'Invalid URL.' });
                logInfo(run, 'Skipped invalid URL: ' + url);
                continue;
            }

            if (!/(^|\.)steamcommunity\.com$/i.test(parsed.hostname) || !parsed.pathname.includes('sharedfiles/filedetails')) {
                run.otherFailures.push({ sourceLabel: url, error: 'Expected a Steam Community Workshop item or collection URL.' });
                logInfo(run, 'Skipped unsupported URL: ' + url);
                continue;
            }

            const urlWorkshopId = parseWorkshopIdFromUrl(url);
            if (!urlWorkshopId) {
                run.otherFailures.push({ sourceLabel: url, error: 'Could not extract a Workshop ID from this URL.' });
                logInfo(run, 'Could not extract a Workshop ID: ' + url);
                continue;
            }

            let dom = null;
            try {
                logInfo(run, '\nReading Steam Workshop page: ' + url);
                const response = await axios.get(url, {
                    timeout: 45000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SteamWorkshopDownloader/1.0)' }
                });
                dom = new JSDOM(response.data, { url: url });

                const document = dom.window.document;
                const pageAppId = extractAppId(document);
                const titleElement = document.querySelector('.workshopItemTitle');
                const pageTitle = validName((titleElement && titleElement.textContent) || document.title || ('Workshop ' + urlWorkshopId));
                const htmlChildren = getHtmlCollectionItems(document);

                let apiChildren = [];
                try {
                    apiChildren = await fetchCollectionChildren(urlWorkshopId);
                } catch (apiErr) {
                    logInfo(run, 'Steam collection API was unavailable for this URL; checking the page contents instead.');
                }

                const childMap = new Map();
                for (const child of htmlChildren) childMap.set(child.workshopId, child);
                for (const child of apiChildren) {
                    const existing = childMap.get(child.workshopId);
                    childMap.set(child.workshopId, {
                        workshopId: child.workshopId,
                        name: existing && existing.name ? existing.name : child.name
                    });
                }

                const isCollection = childMap.size > 0;
                const ids = isCollection ? Array.from(childMap.keys()) : [urlWorkshopId];

                if (isCollection) {
                    logInfo(run, 'Collection detected: "' + pageTitle + '" (' + ids.length + ' items).');
                } else {
                    logInfo(run, 'Individual Workshop item detected: ' + urlWorkshopId);
                }

                const detailsMap = await fetchPublishedFileDetails(ids);

                for (const workshopId of ids) {
                    const fileDetails = detailsMap.get(workshopId);
                    const fallbackHtml = childMap.get(workshopId);
                    const appId = (fileDetails && fileDetails.appId) || pageAppId;

                    if (!appId) {
                        addFailure(run, {
                            appId: 'UNKNOWN',
                            workshopId: workshopId,
                            sourceLabel: url,
                            error: 'Could not determine the App ID for this Workshop item.'
                        });
                        continue;
                    }

                    requests.push({
                        sourceType: isCollection ? 'Collection URL' : 'Item URL',
                        sourceLabel: url,
                        collectionName: isCollection ? pageTitle : '',
                        appId: String(appId),
                        workshopId: workshopId,
                        itemName: (fileDetails && fileDetails.name) || (fallbackHtml && fallbackHtml.name) || ('Workshop item ' + workshopId)
                    });
                }
            } catch (err) {
                run.otherFailures.push({ sourceLabel: url, error: err.message });
                logInfo(run, 'Could not process URL ' + url + ': ' + err.message);
            } finally {
                if (dom) dom.window.close();
            }
        }

        if (requests.length) {
            logInfo(run, '\nSending ' + requests.length + ' Workshop item request(s) to SteamCMD.');
            await downloadViaSteamCMD(run, requests);
        } else {
            logInfo(run, 'No downloadable Workshop items were found in urls.txt.');
        }
    } catch (err) {
        logInfo(run, 'URL mode stopped: ' + err.message);
    } finally {
        logInfo(run, 'URL mode finished.');
        saveReport(run);
    }
}

async function runIdMode() {
    const run = createRun('Download by App ID and Workshop IDs');

    try {
        const appId = parseAppId(await ask('Enter the Steam App ID: '));
        const ids = parseWorkshopIds(await ask('Enter Workshop ID(s), separated by commas: '));
        const requests = ids.map(function (id) {
            return {
                sourceType: 'Manual AppID entry',
                sourceLabel: 'Manual AppID entry',
                collectionName: '',
                appId: appId,
                workshopId: id,
                itemName: 'Workshop item ' + id
            };
        });

        await downloadViaSteamCMD(run, requests);
    } catch (err) {
        logInfo(run, 'Download could not start: ' + err.message);
    } finally {
        saveReport(run);
    }
}

async function main() {
    console.log('\n==============================================');
    console.log('          Steam Workshop Downloader');
    console.log('==============================================');

    try {
        ensureOutputDirectories();
    } catch (err) {
        console.error('Could not prepare the download folder: ' + err.message);
    }

    while (true) {
        console.log('\nDownload folder: ' + getOutputPath());
        console.log('SteamCMD: ' + (findSteamCmd() ? 'Ready' : 'Will be installed automatically when needed'));
        console.log('\nMain Menu');
        console.log('  1. Download from urls.txt');
        console.log('  2. Download by App ID and Workshop IDs');
        console.log('  3. Change download folder');
        console.log('  4. Install / repair SteamCMD');
        console.log('  5. Exit');

        const choice = await ask('\nSelect an option: ');
        if (choice === '1') {
            await runUrlMode();
        } else if (choice === '2') {
            await runIdMode();
        } else if (choice === '3') {
            await changeOutputFolder();
        } else if (choice === '4') {
            try {
                await downloadSteamCMD();
            } catch (err) {
                console.error('SteamCMD installation failed: ' + err.message);
            }
        } else if (choice === '5') {
            console.log('\nGoodbye.');
            rl.close();
            return;
        } else {
            console.log('Please choose an option from 1 to 5.');
        }
    }
}

main().catch(function (err) {
    console.error('Unexpected error: ' + err.message);
    rl.close();
    process.exitCode = 1;
});
