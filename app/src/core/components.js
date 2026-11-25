'use strict';
// Component manager (DLSS AiO Swapper by Machiavelli).
//
// The installer ships without any third-party binary. Everything the app puts
// into games - NVIDIA's DLLs, Streamline, ReShade, RenoDX, DLSS5-Feeder - is
// fetched here from pinned public sources into %APPDATA%\dlss5-swapper\payload
// (same layout as the old resources\payload), verified by digest and, for the
// NVIDIA files, by their Authenticode signature. Downloaded files are never
// executed. The DLSS 5 model (nvngx_dlssnr.dll): NVIDIA's original, signed
// 310.9.16 from a public mirror (pinned archive + file hash + signature), or
// imported by the user from a file of their own.
//
// Errors carry `code` (an i18n key in the renderer) and `params`; `message`
// is the English fallback. No Electron dependency: every entry point takes the
// payload folder, so this module can be exercised from plain Node.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const extract = require('extract-zip');
const pe = require('./pe');
const feederRelease = require('./feeder-release');
const renodxRelease = require('./renodx-release');
const pins = require('./component-pins');

const UA = { 'User-Agent': 'DLSS-AiO-Swapper' };
const LIST_TTL = 6 * 60 * 60 * 1000;
const NVIDIA = 'NVIDIA Corporation';
const NR_MIN = '310.8';
// NVIDIA's own nvngx_dlssnr.dll 310.9.16 (the file NBA 2K27 and Hogwarts Legacy
// ship), mirrored unmodified on rhi-repo since 2026-11-16. Pinned three times:
// archive digest, DLL SHA-256 and NVIDIA's Authenticode signature.
const NVIDIA_NR = {
  version: '310.9.16.0',
  label: '310.9.16',
  file: 'nvngx_dlssnr.dll',
  archive: ['nvngx_dlssnr_310.9.16-nvidia.zip', 'https://github.com/RankFTW/rhi-repo/releases/download/dlssnr-310.9.16-nvidia/nvngx_dlssnr_310.9.16-nvidia.zip', '5277355f0578d36f2a25413d8c7ff4c6f9966cea5bad714305f23b20173e09f6'],
  sha256: '2bc19bc09a7b89dd44f73e2ac0108fcc586e2154bdd0830f242f4f040e28789f'
};

// NVIDIA's official DLSS SDK repository: release tags + the DLLs in lib/.
const DLSS_REPO = {
  releasesApi: 'https://api.github.com/repos/NVIDIA/DLSS/releases?per_page=100',
  raw: (tag, file) => `https://raw.githubusercontent.com/NVIDIA/DLSS/${tag}/lib/Windows_x86_64/rel/${file}`,
  // Used when the GitHub API is unreachable or rate-limited.
  builtinTags: ['v310.9.16', 'v310.9.1', 'v310.7.0', 'v310.6.0', 'v310.5.3', 'v310.5.0', 'v310.4.0', 'v310.3.0',
    'v310.2.1', 'v310.1.0', 'v3.7.20', 'v3.7.10', 'v3.7.0', 'v3.5.10', 'v3.5.0', 'v3.1.30', 'v3.1.13', 'v3.1.10', 'v3.1.0'],
  // Byte pins for the default release (equal to the 2.2.9 payload files).
  pinned: {
    'v310.9.16': {
      'nvngx_dlss.dll': ['d00b5b0ab29c3ca101b70c3a5ecb3a01b7ef33766a3383a28a18623083e6123e', 58956912],
      'nvngx_dlssd.dll': ['b49435ae346f227feafe7bbe937d88277ea0ee7323975ec06488f377fdb46cee', 48343664],
      'nvngx_dlssg.dll': ['8d59d49b36410dd6b62fef2503a5871d347415bd85d943fa0848563a95dd50c7', 7506544]
    }
  }
};
const STREAMLINE = {
  version: '2.13.0.0',
  archive: ['streamline_2.13.0.0.zip', 'https://github.com/RankFTW/rhi-repo/releases/download/streamline-2.13.0.0/streamline_2.13.0.0.zip', '7f38b5b2b7cc83ae859ccb3266160b8e5e517f379f81987fe3c758ae5c9e8c02']
};
const RESHADE = {
  version: '6.8.0',
  file: 'ReShade_Setup_6.8.0_Addon.exe',
  url: 'https://reshade.me/downloads/ReShade_Setup_6.8.0_Addon.exe',
  sha256: 'afe4c8f13048306307983b8b3d41d5bf00a86820440b0e57dea10950e1176445'
};

// The table the UI shows. `kind` decides how a component is fetched/checked.
// `since` = first NVIDIA/DLSS release whose lib/ folder carries that DLL.
// Optional DLSS 5 model for RTX 20/30/40 cards. NVIDIA's own nvngx_dlssnr.dll
// only starts on Blackwell (RTX 50); older cards need a community-modified
// 310.8 build, which is NOT signed by NVIDIA any more. It is never part of
// "Download all", is fetched only after the person confirms a warning, and is
// accepted only byte-for-byte: archive digest + file digest pinned below
// (rhi-repo release dlssnr-310.8.SF-v2, published 2026-08-30, the build RHI and
// Prism use for RTX 20-40). It lives in its own folder and is used for
// installs only while switched on.
const LEGACY_NR = {
  id: 'dlssnr-legacy',
  label: '310.8.SF-v2',
  version: '310.8.2.0',
  dir: 'legacy-nr',
  file: 'nvngx_dlssnr.dll',
  archive: ['nvngx_dlssnr_310.8.SF-v2.zip', 'https://github.com/RankFTW/rhi-repo/releases/download/dlssnr-310.8.SF-v2/nvngx_dlssnr_310.8.SF-v2.zip', '1da35941894994eb087e017577829e492454e9bae3a6a9397027069ceb74955c'],
  sha256: '6eb209e764f39872625debd6abaf45e2bb6322f6f270f781f70c059ae30b3927',
  size: 165830144
};
const legacyNrPath = (payloadDir) => path.join(payloadDir, LEGACY_NR.dir, LEGACY_NR.file);
// True when the pinned community build is present and unchanged.
function legacyNrReady(payloadDir) {
  const file = legacyNrPath(payloadDir);
  return fs.existsSync(file) && sha256File(file) === LEGACY_NR.sha256;
}
function removeLegacyNr(payloadDir) {
  rmrf(path.join(payloadDir, LEGACY_NR.dir));
  hashCache.delete(path.resolve(legacyNrPath(payloadDir)).toLowerCase());
}

