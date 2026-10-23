'use strict';
// NVIDIA driver profile settings per game (DLSS AiO Swapper).
// resources\nv-drs.exe reads/writes the game's DRS profile via NvAPI - the same
// settings the NVIDIA app's "DLSS Override" and Profile Inspector use.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const EXE_NAME = /^[^\\/:*?"<>|]{1,200}\.exe$/i;
const PRIVILEGE = -137;   // NVAPI_INVALID_USER_PRIVILEGE

// Only these settings may be touched from the UI.
const ALLOWED = new Set([
  '0x10E41E01', '0x10E41DF3', '0x10AFB768', '0x10E41DF4',   // Super Resolution
  '0x10E41E02', '0x10E41DF7',                               // Ray Reconstruction
  '0x10E41E03', '0x10E41DF1', '0x10308298', '0x104D6667', '0x10562D0F',  // Frame Generation
  '0x10E41DF8'                                              // DLSS 5 (NR) model preset
]);

function helperPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'nv-drs.exe'),
    path.join(__dirname, '..', '..', 'nv-drs.exe'),
    // From source: tools/build-helper.js compiles it into <repo>\build.
    path.join(__dirname, '..', '..', '..', 'build', 'nv-drs.exe')
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function run(args) {
  return new Promise((resolve) => {
    execFile(helperPath(), args, { windowsHide: true, timeout: 20000 }, (error, stdout) => {
      const line = String(stdout || '').trim().split(/\r?\n/).pop();
      try { resolve(JSON.parse(line)); }
      catch { resolve({ ok: false, code: 0, message: error ? error.message : 'nv-drs: no response' }); }
    });
  });
}

function runElevated(args) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${helperPath().replace(/'/g, "''")}' -ArgumentList ${args.map(a => `'${String(a).replace(/'/g, "''")}'`).join(',')} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $LASTEXITCODE`], { windowsHide: true, timeout: 120000 },
      (error) => resolve(!error));
  });
}

function exeName(exe) {
  const name = path.basename(String(exe || ''));
  if (!EXE_NAME.test(name)) throw new Error('Invalid program name');
  return name;
}
function normId(id) {
  const n = typeof id === 'number' ? id : parseInt(String(id), 16);
  const hex = '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  if (!ALLOWED.has(hex)) throw new Error('Setting not allowed: ' + id);
  return hex;
}

async function get(exe, ids) {
  if (process.platform !== 'win32') return { ok: false, message: 'Windows only' };
  const list = (Array.isArray(ids) && ids.length ? ids : [...ALLOWED]).map(normId);
  return run(['get', exeName(exe), list.join(',')]);
}

// changes: { '0x10E41DF3': 12 | 'default', ... }
async function set(exe, changes) {
  const name = exeName(exe);
  const pairs = Object.entries(changes || {}).map(([id, value]) => {
    const key = normId(id);
    if (value === 'default' || value === null) return `${key}=default`;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) throw new Error('Invalid value for ' + key);
    return `${key}=0x${n.toString(16).toUpperCase()}`;
  });
  if (!pairs.length) return { ok: false, message: 'Nothing to change' };
  let result = await run(['set', name, ...pairs]);
  if (!result.ok && result.code === PRIVILEGE) {
    await runElevated(['set', name, ...pairs]);
    result = await get(name, pairs.map((p) => p.split('=')[0]));
  }
  return result;
}

// DLSS indicator (NVIDIA NGX on-screen text): HKLM\SOFTWARE\NVIDIA Corporation\Global\NGXCore
// ShowDlssIndicator 0/1024 = Super Resolution / DLSS info bottom left,
// DLSSG_IndicatorText 0/1/2 = Frame Generation info (off / short / detailed).
async function indicatorGet() { return run(['indicator']); }
async function indicatorSet(sr, fg) {
  const s = Number(sr) ? 1024 : 0;
  const f = [0, 1, 2].includes(Number(fg)) ? Number(fg) : 0;
  let result = await run(['indicator', String(s), String(f)]);
  if (!result.ok && result.code === PRIVILEGE) {
    await runElevated(['indicator', String(s), String(f)]);
    result = await indicatorGet();
  }
  return result;
}

module.exports = { get, set, indicatorGet, indicatorSet, ALLOWED, helperPath };