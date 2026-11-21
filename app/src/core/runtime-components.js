'use strict';

// LumeniteFX's licence requires redistribution through the author's official
// links. It is therefore fetched directly from the upstream GitHub repository
// on first use, verified, cached locally, and never bundled in our release.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const extractZip = require('extract-zip');
const pe = require('./pe');

// 2.87.5 exists because 2.87.4 is flagged by antivirus engines - upstream
// titled the release "Hopefully an AV-undetected version" - and people were
// left with a wrapper their own machine quarantined (#390). Same archive
// layout, so the install path is unchanged. 2.87.6: bug fixes only (Witcher 2,
// fullscreen, a freeze); upstream dropped the "v" from the tag.
const DGVOODOO = {
  version: '2.87.6',
  url: 'https://github.com/dege-diosg/dgVoodoo2/releases/download/2.87.6/dgVoodoo2_87_6.zip',
  sha256: '9afa493396feec7108f42a2d97661eef96bbaac5addf0dfb5cfbc3001cd76a0a'
};

async function ensureDgVoodoo(cacheRoot) {
  const base = path.join(path.resolve(cacheRoot), 'components', `dgVoodoo2-${DGVOODOO.version}`);
  const archive = base + '.zip';
  if (!cached(archive, DGVOODOO.sha256)) await fetchVerified(DGVOODOO.url, DGVOODOO.sha256, archive);
  // Re-extract the verified archive, never trust previously cached loose DLLs.
  await extractZip(archive, { dir: base });
  return base;
}

function missingVCRuntime(bitness, exeDir, systemRoot = process.env.SystemRoot, extra = []) {
  if (!systemRoot) return [];
  const systemDir = path.join(systemRoot, bitness === 32 ? 'SysWOW64' : 'System32');
  const names = ['msvcp140.dll', 'vcruntime140.dll', ...(bitness === 64 ? ['vcruntime140_1.dll'] : []), ...extra];
  return names.filter(name => {
    const local = exeDir && path.join(exeDir, name);
    const file = local && fs.existsSync(local) ? local : path.join(systemDir, name);
    return pe.getBitness(file) !== bitness;
  });
}

const LUMENITE = {
  commit: 'f8cbbb4eccfcb7adf0d74bb358ba349272e3c1e9',
  url: 'https://codeload.github.com/umar-afzaal/LumeniteFX/zip/f8cbbb4eccfcb7adf0d74bb358ba349272e3c1e9',
  sha256: '43220f99fc0ffa0216e01ebd657180f8c9d043c939f760283b896ea257f1b6a2'
};

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// A cached component counts only when it is still on disk and still the pinned
// bytes; an unreadable or removed file simply means "download it again".
function cached(file, expected) {
  try { return digest(file) === expected; } catch { return false; }
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'DLSS5-Swapper/2.1' },
    // A component is tens of megabytes. Two minutes was a timeout for the
    // connection, not for the transfer, and slow or filtered links lost
    // OptiScaler every time (#370, #373).
    signal: AbortSignal.timeout(600000)
  });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function download(url, file) {
  const data = await fetchBytes(url);
  const temp = file + '.part';
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(temp, data);
  await fs.promises.rename(temp, file);
}

function componentError(code, message) { return Object.assign(new Error(message), { code }); }

// Three different failures used to arrive as one message about the network.
// The bytes are checked in memory first, so a bad transfer is told apart
// from a file that was verified and then taken away - which is what a
// security tool quarantining dgVoodoo2's wrapper DLLs looks like from here,
// and no amount of retrying the connection fixes it.
// The two steps are injectable so the quarantine case - bytes that verify and
// then are not there - can be exercised without a real antivirus.
async function fetchVerified(url, expected, file, deps = {}) {
  const fetcher = deps.fetchBytes || fetchBytes;
  const read = deps.digest || digest;
  let data;
  // One stalled attempt is not proof that the network is gone. Only the
  // transfer is retried; a checksum that does not match is still final.
  const attempts = deps.attempts || 3;
  for (let attempt = 1; ; attempt++) {
    try { data = await fetcher(url); break; }
    catch (cause) {
      if (attempt >= attempts) throw componentError('componentNetwork', cause.message);
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  const received = crypto.createHash('sha256').update(data).digest('hex');
  if (received !== expected) {
    throw componentError('componentChecksum', `expected ${expected}, received ${received}`);
  }
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.part';
  await fs.promises.writeFile(temp, data);
  await fs.promises.rename(temp, file);
  let stored = null;
  try { stored = read(file); } catch { stored = null; }
  if (stored !== expected) throw componentError('componentRemoved', path.dirname(file));
}


async function ensureLumenite(cacheRoot) {
  const base = path.join(cacheRoot, 'components', `LumeniteFX-${LUMENITE.commit.slice(0, 8)}`);
  const archive = base + '.zip';
  const marker = path.join(base, '.verified');
  if (fs.existsSync(marker)) {
    const folders = fs.readdirSync(base).filter((name) => name !== '.verified');
    const root = folders.map((name) => path.join(base, name)).find((item) => fs.existsSync(path.join(item, 'Shaders')));
    if (root) return root;
  }

  if (!cached(archive, LUMENITE.sha256)) {
    try { await fs.promises.unlink(archive); } catch {}
    await fetchVerified(LUMENITE.url, LUMENITE.sha256, archive);
  }

  await fs.promises.rm(base, { recursive: true, force: true });
  await extractZip(archive, { dir: base });
  const folders = fs.readdirSync(base);
  const root = folders.map((name) => path.join(base, name)).find((item) => fs.existsSync(path.join(item, 'Shaders')));
  if (!root) throw new Error('LumeniteFX archive layout is invalid');
  await fs.promises.writeFile(marker, LUMENITE.sha256, 'utf8');
  return root;
}

module.exports = { DGVOODOO_VERSION: DGVOODOO.version, LUMENITE, DGVOODOO, ensureLumenite, ensureDgVoodoo, missingVCRuntime, digest, download, fetchBytes, fetchVerified, cached };