const NV_SOURCE = 'NVIDIA (GitHub NVIDIA/DLSS)';
const COMPONENTS = [
  { id: 'streamline', name: 'NVIDIA Streamline (sl.*)', kind: 'streamline', source: 'GitHub RankFTW/rhi-repo · Streamline ' + STREAMLINE.version },
  { id: 'dlss', name: 'DLSS Super Resolution', kind: 'dlss', file: 'nvngx_dlss.dll', since: '3.1.0', source: NV_SOURCE },
  { id: 'dlssd', name: 'DLSS Ray Reconstruction', kind: 'dlss', file: 'nvngx_dlssd.dll', since: '310.1.0', source: NV_SOURCE },
  { id: 'dlssg', name: 'DLSS Frame Generation', kind: 'dlss', file: 'nvngx_dlssg.dll', since: '310.4.0', source: NV_SOURCE },
  { id: 'dlssnr', name: 'DLSS 5 model (nvngx_dlssnr.dll)', kind: 'import', file: 'nvngx_dlssnr.dll', source: 'GitHub RankFTW/rhi-repo · NVIDIA original ' + NVIDIA_NR.label + ' · or import' },
  { id: 'renodx', name: 'RenoDX DLSS5 add-on', kind: 'renodx', source: 'GitHub RankFTW/rhi-repo · RenoDX ' + renodxRelease.CONSUMER.version },
  { id: 'renodx-sf', name: 'RenoDX multipass (DLSS Tool)', kind: 'renodx-sf', source: 'GitHub RankFTW/rhi-repo · RenoDX ' + renodxRelease.MULTIPASS.version },
  { id: 'feeder', name: 'DLSS5-Feeder', kind: 'feeder', source: 'GitHub jlrouzies-fr/DLSS5-Feeder · ' + feederRelease.version },
  { id: 'reshade', name: 'ReShade (add-on build)', kind: 'reshade', source: 'reshade.me · ' + RESHADE.version },
  { id: LEGACY_NR.id, name: 'DLSS 5 model for RTX 20/30/40 (community build)', kind: 'legacy-nr', optional: true,
    source: 'GitHub RankFTW/rhi-repo · ' + LEGACY_NR.label + ' · modified, not signed by NVIDIA' }
];
const byId = (id) => COMPONENTS.find((c) => c.id === id);

// ---------------------------------------------------------------- helpers
function fail(code, params, message) {
  return Object.assign(new Error(message || code), { code, params: params || {} });
}

