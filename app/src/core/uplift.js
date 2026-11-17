'use strict';

// GITC Uplift by ghostinthecamera (MIT, https://github.com/ghostinthecamera/GITC-Uplift):
// DLSS 5 Neural Rendering through ReShade for DirectX 9-12, Vulkan and OpenGL,
// 64- and 32-bit, with or without the game's own DLSS - a free alternative to
// the Feeder for games without DLSS. Downloaded on first use from the author's
// GitHub release, pinned by the archive digest and every file's SHA-256 (the
// release's own SHA256SUMS.txt). The NVIDIA runtime is not in the release; the
// app puts its own signed nvngx_dlssnr.dll into the GITC-Uplift folder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const extractZip = require('extract-zip');
const { fetchVerified, cached } = require('./runtime-components');

const RELEASE = Object.freeze({
  version: '2.0.0',
  url: 'https://github.com/ghostinthecamera/GITC-Uplift/releases/download/v2.0.0/GITC-Uplift-2.0.0.zip',
  sha256: '1eac38a62339e993cc98fd4f4773dd8a327b098b47c4d21fc070a9d3d6aac255',
  files: Object.freeze({
    'Addons/gitc-uplift.addon64': 'fa18fbbc2f67e31cde2d25b585b78c9d8359566eb916ea44e02fa54277eb40c2',
    'Addons/gitc-uplift.addon32': 'baec0d6d78a0503ff0bb175f4bd2b1a1fb443887bdd7758115a3b261b5396a71',
    'Addons/gitc-uplift-helper64.exe': '9c593aefee8db43f6d1d971666a1eb3564eed59d1c9b0cdfbc6d1b671de697f6',
    'Shaders/Uplift.fx': '488512e79ab257b67499bba4351815ccf92f3eef257a39a67cddc9a43c8c7e43',
    'Shaders/UpliftMask.fx': '98c3bfb871d67a6d1ec3a492305b21b45ef46a1667b87060de1823e36bc0c2d2',
    LICENSE: '473efa28b19a41453e5738019260d4e486b86aa7dfb4a14f9e6a59d53f6360aa',
    'THIRD_PARTY_NOTICES.md': 'a77834ce954f243946324603a7710659622a2edb1efb768a7fff7b20f2d5f3b9'
  })
});

// Every Uplift file this app has ever installed - Update installed DLSS 5
// only swaps a game's copy when it is one of these (never a hand-placed build).
const SHIPPED = Object.freeze(Object.values(RELEASE.files));

const ADDON64 = 'gitc-uplift.addon64';
const ADDON32 = 'gitc-uplift.addon32';
const HELPER = 'gitc-uplift-helper64.exe';
const RUNTIME_DIR = 'GITC-Uplift';
const NAMES = Object.freeze([ADDON64, ADDON32, HELPER]);

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function layout(root) {
  return {
    version: RELEASE.version,
    root,
    addon64: path.join(root, 'Addons', ADDON64),
    addon32: path.join(root, 'Addons', ADDON32),
    helper: path.join(root, 'Addons', HELPER),
    shaders: ['Uplift.fx', 'UpliftMask.fx'].map((name) => path.join(root, 'Shaders', name)),
    license: path.join(root, 'LICENSE')
  };
}

function verified(root) {
  return Object.entries(RELEASE.files).every(([rel, expected]) => {
    const file = path.join(root, ...rel.split('/'));
    try { return fs.existsSync(file) && sha(file) === expected; } catch { return false; }
  });
}

// Downloads (once) and verifies the release under <cacheRoot>\components.
async function ensure(cacheRoot) {
  const base = path.join(cacheRoot, 'components', `GITC-Uplift-${RELEASE.version}`);
  const archive = base + '.zip';
  const root = path.join(base, 'x');
  if (fs.existsSync(path.join(base, '.verified')) && verified(root)) return layout(root);
  if (!cached(archive, RELEASE.sha256)) {
    try { await fs.promises.unlink(archive); } catch {}
    await fetchVerified(RELEASE.url, RELEASE.sha256, archive);
  }
  await fs.promises.rm(base, { recursive: true, force: true });
  await extractZip(archive, { dir: root });
  if (!verified(root)) {
    await fs.promises.rm(base, { recursive: true, force: true });
    throw Object.assign(new Error('GITC Uplift: a file does not match the pinned release'), { code: 'errUpliftDownload' });
  }
  for (const rel of Object.keys(RELEASE.files)) { try { fs.chmodSync(path.join(root, ...rel.split('/')), 0o666); } catch {} }
  await fs.promises.writeFile(path.join(base, '.verified'), RELEASE.sha256, 'utf8');
  return layout(root);
}

module.exports = { RELEASE, SHIPPED, NAMES, ADDON64, ADDON32, HELPER, RUNTIME_DIR, ensure, layout };
