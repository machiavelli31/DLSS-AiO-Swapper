'use strict';

// A write-ahead, file-level journal. Never snapshot or recursively delete a
// whole game. A failed/interrupted backend switch can restore the exact files
// that were present immediately before it, including user-tuned settings.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const active = new Map();
const rootKey = dir => path.resolve(dir).toLowerCase();
const pendingPath = dir => path.join(dir, '_DLSS5_Backup', 'pending-switch.json');
function error(code) { return Object.assign(new Error(code), { code }); }

function safePath(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes(':')) throw error('errUnsafeTarget');
  const dest = path.resolve(root, rel);
  const relative = path.relative(path.resolve(root), dest);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep)) throw error('errUnsafeTarget');
  // Refuse junctions/symlinks, including the selected root. A lexical prefix
  // alone does not guarantee that a write stays in the selected game folder.
  let item = dest;
  while (true) {
    try {
      if (fs.lstatSync(item).isSymbolicLink()) throw error('errUnsafeTarget');
    } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    if (rootKey(item) === rootKey(root)) break;
    item = path.dirname(item);
  }
  return dest;
}
async function atomicJson(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await fs.promises.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(temp, file);
}
async function capture(gameDir, target) {
  const state = active.get(rootKey(gameDir));
  if (!state) return;
  const rel = path.relative(gameDir, target);
  safePath(gameDir, rel);
  if (state.files.some(f => f.rel.toLowerCase() === rel.toLowerCase())) return;
  let parent = path.dirname(target);
  while (rootKey(parent) !== rootKey(gameDir)) {
    const dir = path.relative(gameDir, parent);
    if (!fs.existsSync(parent) && !state.dirs.includes(dir)) state.dirs.push(dir);
    parent = path.dirname(parent);
  }
  const existed = fs.existsSync(target);
  if (existed && !fs.statSync(target).isFile()) throw error('errUnsafeTarget');
  const snapshot = `${state.folder}/${state.files.length}.bin`;
  if (existed) {
    const copy = safePath(gameDir, snapshot);
    await fs.promises.mkdir(path.dirname(copy), { recursive: true });
    await fs.promises.copyFile(target, copy);
  }
  state.files.push({ rel, existed, snapshot });
  await atomicJson(pendingPath(gameDir), state);
}
async function cleanup(gameDir, state) {
  // Only our numbered snapshots and now-empty transaction folder.
  for (const item of state.files) {
    const file = safePath(gameDir, item.snapshot);
    if (fs.existsSync(file)) await fs.promises.unlink(file);
  }
  try { await fs.promises.rmdir(safePath(gameDir, state.folder)); } catch {}
}
async function recover(gameDir) {
  const pending = pendingPath(gameDir);
  if (!fs.existsSync(pending)) return false;
  safePath(gameDir, path.relative(gameDir, pending));
  const state = JSON.parse(await fs.promises.readFile(pending, 'utf8'));
  if (state.version !== 1 || !Array.isArray(state.files) || !Array.isArray(state.dirs) ||
      !/^_DLSS5_Backup\/\.transactions\/[a-f0-9-]+$/.test(state.folder)) throw error('errBackupInvalid');
  // Validate everything before changing anything. Missing rollback bytes are
  // not permission to silently discard the journal and report success.
  for (const item of state.files) {
    safePath(gameDir, item.rel);
    if (!item.snapshot.startsWith(state.folder + '/') || !/^\d+\.bin$/.test(path.basename(item.snapshot))) throw error('errBackupInvalid');
    const copy = safePath(gameDir, item.snapshot);
    if (item.existed && !fs.existsSync(copy)) throw error('errBackendRecovery');
  }
  for (const dir of state.dirs) safePath(gameDir, dir);
  for (const item of [...state.files].reverse()) {
    const target = safePath(gameDir, item.rel);
    if (item.existed) {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(safePath(gameDir, item.snapshot), target);
    } else if (fs.existsSync(target)) await fs.promises.unlink(target);
  }
  for (const dir of [...state.dirs].sort((a, b) => b.length - a.length)) {
    try { await fs.promises.rmdir(safePath(gameDir, dir)); } catch {}
  }
  await fs.promises.unlink(pending);
  await cleanup(gameDir, state).catch(() => {});
  return true;
}
async function transaction(gameDir, work) {
  if (active.has(rootKey(gameDir))) throw error('errJobBusy');
  if (fs.existsSync(pendingPath(gameDir))) throw error('errBackendRecovery');
  safePath(gameDir, '_DLSS5_Backup/pending-switch.json');
  const state = { version: 1, folder: `_DLSS5_Backup/.transactions/${crypto.randomUUID()}`, files: [], dirs: [] };
  await atomicJson(pendingPath(gameDir), state);
  active.set(rootKey(gameDir), state);
  try {
    await capture(gameDir, path.join(gameDir, '_DLSS5_Backup', 'manifest.json'));
    const result = await work();
    await fs.promises.unlink(pendingPath(gameDir));
    active.delete(rootKey(gameDir));
    await cleanup(gameDir, state).catch(() => {});
    return result;
  } catch (cause) {
    active.delete(rootKey(gameDir));
    try { await recover(gameDir); }
    catch (recoveryError) { throw Object.assign(error('errBackendRecovery'), { cause, recoveryError }); }
    throw cause;
  }
}
module.exports = { safePath, capture, transaction, recover, pendingPath, atomicJson };