function cmpVer(a, b) {
  const x = String(a || '0').replace(/^v/i, '').split('.').map(Number);
  const y = String(b || '0').replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const hashCache = new Map();
function sha256File(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = path.resolve(file).toLowerCase();
  const hit = hashCache.get(key);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha;
  let sha;
  try { sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
  hashCache.set(key, { size: st.size, mtimeMs: st.mtimeMs, sha });
  return sha;
}

function helperPath(opts = {}) {
  if (opts.helper) return opts.helper;
  try { return require('./nv-drs').helperPath(); } catch { return 'nv-drs.exe'; }
}

// Authenticode check through nv-drs.exe (WinVerifyTrust). Fails closed.
function sigcheck(file, opts = {}) {
  return new Promise((resolve) => {
    execFile(helperPath(opts), ['sigcheck', file], { windowsHide: true, timeout: 120000 }, (error, stdout) => {
      const line = String(stdout || '').trim().split(/\r?\n/).pop();
      try { resolve(JSON.parse(line)); }
      catch { resolve({ ok: false, valid: false, message: error ? error.message : 'nv-drs: no answer' }); }
    });
  });
}
async function requireNvidia(file, opts, label) {
  const sig = await sigcheck(file, opts);
  if (!sig || !sig.ok) {
    const reason = (sig && sig.message) || 'nv-drs.exe missing?';
    throw fail('compErrSignatureCheck', { file: label, reason }, `${label}: signature check not possible (${reason})`);
  }
  if (!sig.valid || sig.signer !== NVIDIA) {
    throw fail('compErrSignature', { file: label, signer: sig.signer || '-' }, `${label}: no valid NVIDIA signature (signer: ${sig.signer || 'none'})`);
  }
  return sig;
}

function tmpDir(payloadDir) {
  const dir = path.join(payloadDir, '.tmp', `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } }
function cleanupTmp(payloadDir, tmp) {
  rmrf(tmp);
  try { fs.rmdirSync(path.join(payloadDir, '.tmp')); } catch { /* not empty or gone */ }
}

// Copy next to the target, then rename over it: a reader never sees half a file.
function placeFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part-${process.pid}`;
  fs.copyFileSync(src, part);
  // Archives can carry the read-only attribute (the ShortFuse zip does); a
  // read-only copy then blocks its own next update with EPERM.
  try { fs.chmodSync(part, 0o666); } catch { /* best effort */ }
  try { if (fs.existsSync(dest)) fs.chmodSync(dest, 0o666); } catch { /* best effort */ }
  try { fs.renameSync(part, dest); }
  catch (error) {
    rmrf(part);
    throw fail('compErrPlace', { file: path.basename(dest), reason: error.code || error.message },
      `${path.basename(dest)} could not be replaced (${error.code || error.message}) - is a game running?`);
  }
  hashCache.delete(path.resolve(dest).toLowerCase());
}
function placeText(text, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part-${process.pid}`;
  fs.writeFileSync(part, text);
  fs.renameSync(part, dest);
}

// Streams url -> file with a total and an idle timeout, hashing on the way.
async function fetchToFile(url, dest, { onProgress, idleMs = 60000, totalMs = 30 * 60000, label } = {}) {
  if (typeof fetch !== 'function') throw fail('compErrNoFetch', {}, 'fetch is not available in this runtime');
  const what = label || path.basename(url);
  const ctrl = new AbortController();
  let idle = null;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), idleMs); };
  const total = setTimeout(() => ctrl.abort(), totalMs);
  const sha = crypto.createHash('sha256');
  let out = null;
  let got = 0;
  const netFail = (error) => {
    const reason = ctrl.signal.aborted ? 'timeout' : (error && error.cause && error.cause.code) || (error && error.message) || 'error';
    return fail('compErrDownload', { what, reason }, `Download failed (${what}): ${reason}`);
  };
  try {
    arm();
    let res;
    try { res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: UA }); }
    catch (error) { throw netFail(error); }
    if (!res.ok || !res.body) throw fail('compErrHttp', { what, status: res.status }, `Download failed (${what}): HTTP ${res.status}`);
    const size = Number(res.headers.get('content-length')) || 0;
    out = fs.createWriteStream(dest);
    const outErr = new Promise((_, reject) => out.on('error', reject));
    outErr.catch(() => {});
    const reader = res.body.getReader();
    let last = 0;
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch (error) { throw netFail(error); }
      if (chunk.done) break;
      arm();
      const buf = Buffer.from(chunk.value);
      got += buf.length;
      sha.update(buf);
      if (!out.write(buf)) await Promise.race([new Promise((r) => out.once('drain', r)), outErr]);
      const now = Date.now();
      if (onProgress && now - last > 200) { last = now; onProgress(got, size); }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    out = null;
    if (onProgress) onProgress(got, size || got);
    return { size: got, sha256: sha.digest('hex') };
  } catch (error) {
    if (out) { try { out.destroy(); } catch {} }
    rmrf(dest);
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}

// Downloads a file and checks its pinned digest.
async function fetchVerified(url, sha256, dest, progress, label) {
  const got = await fetchToFile(url, dest, { onProgress: progress, label });
  if (got.sha256 !== sha256) {
    rmrf(dest);
    throw fail('compErrDigest', { what: label }, `${label}: checksum mismatch (expected ${sha256.slice(0, 12)}…, got ${got.sha256.slice(0, 12)}…)`);
  }
  return got;
}

function findFile(dir, name) {
  const want = name.toLowerCase();
  const queue = [dir];
  while (queue.length) {
    const d = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) queue.push(p);
      else if (e.name.toLowerCase() === want) return p;
    }
  }
  return null;
}
function missingInArchive(what, file) {
  return fail('compErrMissingInArchive', { what, file }, `${what}: ${file} is missing from the archive`);
}
function checkPinned(file, expected, label) {
  if (sha256File(file) !== expected) throw fail('compErrDigest', { what: label }, `${label}: file checksum mismatch`);
}

// ---------------------------------------------------------------- DLSS releases (NVIDIA/DLSS)
let listMemo = null;
function tagsFromApi(json) {
  return (Array.isArray(json) ? json : [])
    .filter((r) => r && !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(String(r.tag_name)))
    .map((r) => r.tag_name);
}
function cleanTags(tags) {
  const set = [...new Set((tags || []).filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && Number(t.slice(1).split('.')[0]) >= 3))];
  return set.sort((a, b) => cmpVer(b, a));
}
// Release tags, newest first. Cached 6 h; falls back to the cache (any age)
// and then to the built-in list when GitHub is unreachable or rate-limited.
async function dlssTags(opts = {}) {
  const cacheFile = opts.cacheDir ? path.join(opts.cacheDir, 'dlss-releases.json') : null;
  const fresh = (m) => m && Array.isArray(m.tags) && Date.now() - m.fetchedAt < LIST_TTL;
  if (!opts.force && fresh(listMemo)) return listMemo;
  let cached = null;
  if (cacheFile) {
    try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cached = null; }
    if (!opts.force && fresh(cached)) { listMemo = cached; return cached; }
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let json;
    try {
      const res = await fetch(DLSS_REPO.releasesApi, { signal: ctrl.signal, headers: { ...UA, Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      json = await res.json();
    } finally { clearTimeout(timer); }
    const tags = cleanTags(tagsFromApi(json));
    if (!tags.length) throw new Error('empty release list');
    listMemo = { fetchedAt: Date.now(), source: 'github', tags };
    if (cacheFile) { try { fs.mkdirSync(opts.cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(listMemo)); } catch {} }
    return listMemo;
  } catch (error) {
    if (cached && Array.isArray(cached.tags) && cached.tags.length) { listMemo = { ...cached, source: 'cache' }; return listMemo; }
    // Retry the API in ten minutes rather than six hours.
    listMemo = { fetchedAt: Date.now() - LIST_TTL + 10 * 60000, source: 'builtin', tags: cleanTags(DLSS_REPO.builtinTags), error: error.message };
    return listMemo;
  }
}
function knownTags(opts = {}) {
  if (listMemo) return listMemo.tags;
  if (opts.cacheDir) {
    try { const c = JSON.parse(fs.readFileSync(path.join(opts.cacheDir, 'dlss-releases.json'), 'utf8')); if (c.tags && c.tags.length) return c.tags; } catch {}
  }
  return cleanTags(DLSS_REPO.builtinTags);
}
const tagsFor = (c, tags) => tags.filter((t) => cmpVer(t, c.since || '0') >= 0);

// { dlss: { versions: [{tag, version}], default: 'v310.9.16' }, dlssd: ..., dlssg: ..., source }
async function dlssVersions(opts = {}) {
  const list = await dlssTags(opts);
  const out = { source: list.source };
  for (const c of COMPONENTS.filter((x) => x.kind === 'dlss')) {
    const tags = tagsFor(c, list.tags);
    out[c.id] = { versions: tags.map((tag) => ({ tag, version: tag.slice(1) })), default: tags[0] || null };
  }
  return out;
}

// ---------------------------------------------------------------- status
function componentFiles(c, payloadDir) {
  const sl = path.join(payloadDir, 'streamline');
  const fd = path.join(payloadDir, 'feeder');
  switch (c.kind) {
    case 'streamline': return Object.keys(pins.streamline).map((f) => [path.join(sl, f), pins.streamline[f]]);
    case 'dlss': case 'import': return [[path.join(sl, c.file), null]];
    case 'renodx': return [[path.join(payloadDir, renodxRelease.CONSUMER.file), renodxRelease.CONSUMER.sha256],
      [path.join(fd, 'host64', renodxRelease.CONSUMER.file), renodxRelease.CONSUMER.sha256]];
    case 'renodx-sf': return [[path.join(fd, 'host64', renodxRelease.MULTIPASS.file), renodxRelease.MULTIPASS.sha256]];
    case 'feeder': {
      const list = Object.entries(pins.feederZip).map(([rel, sha]) => [path.join(fd, ...rel.split('/')), sha]);
      list.push([path.join(fd, 'dlss5-feed-host64.exe'), pins.feederZip['host64/dlss5-feed-host64.exe']]);
      for (const [rel, , sha] of pins.feederExtras) list.push([path.join(fd, ...rel.split('/')), sha]);
      return list;
    }
    case 'legacy-nr': return [[legacyNrPath(payloadDir), LEGACY_NR.sha256]];
    case 'reshade': return [[path.join(payloadDir, RESHADE.file), RESHADE.sha256]]
      .concat(Object.entries(pins.reshadeVulkan).map(([f, sha]) => [path.join(payloadDir, 'reshade-vulkan', f), sha]));
    default: return [];
  }
}

// 310.9.x carries both DLSS 5 models (preset A and B), 310.8.x only A.
function nrModels(version) {
  if (!version) return null;
  if (cmpVer(version, '310.9') >= 0) return 'AB';
  if (cmpVer(version, '310.8') >= 0) return 'A';
  return null;
}

function statusOne(c, payloadDir, tags) {
  const files = componentFiles(c, payloadDir);
  const present = files.filter(([f]) => fs.existsSync(f));
  const row = { id: c.id, name: c.name, source: c.source, kind: c.kind, downloadable: true, optional: Boolean(c.optional), version: null, status: 'missing', note: null };
  if (!present.length) return row;
  if (c.kind === 'dlss' || c.kind === 'import') {
    row.version = pe.getFileVersion(files[0][0]);
    row.status = 'ok';
    if (c.kind === 'import') {
      row.models = nrModels(row.version);
      if (!row.version || cmpVer(row.version, NR_MIN) < 0) { row.status = 'outdated'; row.note = { key: 'compNoteNrOld', params: { min: NR_MIN } }; }
      else if (cmpVer(row.version, NVIDIA_NR.version) < 0) { row.status = 'outdated'; row.latest = NVIDIA_NR.label; row.note = { key: 'compNoteUpdate', params: { version: NVIDIA_NR.label } }; }
      else row.note = { key: row.models === 'AB' ? 'compNoteModelsAB' : 'compNoteModelsA', params: {} };
    } else if (tags) {
      const newest = tagsFor(c, tags)[0];
      row.latest = newest ? newest.slice(1) : null;
      if (newest && row.version && cmpVer(row.version, newest) < 0) { row.status = 'outdated'; row.note = { key: 'compNoteUpdate', params: { version: newest.slice(1) } }; }
    }
    return row;
  }
  const missing = files.filter(([f]) => !fs.existsSync(f));
  const bad = files.filter(([f, sha]) => sha && fs.existsSync(f) && sha256File(f) !== sha);
  if (missing.length) { row.status = 'missing'; row.note = { key: 'compNoteFilesMissing', params: { n: missing.length, total: files.length } }; }
  else if (bad.length) { row.status = 'outdated'; row.note = { key: 'compNoteFilesDiffer', params: { n: bad.length } }; }
  else row.status = 'ok';
  const ok = row.status === 'ok';
  switch (c.kind) {
    case 'streamline': row.version = pe.getFileVersion(path.join(payloadDir, 'streamline', 'sl.interposer.dll')); break;
    case 'renodx': row.version = ok ? renodxRelease.CONSUMER.version : pe.getFileVersion(present[0][0]); break;
    case 'renodx-sf': row.version = ok ? renodxRelease.MULTIPASS.version : pe.getFileVersion(present[0][0]); break;
    case 'feeder': row.version = ok ? feederRelease.version : null; break;
    case 'reshade': row.version = ok ? RESHADE.version : pe.getFileVersion(path.join(payloadDir, 'reshade-vulkan', 'ReShade64.dll')); break;
    case 'legacy-nr':
      row.version = ok ? LEGACY_NR.label : pe.getFileVersion(present[0][0]);
      row.models = 'A';
      if (ok) row.note = { key: 'compNoteLegacyNr', params: {} };
      break;
  }
  return row;
}

function status(payloadDir, opts = {}) {
  const tags = knownTags(opts);
  const rows = COMPONENTS.map((c) => statusOne(c, payloadDir, tags));
  // Optional components never make the set incomplete.
  const needed = rows.filter((r) => !r.optional);
  return {
    payloadDir,
    components: rows,
    complete: needed.every((r) => r.status !== 'missing'),
    allOk: needed.every((r) => r.status === 'ok'),
    missing: needed.filter((r) => r.status === 'missing').map((r) => r.id)
  };
}

// ---------------------------------------------------------------- downloads
function writeThirdPartySources(payloadDir) {
  const text = [
    `DLSS5-Feeder v${feederRelease.version} - https://github.com/jlrouzies-fr/DLSS5-Feeder`,
    'VORT shaders b410b9f0c0fbb83c8cb42164aaf1655fab386f4a - https://github.com/vortigern11/vort_Shaders',
    'ReShade headers ee30868391d4ad103db60489820102d8fd40e3c1 - https://github.com/crosire/reshade-shaders',
    'dgVoodoo2 - downloaded at runtime; not bundled - https://github.com/dege-diosg/dgVoodoo2',
    `RenoDX DLSS5 add-on v${renodxRelease.CONSUMER.version} - https://github.com/clshortfuse/renodx`,
    `RenoDX DLSS Tool add-on ${renodxRelease.MULTIPASS.version} - https://github.com/clshortfuse/renodx`,
    ''
  ].join('\r\n');
  placeText(text, path.join(payloadDir, 'feeder', 'licenses', 'THIRD-PARTY-SOURCES.txt'));
}

async function downloadStreamline(payloadDir, tmp, progress, opts) {
  const [name, url, sha] = STREAMLINE.archive;
  const zip = path.join(tmp, name);
  await fetchVerified(url, sha, zip, (g, t) => progress({ phase: 'download', received: g, total: t }), 'Streamline');
  progress({ phase: 'verify' });
  const out = path.join(tmp, 'x');
  await extract(zip, { dir: out });
  const staged = [];
  for (const [file, expected] of Object.entries(pins.streamline)) {
    const src = findFile(out, file);
    if (!src) throw missingInArchive('Streamline', file);
    checkPinned(src, expected, file);
    await requireNvidia(src, opts, file);
    staged.push([src, path.join(payloadDir, 'streamline', file)]);
  }
  for (const [src, dest] of staged) placeFile(src, dest);
  // License texts: informational, never block the component.
  for (const [file, licUrl, licSha] of pins.streamlineLicenses) {
    const dest = path.join(tmp, file);
    try { await fetchVerified(licUrl, licSha, dest, null, file); placeFile(dest, path.join(payloadDir, 'streamline', file)); }
    catch { /* optional */ }
  }
  return { version: STREAMLINE.version };
}

// One DLL straight from NVIDIA's repo at a release tag.
async function downloadDlss(c, payloadDir, tmp, progress, opts) {
  let tag = opts.tag || (opts.version ? 'v' + String(opts.version).replace(/^v/i, '') : null);
  if (!tag) tag = tagsFor(c, (await dlssTags(opts)).tags)[0];
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) throw fail('compErrBadVersion', { version: String(tag) }, `Unknown DLSS version ${tag}`);
  if (cmpVer(tag, c.since) < 0) throw fail('compErrNotInRelease', { file: c.file, tag }, `${c.file} is not part of NVIDIA DLSS ${tag}`);
  const dll = path.join(tmp, c.file);
  try {
    await fetchToFile(DLSS_REPO.raw(tag, c.file), dll, { onProgress: (g, t) => progress({ phase: 'download', received: g, total: t }), label: c.file });
  } catch (error) {
    if (error.code === 'compErrHttp' && error.params.status === 404) throw fail('compErrNotInRelease', { file: c.file, tag }, `${c.file} is not part of NVIDIA DLSS ${tag}`);
    throw error;
  }
  progress({ phase: 'verify' });
  const pin = DLSS_REPO.pinned[tag] && DLSS_REPO.pinned[tag][c.file];
  if (pin) checkPinned(dll, pin[0], c.file);
  const sig = await requireNvidia(dll, opts, c.file);
  const version = pe.getFileVersion(dll) || sig.version;
  const want = tag.slice(1);
  if (!version || cmpVer(version.split('.').slice(0, 3).join('.'), want) !== 0) {
    throw fail('compErrVersion', { file: c.file, got: version || '?', want }, `${c.file}: version ${version || '?'} instead of ${want}`);
  }
  placeFile(dll, path.join(payloadDir, 'streamline', c.file));
  return { version, tag };
}

async function downloadSingleAddon(rel, payloadDir, tmp, progress, targets) {
  const [name, url, sha] = rel.archive;
  const zip = path.join(tmp, name);
  await fetchVerified(url, sha, zip, (g, t) => progress({ phase: 'download', received: g, total: t }), name);
  progress({ phase: 'verify' });
  const out = path.join(tmp, 'x');
  await extract(zip, { dir: out });
  const src = findFile(out, rel.file);
  if (!src) throw missingInArchive(name, rel.file);
  checkPinned(src, rel.sha256, rel.file);
  for (const dest of targets) placeFile(src, path.join(payloadDir, dest));
  return { version: rel.version };
}

async function downloadFeeder(payloadDir, tmp, progress) {
  const [name, url, sha] = feederRelease.archive;
  const zip = path.join(tmp, name);
  const extras = pins.feederExtras;
  await fetchVerified(url, sha, zip, (g, t) => progress({ phase: 'download', received: g, total: t }), name);
  const out = path.join(tmp, 'x');
  await extract(zip, { dir: out });
  const staged = [];
  for (const [rel, expected] of Object.entries(pins.feederZip)) {
    const src = path.join(out, ...rel.split('/'));
    if (!fs.existsSync(src)) throw missingInArchive(name, rel);
    checkPinned(src, expected, rel);
    staged.push([src, rel]);
  }
  for (const [file, expected] of Object.entries(feederRelease.hashes)) {
    const inZip = pins.feederZip[file] || pins.feederZip['host64/' + file];
    if (inZip !== expected) throw fail('compErrFeederPins', { file }, `Feeder: ${file} does not match feeder-release.js`);
  }
  // Shader dependencies and license texts the release zip does not carry.
  const dl = path.join(tmp, 'extras');
  let i = 0;
  for (const [rel, rawUrl, expected] of extras) {
    progress({ phase: 'download', index: ++i, count: extras.length, file: rel });
    const dest = path.join(dl, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await fetchVerified(rawUrl, expected, dest, null, rel);
    staged.push([dest, rel]);
  }
  progress({ phase: 'verify' });
  const fd = path.join(payloadDir, 'feeder');
  for (const [src, rel] of staged) placeFile(src, path.join(fd, ...rel.split('/')));
  // Feeder's host must ALSO sit in the feeder root (scan.js / apply.js read it there).
  placeFile(path.join(out, 'host64', 'dlss5-feed-host64.exe'), path.join(fd, 'dlss5-feed-host64.exe'));
  writeThirdPartySources(payloadDir);
  return { version: feederRelease.version };
}

// The setup exe carries a plain zip (ReShade32/64.dll + Vulkan layer json).
// It is read, never run. The zip is located by its end-of-central-directory
// record because the exe holds an earlier stray PK\3\4 marker, and the
// Authenticode signature after the zip has to be cut off for zip readers.
function zipFromSetup(exe, dest) {
  const buf = fs.readFileSync(exe);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let start = -1;
  let end = buf.length;
  if (eocd !== -1 && eocd + 22 <= buf.length) {
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOff = buf.readUInt32LE(eocd + 16);
    const s = eocd - cdSize - cdOff;
    if (s >= 0 && buf.readUInt32LE(s) === 0x04034b50) { start = s; end = eocd + 22; }
  }
  if (start < 0) start = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (start < 0) throw fail('compErrReshadeArchive', {}, 'ReShade: no archive found inside the setup');
  const zip = Buffer.from(buf.subarray(start, end));
  if (eocd !== -1 && end === eocd + 22) zip.writeUInt16LE(0, zip.length - 2);
  fs.writeFileSync(dest, zip);
}

// #17: reshade.me is slow or unreachable from some countries. A copy of the
// exact pinned setup that the person fetched in a browser (Downloads folder)
// is used instead - it is only accepted byte-for-byte, so it is the same file.
function localReShadeSetup() {
  const home = process.env.USERPROFILE || require('os').homedir();
  for (const dir of [path.join(home, 'Downloads'), path.join(home, 'Desktop')]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/^ReShade_Setup_6\.8\.0_Addon(?:\s*\(\d+\))?\.exe$/i.test(name)) continue;
      const file = path.join(dir, name);
      try { if (sha256File(file) === RESHADE.sha256) return file; } catch { /* locked or gone */ }
    }
  }
  return null;
}

