'use strict';

// Own add-on builds: a RenoDX DLSS 5 add-on someone bought or built themselves
// (lecram's paid builds, a newer ShortFuse build). The app never downloads
// or ships these; the person imports the file once, it is checked (a 64-bit
// Windows DLL with the right name, scanned by Microsoft Defender when it is
// there) and copied into the app's own folder, so a cleaned-up Downloads folder
// cannot break an install. While one is active, every install and "Update
// installed DLSS 5" uses it instead of the built-in build of the same name.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const extract = require('extract-zip');
const pe = require('./pe');

// The two add-on names the install routes know. Anything else would never be
// picked up by an install, so it is refused at import rather than silently.
const NAMES = Object.freeze({
  'renodx-dlss5.addon64': 'RenoDX DLSS5 (lecram / generic)',
  'renodx-dlss.addon64': 'RenoDX DLSS Tool (ShortFuse, multipass)'
});

const fail = (code, message, params = {}) => Object.assign(new Error(message), { code, params });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root = (userData) => path.join(userData, 'custom-addons');

function defenderScan(file) {
  const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (!fs.existsSync(exe)) return Promise.resolve({ scanned: false });
  return new Promise((resolve) => {
    execFile(exe, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], { windowsHide: true, timeout: 180000 }, (error, stdout) => {
      // 0 = nothing found, 2 = a threat was found; anything else: scan did not run.
      const code = error && typeof error.code === 'number' ? error.code : 0;
      if (code === 2) resolve({ scanned: true, threat: true, detail: String(stdout || '').trim().split(/\r?\n/).pop() });
      else resolve({ scanned: code === 0, threat: false });
    });
  });
}

function findAddon(dir) {
  const hits = [];
  const walk = (d, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && Object.hasOwn(NAMES, e.name.toLowerCase())) hits.push(p);
    }
  };
  walk(dir, 0);
  return hits;
}

async function importFile(userData, file) {
  if (typeof file !== 'string' || !fs.existsSync(file)) throw fail('caErrMissing', 'The file is not there any more.');
  let tmp = null;
  let src = file;
  try {
    if (/\.zip$/i.test(file)) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-addon-'));
      await extract(file, { dir: tmp, filter: (p) => !path.isAbsolute(p) && !p.startsWith('..') && !p.includes('/') && !p.includes('\\') });
      const hits = findAddon(tmp);
      if (!hits.length) throw fail('caErrNoAddon', 'The archive contains no renodx-dlss5.addon64 or renodx-dlss.addon64.');
      if (hits.length > 1) throw fail('caErrTwoAddons', 'The archive contains more than one add-on; import the one you want on its own.');
      src = hits[0];
    }
    const name = path.basename(src).toLowerCase();
    if (!Object.hasOwn(NAMES, name)) throw fail('caErrName', 'Only renodx-dlss5.addon64 or renodx-dlss.addon64 can be imported.');
    const head = Buffer.alloc(2);
    const fd = fs.openSync(src, 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
    if (head.toString('latin1') !== 'MZ' || pe.getBitness(src) !== 64) throw fail('caErrNotAddon', 'This is not a 64-bit ReShade add-on.');
    const scan = await defenderScan(src);
    if (scan.threat) throw fail('caErrThreat', `Microsoft Defender flagged this file: ${scan.detail || ''}`, { detail: scan.detail || '' });
    const digest = sha256(src);
    const dest = path.join(root(userData), name.replace(/\.addon64$/, ''), digest.slice(0, 16), name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest) || sha256(dest) !== digest) fs.copyFileSync(src, dest);
    // The add-on's own "v10.8.0" label is what its author and its menu call
    // it; the PE file version is a build stamp. Prefer the label.
    let version = null;
    try {
      const m = /\x00v(\d{1,2}\.\d{1,2}\.\d{1,2}(?:-[a-z]+\d*)?)\x00/.exec(fs.readFileSync(dest).toString('latin1'));
      version = m ? m[1] : pe.getFileVersion(dest);
    } catch { /* unversioned build */ }
    return { name, path: dest, sha256: digest, version, scanned: scan.scanned };
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ } }
  }
}

// Every imported build on disk, so "Update installed DLSS 5" knows these files
// came through the app and may be swapped when the choice changes.
function knownHashes(userData) {
  const out = new Set();
  const base = root(userData);
  if (!fs.existsSync(base)) return out;
  for (const hit of findAddon(base)) { try { out.add(sha256(hit)); } catch { /* unreadable */ } }
  return out;
}

module.exports = { NAMES, importFile, knownHashes, root, defenderScan };