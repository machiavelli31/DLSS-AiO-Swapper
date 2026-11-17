'use strict';

// Lecram's add-on changed its file name with v11: up to v10.8 it was
// renodx-dlss5.addon64, from v11 on it is dlss5-nr.addon64 (and a v11+ build
// must keep that name - it treats a loaded renodx-dlss5.addon64 as a rival NR
// add-on). "Update installed DLSS 5" only swapped same-named files, so a game
// installed with v10.8 or the built-in 8.5 never received an imported v12
// until it was installed again by hand. This plans and performs that rename.

const fs = require('fs');
const path = require('path');

const LECRAM = ['renodx-dlss5.addon64', 'dlss5-nr.addon64'];
const HOST_DIR = /(^|[\\/])dlss5-nr-host[\\/]/i;

// The game's Lecram add-on at `rel`, and the build being rolled out under the
// other name: returns { newRel, src } or null.
function plan(rel, sources, route) {
  if (typeof rel !== 'string') return null;
  const base = path.basename(rel).toLowerCase();
  if (!LECRAM.includes(base) || HOST_DIR.test(rel) || sources.has(base)) return null;
  const other = LECRAM.find((name) => name !== base);
  const src = sources.get(other);
  if (!src) return null;
  // The no-Feeder route needs v12.6+ and its host; an older build under the
  // old name cannot serve it.
  if (other === 'renodx-dlss5.addon64' && route === 'lecram12') return null;
  return { newRel: path.join(path.dirname(rel), other), src };
}

// Puts `src` in under the new name, removes the old copy and records the new
// name in the manifest so Restore removes it. The caller saves the manifest.
function apply(manifest, gameDir, item, safePath) {
  const oldTarget = safePath(gameDir, item.rel);
  const newTarget = safePath(gameDir, item.newRel);
  const tmp = newTarget + '.aio-update';
  fs.copyFileSync(item.src, tmp);
  try { fs.chmodSync(tmp, 0o666); } catch { /* best effort */ }
  if (fs.existsSync(newTarget)) { try { fs.chmodSync(newTarget, 0o666); } catch {} }
  fs.renameSync(tmp, newTarget);
  try { fs.chmodSync(oldTarget, 0o666); } catch {}
  fs.rmSync(oldTarget, { force: true });
  const added = manifest.added || (manifest.added = []);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const at = added.findIndex((rel) => typeof rel === 'string' && same(rel, item.rel));
  if (at >= 0) added.splice(at, 1);
  if (!added.some((rel) => typeof rel === 'string' && same(rel, item.newRel))) added.push(item.newRel);
}

module.exports = { LECRAM, plan, apply };