async function downloadReShade(payloadDir, tmp, progress) {
  const exe = path.join(tmp, RESHADE.file);
  const local = localReShadeSetup();
  if (local) {
    fs.copyFileSync(local, exe);
  } else {
    let lastError = null;
    for (let attempt = 0; attempt < 2 && !fs.existsSync(exe); attempt++) {
      try { await fetchVerified(RESHADE.url, RESHADE.sha256, exe, (g, t) => progress({ phase: 'download', received: g, total: t }), 'ReShade'); }
      catch (error) { lastError = error; if (error.code !== 'compErrDownload') throw error; }
    }
    if (!fs.existsSync(exe)) {
      throw fail('compErrReshadeManual', { what: 'ReShade', reason: (lastError.params && lastError.params.reason) || 'error', file: RESHADE.file },
        `Download failed (ReShade): reshade.me did not answer. Download ${RESHADE.file} in your browser into Downloads, then click Download again.`);
    }
  }
  progress({ phase: 'verify' });
  const zip = path.join(tmp, 'reshade.zip');
  zipFromSetup(exe, zip);
  const out = path.join(tmp, 'x');
  await extract(zip, { dir: out });
  const staged = [];
  for (const [file, expected] of Object.entries(pins.reshadeVulkan)) {
    const src = findFile(out, file);
    if (!src) throw missingInArchive('ReShade', file);
    checkPinned(src, expected, file);
    staged.push([src, path.join(payloadDir, 'reshade-vulkan', file)]);
  }
  for (const [src, dest] of staged) placeFile(src, dest);
  placeFile(exe, path.join(payloadDir, RESHADE.file));
  return { version: RESHADE.version };
}

