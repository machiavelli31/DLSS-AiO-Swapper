'use strict';

// AiO SF Toggle: our own small ReShade add-on (source in tools/aio-sf-toggle)
// that gives ShortFuse's RenoDX DLSS Tool an on/off hotkey (F6 by default,
// ReShade.ini [AIO-SF-TOGGLE] Key=). It never changes ShortFuse's file; if it
// cannot match ShortFuse's build it logs one line and does nothing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'aio-sf-toggle.addon64';
const SHA256 = '807e9ac98c852a6c43fd486c8a2e1f15e150a917a5158fd994e976a308f22264';

function addonPath() {
  const candidates = [
    path.join(process.resourcesPath || '', FILE),
    path.join(__dirname, '..', '..', FILE),
    path.join(__dirname, '..', '..', '..', 'tools', 'aio-sf-toggle', FILE)
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') === SHA256) return p;
    } catch { /* next */ }
  }
  return null;
}

module.exports = { FILE, SHA256, addonPath };
