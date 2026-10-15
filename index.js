'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const readline = require('readline');
const axios = require('axios').default;
const { JSDOM } = require('jsdom');
const { DownloaderHelper } = require('node-downloader-helper');

const ROOT = __dirname;
const URLS_FILE = path.join(ROOT, 'urls.txt');
const DOWNLOAD_DIR = path.join(ROOT, 'downloads');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(ROOT, 'downloader.log');
const OPTIONS_FILE = path.join(ROOT, 'options.ini');
const FILE_EXTENSION = normalizeExtension(process.argv[2] || '.zip');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise(function (resolve) {
        rl.question(question, function (answer) { resolve(answer.trim()); });
    });
}

function normalizeExtension(value) {
    const ext = String(value || '.zip').trim();
    const normalized = ext.startsWith('.') ? ext : '.' + ext;
    if (!/^\.[a-zA-Z0-9_-]{1,12}$/.test(normalized)) return '.zip';
    return normalized;
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

function expectedSteamCmdNames() {
    if (process.platform === 'win32') return ['steamcmd.exe'];
    return ['steamcmd.sh', 'steamcmd'];
}

function resolveSteamCmdCandidate(candidate) {
    if (!candidate) return null;
    const expanded = path.resolve(candidate.replace(/^["']|["']$/g, ''));
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

function findSteamCmd() {
    const options = readOptions();
    const configured = resolveSteamCmdCandidate(options.steamcmdPath);
    if (configured) return configured;
    const environmentPath = resolveSteamCmdCandidate(process.env.STEAMCMD);
    if (environmentPath) return environmentPath;

    const localCandidates = [
        path.join(ROOT, 'steamcmd'),
        path.join(ROOT, 'SteamCMD'),
        path.join(ROOT, 'steamcmd.exe'),
        path.join(ROOT, 'steamcmd.sh')
    ];
    for (const candidate of localCandidates) {
        const found = resolveSteamCmdCandidate(candidate);
        if (found) return found;
    }

    const searchNames = expectedSteamCmdNames();
    const pathEntries = (process.env.PATH || '').split(path.delimiter);
    for (const entry of pathEntries) {
        if (!entry) continue;
        for (const name of searchNames) {
            const found = resolveSteamCmdCandidate(path.join(entry, name));
            if (found) return found;
        }
    }
    return null;
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
    output.push('========== 2. SUCCESSFUL / ALREADY PRESENT ITEMS ==========');

    if (!run.completed.length) {
        output.push('No items were confirmed as completed.');
    } else {
        const groups = new Map();
        for (const item of run.completed) {
            const key = [item.sourceType || 'Source', item.sourceLabel || '(not specified)', item.appId || 'UNKNOWN'].join('\n');
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
    console.log('\n' + report);
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.writeFileSync(LOG_FILE, report, 'utf8');
        const stamp = run.started.toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(LOG_DIR, 'run-' + stamp + '.log'), report, 'utf8');
        console.log('\nLog saved to: ' + LOG_FILE);
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
        if (!seen.has(id)) { ids.push(id); seen.add(id); }
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
            response.data.on('error', reject);
            file.on('error', reject);
            file.on('finish', resolve);
            response.data.pipe(file);
        });
    });
}

async function downloadSteamCMD() {
    if (process.platform !== 'win32' && process.platform !== 'linux') {
        throw new Error('Automatic SteamCMD setup currently supports Windows and Linux. Please install SteamCMD manually on this operating system.');
    }
    const installDir = path.join(ROOT, 'steamcmd');
    fs.mkdirSync(installDir, { recursive: true });

    if (process.platform === 'win32') {
        const archive = path.join(ROOT, '.steamcmd-download.zip');
        logSetupMessage('Downloading the official Windows SteamCMD archive...');
        await downloadToFile('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip', archive);
        const psPath = archive.replace(/'/g, "''");
        const psDir = installDir.replace(/'/g, "''");
        const command = "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '" + psPath + "' -DestinationPath '" + psDir + "' -Force";
        await runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: ROOT, stdio: 'inherit' });
        try { fs.unlinkSync(archive); } catch (_) {}
    } else {
        const archive = path.join(ROOT, '.steamcmd-download.tar.gz');
        logSetupMessage('Downloading the official Linux SteamCMD archive...');
        await downloadToFile('https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz', archive);
        await runProcess('tar', ['-xzf', archive, '-C', installDir], { cwd: ROOT, stdio: 'inherit' });
        try { fs.unlinkSync(archive); } catch (_) {}
        const shellPath = path.join(installDir, 'steamcmd.sh');
        if (fs.existsSync(shellPath)) fs.chmodSync(shellPath, 0o755);
    }

    const found = resolveSteamCmdCandidate(installDir);
    if (!found) throw new Error('SteamCMD was extracted, but its executable was not found in ' + installDir);
    saveOption('steamcmdPath', found);
    return found;
}

function logSetupMessage(message) { console.log(message); }

async function configureSteamCMD(allowSkip) {
    while (true) {
        console.log('\nSteamCMD was not found in PATH or options.ini.');
        console.log('1. Enter the folder containing SteamCMD and save it');
        console.log('2. Download SteamCMD into this project folder');
        if (allowSkip) console.log('3. Skip for now (URL mode will still be available)');
        const choice = await ask('Choose an option: ');

        if (choice === '1') {
            const folder = await ask('Enter the SteamCMD folder path (or the full executable path): ');
            const found = resolveSteamCmdCandidate(folder);
            if (!found) {
                console.log('Could not find ' + expectedSteamCmdNames().join(' or ') + ' in that location. Please check the path.');
                continue;
            }
            saveOption('steamcmdPath', found);
            console.log('Saved SteamCMD path to options.ini: ' + found);
            return found;
        } else if (choice === '2') {
            try {
                const found = await downloadSteamCMD();
                console.log('SteamCMD installed and saved in options.ini: ' + found);
                return found;
            } catch (err) {
                console.error('SteamCMD setup failed: ' + err.message);
                console.log('You can retry or enter an existing SteamCMD path manually.');
            }
        } else if (choice === '3' && allowSkip) {
            return null;
        } else {
            console.log('Please choose a listed option.');
        }
    }
}

function getContentRoots(steamcmdPath) {
    const roots = [
        path.join(path.dirname(steamcmdPath), 'steamapps', 'workshop', 'content'),
        path.join(os.homedir(), '.local', 'share', 'Steam', 'steamapps', 'workshop', 'content'),
        path.join(os.homedir(), '.steam', 'steam', 'steamapps', 'workshop', 'content'),
        path.join(os.homedir(), '.steam', 'steamcmd', 'steamapps', 'workshop', 'content')
    ];
    if (process.platform === 'win32') {
        if (process.env['ProgramFiles(x86)']) roots.push(path.join(process.env['ProgramFiles(x86)'], 'Steam', 'steamapps', 'workshop', 'content'));
        if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Steam', 'steamapps', 'workshop', 'content'));
    }
    return Array.from(new Set(roots.map(function (root) { return path.resolve(root); })));
}

function hasWorkshopContent(steamcmdPath, appId, workshopId) {
    for (const root of getContentRoots(steamcmdPath)) {
        const itemDir = path.join(root, String(appId), String(workshopId));
        try {
            if (fs.existsSync(itemDir) && fs.statSync(itemDir).isDirectory() && fs.readdirSync(itemDir).length > 0) return itemDir;
        } catch (_) {}
    }
    return null;
}

async function downloadViaSteamCMD(run, appId, ids, source) {
    const steamcmdPath = findSteamCmd();
    if (!steamcmdPath) throw new Error('SteamCMD is not configured. Select menu option 3 to configure it.');

    // SteamCMD's runscript avoids Windows command-line length limits and lets it
    // continue to later IDs when one individual item fails.
    const scriptPath = path.join(ROOT, '.steamcmd-batch-' + Date.now() + '.txt');
    const scriptLines = [
        '@ShutdownOnFailedCommand 0',
        '@NoPromptForPassword 1',
        'login anonymous'
    ];
    for (const id of ids) {
        scriptLines.push('workshop_download_item ' + String(appId) + ' ' + String(id) + ' validate');
    }
    scriptLines.push('quit');
    fs.writeFileSync(scriptPath, scriptLines.join('\n') + '\n', 'utf8');
    const args = ['+runscript', scriptPath];

    logInfo(run, 'SteamCMD executable: ' + steamcmdPath);
    logInfo(run, 'App ID: ' + appId);
    logInfo(run, 'Workshop IDs: ' + ids.join(', '));
    logInfo(run, 'SteamCMD will be started once. Its runscript performs one anonymous login and then tries every ID in the same session.');
    logInfo(run, 'The script continues after individual failures and suppresses password prompts.');
    logInfo(run, 'Command sequence: login anonymous; ' + ids.map(function (id) {
        return 'workshop_download_item ' + appId + ' ' + id + ' validate';
    }).join('; ') + '; quit');
    console.log('\nStarting SteamCMD. Its output is shown below:\n');

    let output = '';
    let childError = null;
    const exitCode = await new Promise(function (resolve) {
        let settled = false;
        function finish(code) {
            if (settled) return;
            settled = true;
            resolve(code);
        }
        let child;
        try {
            child = spawn(steamcmdPath, args, { cwd: path.dirname(steamcmdPath), windowsHide: true });
        } catch (err) {
            childError = err;
            finish(-1);
            return;
        }
        function capture(chunk) {
            const text = chunk.toString();
            output += text;
            process.stdout.write(text);
            text.split(/[\r\n]+/).forEach(function (line) {
                if (line.trim()) run.general.push('[SteamCMD] ' + line.trim());
            });
        }
        if (child.stdout) child.stdout.on('data', capture);
        if (child.stderr) child.stderr.on('data', capture);
        child.on('error', function (err) { childError = err; finish(-1); });
        child.on('close', finish);
    });

    try { fs.unlinkSync(scriptPath); } catch (_) {}
    if (childError) logInfo(run, 'Could not launch SteamCMD: ' + childError.message);
    else logInfo(run, 'SteamCMD process exited with code: ' + exitCode);

    const outputLines = output.split(/[\r\n]+/);
    for (const id of ids) {
        // IDs are numeric and validated before reaching this function.
        const failRegex = new RegExp('(ERROR!.*(?:item\\s*)?' + id + '\\b|failed.*' + id + '\\b)', 'i');
        const successRegex = new RegExp('(Success\\.\\s*Downloaded item\\s+' + id + '\\b|Downloaded item\\s+' + id + '\\s+to\\s+)', 'i');
        let failureLine = null;
        let successLine = null;
        for (const line of outputLines) {
            if (!failureLine && failRegex.test(line)) failureLine = line.trim();
            if (!successLine && successRegex.test(line)) successLine = line.trim();
        }

        const sourceDetails = {
            sourceType: source.sourceType || 'Manual AppID entry',
            sourceLabel: source.sourceLabel || 'Manual AppID entry',
            appId: String(appId),
            workshopId: String(id)
        };

        if (failureLine) {
            addFailure(run, Object.assign({}, sourceDetails, { error: 'SteamCMD reported: ' + failureLine }));
        } else if (successLine) {
            addSuccess(run, Object.assign({}, sourceDetails, { note: 'SteamCMD reported a successful download.' }));
        } else {
            const existingDir = hasWorkshopContent(steamcmdPath, appId, id);
            if (existingDir && exitCode === 0) {
                addSuccess(run, Object.assign({}, sourceDetails, { note: 'Workshop content is present at ' + existingDir }));
            } else {
                addFailure(run, Object.assign({}, sourceDetails, {
                    error: childError ? childError.message : (exitCode !== 0
                        ? 'SteamCMD exited with code ' + exitCode + ' without confirming this item.'
                        : 'SteamCMD did not confirm this item. Check the General Information section of the log.')
                }));
            }
        }
    }

    console.log('\nExpected Workshop content location(s):');
    const roots = getContentRoots(steamcmdPath);
    const existingRoots = roots.filter(function (root) { return fs.existsSync(root); });
    if (existingRoots.length) {
        existingRoots.forEach(function (root) { console.log('  ' + path.join(root, String(appId), '<WorkshopID>')); });
    } else {
        console.log('  ' + path.join(path.dirname(steamcmdPath), 'steamapps', 'workshop', 'content', String(appId), '<WorkshopID>'));
        console.log('  (SteamCMD installations may use a different library location; see its output above.)');
    }
}

async function extractDirectDownloadUrl(workshopId, appId) {
    const itemPageUrl = 'http://steamworkshop.download/download/view/' + encodeURIComponent(workshopId);
    const pageResponse = await axios.get(itemPageUrl, { timeout: 45000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const dom = new JSDOM(pageResponse.data);
    const document = dom.window.document;
    let directUrl = null;

    const downloadButton = document.getElementById('steamdownload');
    if (downloadButton) {
        const body = 'item=' + encodeURIComponent(workshopId) + '&app=' + encodeURIComponent(appId);
        const response = await axios.post('http://steamworkshop.download/online/steamonline.php', body, {
            timeout: 45000,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }
        });
        if (response.data && typeof response.data === 'string') {
            const match = response.data.match(/<a\b[^>]*href=['"]([^'"]+)['"]/i);
            if (match) directUrl = match[1];
        }
    } else {
        const link = document.querySelector('table a[href]');
        if (link) directUrl = link.href;
    }
    dom.window.close();

    if (!directUrl || !/^https?:\/\//i.test(directUrl)) {
        throw new Error('The third-party download page did not provide a valid direct URL.');
    }
    return directUrl;
}

function downloadAndSave(url, directory, fileName) {
    return new Promise(function (resolve, reject) {
        if (!url || !/^https?:\/\//i.test(url)) {
            reject(new Error('Invalid download URL.'));
            return;
        }
        let settled = false;
        const helper = new DownloaderHelper(url, directory, { fileName: fileName });
        helper.on('end', function () {
            if (settled) return;
            settled = true;
            process.stdout.write('\n');
            resolve();
        });
        helper.on('error', function (err) {
            if (settled) return;
            settled = true;
            reject(err);
        });
        helper.on('progress', function (stats) {
            if (stats && typeof stats.progress === 'number') process.stdout.write('\r    Downloading ' + fileName + ': ' + stats.progress.toFixed(1) + '%');
        });
        helper.start();
    });
}

function parseWorkshopIdFromUrl(value) {
    try {
        const url = new URL(value);
        const id = url.searchParams.get('id');
        return id && /^\d+$/.test(id) ? id : null;
    } catch (_) { return null; }
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

function getCollectionItems(document) {
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
        result.push({ url: link.href, workshopId: id, name: name || ('Workshop item ' + id) });
    }
    return result;
}

async function downloadWebItem(run, details) {
    const appId = details.appId;
    const workshopId = details.workshopId;
    const label = details.itemName || ('Workshop item ' + workshopId);
    if (!appId) throw new Error('Could not determine the App ID from the Steam Workshop page.');

    const directory = details.collectionName
        ? path.join(DOWNLOAD_DIR, validName(details.collectionName))
        : path.join(DOWNLOAD_DIR, 'Individual Items');
    fs.mkdirSync(directory, { recursive: true });
    const fileName = validName(label) + FILE_EXTENSION;
    const outputFile = path.join(directory, fileName);

    if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0) {
        logInfo(run, 'Already exists, skipping: ' + label);
        addSuccess(run, {
            sourceType: details.sourceType, sourceLabel: details.sourceLabel,
            collectionName: details.collectionName || '', appId: appId, workshopId: workshopId,
            note: 'Skipped because the output file already exists.'
        });
        return;
    }

    logInfo(run, 'Downloading "' + label + '" (App ID ' + appId + ', Workshop ID ' + workshopId + ')');
    const directUrl = await extractDirectDownloadUrl(workshopId, appId);
    await downloadAndSave(directUrl, directory, fileName);
    if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
        throw new Error('The download finished without a non-empty output file being found.');
    }
    logInfo(run, 'Finished: ' + outputFile);
    addSuccess(run, {
        sourceType: details.sourceType, sourceLabel: details.sourceLabel,
        collectionName: details.collectionName || '', appId: appId, workshopId: workshopId
    });
}

async function runUrlMode() {
    const run = createRun('Download from urls.txt');
    try {
        logInfo(run, 'Started URL mode. Reading: ' + URLS_FILE);
        logInfo(run, 'Output folder: ' + DOWNLOAD_DIR);
        if (!fs.existsSync(URLS_FILE)) {
            fs.writeFileSync(URLS_FILE, '# Add Steam Workshop collection or individual-item URLs, one per line.\n', 'utf8');
            throw new Error('urls.txt did not exist, so an example file has been created. Add URLs and run again.');
        }

        const urls = fs.readFileSync(URLS_FILE, 'utf8').split(/\r?\n/)
            .map(function (line) { return line.trim(); })
            .filter(function (line) { return line && !line.startsWith('#'); });

        if (!urls.length) throw new Error('urls.txt contains no URLs. Add one collection or item URL per line.');
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        logInfo(run, 'Found ' + urls.length + ' URL(s). Collections and individual Workshop items are detected automatically.');

        for (const url of urls) {
            let parsed;
            try { parsed = new URL(url); }
            catch (_) {
                const message = 'Invalid URL: ' + url;
                logInfo(run, message);
                run.otherFailures.push({ sourceLabel: url, error: message });
                continue;
            }

            if (!/(^|\.)steamcommunity\.com$/i.test(parsed.hostname) || !parsed.pathname.includes('sharedfiles/filedetails')) {
                const message = 'Skipped unsupported URL (expected a Steam Workshop sharedfiles URL): ' + url;
                logInfo(run, message);
                run.otherFailures.push({ sourceLabel: url, error: message });
                continue;
            }

            let dom;
            try {
                logInfo(run, '\nReading Steam Workshop page: ' + url);
                const response = await axios.get(url, { timeout: 45000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                dom = new JSDOM(response.data, { url: url });
                const document = dom.window.document;
                const appId = extractAppId(document);
                const titleElement = document.querySelector('.workshopItemTitle');
                const pageTitle = (titleElement && titleElement.textContent || document.title || 'Steam Workshop item').replace(/\s+/g, ' ').trim();
                const collectionItems = getCollectionItems(document);

                if (collectionItems.length) {
                    logInfo(run, 'Detected collection: "' + pageTitle + '" (' + collectionItems.length + ' items)');
                    for (const item of collectionItems) {
                        try {
                            await downloadWebItem(run, {
                                sourceType: 'Collection URL', sourceLabel: url, collectionName: pageTitle,
                                appId: appId, workshopId: item.workshopId, itemName: item.name
                            });
                        } catch (err) {
                            logInfo(run, 'FAILED Workshop ID ' + item.workshopId + ': ' + err.message);
                            addFailure(run, { appId: appId || 'UNKNOWN', workshopId: item.workshopId, sourceLabel: url, error: err.message });
                        }
                    }
                } else {
                    const workshopId = parseWorkshopIdFromUrl(url);
                    if (!workshopId) throw new Error('Could not identify a Workshop ID on this page. It may be unavailable or not be an item / collection.');
                    logInfo(run, 'Detected individual Workshop item: ' + workshopId);
                    try {
                        await downloadWebItem(run, {
                            sourceType: 'Item URL', sourceLabel: url, collectionName: '',
                            appId: appId, workshopId: workshopId, itemName: pageTitle
                        });
                    } catch (err) {
                        logInfo(run, 'FAILED Workshop ID ' + workshopId + ': ' + err.message);
                        addFailure(run, { appId: appId || 'UNKNOWN', workshopId: workshopId, sourceLabel: url, error: err.message });
                    }
                }
            } catch (err) {
                logInfo(run, 'Could not process URL ' + url + ': ' + err.message);
                run.otherFailures.push({ sourceLabel: url, error: err.message });
            } finally {
                if (dom) dom.window.close();
            }
        }
    } catch (err) {
        logInfo(run, 'URL mode stopped: ' + err.message);
    } finally {
        logInfo(run, '\nURL mode finished. Confirmed items: ' + run.completed.length + '; items needing review: ' + run.failed.length + '; other URL errors: ' + run.otherFailures.length + '.');
        saveReport(run);
    }
}

async function runIdMode() {
    const run = createRun('Download by App ID and Workshop IDs with SteamCMD');
    try {
        let appId;
        let ids;
        try {
            appId = parseAppId(await ask('Enter the Steam App ID: '));
            ids = parseWorkshopIds(await ask('Enter Workshop ID(s), separated by commas: '));
        } catch (err) {
            logInfo(run, 'Input error: ' + err.message);
            return;
        }
        logInfo(run, 'Starting bulk Workshop download.');
        await downloadViaSteamCMD(run, appId, ids, {
            sourceType: 'Manual AppID entry',
            sourceLabel: 'Manual AppID entry'
        });
        logInfo(run, 'SteamCMD result: confirmed ' + run.completed.length + ', failed / unconfirmed ' + run.failed.length + '.');
    } catch (err) {
        logInfo(run, 'Download could not start: ' + err.message);
    } finally {
        saveReport(run);
    }
}

async function main() {
    console.log('==============================================');
    console.log('       Steam Workshop Downloader');
    console.log('==============================================');
    console.log('This is a CLI tool. No separate GUI is required.');

    const steamcmdPath = findSteamCmd();
    if (!steamcmdPath) await configureSteamCMD(true);
    else console.log('SteamCMD found: ' + steamcmdPath);

    while (true) {
        console.log('\nMain menu');
        console.log('1. Download from urls.txt (collections and individual item URLs)');
        console.log('2. Download by App ID + Workshop ID(s) using one SteamCMD session');
        console.log('3. Configure / download SteamCMD');
        console.log('4. Exit');
        const choice = await ask('Choose an option: ');

        if (choice === '1') {
            await runUrlMode();
        } else if (choice === '2') {
            if (!findSteamCmd()) {
                const configured = await configureSteamCMD(false);
                if (!configured) continue;
            }
            await runIdMode();
        } else if (choice === '3') {
            await configureSteamCMD(false);
        } else if (choice === '4') {
            console.log('Goodbye.');
            rl.close();
            return;
        } else {
            console.log('Please enter 1, 2, 3, or 4.');
        }
    }
}

main().catch(function (err) {
    console.error('Unexpected error: ' + err.message);
    rl.close();
    process.exitCode = 1;
});