// The community build for RTX 20/30/40. opts.acceptUnsigned must be true: the
// renderer sets it only after the person confirmed the warning. No signature
// check is possible (the file is modified), so it is pinned twice instead.
async function downloadLegacyNr(payloadDir, tmp, progress, opts) {
  if (!opts || opts.acceptUnsigned !== true) throw fail('compErrLegacyNrConsent', {}, 'The community DLSS 5 build needs your confirmation first.');
  const [name, url, sha] = LEGACY_NR.archive;
  const zip = path.join(tmp, name);
  await fetchVerified(url, sha, zip, (g, t) => progress({ phase: 'download', received: g, total: t }), LEGACY_NR.label);
  progress({ phase: 'verify' });
  const out = path.join(tmp, 'x');
  await extract(zip, { dir: out });
  const src = findFile(out, LEGACY_NR.file);
  if (!src) throw missingInArchive(LEGACY_NR.label, LEGACY_NR.file);
  checkPinned(src, LEGACY_NR.sha256, LEGACY_NR.file);
  // The archive marks the DLL read-only; a read-only copy in a game folder
  // could not be removed again by Restore.
  try { fs.chmodSync(src, 0o666); } catch { /* best effort */ }
  placeFile(src, legacyNrPath(payloadDir));
  return { version: LEGACY_NR.label };
}

// NVIDIA's signed DLSS 5 model. Same checks as an import, plus two pins.
async function downloadNr(payloadDir, tmp, progress, opts) {
  const [name, url, sha] = NVIDIA_NR.archive;
  const zip = path.join(tmp, name);
  await fetchVerified(url, sha, zip, (g, t) => progress({ phase: 'download', received: g, total: t }), 'DLSS 5 ' + NVIDIA_NR.label);
  progress({ phase: 'verify' });
  const out = path.join(tmp, 'x');
  await extract(zip, { dir: out });
  const src = findFile(out, NVIDIA_NR.file);
  if (!src) throw missingInArchive('DLSS 5 ' + NVIDIA_NR.label, NVIDIA_NR.file);
  checkPinned(src, NVIDIA_NR.sha256, NVIDIA_NR.file);
  const info = await validateNr(src, opts);
  try { fs.chmodSync(src, 0o666); } catch { /* best effort */ }
  placeFile(src, path.join(payloadDir, 'streamline', NVIDIA_NR.file));
  return info;
}

// download(payloadDir, id, opts, progressCb) - opts.tag ('v310.9.16') picks
// the NVIDIA release for dlss/dlssd/dlssg; opts.cacheDir caches the release
// list; opts.helper overrides the nv-drs.exe path.
async function download(payloadDir, id, opts = {}, progressCb = () => {}) {
  const c = byId(id);
  if (!c) throw fail('compErrUnknown', { id }, 'Unknown component: ' + id);
  fs.mkdirSync(payloadDir, { recursive: true });
  const tmp = tmpDir(payloadDir);
  const progress = (p) => { try { progressCb({ id, ...p }); } catch {} };
  progress({ phase: 'start' });
  try {
    let result;
    switch (c.kind) {
      case 'streamline': result = await downloadStreamline(payloadDir, tmp, progress, opts); break;
      case 'dlss': result = await downloadDlss(c, payloadDir, tmp, progress, opts); break;
      case 'renodx': result = await downloadSingleAddon(renodxRelease.CONSUMER, payloadDir, tmp, progress,
        [renodxRelease.CONSUMER.file, path.join('feeder', 'host64', renodxRelease.CONSUMER.file)]); break;
      case 'renodx-sf': result = await downloadSingleAddon(renodxRelease.MULTIPASS, payloadDir, tmp, progress,
        [path.join('feeder', 'host64', renodxRelease.MULTIPASS.file)]); break;
      case 'feeder': result = await downloadFeeder(payloadDir, tmp, progress); break;
      case 'reshade': result = await downloadReShade(payloadDir, tmp, progress); break;
      case 'legacy-nr': result = await downloadLegacyNr(payloadDir, tmp, progress, opts); break;
      case 'import': result = await downloadNr(payloadDir, tmp, progress, opts); break;
      default: throw fail('compErrUnknown', { id }, 'Unsupported component: ' + id);
    }
    progress({ phase: 'done', version: result.version });
    return { ok: true, id, ...result };
  } catch (error) {
    progress({ phase: 'error', code: error.code, params: error.params, message: error.message });
    throw error;
  } finally {
    cleanupTmp(payloadDir, tmp);
  }
}

// Downloads every component that is not ok. A DLSS 5 model that is present
// (imported or downloaded) is never replaced by Download all. opts.versions = { dlss: 'v310.9.16', dlssd: ..., dlssg: ... }.
async function ensureAll(payloadDir, opts = {}, progressCb = () => {}) {
  const before = status(payloadDir, opts);
  const results = [];
  for (const row of before.components) {
    if (row.optional) { results.push({ id: row.id, ok: true, skipped: true, code: 'compOptional' }); continue; }
    if (row.kind === 'import' && row.status !== 'missing' && !opts.force) { results.push({ id: row.id, ok: true, skipped: true, code: 'compPresent' }); continue; }
    const pick = opts.versions && opts.versions[row.id];
    const wanted = pick && row.version ? cmpVer(row.version.split('.').slice(0, 3).join('.'), pick) !== 0 : Boolean(pick);
    if (row.status === 'ok' && !opts.force && !wanted) { results.push({ id: row.id, ok: true, skipped: true, code: 'compUpToDate' }); continue; }
    try {
      const r = await download(payloadDir, row.id, { ...opts, tag: pick || undefined }, progressCb);
      results.push({ id: row.id, ok: true, version: r.version });
    } catch (error) {
      results.push({ id: row.id, ok: false, code: error.code, params: error.params, message: error.message });
    }
  }
  return { ok: results.every((r) => r.ok || r.skipped), results };
}

// ---------------------------------------------------------------- DLSS 5 import
async function validateNr(dll, opts) {
  if (path.basename(dll).toLowerCase() !== 'nvngx_dlssnr.dll') throw fail('compErrNrName', {}, 'The file must be named nvngx_dlssnr.dll.');
  const sig = await requireNvidia(dll, opts, 'nvngx_dlssnr.dll');
  if (String(sig.product || '').trim() !== 'NVIDIA DLSSNR') {
    throw fail('compErrNrProduct', { product: sig.product || '' }, `nvngx_dlssnr.dll: unexpected product "${sig.product || ''}"`);
  }
  const version = pe.getFileVersion(dll) || sig.version;
  if (!version || cmpVer(version, NR_MIN) < 0) {
    throw fail('compErrNrVersion', { got: version || '?', min: NR_MIN }, `nvngx_dlssnr.dll ${version || '?'} is too old (at least ${NR_MIN})`);
  }
  return { version, models: nrModels(version) };
}

async function importNr(payloadDir, file, opts = {}) {
  if (!file || !fs.existsSync(file)) throw fail('compErrFileMissing', {}, 'File not found');
  fs.mkdirSync(payloadDir, { recursive: true });
  const tmp = tmpDir(payloadDir);
  try {
    let dll = file;
    if (/\.zip$/i.test(file)) {
      const out = path.join(tmp, 'x');
      await extract(file, { dir: out });
      dll = findFile(out, 'nvngx_dlssnr.dll');
      if (!dll) throw fail('compErrNrNotInZip', {}, 'The archive contains no nvngx_dlssnr.dll.');
    } else if (!/\.dll$/i.test(file)) {
      throw fail('compErrWrongType', {}, 'Please choose a .dll or .zip file.');
    }
    const info = await validateNr(dll, opts);
    placeFile(dll, path.join(payloadDir, 'streamline', 'nvngx_dlssnr.dll'));
    return { ok: true, id: 'dlssnr', ...info };
  } finally {
    cleanupTmp(payloadDir, tmp);
  }
}

// ---------------------------------------------------------------- migration
function legacyDirs(extra = []) {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean);
  const dirs = roots.map((r) => path.join(r, 'DLSS 5 Swapper', 'resources', 'payload')).concat(extra || []);
  const seen = new Set();
  return dirs.filter((d) => {
    const k = path.resolve(d).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return fs.existsSync(path.join(d, 'streamline'));
  });
}

// Which components a legacy payload could supply (cheap: presence + pins, no signatures).
function legacyOffer(payloadDir, legacyDir, opts = {}) {
  const mine = status(payloadDir, opts).components;
  const theirs = status(legacyDir, opts).components;
  return mine.filter((r) => r.status !== 'ok' && !r.optional).map((r) => {
    const t = theirs.find((x) => x.id === r.id);
    const usable = t && (t.kind === 'dlss' || t.kind === 'import' ? t.status !== 'missing' : t.status === 'ok');
    return usable ? { id: r.id, version: t.version } : null;
  }).filter(Boolean);
}

// Copies every component that is not ok here from an old install, after the
// same checks a download gets (signatures for NVIDIA files, pins elsewhere).
async function migrate(payloadDir, legacyDir, opts = {}, progressCb = () => {}) {
  if (!legacyDir || !fs.existsSync(legacyDir)) throw fail('compErrLegacyMissing', {}, 'No old installation found.');
  if (path.resolve(legacyDir).toLowerCase() === path.resolve(payloadDir).toLowerCase()) throw fail('compErrLegacyMissing', {}, 'Source and target are the same folder.');
  fs.mkdirSync(payloadDir, { recursive: true });
  const mine = status(payloadDir, opts).components;
  const results = [];
  for (const row of mine) {
    const c = byId(row.id);
    const progress = (p) => { try { progressCb({ id: row.id, ...p }); } catch {} };
    if (row.status === 'ok') { results.push({ id: row.id, ok: true, skipped: true, code: 'compUpToDate' }); continue; }
    if (row.optional) { results.push({ id: row.id, ok: true, skipped: true, code: 'compOptional' }); continue; }
    progress({ phase: 'verify' });
    try {
      const src = componentFiles(c, legacyDir);
      const dst = componentFiles(c, payloadDir);
      if (!src.every(([f]) => fs.existsSync(f))) throw fail('compErrLegacyIncomplete', {}, 'incomplete in the old installation');
      let version = null;
      if (c.kind === 'dlss') {
        const sig = await requireNvidia(src[0][0], opts, c.file);
        version = pe.getFileVersion(src[0][0]) || sig.version;
      } else if (c.kind === 'import') {
        version = (await validateNr(src[0][0], opts)).version;
      } else {
        for (const [f, sha] of src) {
          if (sha && sha256File(f) !== sha) throw fail('compErrLegacyOtherVersion', { file: path.basename(f) }, `${path.basename(f)} is a different version than the verified one - download it instead`);
        }
        if (c.kind === 'streamline') for (const [f] of src) await requireNvidia(f, opts, path.basename(f));
      }
      src.forEach(([f], i) => placeFile(f, dst[i][0]));
      if (c.kind === 'streamline') {
        for (const [file] of pins.streamlineLicenses) {
          const lic = path.join(legacyDir, 'streamline', file);
          if (fs.existsSync(lic)) placeFile(lic, path.join(payloadDir, 'streamline', file));
        }
      }
      if (c.kind === 'feeder') writeThirdPartySources(payloadDir);
      const after = statusOne(c, payloadDir, null);
      progress({ phase: 'done', version: version || after.version });
      results.push({ id: row.id, ok: true, version: version || after.version });
    } catch (error) {
      progress({ phase: 'error', code: error.code, params: error.params, message: error.message });
      results.push({ id: row.id, ok: false, code: error.code, params: error.params, message: error.message });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

module.exports = {
  COMPONENTS, STREAMLINE, RESHADE, DLSS_REPO, NR_MIN, NVIDIA_NR, LEGACY_NR, legacyNrPath, legacyNrReady, removeLegacyNr,
  status, download, ensureAll, importNr, migrate, legacyDirs, legacyOffer,
  dlssVersions, dlssTags, sigcheck, cmpVer, nrModels, zipFromSetup
};
