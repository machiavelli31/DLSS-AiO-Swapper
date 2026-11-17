'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const { t, setLang, getLang, dirOf, LANGS } = window.i18n;
const state = { games: [], recents: [], history: [], newDlss: null, log: [], theme: 'light', skin: 'one', rail: 'off', lang: 'en', logo: {}, groupGamesByStore: true };
const filters = { query: '', api: 'all', dlss: 'all', addon: 'all' };
const gameFilters = window.gameFilters;

const ORDER = ['Steam', 'Epic Games', 'GOG', 'Xbox', 'Ubisoft', 'Added by hand', 'My folders'];
const rank = (l) => (ORDER.indexOf(l) === -1 ? ORDER.length : ORDER.indexOf(l));
const short = (v) => (v ? String(v).replace(/\.0$/, '') : null);
const initials = (name) =>
  name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

const ICON = {
  exe: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  dlss: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-6 4 12 2.5-6h5"/></svg>',
  detect: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5-8 4.5-8-4.5z"/><path d="M4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/></svg>',
  addon: '<svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v4"/><path d="M4 10V6a2 2 0 0 1 2-2h4"/><rect x="4" y="12" width="8" height="8" rx="2"/><path d="M16 12v8m4-4h-8"/></svg>'
};

// ---------------- log ----------------

const TICK = '<svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M5 12.5 9.5 17 19 7.5"/></svg>';
// Under ten megabytes a whole number rounds a 0.4 MB add-on down to "0 MB".
const MB = (bytes) => {
  const mb = bytes / 1048576;
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
};

function log(message) {
  state.log.push({ t: new Date().toLocaleTimeString('en-GB'), m: message });
  renderLog();
}

function renderLog() {
  $('copyLog').disabled = state.log.length === 0;
  $('log').innerHTML = state.log.length
    ? state.log.slice(-40).map((e) => `<div class="log-row"><i></i><span class="t">[${e.t}]</span><span class="m">${esc(e.m)}</span></div>`).join('')
    : `<p class="empty">${t('logEmpty')}</p>`;
  $('log').scrollTop = $('log').scrollHeight;
}

let copyFeedbackTimer;
async function copyText(text) {
  let ok = false;
  try { ok = Boolean(text.trim()) && await window.lab.copyText(text); } catch { /* Show an actionable error. */ }
  const feedback = $('copyFeedback');
  clearTimeout(copyFeedbackTimer);
  feedback.textContent = t(ok ? 'copied' : 'copyFailed');
  feedback.classList.remove('hidden');
  copyFeedbackTimer = setTimeout(() => feedback.classList.add('hidden'), ok ? 2200 : 6000);
  return ok;
}

// The sidebar status card is gone. The current line is kept in state and shown
// in skin two's dock (#t2Status); install progress lives in the job log (#job).
function setStatus(text, percent) {
  state.statusLine = text;
  state.statusPercent = percent;
  const line = $('t2Status');
  if (line) line.textContent = text;
}

// ---------------- views ----------------

// Theme 2 brings its own frame - a command bar, a dock, a palette - and its
// own page for a game. It is built when that skin is chosen and taken back out
// when it is not, so theme 1 never grows a control it was not designed with.
function syncSkinChrome() {
  if (state.skin === 'two') window.theme2?.enable();
  else window.theme2?.disable();
}

function show(view) {
  // Add-ons/Overlay are hidden in this edition; unknown views (old links) fall back to home.
  if (['addons', 'overlays'].includes(view) || !document.getElementById('view-' + view)) view = 'home';
  // Theme 2 opens a game as a full page inside the content area rather than
  // over the app, so the nav is still reachable behind it.
  if (sheetGame && !jobRunning && document.documentElement.dataset.skin === 'two') closeSheet();
  for (const s of document.querySelectorAll('.view')) s.classList.toggle('active', s.id === 'view-' + view);
  for (const b of document.querySelectorAll('.nav-item')) b.classList.toggle('active', b.dataset.view === view);
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
  if (view === 'indicator') renderIndicator();
  if (view === 'components') renderComponents(true);
}

for (const link of document.querySelectorAll('[data-project]')) {
  link.addEventListener('click', async event => {
    event.preventDefault();
    let ok = false;
    try { ok = await window.lab.openProject(link.dataset.project); } catch {}
    $('projectLinkError')?.classList.toggle('hidden', Boolean(ok));
  });
}

// ---------------- recent game ----------------

function tile(icon, key, value, sub, on) {
  return `<div class="tile">${icon}<div><div class="k">${key}</div><div class="v${on ? ' on' : ''}">${esc(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div></div>`;
}

// "2 min ago", "1 day ago" - close enough without a date library.
function ago(ts) {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60) return t('agoNow');
  const mins = Math.floor(sec / 60);
  if (mins < 60) return t('agoMin', mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('agoHour', hours);
  const days = Math.floor(hours / 24);
  return t('agoDay', days);
}

// A game counts as done when the add-on is in place and its DLSS matches the
// payload; that is what the pip reports.
function isReady(g) {
  return gameFilters.isInstalled(g, state.newDlss);
}

function renderRecent() {
  const rows = state.recents
    .map((r) => ({ at: r.at, game: state.games.find((g) => g.dir === r.dir) }))
    .filter((r) => r.game)
    .slice(0, 8);

  if (!rows.length) {
    $('recents').innerHTML = `<p class="empty">${t('recentEmpty')}</p>`;
    return;
  }

  $('recents').innerHTML = rows.map(({ at, game }) => `
    <article class="rcard" data-dir="${esc(game.dir)}" tabindex="0" aria-label="${esc(game.name)}" aria-haspopup="menu">
      ${game.poster ? `<img src="${game.poster.url}" alt="">` : `<div class="initials">${esc(initials(game.name))}</div>`}
      <div class="meta">
        <div class="title">${esc(game.name)}</div>
        <div class="when"><span class="ago">${ago(at)}</span><i class="pip${isReady(game) ? ' on' : ''}"></i></div>
      </div>
    </article>`).join('');
}

// Why a folder cannot be patched. These arrive from the scanner as codes, and
// a card was literally showing "no-graphics-exe" to the reader. An unknown code
// falls through as itself so a new one is visible rather than silently blank.
const REASONS = {
  installer: 'rInstaller',
  'no-exe': 'rNoExe',
  'no-graphics-exe': 'rNoGraphics',
  'renderer-in-dll': 'rRendererInDll',
  'xbox-protected': 'rXboxProtected',
  error: 'rError'
};
const reasonText = (code) => (code ? (REASONS[code] ? t(REASONS[code]) : code) : null);

// ---------------- games grid ----------------

function cardMarkup(g) {
  const s = g.cached;
  const api = s ? (s.api || reasonText(s.reason) || '—') : t('scanning');
  const dx12 = Boolean(s && s.dx12);
  const hasDlss = gameFilters.hasDlss(g);
  const status = s && s.ok
    ? `<span class="dot-s ${hasDlss ? 'on' : ''}"></span>${s.dlss ? esc(short(s.dlss)) : t(hasDlss ? 'hasDlss' : 'noDlss')}
       <span class="dot-s ${s.addon || s.optiscaler ? 'on' : ''}" style="margin-inline-start:8px"></span>${s.optiscaler ? 'OptiScaler' : t('addonShort')}`
    : '';
  const strip = status ? `<div class="status">${status}</div>` : '';
  const poster = g.poster
    ? `<div class="poster${g.poster.tall ? '' : ' wide'}"${g.poster.tall ? '' : ` style="--bgimg:url('${g.poster.url}')"`}>
         <img src="${g.poster.url}" alt="">${strip}</div>`
    : `<div class="poster"><div class="placeholder">${initials(g.name)}</div>${strip}</div>`;

  return `
    <article class="card${dx12 ? ' dx12' : ''}${s && !s.ok ? ' unsupported' : ''}" data-dir="${esc(g.dir)}" tabindex="0" aria-label="${esc(g.name)}" aria-haspopup="menu">
      <div class="tools">
        <button class="tool" data-act="poster" title="${esc(t('menuPoster'))}">🖼</button>
        <button class="tool" data-act="open" title="${esc(t('menuOpen'))}">📂</button>
        <button class="tool" data-act="hide" title="${esc(t('menuHide'))}">✕</button>
      </div>
      <span class="badge${dx12 ? ' dx12' : ''}">${esc(api)}</span>
      <button class="card-play" data-act="play" title="${esc(t('playGame', g.name))}" aria-label="${esc(t('playGame', g.name))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button>
      ${poster}
      <div class="name">${esc(g.name)}</div>
    </article>`;
}

function fillFilter(id, options, selected) {
  const element = $(id);
  // Don't reset native dropdowns on every scan/art update or keystroke.
  const markup = options.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if (element._optionsMarkup !== markup) {
    element.innerHTML = markup;
    element._optionsMarkup = markup;
  }
  element.value = selected;
}

function renderGameFilters() {
  $('gameSearch').placeholder = t('searchGamesHint');
  const apis = [
    ['all', t('allApis')], ['dx11-dx12', 'DirectX 11 / 12'],
    ...['DirectX 12', 'DirectX 11', 'DirectX 10', 'DirectX 9', 'DirectX 8', 'Vulkan', 'OpenGL'].map((api) => [api, api]),
    ['no-graphics-exe', t('rNoGraphics')], ['renderer-in-dll', t('rRendererInDll')], ['no-exe', t('rNoExe')],
    ['pending', t('scanning')]
  ];
  for (const game of state.games) {
    const api = gameFilters.apiKey(game);
    if (!apis.some(([value]) => value === api)) apis.push([api, reasonText(game.cached?.reason) || game.cached?.api || t('unknownApi')]);
  }
  if (!apis.some(([value]) => value === filters.api)) apis.push([filters.api, reasonText(filters.api)]);
  fillFilter('gameApi', apis, filters.api);

  const versions = gameFilters.versions(state.games);
  if (filters.dlss.startsWith('version:') && !versions.includes(filters.dlss.slice(8))) versions.push(filters.dlss.slice(8));
  fillFilter('gameDlss', [
    ['all', t('allDlss')], ['ready', t('filterReady')],
    ['present', t('hasDlss')], ['absent', t('noDlss')],
    ['installed', t('dlssCurrent')], ...versions.map((v) => ['version:' + v, 'DLSS ' + v])
  ], filters.dlss);
  fillFilter('gameAddon', [
    ['all', t('allAddons')], ['present', t('addonPresent')], ['absent', t('addonAbsent')]
  ], filters.addon);
  $('clearGameFilters').disabled = !filters.query && ['api', 'dlss', 'addon'].every((key) => filters[key] === 'all');
  const quick = [
    ['api', 'DirectX 12', t('dx12Count', state.games.filter((g) => gameFilters.apiKey(g) === 'DirectX 12').length)],
    ['dlss', 'ready', t('readyFor', state.games.filter(gameFilters.canInstall).length)],
    ['dlss', 'present', t('dlssCount', state.games.filter(gameFilters.hasDlss).length)]
  ];
  const chips = $('gameQuickFilters');
  if (!chips.children.length) {
    chips.innerHTML = quick.map(() => '<button type="button" class="filter-chip"></button>').join('');
  }
  quick.forEach(([key, value, label], index) => {
    const chip = chips.children[index];
    chip.dataset.filter = key;
    chip.dataset.value = value;
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(filters[key] === value));
  });
}

function renderGames() {
  const focusedGroup = document.activeElement?.dataset.readyFilter;
  renderGameFilters();
  const visible = state.games.filter((g) => gameFilters.matches(g, filters, state.newDlss));
  let sections;
  if (state.groupGamesByStore) {
    const groups = new Map();
    for (const game of visible) {
      if (!groups.has(game.launcher)) groups.set(game.launcher, []);
      groups.get(game.launcher).push(game);
    }
    sections = [...groups].sort((a, b) => rank(a[0]) - rank(b[0]));
  } else {
    // Sort only the filtered copy. Keep each game's source and the stored
    // library intact so switching categories back on restores its sections.
    const byName = new Intl.Collator(state.lang, { numeric: true, sensitivity: 'base' });
    visible.sort((a, b) => byName.compare(a.name, b.name));
    sections = visible.length ? [[null, visible]] : [];
  }

  $('groups').innerHTML = sections
    .map(([launcher, list]) => {
      if (launcher === null) return `<div class="grid">${list.map(cardMarkup).join('')}</div>`;
      const ready = list.filter(gameFilters.canInstall).length;
      return `<section class="group">
        <div class="group-head"><h4>${esc(launcher)}</h4><span class="count">${list.length}</span>
        <button type="button" class="ready filter-chip" data-ready-filter="${esc(launcher)}" aria-pressed="${filters.dlss === 'ready'}">${t('readyFor', ready)}</button></div>
        <div class="grid">${list.map(cardMarkup).join('')}</div>
      </section>`;
    }).join('') || `<div class="glass games-empty"><h4>${t('noMatchingGames')}</h4><p>${t('changeFilters')}</p></div>`;

  $('gamesCount').textContent = t('filteredCount', visible.length, state.games.length);
  if (focusedGroup !== undefined) {
    [...$('groups').querySelectorAll('[data-ready-filter]')]
      .find((button) => button.dataset.readyFilter === focusedGroup)?.focus({ preventScroll: true });
  }
}

$('gameSearch').oninput = (event) => { filters.query = event.target.value; renderGames(); };
for (const [id, key] of [['gameApi', 'api'], ['gameDlss', 'dlss'], ['gameAddon', 'addon']]) {
  $(id).onchange = (event) => { filters[key] = event.target.value; renderGames(); };
}
$('clearGameFilters').onclick = () => {
  Object.assign(filters, { query: '', api: 'all', dlss: 'all', addon: 'all' });
  $('gameSearch').value = '';
  renderGames();
  $('gameSearch').focus();
};
$('gameQuickFilters').onclick = (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  const { filter, value } = button.dataset;
  filters[filter] = filters[filter] === value ? 'all' : value;
  renderGames();
};

// ---------------- history / settings ----------------

let historyRenderId = 0;
async function renderHistory() {
  const requestId = ++historyRenderId;
  $('copyHistory').disabled = true;
  $('historyWarning').classList.add('hidden');
  let result;
  try {
    result = await window.lab.history();
    if (!Array.isArray(result?.rows)) throw new Error('Invalid history response');
  }
  catch {
    if (requestId !== historyRenderId) return;
    state.history = [];
    $('history').innerHTML = `<p class="pad">${esc(t('historyLoadFailed'))}</p>`;
    return;
  }
  if (requestId !== historyRenderId) return;
  const rows = state.history = result.rows;
  $('historyWarning').classList.toggle('hidden', !result.warning);
  $('historyWarning').textContent = result.warning ? t('historySaveWarning') : '';
  $('copyHistory').disabled = rows.length === 0;
  $('history').innerHTML = rows.length
    ? rows.map((r) => `<div class="hist-row">
        <div class="n"><bdi>${esc(r.name)}</bdi> <span class="undone">${esc(historyAction(r))}</span>
          <div class="d" dir="auto">${esc(r.dir)}</div>
          ${r.exe ? `<div class="d" dir="auto">${esc(r.exe)}</div>` : ''}
          ${r.route || r.api ? `<div class="d">${esc([historyRoute(r), r.api].filter(Boolean).join(' · '))}</div>` : ''}
        </div>
        <div class="c">${esc(t('replacedAdded', r.replaced, r.added))}</div>
        <div class="d">${esc(new Date(r.date).toLocaleString(state.lang))}</div>
      </div>`).join('')
    : `<div class="pad" style="color:var(--dim);font-size:13.5px">${t('histEmpty')}</div>`;
}

const historyRoute = row => ({ native: 'ReShade / Lecram', feeder: 'ReShade / Lecram + Feeder', renodx: 'ReShade / ShortFuse multipass', combo: 'ReShade / Lecram + ShortFuse (experimental)', optiscaler: 'OptiScaler DLSS-NR' }[row.route] || row.route || '');
function historyAction(row) {
  if (row.action === 'restore') return t('restored');
  if (row.action === 'recovery') return t('historyRecovered');
  return t(row.imported ? 'historySnapshot' : 'installed');
}
function historyText() {
  return state.history.map(row => [
    `[${row.date}] ${historyAction(row)} — ${row.name}`,
    row.dir, row.exe,
    [historyRoute(row), row.api].filter(Boolean).join(' · '),
    t('replacedAdded', row.replaced, row.added)
  ].filter(Boolean).join('\n')).join('\n\n');
}

// ---------------- add-on builds ----------------

async function renderAddons() {
  const rows = await window.lab.addons();
  $('addonList').innerHTML = rows.length ? rows.map((a) => `
    <div class="addon${a.active ? ' on' : ''}">
      <div class="mark">${a.active ? TICK : ''}</div>
      <div class="body">
        <div class="t">${esc(a.label)}${a.replaces ? `<span class="tag">${t('addonReplaces')}</span>` : ''}${
          a.warn ? `<span class="tag warn">${esc(a.warn)}</span>` : ''}${
          a.caution ? `<span class="tag warn">${t(a.caution)}</span>` : ''}</div>
        <div class="d">${esc(a.file)}${a.version ? ' · ' + esc(a.version) : ''} · ${MB(a.size)}</div>
        ${a.notes ? `<ul class="notes">${a.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>
      <button class="toggle" role="switch" aria-checked="${a.active}" data-path="${esc(a.path)}"
              title="${a.active ? t('addonDeactivate') : t('addonActivate')}">
        <span class="knob"></span>
      </button>
      ${a.custom
        ? `<button class="drop" data-remove="${esc(a.path)}" title="${t('addonRemove')}">
             <svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
           </button>`
        : ''}
    </div>`).join('') : `<p class="hint">${t('logEmpty')}</p>`;

  const set = async (b, file, on) => {
    b.disabled = true;
    const res = await window.lab.addonToggle(file, on);
    if (!res.ok) { log(res.message); b.disabled = false; return; }
    // Only reported when one build had to step aside for another's file name.
    if (res.replaced) log(t('addonNameClash', res.replaced));
    renderAddons();
  };
  // Each switch stands on its own: turning one on leaves the others as they are.
  for (const b of $('addonList').querySelectorAll('.toggle')) {
    b.onclick = () => set(b, b.dataset.path, b.getAttribute('aria-checked') !== 'true');
  }
  // Only builds added by hand can be dropped; the ones found in folders and the
  // one shipped with the app are not the list's to delete.
  for (const b of $('addonList').querySelectorAll('[data-remove]')) {
    b.onclick = async () => {
      b.disabled = true;
      await window.lab.addonRemove(b.dataset.remove);
      renderAddons();
    };
  }
}

// Picking a file only opens the dialog; nothing is saved until it is confirmed,
// so a mis-click costs nothing.
let pendingAddon = null;

function closeDialog() {
  $('dlgOverlay').classList.add('hidden');
  pendingAddon = null;
}

$('addonAdd').onclick = async () => {
  const picked = await window.lab.addonPick();
  if (!picked) return;
  if (picked.error) { log(picked.error); return; }

  pendingAddon = picked;
  $('dlgFile').textContent =
    picked.file + (picked.version ? ' · ' + picked.version : '') + ' · ' + MB(picked.size);
  $('dlgName').value = picked.suggestedName || '';
  $('dlgDesc').value = '';
  $('dlgTag').value = '';
  $('dlgOverlay').classList.remove('hidden');
  $('dlgName').focus();
  $('dlgName').select();
};

$('dlgCancel').onclick = closeDialog;
$('dlgOverlay').onclick = (e) => { if (e.target === $('dlgOverlay')) closeDialog(); };
$('dlgSave').onclick = async () => {
  if (!pendingAddon) return;
  await window.lab.addonSave({
    path: pendingAddon.path,
    name: $('dlgName').value,
    description: $('dlgDesc').value,
    tag: $('dlgTag').value
  });
  closeDialog();
  renderAddons();
};


// Theme 1 is the design the app has always had; theme 2 is the modern one.
// Both are whole skins, not a colour switch - the light/dark toggle keeps
// working inside either of them.
function skinPicker(current) {
  const card = (id, name, description, swatch) => `
    <button type="button" class="skin-card" data-skin-choice="${id}" aria-pressed="${current === id}">
      <span class="skin-swatch skin-swatch-${swatch}" aria-hidden="true"><i></i><i></i><i></i></span>
      <b>${esc(name)}</b><small>${esc(description)}</small>
    </button>`;
  return `
    <div class="set-row" style="display:block">
      <div class="k">${t('setSkins')}</div>
      <div class="v" style="margin-bottom:12px">${t('setSkinsHint')}</div>
      <div class="skin-picker" role="group" aria-label="${esc(t('setSkins'))}">
        ${card('one', t('skinOne'), t('skinOneHint'), 'one')}
        ${card('two', t('skinTwo'), t('skinTwoHint'), 'two')}
      </div>
    </div>`;
}

async function renderSettings() {
  const info = await window.lab.settings();
  $('settings').innerHTML = skinPicker(info.skin === 'two' ? 'two' : 'one') + `
    <div class="set-row"><div><div class="k">${t('setGroupGames')}</div>
      <div class="v" id="setGroupGamesHint">${t('setGroupGamesHint')}</div></div>
      <button class="setting-switch" id="setGroupGames" type="button" role="switch"
        aria-checked="${info.groupGamesByStore !== false}" aria-label="${t('setGroupGames')}" aria-describedby="setGroupGamesHint">
        <span class="knob"></span>
      </button></div>
    <div class="set-row"><div><div class="k">${t('setSafeGraphics')}</div>
      <div class="v" id="setSafeGraphicsHint">${t('setSafeGraphicsHint')}</div></div>
      <button class="setting-switch" id="setSafeGraphics" type="button" role="switch"
        aria-checked="${info.safeGraphics === true}" aria-label="${t('setSafeGraphics')}" aria-describedby="setSafeGraphicsHint">
        <span class="knob"></span>
      </button></div>
    <div class="set-row"><div><div class="k">${t('setTray')}</div>
      <div class="v" id="setTrayHint">${t('setTrayHint')}</div></div>
      <button class="setting-switch" id="setTray" type="button" role="switch"
        aria-checked="${info.closeToTray !== false}" aria-label="${t('setTray')}" aria-describedby="setTrayHint">
        <span class="knob"></span>
      </button></div>
    <div class="set-row"><div><div class="k">${t('setAutoScan')}</div>
      <div class="v">${t('setAutoScanHint')}</div></div>
      <button class="setting-switch" id="setAutoScan" type="button" role="switch"
        aria-checked="${info.autoScanDrives ? 'true' : 'false'}" aria-label="${t('setAutoScan')}">
        <span class="knob"></span>
      </button></div>
    <div class="set-row"><div><div class="k">${t('setRoots')}</div>${
        (info.roots || []).length
          ? `<div class="paths">${info.roots.map((f) => `
              <div class="path-row"><span>${esc(f)}</span>
                <button class="drop" data-unroot="${esc(f)}" title="${t('addonRemove')}">
                  <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
                </button></div>`).join('')}</div>`
          : `<div class="v">—</div>`}</div>
      <span class="d">${(info.roots || []).length}</span></div>
    <div class="set-row"><div><div class="k">${t('setFolders')}</div>
        ${info.folders.length
          ? `<div class="paths">${info.folders.map((f) => `
              <div class="path-row"><span>${esc(f)}</span>
                <button class="drop" data-unfolder="${esc(f)}" title="${t('addonRemove')}">
                  <svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
                </button></div>`).join('')}</div>`
          : `<div class="v">—</div>`}
      </div>
      <button class="ghost sm" id="setAddFolder">${t('setAdd')}</button></div>
    <div class="set-row"><div><div class="k">${t('setHidden')}</div>
        ${(info.hidden || []).length
          ? `<div class="paths">${info.hidden.map((f) => `
              <div class="path-row"><span>${esc(f)}</span>
                <button class="ghost sm" data-unhide="${esc(f)}">${t('setUnhide')}</button>
              </div>`).join('')}</div>`
          : `<div class="v">${t('setHiddenNone')}</div>`}
      </div>
      <span class="d">${(info.hidden || []).length}</span></div>
    <div class="set-row"><div><div class="k">${t('setLibrary')}</div><div class="v">${esc(info.stateFile)}</div></div>
      <button class="ghost sm" id="setReset">${t('setReset')}</button></div>
    <div class="set-row"><div><div class="k">${t('setPosters')}</div><div class="v">${esc(info.posterDir)}</div></div>
      <span class="d">${t('setSaved', info.posterCount)}</span></div>`;
  for (const button of document.querySelectorAll('[data-skin-choice]')) {
    button.onclick = async () => {
      const choice = button.dataset.skinChoice;
      if (choice === state.skin) return;
      state.skin = choice;
      document.documentElement.dataset.skin = choice;
      for (const other of document.querySelectorAll('[data-skin-choice]')) {
        other.setAttribute('aria-pressed', String(other.dataset.skinChoice === choice));
      }
      syncSkinChrome();
      try { await window.lab.setSkin(choice); } catch { /* the app still wears it now */ }
      if (sheetGame) openSheet(sheetGame.dir, true);
    };
  }
  $('setSafeGraphics').onclick = async () => {
    const toggle = $('setSafeGraphics');
    const on = toggle.getAttribute('aria-checked') !== 'true';
    toggle.disabled = true;
    try {
      const answer = await window.lab.setSafeGraphics(on);
      toggle.setAttribute('aria-checked', String(answer?.on === true));
    } finally { toggle.disabled = false; }
  };
  $('setTray').onclick = async () => {
    const toggle = $('setTray');
    const on = toggle.getAttribute('aria-checked') !== 'true';
    toggle.disabled = true;
    try {
      toggle.setAttribute('aria-checked', String(await window.lab.setCloseToTray(on)));
    } catch (error) {
      log(error.message);
    } finally { toggle.disabled = false; }
  };
  $('setGroupGames').onclick = async () => {
    const toggle = $('setGroupGames');
    const enabled = toggle.getAttribute('aria-checked') !== 'true';
    toggle.disabled = true;
    try {
      state.groupGamesByStore = await window.lab.setGroupGamesByStore(enabled);
      toggle.setAttribute('aria-checked', String(state.groupGamesByStore));
      renderGames(); // Presentation only: no discovery, rescan or filter reset.
    } catch (error) {
      log(error.message);
    } finally {
      toggle.disabled = false;
    }
  };
  $('setAutoScan').onclick = async () => {
    const toggle = $('setAutoScan');
    const enabled = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.disabled = true;
    await window.lab.setAutoScanDrives(enabled);
    await load();
    await renderSettings();
  };
  $('setAddFolder').onclick = async () => { if (await window.lab.addFolder()) load(); };
  for (const b of $('settings').querySelectorAll('[data-unroot]')) {
    b.onclick = async () => {
      b.disabled = true;
      await window.lab.excludeRoot(b.dataset.unroot);
      renderSettings();
      load();
    };
  }
  // Hiding a game is only about the list, so it has to be reversible.
  for (const b of $('settings').querySelectorAll('[data-unhide]')) {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await window.lab.unhide(b.dataset.unhide);
        renderSettings();
        load();
      } catch (error) { log(error.message); b.disabled = false; }
    };
  }
  // A folder added for a quick look has to be removable, or the library is
  // stuck with it.
  for (const b of $('settings').querySelectorAll('[data-unfolder]')) {
    b.onclick = async () => {
      b.disabled = true;
      await window.lab.removeFolder(b.dataset.unfolder);
      renderSettings();
      load();
    };
  }
  $('setReset').onclick = async () => { await window.lab.reset(); load(); };
}

// ---------------- loading ----------------

async function scanAll() {
  const pending = state.games.filter((g) => !g.cached);
  let scanned = state.games.length - pending.length;
  for (const game of pending) {
    game.cached = await window.lab.scan(game.dir);
    setStatus(t('scanning'), (++scanned / state.games.length) * 100);
    renderGames();
    renderRecent();
  }
  setStatus(t('ready'), 100);
  log(t('libReady', state.games.length, state.games.filter((g) => g.cached && g.cached.dx12).length));
  fetchArt();
}

// Art is pulled for the whole grid rather than only when a game is opened, so
// the library fills in on its own. Steam's store is rate limited, so this walks
// one at a time and each result is cached on disk for next launch.
async function fetchArt() {
  if (!state.art) return;
  const missing = state.games.filter((g) => !g.poster || !g.poster.tall);
  if (!missing.length) return;

  let done = 0;
  setStatus(t('fetchingArt'), 0);
  for (const game of missing) {
    const art = await window.lab.artFetch(game.dir, game.name, game.appid);
    if (art && art.cover) {
      game.poster = { url: art.cover, tall: true, custom: false };
      renderGames();
      renderRecent();
    }
    setStatus(t('fetchingArt'), (++done / missing.length) * 100);
  }
  setStatus(t('ready'), 100);
  log(t('artFound', missing.filter((g) => g.poster && g.poster.tall).length, missing.length));
}

async function load() {
  setStatus(t('scanning'), 5);
  state.games = await window.lab.library();
  state.recents = await window.lab.recents();
  // Only for the "newer DLSS" hint: a failure here must never leave the
  // library empty until a filter click redraws it.
  try { state.newDlss = (await window.lab.details(state.games[0] ? state.games[0].dir : '')).newDlss; }
  catch (err) { log(t('sheetFailedLog', { name: state.games[0] ? state.games[0].name : '?', reason: err && err.message })); }
  renderGames();
  renderRecent();
  log(`Found ${state.games.length} games across ${new Set(state.games.map((g) => g.launcher)).size} sources`);
  await scanAll();
  refreshUpdateAll();
}

// "Update all games": shown only when a game still carries an older copy of
// a file the app installed (RenoDX add-on, NR model) than the components now
// hold. One click swaps those files everywhere; settings stay as they are.
let updateAllPending = [];
async function refreshUpdateAll() {
  const button = $('updateAll');
  if (!button || !window.lab.updateAllGames) return;
  let answer = null;
  try { answer = await window.lab.updateAllGames(true); } catch { return; }
  if (!answer || !answer.ok) return;
  updateAllPending = answer.games || [];
  button.textContent = t('updateAllGames', updateAllPending.length);
  button.classList.toggle('hidden', updateAllPending.length === 0);
}
async function runUpdateAll() {
  await refreshUpdateAll();
  if (!updateAllPending.length || jobRunning) return;
  const list = updateAllPending.map((g) => `• ${g.name}: ${g.files.join(', ')}`).join('\n');
  if (!await ask({ icon: 'question', tone: 'accent', title: t('updateAllTitle', updateAllPending.length),
    body: t('updateAllBody') + '\n\n' + list, confirm: t('updateAllConfirm'), cancel: t('cancel') })) return;
  const button = $('updateAll');
  button.disabled = true;
  try {
    const answer = await window.lab.updateAllGames(false);
    if (!answer || !answer.ok) { log(t('updateAllFailed', answer?.message || answer?.code || '')); return; }
    for (const r of answer.results) {
      if (r.ok) log(t('updateAllDone', r.name, r.files.join(', ')));
      else if (r.reason === 'running') log(t('updateAllRunning', r.name));
      else log(t('updateAllFailedGame', r.name, r.reason));
    }
    for (const g of state.games) if (answer.results.some((r) => r.ok && r.name === g.name)) g.cached = null;
    await scanAll();
  } finally {
    button.disabled = false;
    refreshUpdateAll();
  }
}
if ($('updateAll')) $('updateAll').onclick = runUpdateAll;

async function pickGame(dir) {
  log(`Scanning: ${dir}`);
  const cached = await window.lab.scan(dir);
  let game = state.games.find((g) => g.dir === dir);
  if (!game) {
    await window.lab.addGameByPath(dir);
    state.games = await window.lab.library();
    game = state.games.find((g) => g.dir === dir);
  }
  if (game) {
    game.cached = cached;
    renderGames();
    log(`Game: ${cached.exe || '—'} (${cached.api || 'unknown'})`);
    openSheet(dir);
  }
}


// ---------------- game sheet ----------------

let sheetGame = null;
let sheetDetails = null;
let jobLines = [];
let jobRunning = false;
// Which executable the sheet is pointed at, kept per folder so re-rendering
// the sheet - a language switch does that - does not silently reset the choice.
const exeChoice = new Map();
const routeChoice = new Map();

// One row per fact, in a single panel. A wrapping grid of bordered tiles left
// an orphan on its own line whenever the count was odd, and repeated the same
// border and background six times over.
function spec(k, valueHtml, tone, full) {
  return `<div class="spec"><span class="k">${k}</span>` +
    `<span class="v${tone ? ' ' + tone : ''}"${full ? ` title="${esc(full)}"` : ''}>${valueHtml}</span></div>`;
}

// "3.7.20.0 -> 310.8.0.0" says what the swap does in one line; two separate
// rows made the reader hold one number in their head to compare it with the
// other. Nothing to change means no arrow at all.
function dlssValue(have, next, upToDate) {
  if (!next) return `<span>${esc(have || '—')}</span>`;
  if (upToDate) return `<span class="on">${esc(next)}</span>`;
  return `<span class="was">${esc(have || t('none'))}</span>` +
    `<span class="arrow">→</span><span class="on">${esc(next)}</span>`;
}

// An executable whose renderer could not be read says so, rather than showing
// the word null where an API belongs.
const exeLine = (e) => `${e.rel}  —  ${e.apiLabel || t('unknownApi')}  —  ${e.bitness || '?'}-bit  —  ${MB(e.size)}`;

function chosenExe(d, dir) {
  const want = exeChoice.get(dir);
  return d.exes.find((e) => e.path === want) || d.exes[0] || null;
}

// One executable is not a choice, so the control only appears when the folder
// really does hold more than one - a launcher plus the game, most often.
function exePicker(d, dir) {
  if (d.exes.length < 2) return '';
  const chosen = chosenExe(d, dir);
  return `
    <div class="exe-field">
      <div class="k">${t('fExe')}</div>
      <div class="exe-wrap">
        <button type="button" class="exe-select" id="exeSelect" aria-haspopup="listbox" aria-expanded="false">
          <span class="exe-value">${esc(exeLine(chosen))}</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="exe-menu hidden" id="exeMenu" role="listbox">
          ${d.exes.map((e) => `
            <button type="button" class="exe-option${e.path === chosen.path ? ' selected' : ''}"
                    data-path="${esc(e.path)}" role="option" title="${esc(e.rel)}">
              <span class="tick">${e.path === chosen.path ? '✓' : ''}</span>
              <span class="exe-name">${esc(e.rel)}</span>
              <span class="exe-meta"><span>${esc(e.apiLabel || t('unknownApi'))}</span><span>${e.bitness || '?'}-bit · ${MB(e.size)}</span></span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
}

function selectedApi(pick, dir) {
  return window.renderingApi.resolve(pick, pick?.apiOverride || 'auto');
}

function routesFor(pick) {
  return window.installRoutes.routesFor(window.renderingApi.effective(pick, pick?.apiOverride || 'auto'));
}

function selectedRoute(d, pick, dir) {
  const routes = routesFor(pick);
  const wanted = routeChoice.get(dir);
  if (routes.includes(wanted)) return wanted;
  if (routes.includes(d.recommendedRoute)) return d.recommendedRoute;
  return routes[0];
}

function installLabel(d, pick, dir) {
  const route = pick && selectedRoute(d, pick, dir);
  if (d.installedRoute && route !== d.installedRoute) return t('applyBackend');
  return route === 'optiscaler' ? t('installOpti') : t('install');
}

// Every note about this game in one box that can be put away. A warning still
// says so on the outside, because something that can cost an account must not
// be hidden behind a closed lid - only the reading of it is optional.
const NOTES_OPEN = 'sheet-notes-open';
const notesOpen = () => { try { return localStorage.getItem(NOTES_OPEN) === '1'; } catch { return false; } };

function notesBox(blocks, hasWarning) {
  const notes = blocks.filter(Boolean);
  if (!notes.length) return '';
  const open = notesOpen() || hasWarning;
  return `<div class="sheet-notes${hasWarning ? ' has-warning' : ''}" id="sheetNotes">
    <button type="button" class="sheet-notes-head" id="sheetNotesToggle" aria-expanded="${open}" aria-controls="sheetNotesBody">
      <svg viewBox="0 0 24 24" aria-hidden="true">${hasWarning
        ? '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'
        : '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'}</svg>
      <span>${t(hasWarning ? 'notesWarning' : 'notesTitle')}</span>
      <i class="sheet-notes-count">${notes.length}</i>
      <svg class="sheet-notes-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="sheet-notes-body" id="sheetNotesBody"${open ? '' : ' hidden'}>${notes.join('')}</div>
  </div>`;
}

// Wired after the sheet is painted; the choice is remembered for next time.
function wireNotes() {
  const toggle = $('sheetNotesToggle'), body = $('sheetNotesBody');
  if (!toggle || !body) return;
  toggle.onclick = () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem(NOTES_OPEN, open ? '1' : '0'); } catch { /* storage off */ }
  };
}

function installOptions(d, pick, dir) {
  const warning = (d.antiCheatWarning || pick?.antiCheatWarning)
    ? `<div class="emu-note anti-cheat-warning" role="alert"><b>${t('antiCheatWarningTitle')}</b><span>${t('antiCheatWarning')}</span></div>` : '';
  if (!pick) return warning;
  const api = selectedApi(pick, dir);
  const route = selectedRoute(d, pick, dir, api.api);
  const routes = routesFor(pick);
  const opti = route === 'optiscaler';
  const neutral = window.installRoutes.isVendorNeutral();
  const optiReason = window.installRoutes.optiReason(window.renderingApi.effective(pick, pick.apiOverride || 'auto'));
  const apiField = `<label class="api-field"><span>${t('fApi')}</span><select id="apiChoice" aria-describedby="apiHint">
    <option value="auto"${!pick.apiOverride || pick.apiOverride === 'auto' ? ' selected' : ''}>${esc(t('apiAutomatic', pick.apiLabel || t('unknownApi')))}</option>
    ${window.renderingApi.choices.map(item => `<option value="${item.value}"${pick.apiOverride === item.value ? ' selected' : ''}>${item.label}</option>`).join('')}
    </select></label>`;
  const apiHint = `<div class="emu-note" id="apiHint"><span>${t('apiOverrideHint')}</span>${api.api === 'vulkan' && !opti ? `<span>${t('apiVulkanHint')}</span>` : ''}</div>`;
  // Keep the picker available even when automatic detection yields DX10 or an
  // unsupported renderer. Otherwise the user cannot correct that detection.
  if (!routes.length) return `<div class="install-options" data-title="${esc(t('sheetSetup'))}">${apiField}</div>${notesBox([apiHint, `<div class="emu-note">${t('unsupportedRendererHint')}</div>`, warning], Boolean(warning))}`;
  return `
    <div class="install-options" data-title="${esc(t('sheetSetup'))}">
      ${apiField}
      <label><span>${t('fBackend')}</span><select id="backendChoice" aria-describedby="backendHint">
        <option value="reshade"${opti ? '' : ' selected'}${neutral ? ' disabled' : ''}>${t('backendReShade')}${neutral ? ` – ${t('backendNeedsNvidia')}` : ''}</option>
        <option value="optiscaler"${opti ? ' selected' : ''}${optiReason ? ' disabled' : ''}>${neutral ? esc(t('routePort')) : 'OptiScaler DLSS-NR (no ReShade)'}</option>
      </select></label>
      ${!opti ? `<label><span>${t('fRoute')}</span><select id="routeChoice">${routes.filter(item => item !== 'optiscaler').map((item) =>
        `<option value="${item}"${item === route ? ' selected' : ''}>${t(item === 'feeder' ? 'routeFeeder' : item === 'renodx' ? 'routeRenodx' : item === 'combo' ? 'routeCombo' : item === 'lecram12' ? 'routeLecram12' : item === 'uplift' ? 'routeUplift' : 'routeNative')}</option>`).join('')}</select></label>
      ` : ''}
      ${!opti && RESHADE_PROXY_APIS.includes(api.api) && api.label !== 'DirectX 12' ? `<label><span>${t('fReshadeFile')}</span><select id="reshadeProxy">
        <option value="dxgi"${pick.reshadeProxy !== 'd3d11' ? ' selected' : ''}>dxgi.dll</option>
        <option value="d3d11"${pick.reshadeProxy === 'd3d11' ? ' selected' : ''}>d3d11.dll</option>
      </select></label>` : ''}
      ${opti ? `<label><span>${t('fOptiBuild')}</span><select id="optiBuild"></select></label>` : ''}
    </div>
    ${notesBox([
      `<div class="emu-note" id="apiHint"><span>${t('apiOverrideHint')}</span>${api.api === 'vulkan' && !opti ? `<span>${t('apiVulkanHint')}</span>` : ''}</div>`,
      `<div class="emu-note backend-note" id="backendHint"><span>${t(neutral ? 'portHint' : opti ? 'optiHint' : 'backendHint')}</span>
        ${optiReason ? `<span>${t(optiReason)}</span>` : ''}
        ${route === 'native' ? `<span>${t('nativeEffectsHint')}</span>` : ''}
        ${route === 'renodx' ? `<span>${t('routeRenodxHint')}</span>` : ''}
        ${route === 'combo' ? `<span>${t('routeComboHint')}</span>` : ''}
        ${route === 'lecram12' ? `<span>${t('routeLecram12Hint')}</span>` : ''}
        ${route === 'uplift' ? `<span>${t('routeUpliftHint')}</span>` : ''}
        ${!opti && RESHADE_PROXY_APIS.includes(api.api) && pick.reshadeProxy === 'd3d11' ? `<span>${t(api.api === 'dxgi' ? 'reshadeProxyHint' : 'reshadeProxyWrapHint')}</span>` : ''}
        ${opti && (api.api === 'vulkan' || api.label === 'DirectX 11') ? `<span>${t('optiBridgeHint')}</span>` : ''}
        ${opti && api.api === 'vulkan' ? `<span>${t('optiVulkanHint')}</span>` : ''}
      </div>`,
      pick.installIssue ? `<div class="emu-note compatibility-warning" role="alert">${t(pick.installIssue)}</div>` : '',
      warning,
      ['ddraw', 'd3d8', 'd3d9'].includes(api.api) ? `<div class="emu-note">${t('legacyRendererHint')}</div>` : '',
      pick.emulator ? `<div class="emu-note"><b>${esc(pick.emulator.name)} · ${esc(pick.emulator.system)}</b><span>${esc(pick.emulator.hint)}</span><span>${t('emulatorDepthHint')}</span>${pick.emulator.key === 'xenia' ? `<span>${t('xeniaUiHint')}</span>` : ''}</div>` : ''
    ], Boolean(warning || pick.installIssue))}`;
}

// A newer release exists, said once, in the corner. The link is the same
// allowlisted releases page the About view uses; nothing downloads itself.
async function showUpdateNotice() {
  const link = $('aboutUpdate');
  if (!link || !window.lab.checkUpdate) return;
  let answer = null;
  try { answer = await window.lab.checkUpdate(); } catch { return; }
  if (!answer) return;
  // A failed lookup used to look exactly like "nothing new", so someone on an
  // old build whose check never completed was told nothing at all and had no
  // reason to go and look. Say which of the two it was.
  // No release found (offline, private or unpublished repository): say nothing.
  if (!answer.latest || !answer.newer) return;
  link.textContent = t('updateAvailable', answer.latest);
  link.classList.remove('muted');
  link.classList.remove('hidden');
  showUpdateBanner(answer);
}

// The About link alone was too easy to miss, so a newer release also gets a
// banner at the top of the window. "Later" hides it for this version only;
// the next release shows it again.
function showUpdateBanner(answer) {
  const banner = $('updateBanner');
  if (!banner) return;
  // Live in the top bar (next to theme/language), so it never covers content.
  const bar = document.querySelector('.main .toolbar');
  if (bar && banner.parentElement !== bar) bar.prepend(banner);
  const key = 'aio.updateLater';
  try { if (localStorage.getItem(key) === answer.latest) return; } catch {}
  $('updateBannerTitle').textContent = t('updateBannerTitle', answer.latest);
  $('updateBannerText').textContent = t('updateBannerText', answer.current);
  $('updateBannerGo').textContent = t('updateBannerAction');
  $('updateBannerLater').textContent = t('updateBannerLater');
  $('updateBannerLater').onclick = () => {
    try { localStorage.setItem(key, answer.latest); } catch {}
    banner.classList.add('hidden');
  };
  banner.classList.remove('hidden');
}

function jobLog(line) {
  jobLines.push(line);
  const box = document.querySelector('.job');
  if (box) { box.textContent = jobLines.join('\n'); box.scrollTop = box.scrollHeight; }
  if ($('copyJob')) $('copyJob').disabled = jobLines.length === 0;
}

async function openSheet(dir, keepLog = false) {
  if (jobRunning) return;
  const g = state.games.find((x) => x.dir === dir);
  if (!g) return;
  sheetGame = g;
  if (!keepLog) jobLines = [];

  $('overlay').classList.remove('hidden');
  $('sheet').innerHTML = `<div class="pad" style="color:var(--dim)">${esc(t('sheetReading'))}</div>`;

  // Artwork comes from Steam's servers and is only decoration: a slow or
  // blocked connection must not keep the sheet on "Reading the folder…".
  // It keeps loading in the background and is cached for the next open.
  const artLate = window.lab.artFetch(dir, g.name, g.appid).catch(() => null);
  let d;
  let art;
  try {
    [d, art] = await Promise.all([
      window.lab.details(dir),
      Promise.race([artLate, new Promise((resolve) => setTimeout(() => resolve(null), 4000))])
    ]);
  } catch (err) {
    if (sheetGame !== g) return;
    sheetFailed(g, err);
    return;
  }
  if (sheetGame !== g) return;
  if (!d || !Array.isArray(d.exes)) { sheetFailed(g, new Error((d && (d.message || d.reason)) || 'no folder details')); return; }
  sheetDetails = d;
  window.installRoutes.setLecram12(d.lecram12 || null);
  if (!exeChoice.has(dir) && d.installedExe) {
    const installed = d.exes.find((item) => item.rel.toLowerCase() === String(d.installedExe).toLowerCase());
    if (installed) exeChoice.set(dir, installed.path);
  }
  if (!routeChoice.has(dir) && d.installedRoute) routeChoice.set(dir, d.installedRoute);

  const info = art && !art.error && !art.none ? art : null;
  const cover = (info && info.cover) || (g.poster && g.poster.tall ? g.poster.url : null);
  const hero = (info && info.hero) || (g.poster && !g.poster.tall ? g.poster.url : null);
  const upToDate = Boolean(d.newDlss && d.currentDlss && d.currentDlss.version === d.newDlss);
  // With a picker on screen the executable already has its own row, so the
  // fact tile would only repeat it.
  const pick = chosenExe(d, dir);
  const inGameDlss = (d.currentDlss && d.currentDlss.version) || null;
  const showExeFact = d.exes.length < 2;
  // Filled in once the sheet is on screen, so the sheet never waits on the network.

  // Theme 2 draws this page itself: same facts, same controls, same ids - a
  // different page rather than a different program.
  const sheetContext = { d, game: g, art: info, cover, hero, pick, dir, upToDate, inGameDlss, showExeFact };
  const modernSheet = state.skin === 'two' && window.theme2;
  $('sheet').innerHTML = modernSheet ? window.theme2.sheetMarkup(sheetContext) : `
    <div class="hero${hero ? '' : ' empty'}">
      ${hero ? `<img src="${hero}" alt="">` : ''}
      <button class="close" id="sheetClose"><svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="sheet-body">
      <div class="head">
        <div class="cover">${cover ? `<img src="${cover}" alt="">` : esc(initials(g.name))}</div>
        <div class="who">
          <div class="title-row"><h3>${esc(info ? info.name : g.name)}</h3><button class="btn-play" id="sheetPlay" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg><span>${esc(t('play'))}</span></button></div>
          <div class="meta">${[g.launcher, info && info.released, info && info.genres && info.genres.join(', '),
              info && info.rating ? info.rating + '/100' : null].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="path">${esc(g.dir)}</div>
        </div>
      </div>

      ${info && info.summary ? `<p class="summary">${esc(info.summary.slice(0, 260))}${info.summary.length > 260 ? '…' : ''}</p>` : ''}

      ${exePicker(d, dir)}
      ${installOptions(d, pick, dir)}

      <div class="specs" data-title="${esc(t('sheetFacts'))}">
        ${showExeFact && pick ? spec(t('fExe'), esc(pick.rel.split(/[\/]/).pop()), null, pick.rel) : ''}
        ${pick ? spec(t('fArchitecture'), `${pick.bitness || '?'}-bit`) : ''}
        ${spec(t('fApi'), esc((pick && selectedApi(pick, dir).label) || reasonText(d.reason) || '—'), pick && selectedApi(pick, dir).api === 'dxgi' ? 'on' : 'off')}
        ${spec(t('installedBackend'), esc({ optiscaler: 'OptiScaler DLSS-NR', native: 'ReShade · Lecram', feeder: 'ReShade · Lecram + Feeder', renodx: 'ReShade · ShortFuse multipass', combo: 'ReShade · Lecram + ShortFuse' }[d.installedRoute] || (d.installedRoute ? 'ReShade' : t('none'))), d.installedRoute ? 'on' : 'off')}
        ${spec('DLSS', pick && selectedRoute(d, pick, dir) === 'optiscaler' ? esc(inGameDlss || t('none')) : dlssValue(inGameDlss, d.newDlss, upToDate))}
        ${d.optiscaler ? spec('OptiScaler', esc(d.optiscaler.installed ? d.optiscaler.version : t('notInstalled')), d.optiscaler.installed ? 'on' : 'off') : ''}
        ${spec(t('fAddon'), esc(d.addon ? t('installed') : t('notPresent')), d.addon ? 'on' : 'off')}
        ${spec(t('fReShade'), esc(d.reshade.installed
            ? d.reshade.version + (d.reshade.addonSupport ? ' + ' + t('addonShort') : '')
            : t('notInstalled')), d.reshade.installed ? 'on' : 'off')}
      </div>

      ${d.files.length ? `<div class="filelist" data-title="${esc(t('sheetFiles'))}">${d.files.map((f) =>
        `<div class="filerow"><span class="f">${esc(f.rel)}</span><span class="v">${esc(f.version || '—')}</span></div>`).join('')}</div>` : ''}

      <div class="extras" id="sheetExtras"></div>

      <div class="sheet-actions">
        <button class="btn-install" id="doInstall"${d.ok && pick && !pick.installIssue && routesFor(pick).length ? '' : ' disabled'}>${installLabel(d, pick, dir)}</button>
        <button class="btn-restore" id="doRestore"${d.hasBackup ? '' : ' disabled'}>${t('restore')}</button>
      </div>
      <div class="job-toolbar"><button class="ghost sm" id="copyJob"${jobLines.length ? '' : ' disabled'}>${t('copyLog')}</button><button class="ghost sm" id="saveDiag">${t('saveDiagnostics')}</button></div>
      <div class="job" id="job" role="status" aria-live="polite" data-title="${esc(t('sheetActivity'))}">${esc(jobLines.join('\n') || t('jobReady'))}</div>
    </div>`;

  if (modernSheet) window.theme2.wireSheet(sheetContext);
  $('sheetClose').onclick = closeSheet;
  if ($('sheetPlay')) $('sheetPlay').onclick = () => playGame(dir, $('sheetPlay'));
  renderExtras(dir);
  $('copyJob').onclick = () => copyText([sheetGame.name, sheetGame.dir, '', ...jobLines].join('\n'));
  // Everything an issue report needs, in one file, instead of four asked for
  // one at a time.
  $('saveDiag').onclick = async () => {
    const button = $('saveDiag');
    button.disabled = true;
    try {
      const r = await window.lab.saveDiagnostics(sheetGame.dir, jobLines.join('\n'));
      if (r && r.ok) jobLog(t('diagnosticsSaved', r.count));
      else if (r && r.message) jobLog(r.message);
    } catch (e) { jobLog(e.message); } finally { button.disabled = false; }
  };
  wireNotes();
  wireNrPreset(d, pick);
  wireExePicker(dir);
  const apiSelect = $('apiChoice');
  if (apiSelect) apiSelect.onchange = async () => {
    const value = apiSelect.value;
    document.querySelectorAll('#sheet select, #doInstall, #doRestore, #exeSelect').forEach(e => { e.disabled = true; });
    let result;
    try { result = await window.lab.setApiOverride(dir, pick.path, value); }
    catch { result = { ok: false, code: 'errApiSave' }; }
    if (!result?.ok) jobLog(t(result?.code || 'errApiSave'));
    if (sheetGame?.dir === dir) {
      await openSheet(dir, true);
      $('apiChoice')?.focus();
    }
  };
  const proxySelect = $('reshadeProxy');
  if (proxySelect) proxySelect.onchange = async () => {
    document.querySelectorAll('#sheet select, #doInstall, #doRestore, #exeSelect').forEach(e => { e.disabled = true; });
    let result;
    try { result = await window.lab.setReshadeProxy(dir, pick.path, proxySelect.value); }
    catch { result = { ok: false, code: 'errApiSave' }; }
    if (!result?.ok) jobLog(t(result?.code || 'errApiSave'));
    if (sheetGame?.dir === dir) {
      await openSheet(dir, true);
      $('reshadeProxy')?.focus();
    }
  };
  // Filled in after the sheet exists - it was being written before, when
  // $('optiBuild') was still null, so the select rendered and stayed empty.
  // Only one game at a time is ever pinned to an older build, and only to one
  // the app already carries, so the list comes from the main process (#238).
  const buildSelect = $('optiBuild');
  if (buildSelect) {
    window.lab.optiscalerBuilds(dir).then(({ builds, current }) => {
      if ($('optiBuild') !== buildSelect) return;   // the sheet moved on
      buildSelect.innerHTML = builds.map((build, i) => {
        // An older app sent bare strings; a build is an object with a label now.
        const version = typeof build === 'string' ? build : build.version;
        const label = typeof build === 'string' ? build : (build.label || build.version);
        return `<option value="${esc(version)}"${version === current ? ' selected' : ''}>${esc(label)}${i === 0 ? ` · ${t('optiBuildCurrent')}` : ''}</option>`;
      }).join('');
      buildSelect.onchange = async () => {
        buildSelect.disabled = true;
        try { await window.lab.setOptiscalerBuild(dir, buildSelect.value); }
        catch (error) { log(error.message); }
        finally { buildSelect.disabled = false; }
      };
    }).catch(() => buildSelect.closest('label')?.remove());
  }
  const routeSelect = $('routeChoice');
  if (routeSelect) routeSelect.onchange = () => { routeChoice.set(dir, routeSelect.value); openSheet(dir, true); };
  const backendSelect = $('backendChoice');
  if (backendSelect) backendSelect.onchange = () => {
    const available = routesFor(pick).filter(route => route !== 'optiscaler');
    const previous = available.includes(d.previousReShadeRoute) ? d.previousReShadeRoute : d.recommendedRoute;
    routeChoice.set(dir, backendSelect.value === 'optiscaler' ? 'optiscaler' : available.includes(previous) ? previous : available[0]);
    openSheet(dir, true);
  };
  $('doInstall').onclick = () => runJob('install', dir);
  $('doRestore').onclick = () => runJob('restore', dir);
}

// NVIDIA DLSS per game (DLSS AiO Swapper): Super Resolution, Ray
// Reconstruction and Frame Generation, written into the game's NVIDIA driver
// profile - the same settings as the NVIDIA app's DLSS Override. "Default"
// removes the setting so the game/driver decides. Labels and option texts are
// i18n keys (i18n-dlss.js) when they start with "drs"; anything else (DLAA,
// Quality, 2x ...) is shown as is.
const DLSS_DRS = [
  { title: 'Super Resolution', items: [
    { id: '0x10E41E01', label: 'drsLatestSr', values: [[1, 'drsOn'], [0, 'drsOff']] },
    { id: '0x10E41DF3', label: 'drsPreset', values: [[0xFFFFFF, 'drsRecommended'], [0xD, 'drsSrM'], [0xC, 'drsSrL'],
      [0xB, 'drsSrK'], [0xA, 'J · Transformer 1'], [6, 'F · CNN'], [5, 'E · CNN'], [4, 'D · CNN']] },
    { id: '0x10AFB768', label: 'drsForceMode', values: [[4, 'DLAA'], [2, 'Quality'], [1, 'Balanced'], [0, 'Performance'], [5, 'Ultra Performance']], unset: [3] }
  ] },
  { title: 'Ray Reconstruction', items: [
    { id: '0x10E41E02', label: 'drsLatestRr', values: [[1, 'drsOn'], [0, 'drsOff']] },
    { id: '0x10E41DF7', label: 'drsPreset', values: [[0xFFFFFF, 'drsRecommended'], [6, 'F · Transformer 2'], [5, 'E · Transformer 1'], [4, 'D · Transformer 1']] }
  ] },
  { title: 'Frame Generation', items: [
    { id: '0x10E41E03', label: 'drsLatestFg', values: [[1, 'drsOn'], [0, 'drsOff']] },
    { id: '0x10E41DF1', label: 'drsPreset', values: [[0xFFFFFE, 'drsRecommended'], [0xFFFFFF, 'drsLatest'], [1, 'drsFgA'], [2, 'drsFgB'], [3, 'drsFgC']], unset: [0] },
    { id: '0x10308298', label: 'drsMode', values: [[2, 'drsFixed'], [4, 'drsDynamic']], unset: [0] },
    { id: '0x104D6667', label: 'drsFactorFixed', values: [[1, '2x'], [2, '3x'], [3, '4x'], [4, '5x'], [5, '6x']], unset: [0] },
    { id: '0x10562D0F', label: 'drsFactorDynamic', values: [[1, '2x'], [2, '3x'], [3, '4x'], [4, '5x'], [5, '6x']], unset: [0] }
  ] }
];
const drsText = (text) => (/^drs[A-Z]/.test(text) ? t(text) : text);

function wireNrPreset(d, pick) {
  if (!pick || !window.lab.drsGet) return;
  const anchor = $('doInstall')?.closest('.sheet-actions') || $('doInstall')?.parentElement;
  if (!anchor) return;
  // AMD / Intel: no NVIDIA driver profile, and the port always runs model B.
  if (window.installRoutes.isVendorNeutral()) {
    const box = document.createElement('div');
    box.className = 'nv-dlss-box';
    box.innerHTML = `<div class="install-options" data-title="${esc(t('nrModelTitle'))}"><div class="emu-note"><span>${esc(t('portModelFixed'))}</span></div></div>`;
    anchor.insertAdjacentElement('beforebegin', box);
    return;
  }
  const exe = String(pick.rel || pick.path || '').split(/[\\/]/).pop();
  const nr = (d.files || []).filter((f) => /(^|[\\/])nvngx_dlssnr\.dll$/i.test(f.rel || '') && !/(^|[\\/])_(hermes_|dlss5_backup)/i.test(f.rel || ''))[0];
  const nrVersion = nr && nr.version ? String(nr.version).replace(/,\s*/g, '.') : null;
  const box = document.createElement('div');
  box.className = 'nv-dlss-box';
  box.innerHTML = `
    <div class="install-options" data-title="${esc(t('nrModelTitle'))}">
      <label><span>${esc(t('nrModelLabel'))}</span><select id="nrModel" disabled>
        <option value="2">${esc(t('nrModelB'))}</option>
        <option value="1">${esc(t('nrModelA'))}</option>
      </select></label>
      <div class="emu-note" id="nrModelNote"><span>${esc(t('nrReading'))}</span></div>
    </div>` + DLSS_DRS.map((group) => `
    <div class="install-options" data-title="NVIDIA ${esc(group.title)}">
      ${group.items.map((item) => `<label><span>${esc(drsText(item.label))}</span><select data-drs="${item.id}" disabled>
        <option value="default">${esc(t('drsDefault'))}</option>
        ${item.values.map(([v, text]) => `<option value="${v}">${esc(drsText(text))}</option>`).join('')}
      </select></label>`).join('')}
    </div>`).join('') + `<div class="emu-note" id="drsNote"><span>${esc(t('drsReading'))}</span></div>`;
  anchor.insertAdjacentElement('beforebegin', box);
  const note = box.querySelector('#drsNote');
  const selects = [...box.querySelectorAll('select[data-drs]')];
  const itemFor = (id) => DLSS_DRS.flatMap((g) => g.items).find((i) => i.id === id);
  const nrHint = esc(!nr ? t('nrHintMissing')
    : /^310\.8\./.test(nrVersion) ? t('nrHintOld', { version: nrVersion })
      : t('nrHintBoth', { version: nrVersion }));
  const apply = (r) => {
    if (!r || !r.ok) { note.innerHTML = `<span>${esc((r && r.message) || t('drsReadFailed'))}</span>`; return false; }
    for (const select of selects) {
      const item = itemFor(select.dataset.drs);
      const entry = r.values ? r.values[select.dataset.drs] : undefined;
      if (entry === undefined) continue;
      select.querySelector('option[data-other]')?.remove();
      const value = entry ? parseInt(entry.value, 16) : null;
      if (value === null || (item.unset || []).includes(value)) { select.value = 'default'; continue; }
      if (!item.values.some(([v]) => v === value)) {
        const other = document.createElement('option');
        other.value = String(value); other.dataset.other = '1';
        other.textContent = t('drsSetValue', { value: entry.value });
        select.appendChild(other);
      }
      select.value = String(value);
      select.title = entry.source === 'game' ? t('drsFromGame') : t('drsFromGlobal');
    }
    note.innerHTML = `<span>${esc(t('drsProfileNote', { profile: r.profile || exe }))}</span>`;
    return true;
  };
  // DLSS 5 model: RenoDX passes NRPreset to nvngx_dlssnr.dll (the DLL ignores
  // the driver profile). Verified with NGX logs: 1 = A, 2 = B, 0 = falls back to B.
  const modelSel = box.querySelector('#nrModel'), modelNote = box.querySelector('#nrModelNote');
  const gameDir = sheetGame && sheetGame.dir;
  const showModel = (r) => {
    if (!r || !r.ok) { modelNote.innerHTML = `<span>${esc((r && r.message) || t('nrReadFailed'))}</span>`; return; }
    if (!r.found) { modelSel.disabled = true; modelNote.innerHTML = `<span>${esc(t('nrNotInstalled'))}</span>`; return; }
    modelSel.value = r.value === 1 ? '1' : '2';
    modelSel.disabled = false;
    const auto = r.value === null || r.value === 0 ? t('nrAuto') : '';
    modelNote.innerHTML = `<span>${esc(t('nrNextStart', { model: r.model, auto, via: r.via, files: r.files.join(', ') }))}</span><span>${nrHint}</span>`;
  };
  if (gameDir && window.lab.nrModelGet) {
    window.lab.nrModelGet(gameDir).then((r) => { if (box.isConnected) showModel(r); })
      .catch((e) => { modelNote.innerHTML = `<span>${esc(e.message)}</span>`; });
    modelSel.onchange = async () => {
      modelSel.disabled = true;
      let r;
      try { r = await window.lab.nrModelSet(gameDir, Number(modelSel.value)); } catch (e) { r = { ok: false, message: e.message }; }
      if (!box.isConnected) return;
      jobLog(r && r.ok ? t('nrSaved', { exe, model: r.model }) : t('nrSaveFailed', { error: (r && r.message) || t('saveFailed') }));
      showModel(r && r.ok ? r : await window.lab.nrModelGet(gameDir).catch(() => r));
    };
  }
  window.lab.drsGet(exe).then((r) => {
    if (!box.isConnected) return;
    if (apply(r)) selects.forEach((s) => { s.disabled = false; });
  }).catch((e) => { note.innerHTML = `<span>${esc(e.message)}</span>`; });
  for (const select of selects) {
    select.onchange = async () => {
      const id = select.dataset.drs, item = itemFor(id);
      const text = select.options[select.selectedIndex].text;
      selects.forEach((s) => { s.disabled = true; });
      let r;
      try { r = await window.lab.drsSet(exe, { [id]: select.value === 'default' ? 'default' : Number(select.value) }); }
      catch (e) { r = { ok: false, message: e.message }; }
      if (!box.isConnected) return;
      jobLog(r && r.ok ? t('drsSaved', { exe, label: drsText(item.label), value: text }) : t('drsSaveFailed', { error: (r && r.message) || t('saveFailed') }));
      const fresh = await window.lab.drsGet(exe).catch(() => r);
      apply(fresh && fresh.ok ? fresh : r);
      selects.forEach((s) => { s.disabled = false; });
    };
  }
}

// ---------------- DLSS indicator (DLSS AiO Swapper) ----------------
async function renderIndicator() {
  const sr = $('indSr'), fg = $('indFg'), note = $('indNote');
  if (!sr || !window.lab.indicatorGet) return;
  const apply = (r) => {
    if (!r || !r.ok) { note.textContent = (r && r.message) || t('indReadFailed'); return; }
    sr.setAttribute('aria-checked', String(Number(r.sr) > 0));
    fg.value = String([0, 1, 2].includes(Number(r.fg)) ? Number(r.fg) : 0);
    note.textContent = Number(r.sr) > 0 || Number(r.fg) > 0 ? t('indIsOn') : t('indIsOff');
    sr.disabled = false; fg.disabled = false;
  };
  const save = async (srOn, fgVal) => {
    sr.disabled = true; fg.disabled = true; note.textContent = t('indSaving');
    let r;
    try { r = await window.lab.indicatorSet(srOn ? 1024 : 0, fgVal); } catch (e) { r = { ok: false, message: e.message }; }
    if (r && r.ok) jobLog(t('indSaved', { sr: srOn, fg: fgVal }));
    apply(r && r.ok ? r : await window.lab.indicatorGet().catch(() => r));
    if (!r || !r.ok) note.textContent = (r && r.message) || t('indSaveFailed');
  };
  sr.onclick = () => save(sr.getAttribute('aria-checked') !== 'true', Number(fg.value));
  fg.onchange = () => save(sr.getAttribute('aria-checked') === 'true', Number(fg.value));
  try { apply(await window.lab.indicatorGet()); } catch (e) { note.textContent = e.message; }
}

// ---------------- Components (component manager) ----------------
// Lists what src/core/components.js manages in %APPDATA%\dlss5-swapper\payload
// and drives downloads, the DLSS 5 import and the migration from an old
// install. All text goes through t(); main sends codes + params.
const comp = { status: null, versions: null, busy: false, progress: {}, errors: {}, picks: {}, wired: false };
const compMsg = (r) => {
  if (!r) return t('compErrGeneric');
  if (r.code) { const text = t(r.code, r.params || {}); if (text && text !== r.code) return text; }
  return r.message || t('compErrGeneric');
};
const compName = (row) => { const key = 'compName_' + row.id; const text = t(key); return text !== key ? text : row.name; };
const compTag = (version) => (version ? 'v' + String(version).split('.').slice(0, 3).join('.') : null);

// Which card the Components page lists parts for. It starts on the detected
// GPU; a different pick is remembered so someone can look up what a friend's
// PC needs. It only filters this page - installs always follow the detected
// card (main decides the route from the hardware, not from this choice).
// AMD Radeon / Intel Arc run DLSS 5 through OptiScaler's vendor-neutral port,
// which needs nothing but NVIDIA's DLSS 5 model 310.9+; OptiScaler and the
// port are fetched by the install itself.
const COMP_GPU_KEY = 'aio.compGpu';
const COMP_AMD_IDS = new Set(['dlssnr']);
const COMP_PORT_MIN = '310.9';
const compDetectedGpu = () => (state.gpuMode && state.gpuMode.vendorNeutral ? 'amd' : 'nvidia');
function compGpu() {
  try { const v = localStorage.getItem(COMP_GPU_KEY); if (v === 'nvidia' || v === 'amd') return v; } catch { /* storage off */ }
  return compDetectedGpu();
}
function setCompGpu(value) {
  try {
    if (value === compDetectedGpu()) localStorage.removeItem(COMP_GPU_KEY);
    else localStorage.setItem(COMP_GPU_KEY, value);
  } catch { /* storage off: the pick lasts for this session only */ }
  comp.gpuPick = value;
}
const compGpuNow = () => comp.gpuPick || compGpu();
const compRelevant = (row) => compGpuNow() === 'nvidia' || COMP_AMD_IDS.has(row.id);
function compVersionAtLeast(version, min) {
  const a = String(version || '0').split('.').map(Number);
  const b = String(min).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return true;
}

function compBadge(row) {
  if (row.optional && row.status === 'missing') return `<span class="comp-badge optional">${esc(t('compOptional'))}</span>`;
  if (comp.progress[row.id] && comp.busy) return `<span class="comp-badge working">${esc(t('compStatusWorking'))}</span>`;
  const key = { ok: 'compStatusOk', outdated: 'compStatusOutdated', missing: 'compStatusMissing' }[row.status] || 'compStatusMissing';
  return `<span class="comp-badge ${esc(row.status)}">${esc(t(key))}</span>`;
}
function compProgressText(p) {
  if (!p) return '';
  if (p.phase === 'start') return t('compProgStart');
  if (p.phase === 'verify') return t('compProgVerify');
  if (p.phase === 'download' && p.count) return t('compProgFiles', p);
  if (p.phase === 'download') return t('compProgDownload', p);
  return '';
}
function compActionLabel(row) {
  if (row.status === 'missing') return t('compDownload');
  if (row.status === 'outdated') return t('compUpdate');
  if (row.kind === 'dlss' && comp.picks[row.id] && comp.picks[row.id] !== compTag(row.version)) return t('compSwitch');
  return t('compRedownload');
}

function renderComponentTable() {
  const table = $('compTable');
  const s = comp.status;
  if (!table || !s) return;
  if (!s.ok) { table.innerHTML = `<tr><td class="comp-err">${esc(compMsg(s))}</td></tr>`; return; }
  const head = `<tr><th>${esc(t('compColName'))}</th><th>${esc(t('compColVersion'))}</th><th>${esc(t('compColStatus'))}</th><th></th></tr>`;
  const amd = compGpuNow() === 'amd';
  const rows = s.components.filter(compRelevant).map((row) => {
    const source = row.kind === 'import' ? t('compSourceNr', { version: row.latest || '310.9.16' }) : row.source;
    const note = row.note ? t(row.note.key, row.note.params || {}) : '';
    const err = comp.errors[row.id];
    let action;
    let extra = '';
    const dis = comp.busy ? 'disabled' : '';
    if (row.kind === 'import' && amd) {
      extra = row.status !== 'missing' && !compVersionAtLeast(row.version, COMP_PORT_MIN)
        ? t('compAmdNrTooOld', { version: row.version || '?', min: COMP_PORT_MIN })
        : t('compAmdNrNeeded', { min: COMP_PORT_MIN });
    } else if (row.kind === 'import' && s.gpu && !s.gpu.blackwell) extra = t('compNoteNrRtx50', { gpu: s.gpu.names });
    if (row.kind === 'legacy-nr') {
      const active = Boolean(s.legacyNr && s.legacyNr.active);
      if (row.status === 'ok') extra = t(active ? 'compLegacyNrOn' : 'compLegacyNrOff');
      else if (s.gpu && !s.gpu.blackwell) extra = t('compLegacyNrForYou', { gpu: s.gpu.names });
      else extra = t('compLegacyNrIntro');
      action = row.status === 'ok'
        ? `<button class="${active ? 'ghost' : 'glass-btn'} sm" data-comp-act="legacy-${active ? 'off' : 'on'}" ${dis}>${esc(t(active ? 'compLegacyNrUseOfficial' : 'compLegacyNrUse'))}</button>` +
          `<button class="ghost sm" data-comp-act="legacy-remove" ${dis}>${esc(t('caRemove'))}</button>`
        : `<button class="ghost sm" data-comp-act="legacy-download" ${dis}>${esc(t('compDownload'))}…</button>`;
    } else if (row.kind === 'import') {
      // NVIDIA's signed model is a download now; importing an own file stays.
      action = `<button class="${row.status === 'ok' ? 'ghost' : 'glass-btn'} sm" data-comp-act="download" data-comp-id="${esc(row.id)}" ${dis}>${esc(compActionLabel(row))}</button>` +
        `<button class="ghost sm" data-comp-act="import" ${dis}>${esc(t('compImportNr'))}</button>`;
    } else {
      let select = '';
      const list = row.kind === 'dlss' && comp.versions && comp.versions.ok && comp.versions[row.id];
      if (list && list.versions.length) {
        const pick = comp.picks[row.id] || list.default;
        select = `<select data-comp-pick="${esc(row.id)}" title="${esc(t('compVersion'))}" ${comp.busy ? 'disabled' : ''}>` +
          list.versions.map((v) => `<option value="${esc(v.tag)}"${v.tag === pick ? ' selected' : ''}>${esc(v.version)}</option>`).join('') + '</select>';
      }
      action = `${select}<button class="${row.status === 'ok' ? 'ghost' : 'glass-btn'} sm" data-comp-act="download" data-comp-id="${esc(row.id)}" ${comp.busy ? 'disabled' : ''}>${esc(compActionLabel(row))}</button>`;
    }
    return `<tr data-comp-row="${esc(row.id)}">
      <td><div class="comp-name">${esc(compName(row))}</div><div class="comp-sub">${esc(source)}</div></td>
      <td>${esc(row.version || '–')}</td>
      <td>${compBadge(row)}${note ? `<div class="comp-sub">${esc(note)}</div>` : ''}${extra ? `<div class="comp-sub comp-warn">${esc(extra)}</div>` : ''}<div class="comp-prog" data-comp-prog="${esc(row.id)}">${esc(compProgressText(comp.progress[row.id]))}</div>${err ? `<div class="comp-err">${esc(err)}</div>` : ''}</td>
      <td class="comp-act">${action}</td></tr>`;
  }).join('');
  table.innerHTML = head + rows;
}

function paintCompGpu() {
  const pick = compGpuNow();
  for (const b of document.querySelectorAll('[data-comp-gpu]')) {
    const on = b.dataset.compGpu === pick;
    b.className = (on ? 'glass-btn' : 'ghost') + ' sm';
    b.setAttribute('aria-checked', String(on));
    b.disabled = comp.busy;
  }
  const amd = pick === 'amd';
  const notes = [];
  if (amd) notes.push(t('compGpuAmdNote', { min: COMP_PORT_MIN }));
  if (state.gpuMode && pick !== compDetectedGpu()) {
    notes.push(t('compGpuOtherNote', { gpu: state.gpuMode.names || t(compDetectedGpu() === 'amd' ? 'compGpuAmd' : 'compGpuNvidia') }));
  }
  if ($('compGpuNote')) $('compGpuNote').textContent = notes.join(' ');
  // Nothing on the AMD / Intel list is a download, and own RenoDX add-ons
  // need ReShade + an NVIDIA card.
  if ($('compAll')) $('compAll').classList.toggle('hidden', amd);
  if ($('ownAddon')) $('ownAddon').classList.toggle('hidden', amd);
}

function paintComponents() {
  const s = comp.status;
  if ($('compIntro')) $('compIntro').textContent = t('compIntro', { dir: s && s.payloadDir });
  paintCompGpu();
  const box = $('compMigrateBox');
  if (box) {
    const legacy = s && s.ok && s.legacy;
    box.classList.toggle('hidden', !legacy);
    if (legacy) {
      const names = legacy.components.map((c) => compName((s.components.find((r) => r.id === c.id)) || c)).join(', ');
      $('compMigrateHint').textContent = t('compMigrateHint', { dir: legacy.dir, list: names });
      $('compMigrate').disabled = comp.busy;
    }
  }
  for (const id of ['compAll', 'compImport', 'compRecheck']) if ($(id)) $(id).disabled = comp.busy;
  if ($('compVersionsNote')) $('compVersionsNote').textContent = comp.versions && comp.versions.ok && comp.versions.source === 'builtin' ? t('compVersionsOffline') : '';
  if ($('compActive')) $('compActive').textContent = s && s.activePayload ? t('compActivePayload', { dir: s.activePayload }) : '';
  renderComponentTable();
}

function paintCompBanner() {
  const s = comp.status;
  const banner = $('compBanner');
  if (!banner) return;
  const amd = compGpuNow() === 'amd';
  const missing = s && s.ok && Array.isArray(s.missing) ? s.missing.filter((id) => !amd || COMP_AMD_IDS.has(id)) : [];
  // NVIDIA: a complete legacy payload still counts. AMD / Intel: only the
  // model matters, wherever the rest comes from.
  const show = Boolean(missing.length && (amd || !s.activeComplete));
  banner.classList.toggle('hidden', !show);
  if (show) {
    $('compBannerText').textContent = t('compBannerText', {
      list: missing.map((id) => compName(s.components.find((r) => r.id === id) || { id, name: id })).join(', ')
    });
  }
}

async function refreshComponents() {
  try { comp.status = await window.lab.componentsStatus(); } catch (e) { comp.status = { ok: false, message: e.message }; }
  paintCompBanner();
  paintCompNav();
  if (document.getElementById('view-components')?.classList.contains('active')) paintComponents();
  return comp.status;
}

// The Components entry in the sidebar glows with a count when something there
// can be downloaded or updated (a new RenoDX build, newer NVIDIA DLLs), so an
// update is seen without opening the tab - the DLSS 5 model included, now
// that NVIDIA's signed file can be downloaded.
function paintCompNav() {
  const s = comp.status;
  const list = s && s.ok && Array.isArray(s.components) ? s.components : [];
  const due = list.filter((c) => compRelevant(c) && c.downloadable && !c.optional && (c.status === 'outdated' || c.status === 'missing'));
  for (const item of document.querySelectorAll('[data-view="components"]')) {
    item.classList.toggle('has-update', due.length > 0);
    let badge = item.querySelector('.nav-badge');
    if (due.length) {
      if (!badge) { badge = document.createElement('b'); badge.className = 'nav-badge'; item.appendChild(badge); }
      badge.textContent = String(due.length);
      item.title = t('compNavUpdates', due.length, due.map((c) => compName(c)).join(', '));
    } else {
      if (badge) badge.remove();
      item.removeAttribute('title');
    }
  }
}

// The payload may have changed: the games list compares against its DLSS version.
async function afterComponentsChanged() {
  await refreshComponents();
  refreshUpdateAll();
  try {
    state.newDlss = (await window.lab.details(state.games[0] ? state.games[0].dir : '')).newDlss;
    renderGames();
    renderRecent();
  } catch { /* the list refreshes on the next scan */ }
}

function wireComponents() {
  if (comp.wired) return;
  comp.wired = true;
  window.lab.onComponentsProgress((p) => {
    if (!p || !p.id) return;
    comp.progress[p.id] = p;
    if (p.phase === 'error') comp.errors[p.id] = compMsg(p);
    const cell = document.querySelector(`[data-comp-prog="${CSS.escape(p.id)}"]`);
    if (cell && p.phase === 'download') cell.textContent = compProgressText(p);
    else renderComponentTable();
  });
  $('compTable').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-comp-pick]');
    if (!sel) return;
    comp.picks[sel.dataset.compPick] = sel.value;
    renderComponentTable();
  });
  $('compTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-comp-act]');
    if (!b || comp.busy) return;
    if (b.dataset.compAct === 'import') compImport();
    else if (b.dataset.compAct.startsWith('legacy-')) compLegacyNr(b.dataset.compAct.slice(7));
    else compDownload(b.dataset.compId);
  });
  $('compAll').onclick = () => compDownload('all');
  for (const b of document.querySelectorAll('[data-comp-gpu]')) {
    b.onclick = () => {
      if (comp.busy || b.dataset.compGpu === compGpuNow()) return;
      setCompGpu(b.dataset.compGpu);
      paintComponents();
      paintCompBanner();
      paintCompNav();
    };
  }
  $('compImport').onclick = () => compImport();
  $('compRecheck').onclick = () => renderComponents(true);
  $('compMigrate').onclick = () => compMigrate();
  $('compBannerOpen').onclick = () => show('components');
  if ($('caImport')) $('caImport').onclick = () => customAddonImport();
  if ($('caList')) $('caList').onclick = (e) => {
    const b = e.target.closest('[data-ca-act]');
    if (b) customAddonAction(b.dataset.caAct, b.dataset.caName);
  };
  renderCustomAddons();
}

// Own add-on builds (a purchased lecram build, a newer ShortFuse build):
// imported once, then used by every install and by "Update installed DLSS 5".
async function renderCustomAddons() {
  const box = $('caList');
  if (!box || !window.lab.customAddons) return;
  let rows = [];
  try { rows = await window.lab.customAddons(); } catch { return; }
  const present = rows.filter((r) => r.present);
  box.innerHTML = present.length ? present.map((r) => `
    <div class="own-row${r.active ? ' on' : ''}">
      <div class="own-info"><b>${esc(r.label)}</b>
        <span>${esc(r.file || r.name)}${r.version ? ' · v' + esc(r.version) : ''} · SHA-256 ${esc(String(r.sha256).slice(0, 12))}…</span>
        <span class="own-state">${esc(t(r.active ? 'caActive' : 'caInactive'))}</span></div>
      <div class="own-acts">
        <button class="${r.active ? 'ghost' : 'glass-btn'} sm" data-ca-act="${r.active ? 'off' : 'on'}" data-ca-name="${esc(r.name)}">${esc(t(r.active ? 'caUseBuiltin' : 'caUseOwn'))}</button>
        <button class="ghost sm" data-ca-act="remove" data-ca-name="${esc(r.name)}">${esc(t('caRemove'))}</button>
      </div>
    </div>`).join('') : `<p class="comp-note">${esc(t('caNone'))}</p>`;
}
async function customAddonImport() {
  if (jobRunning) return;
  const answer = await window.lab.customAddonImport({ title: t('caImport') });
  if (!answer || answer.cancelled) return;
  if (!answer.ok) { log(t('caFailed', answer.code ? t(answer.code, answer.params || {}) : answer.message)); return; }
  log(answer.file === 'dlss5-nr.addon64' && answer.host
    ? t('caImportedV126', answer.version || '?', answer.scanned, answer.addon32)
    : answer.file === 'dlss5-nr.addon64'
    ? t('caImportedV11', answer.version || '?', answer.scanned)
    : t('caImported', answer.name, answer.version || '?', answer.scanned));
  await renderCustomAddons();
  refreshUpdateAll();
}
async function customAddonAction(act, name) {
  if (act === 'remove') {
    if (!await ask({ icon: 'question', title: t('caRemoveTitle'), body: t('caRemoveBody'), confirm: t('caRemove'), cancel: t('cancel') })) return;
    await window.lab.customAddonRemove(name);
  } else {
    await window.lab.customAddonUse(name, act === 'on');
  }
  await renderCustomAddons();
  refreshUpdateAll();
}

async function compBusy(work) {
  if (comp.busy) return;
  comp.busy = true;
  comp.errors = {};
  comp.progress = {};
  paintComponents();
  try { await work(); }
  catch (e) { log(compMsg({ message: e.message })); }
  finally {
    comp.busy = false;
    comp.progress = {};
    await afterComponentsChanged();
    paintComponents();
  }
}

function compDownload(id) {
  return compBusy(async () => {
    const rowName = (rid) => compName((comp.status.components.find((r) => r.id === rid)) || { id: rid, name: rid });
    if (id === 'all') {
      const versions = {};
      for (const [k, v] of Object.entries(comp.picks)) if (v) versions[k] = v;
      const r = await window.lab.componentsDownload('all', { versions });
      if (!r || !Array.isArray(r.results)) { log(compMsg(r)); return; }
      for (const x of r.results) {
        if (x.ok && !x.skipped) log(t('compLogDone', { name: rowName(x.id), version: x.version }));
        if (!x.ok && !x.skipped) { comp.errors[x.id] = compMsg(x); log(t('compLogFailed', { name: rowName(x.id), reason: compMsg(x) })); }
      }
      log(t('compLogAll', { ok: r.results.filter((x) => x.ok).length, failed: r.results.filter((x) => !x.ok && !x.skipped).length }));
      return;
    }
    const opts = comp.picks[id] ? { tag: comp.picks[id] } : {};
    const r = await window.lab.componentsDownload(id, opts);
    if (r && r.ok) log(t('compLogDone', { name: rowName(id), version: r.version }));
    else { comp.errors[id] = compMsg(r); log(t('compLogFailed', { name: rowName(id), reason: compMsg(r) })); }
  });
}

function compImport() {
  return compBusy(async () => {
    const r = await window.lab.componentsImportNr({ title: t('compImportTitle') });
    if (r && r.cancelled) return;
    if (r && r.ok) log(t('compLogImported', { version: r.version, models: t(r.models === 'AB' ? 'compModelsAB' : 'compModelsA') }));
    else { comp.errors.dlssnr = compMsg(r); log(t('compLogFailed', { name: compName({ id: 'dlssnr', name: 'nvngx_dlssnr.dll' }), reason: compMsg(r) })); }
  });
}

// The community DLSS 5 build for RTX 20/30/40: opt-in, behind a warning.
async function compLegacyNr(act) {
  const id = 'dlssnr-legacy';
  const name = compName({ id, name: id });
  if (act === 'download') {
    const s = comp.status || {};
    const body = t('compLegacyNrWarnBody', { gpu: s.gpu ? s.gpu.names : '?' }) + (s.gpu && s.gpu.blackwell ? '\n\n' + t('compLegacyNrWarnRtx50') : '');
    if (!await ask({ icon: 'shield', title: t('compLegacyNrWarnTitle'), body, confirm: t('compLegacyNrWarnConfirm'), cancel: t('cancel') })) return;
    return compBusy(async () => {
      const r = await window.lab.componentsDownload(id, { acceptUnsigned: true });
      if (r && r.ok) log(t('compLogDone', { name, version: r.version }) + ' ' + t(r.active ? 'compLegacyNrOn' : 'compLegacyNrOff'));
      else { comp.errors[id] = compMsg(r); log(t('compLogFailed', { name, reason: compMsg(r) })); }
    });
  }
  if (act === 'remove' && !await ask({ icon: 'question', title: name, body: t('compLegacyNrRemoveBody'), confirm: t('caRemove'), cancel: t('cancel') })) return;
  return compBusy(async () => {
    const r = await window.lab.componentsLegacyNr(act);
    if (r && r.ok) log(t(act === 'remove' ? 'compLegacyNrRemoved' : (r.active ? 'compLegacyNrOn' : 'compLegacyNrOff')) + (act === 'remove' ? '' : ' ' + t('compLegacyNrReinstall')));
    else { comp.errors[id] = compMsg(r); log(t('compLogFailed', { name, reason: compMsg(r) })); }
  });
}

function compMigrate() {
  return compBusy(async () => {
    const r = await window.lab.componentsMigrate();
    if (!r || !Array.isArray(r.results)) { log(compMsg(r)); return; }
    for (const x of r.results) if (!x.ok) comp.errors[x.id] = compMsg(x);
    log(t('compLogMigrated', { n: r.results.filter((x) => x.ok && !x.skipped).length }));
  });
}

async function renderComponents(force) {
  wireComponents();
  if (force || !comp.status) await refreshComponents();
  paintComponents();
  if (force || !comp.versions) {
    try { comp.versions = await window.lab.dlssVersions(); } catch (e) { comp.versions = { ok: false, message: e.message }; }
    for (const id of ['dlss', 'dlssd', 'dlssg']) {
      const list = comp.versions && comp.versions.ok && comp.versions[id];
      if (list && !comp.picks[id]) comp.picks[id] = list.default;
    }
    paintComponents();
  }
}

function wireExePicker(dir) {
  const select = $('exeSelect');
  if (!select) return;
  const menu = $('exeMenu');

  select.onclick = (event) => {
    event.stopPropagation();
    const opening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !opening);
    select.classList.toggle('open', opening);
    select.setAttribute('aria-expanded', String(opening));
  };
  menu.onclick = (event) => {
    const option = event.target.closest('.exe-option');
    if (!option) return;
    exeChoice.set(dir, option.dataset.path);
    routeChoice.delete(dir);
    openSheet(dir);
  };
}

const JOB_DETAIL_CODES = new Set(['errLoaderConflict', 'errBackupInvalid']);
async function runJob(kind, dir) {
  if (jobRunning) return;
  jobRunning = true;
  const install = $('doInstall');
  const restoreBtn = $('doRestore');
  install.disabled = restoreBtn.disabled = true;
  document.querySelectorAll('#sheet select, #exeSelect, #sheetClose').forEach(e => { e.disabled = true; });
  install.textContent = kind === 'install' ? t('installing') : t('install');
  jobLines = [];
  jobLog(kind === 'install' ? '--- installing ---' : '--- restoring ---');

  const pick = sheetDetails ? chosenExe(sheetDetails, dir) : null;

  // The driver that cannot run the neural pass is worth one question rather
  // than a line in a log nobody reads (#229, #258, #104). Asked once per
  // driver version, and never a refusal - the install still works, and people
  // do install deliberately on these drivers.
  if (kind === 'install') {
    let driver = { fault: false };
    try { driver = await window.lab.driverNeuralFault(); } catch { /* no nvidia-smi is not a reason to stop */ }
    if (driver.fault && !driver.acknowledged) {
      const go = await ask({
        icon: 'warning', title: t('driverFaultTitle'), body: t('driverFaultBody', driver.names),
        confirm: t('driverFaultGo'), cancel: t('cancel')
      });
      if (!go) {
        jobLog(t('driverFaultStopped'));
        jobRunning = false;
        install.textContent = t('install');
        install.disabled = restoreBtn.disabled = false;
        document.querySelectorAll('#sheet select, #exeSelect, #sheetClose').forEach(e => { e.disabled = false; });
        return;
      }
      try { await window.lab.acknowledgeDriver(driver.names); } catch { /* asking twice is not a failure */ }
    }
  }

  let res;
  try { res = kind === 'install'
    ? await window.lab.install(
      dir,
      exeChoice.get(dir) || null,
      pick ? selectedRoute(sheetDetails, pick, dir) : null,
      pick?.apiOverride || 'auto'
    )
    : await window.lab.restoreGame(dir);
  } catch (error) { res = { ok: false, message: error.message }; }
  jobRunning = false;
  install.textContent = t('install');

  if (res.ok) {
    jobLog(kind === 'install' ? `done - ${res.replaced} replaced, ${res.added} added` : 'done - originals restored');
    log(`${kind === 'install' ? 'Installed' : 'Restored'}: ${dir}`);
    if ($('view-history').classList.contains('active')) await renderHistory();
    // Recent Games tracks what was actually swapped, not what was browsed.
    state.recents = await window.lab.touch(dir);
    renderRecent();
    const g = state.games.find((x) => x.dir === dir);
    if (g) { g.cached = await window.lab.scan(dir); renderGames(); renderRecent(); }
    if (kind === 'restore') routeChoice.delete(dir);
    setTimeout(() => { if (sheetGame?.dir === dir) openSheet(dir, true); }, 400);
  } else {
    const translated = res.code && (res.params ? t(res.code, res.params) : t(res.code));
    const hasTranslation = Boolean(translated && translated !== res.code);
    jobLog(res.cancelled ? t('operationCancelled') : 'failed: ' + (hasTranslation ? translated : (res.message || res.code)));
    // With a translated code the English res.message is only a duplicate, so
    // it is not logged - except where the translated text points at a file
    // path that only the message carries.
    if (!res.cancelled && hasTranslation && JOB_DETAIL_CODES.has(res.code) && res.message && res.message !== res.code) jobLog(res.message);
    install.disabled = false;
    // A failed external ReShade setup can still have changed files. Re-read
    // the manifest so Restore originals becomes available immediately.
    setTimeout(() => { if (sheetGame?.dir === dir) openSheet(dir, true); }, 250);
  }
}

// The sheet could not be built. Say why instead of leaving "Reading the
// folder…" on screen forever, and put the reason in the log to copy.
function sheetFailed(g, err) {
  const reason = String((err && err.message) || err || '?').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  $('sheet').innerHTML = `<div class="pad">
    <h3 style="margin:0 0 8px">${esc(g.name)}</h3>
    <p class="hint">${esc(t('sheetFailed'))}</p>
    <pre style="white-space:pre-wrap;font-size:12px;opacity:.85">${esc(reason)}</pre>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="ghost sm" id="sheetRetry">${esc(t('sheetRetry'))}</button>
      <button class="glass-btn sm" id="sheetClose">${esc(t('sheetCloseBtn'))}</button>
    </div></div>`;
  $('sheetClose').onclick = closeSheet;
  $('sheetRetry').onclick = () => openSheet(g.dir);
  log(t('sheetFailedLog', { name: g.name, reason }));
}

function closeSheet() {
  if (jobRunning) return;
  sheetGame = null;
  sheetDetails = null;
  $('overlay').classList.add('hidden');
}

// ---------------- events ----------------

$('nav').onclick = (e) => {
  const b = e.target.closest('.nav-item');
  if (b) show(b.dataset.view);
};
document.querySelector('.link[data-view]').onclick = () => show('games');

// The wordmark is black artwork, so the dark theme gets the lifted copy.
function paintBrand() {
  const art = state.logo && (state.logo.logo || state.logo.logoDark);
  $('brand').innerHTML = '<div style="display:flex;align-items:center;gap:9px">'
    + (art ? `<img src="${art}" alt="" style="width:38px;height:38px;max-width:none;border-radius:9px;flex:none">` : '')
    + '<div style="min-width:0"><b style="display:block;white-space:nowrap;font-size:15px;letter-spacing:.01em;background:linear-gradient(90deg,#a855f7,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent">DLSS AiO Swapper</b>'
    + '<div style="font-size:11px;color:var(--dim);margin-top:1px">by Machiavelli</div></div></div>';
}

// ---------------- language ----------------

function applyLang(code) {
  state.lang = setLang(code);
  document.documentElement.lang = state.lang;
  document.documentElement.dir = dirOf(state.lang);
  $('langLabel').textContent = state.lang.toUpperCase();

  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  // Anything drawn from data has to be rebuilt, not just relabelled.
  renderLog();
  renderRecent();
  renderGames();
  const view = document.querySelector('.view.active');
  if (view && view.id === 'view-history') renderHistory();
  if (view && view.id === 'view-settings') renderSettings();
  if (view && view.id === 'view-components') paintComponents();
  if (view && view.id === 'view-indicator') renderIndicator();
  paintCompBanner();
  if (sheetGame) openSheet(sheetGame.dir, true);
}

// With this many languages a plain list is a long scroll, so the menu filters
// as you type. The filter matches the native name, the English name and the
// code, because someone looking for Greek may type any of the three.
function langRows(filter) {
  const q = filter.trim().toLowerCase();
  const rows = q
    ? LANGS.filter((l) => `${l.native} ${l.label} ${l.code}`.toLowerCase().includes(q))
    : LANGS;
  if (!rows.length) return '<div class="lang-none">—</div>';
  return rows.map((l) => `
    <button class="lang-item${l.code === state.lang ? ' active' : ''}" data-lang="${l.code}">
      <span>${l.native}</span><span class="code">${l.code.toUpperCase()}</span>
    </button>`).join('');
}

function buildLangMenu(filter = '') {
  const menu = $('langMenu');
  if (!menu.querySelector('.lang-search')) {
    menu.innerHTML = '<input class="lang-search" type="text" spellcheck="false"><div class="lang-list"></div>';
    const box = menu.querySelector('.lang-search');
    box.oninput = () => { menu.querySelector('.lang-list').innerHTML = langRows(box.value); };
    box.onclick = (e) => e.stopPropagation();
  }
  const box = menu.querySelector('.lang-search');
  box.placeholder = t('setLang') + ' · ' + LANGS.length;
  box.value = filter;
  menu.querySelector('.lang-list').innerHTML = langRows(filter);
  return box;
}

$('langBtn').onclick = (e) => {
  e.stopPropagation();
  const box = buildLangMenu('');
  const menu = $('langMenu');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    box.focus();
    // Keep the current language in view when the list opens unfiltered.
    const active = menu.querySelector('.lang-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
};

$('langMenu').onclick = async (e) => {
  const item = e.target.closest('.lang-item');
  if (!item) return;
  $('langMenu').classList.add('hidden');
  applyLang(item.dataset.lang);
  await window.lab.setLang(state.lang);
  // The main process has no translations, so the tray menu is told what to say.
  window.lab.setTrayLabels({ show: t('trayShow'), quit: t('trayQuit') });
};

document.addEventListener('click', () => {
  $('langMenu').classList.add('hidden');
  // The executable menu lives inside the sheet, so it is rebuilt often; look it
  // up each time rather than holding a reference.
  const exeMenu = $('exeMenu');
  if (exeMenu) {
    exeMenu.classList.add('hidden');
    $('exeSelect').classList.remove('open');
    $('exeSelect').setAttribute('aria-expanded', 'false');
  }
});

$('winMin').onclick = () => window.lab.window('minimize');
$('winClose').onclick = () => window.lab.window('close');

$('themeBtn').onclick = () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  paintBrand();
  window.lab.setTheme(state.theme);
};

$('browseBtn').onclick = async () => {
  const dir = await window.lab.addGame();
  if (dir) { show('home'); pickGame(dir); }
};
$('addGame').onclick = async () => { const d = await window.lab.addGame(); if (d) load(); };
$('addFolder').onclick = async () => { if (await window.lab.addFolder()) load(); };
$('rescan').onclick = async () => {
  for (const g of state.games) g.cached = null;
  await load();
};
$('clearLog').onclick = () => { state.log = []; renderLog(); };
$('copyLog').onclick = () => copyText(state.log.map(e => `[${e.t}] ${e.m}`).join('\n'));
$('copyHistory').onclick = () => copyText(historyText());

const cardActionsBusy = new Set();
let contextMenuOpen = false;

// HDR (RenoDX game mod from RenoDX's own catalogue) and extra ReShade add-ons
// for a game this app set up with ReShade. Both are tracked in the game's
// backup, so Restore removes them too.
async function renderExtras(dir) {
  const box = $('sheetExtras');
  if (!box || !window.lab.gameExtras) return;
  box.innerHTML = '';
  let info = null;
  try { info = await window.lab.gameExtras(dir); } catch { return; }
  if (!$('sheetExtras') || sheetGame?.dir !== dir) return;
  if (!info || !info.ok) {
    box.innerHTML = `<div class="extras-card"><b>${esc(t('hdrTitle'))}</b><p class="dim">${esc(t('hdrNeedsReShade'))}</p></div>`;
    return;
  }
  const mods = info.mods || [];
  const hdrHtml = info.catalogError ? `<p class="dim">${esc(t('hdrOffline'))}</p>`
    : !mods.length ? `<p class="dim">${esc(t('hdrNone'))}</p>`
    : mods.map((m) => `
      <div class="extra-row${m.installed ? ' on' : ''}">
        <div class="extra-info"><b>${esc(m.title)}${m.variant ? ' · ' + esc(m.variant) : ''}</b>
          <span>${esc(t('hdrBy', (m.maintainers || []).join(', ') || '?'))}${m.status ? ' · ' + esc(m.status) : ''}${m.installed ? ' · ' + esc(t('hdrInstalled')) : ''}</span>
          ${(m.notes || []).map((n) => `<span class="extra-note">${esc(n)}</span>`).join('')}
          ${m.apiMismatch ? `<span class="extra-warn">${esc(t('hdrApiMismatch', m.api))}</span>` : ''}
          ${m.nexusOnly ? `<span class="extra-note">${esc(t('hdrNexusOnly'))}</span>`
            : !m.artifact ? `<span class="extra-warn">${esc(t('hdrNoArch', info.bits))}</span>` : ''}</div>
        <div class="extra-acts">${m.installed
          ? (m.ours ? `<button class="ghost sm" data-x-act="remove" data-x-name="${esc(m.artifact)}">${esc(t('hdrRemove'))}</button>` : `<span class="dim">${esc(t('hdrYours'))}</span>`)
          : m.artifact ? `<button class="glass-btn sm" data-x-act="hdr" data-x-name="${esc(m.artifact)}">${esc(t('hdrInstall'))}</button>`
          : m.nexusOnly && m.nexus ? `<button class="ghost sm" data-x-act="nexus" data-x-name="${esc(m.nexus)}">${esc(t('hdrOpenNexus'))}</button>` : ''}</div>
      </div>`).join('');
  const hdrNames = new Set(mods.map((m) => String(m.artifact || '').toLowerCase()));
  const others = (info.addons || []).filter((a) => !hdrNames.has(a.name.toLowerCase()));
  const addHtml = others.map((a) => `
      <div class="extra-row on"><div class="extra-info"><b>${esc(a.name)}</b><span>${esc(t(a.ours ? 'gaOurs' : 'gaForeign'))}</span></div>
        <div class="extra-acts">${a.ours ? `<button class="ghost sm" data-x-act="remove" data-x-name="${esc(a.name)}">${esc(t('hdrRemove'))}</button>` : ''}</div></div>`).join('');
  box.innerHTML = `
    <div class="extras-card">
      <div class="extras-head"><b>${esc(t('hdrTitle'))}</b><span class="dim">${esc(t('hdrHint'))}</span></div>
      ${hdrHtml}
      <div class="extras-head sub"><b>${esc(t('gaTitle'))}</b>
        <button class="ghost sm" data-x-act="add">${esc(t('gaAdd'))}</button></div>
      ${addHtml || `<p class="dim">${esc(t('gaNone'))}</p>`}
    </div>`;
  box.onclick = (e) => {
    const b = e.target.closest('[data-x-act]');
    if (b) extrasAction(dir, b.dataset.xAct, b.dataset.xName);
  };
}
async function extrasAction(dir, act, name) {
  if (act === 'nexus') { window.lab.openNexus(name); return; }
  if (jobRunning) return;
  const box = $('sheetExtras');
  box?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  let answer = null;
  try {
    if (act === 'hdr') { log(t('hdrDownloading', name)); answer = await window.lab.hdrInstall(dir, name); }
    else if (act === 'add') answer = await window.lab.gameAddonAdd(dir, t('gaAdd'));
    else if (act === 'remove') answer = await window.lab.gameAddonRemove(dir, name);
  } catch (error) { answer = { ok: false, message: error.message }; }
  if (answer && answer.ok) {
    if (act === 'hdr') log(t('hdrDone', answer.name));
    else if (act === 'add') log(t('gaDone', answer.name));
    else log(t('gaRemoved', name));
  } else if (answer && !answer.cancelled) {
    log(t('extrasFailed', answer.code ? t(answer.code, answer.params || {}) : (answer.message || '?')));
  }
  renderExtras(dir);
}

// Starts the game the way its launcher would (Steam/Epic link, otherwise the
// game's own exe). Nothing is installed or changed. Not while an install or
// restore is running, because the files are in flux.
async function playGame(dir, button) {
  const game = state.games.find(g => g.dir === dir);
  if (!game) return;
  if (jobRunning) { log(t('playBusy')); return; }
  if (button) button.disabled = true;
  try {
    const answer = await window.lab.launchGame(dir);
    if (answer?.ok) log(t('playStarted', game.name));
    else log(t('playFailed', game.name, answer?.message || ''));
  } catch (error) {
    log(t('playFailed', game.name, error.message));
  } finally {
    if (button) setTimeout(() => { button.disabled = false; }, 2500);
  }
}

async function performGameAction(action, dir) {
  if (action === 'play') return playGame(dir);
  if (!['details', 'open', 'copy', 'restore', 'scan', 'poster', 'hide'].includes(action)) return;
  const game = state.games.find(g => g.dir === dir);
  if (!game) return;
  if (!['open', 'copy'].includes(action) && (jobRunning || cardActionsBusy.size)) return;
  if (action === 'copy') return copyText(dir);
  const locksCard = action !== 'open';
  if (locksCard) cardActionsBusy.add(dir);
  try {
    if (action === 'details') {
      await openSheet(dir);
    } else if (action === 'open') {
      const error = await window.lab.open(dir);
      if (error) throw new Error(error);
    } else if (action === 'restore') {
      // The native menu already requested confirmation. Re-read the actual
      // backup before reusing the existing guarded restore/history/log flow.
      await openSheet(dir);
      if (jobRunning || sheetGame !== game) return;
      if (!sheetDetails?.hasBackup) throw new Error(t('menuNoBackup'));
      await runJob('restore', dir);
    } else if (action === 'scan') {
      const scan = await window.lab.scan(dir);
      if (state.games.includes(game)) game.cached = scan;
      renderGames();
      renderRecent();
      log(t('menuScanned', game.name));
    } else if (action === 'poster') {
      const url = await window.lab.setPoster(dir);
      if (url && state.games.includes(game)) {
        game.poster = { url, tall: true, custom: true };
        renderGames();
        renderRecent();
      }
    } else if (action === 'hide') {
      if (!await ask({
        icon: 'hide', title: t('hideTitle'), body: t('hideConfirm', game.name),
        confirm: t('menuHide'), cancel: t('cancel')
      })) return;
      await window.lab.hide(dir);
      state.games = state.games.filter(g => g.dir !== dir);
      renderGames();
      renderRecent();
    }
  } catch (error) {
    log(t('menuActionFailed', game.name, error.message));
  } finally {
    if (locksCard) cardActionsBusy.delete(dir);
  }
}

// The right-click menu, drawn here rather than by the operating system: a
// native menu cannot carry the game's own art, an icon per line, or the app's
// own edges. It resolves to the same action names the native one returned, so
// nothing that acts on the result had to change.
const MENU_ICON = {
  details: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h4M9 17h3"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  copy: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  scan: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>',
  poster: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  hide: '<path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.2A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7a11 11 0 0 1-2.4 3.6M6.3 6.4A11.6 11.6 0 0 0 3 12c0 2.5 4 7 9 7a9.7 9.7 0 0 0 3.3-.6"/>'
};
// Order, and where a rule falls between groups.
const MENU_ITEMS = [['details'], ['open', 'copy'], ['scan', 'poster', 'restore'], ['hide']];

// Two letters when a game has no art, so the head is never an empty square.
const menuInitials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

function closeGameMenu() {
  const menu = $('gameMenu');
  menu.classList.add('hidden');
  menu.setAttribute('aria-hidden', 'true');
  menu.innerHTML = '';
}

// Resolves to an action name, or null when it is dismissed.
function showGameMenu(game, position, { busy = false } = {}) {
  return new Promise(resolve => {
    const menu = $('gameMenu');
    const labels = {
      details: t('menuDetails'), open: t('menuOpen'), copy: t('menuCopyPath'), scan: t('menuScan'),
      poster: t('menuPoster'), restore: t('restore'), hide: t('menuHide')
    };
    const disabled = new Set(busy ? ['scan', 'poster', 'restore', 'hide'] : []);
    const hidden = new Set();

    const art = game.poster && game.poster.url;
    menu.innerHTML = `
      <div class="ctx-head">
        <span class="ctx-art">${art ? `<img src="${esc(art)}" alt="">` : `<i>${esc(menuInitials(game.name))}</i>`}</span>
        <span class="ctx-name"><b>${esc(game.name)}</b>${game.summary ? `<small>${esc(game.summary)}</small>` : ''}</span>
      </div>
      ${MENU_ITEMS.map(group => `<div class="ctx-group">${group.filter(id => !hidden.has(id)).map(id => `
        <button type="button" role="menuitem" data-menu="${id}"${disabled.has(id) ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true">${MENU_ICON[id]}</svg>
          <span>${esc(labels[id])}</span>
          ${id === 'details' ? '<svg class="ctx-go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>' : ''}
        </button>`).join('')}</div>`).join('')}`;

    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    // Placed after it is measurable, and never off the edge of the window.
    const box = menu.getBoundingClientRect();
    const x = Math.max(8, Math.min(position.x, window.innerWidth - box.width - 8));
    const y = Math.max(8, Math.min(position.y, window.innerHeight - box.height - 8));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const first = menu.querySelector('button:not([disabled])');
    if (first) first.focus({ preventScroll: true });

    const finish = (action) => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      closeGameMenu();
      resolve(action);
    };
    const onOutside = (event) => { if (!menu.contains(event.target)) finish(null); };
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); finish(null); } };
    const onBlur = () => finish(null);
    menu.onclick = (event) => {
      const item = event.target.closest('[data-menu]');
      if (item && !item.disabled) finish(item.dataset.menu);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
  });
}

async function openGameMenu(card, position) {
  if (contextMenuOpen) return;
  const dir = card.dataset.dir;
  if (!state.games.some(game => game.dir === dir)) return;
  contextMenuOpen = true;
  const game = state.games.find(item => item.dir === dir);
  try {
    const action = await showGameMenu(game, position, { busy: jobRunning || cardActionsBusy.size > 0 });
    // The native menu used to ask before a restore. It still gets asked.
    if (action === 'restore' && !await ask({
      icon: 'restore', tone: 'accent', title: t('menuConfirmRestore'),
      body: t('menuRestoreHint'), confirm: t('restore'), cancel: t('cancel')
    })) return;
    if (action) await performGameAction(action, dir);
  } catch (error) {
    log(t('menuActionFailed', card.getAttribute('aria-label'), error.message));
  } finally {
    contextMenuOpen = false;
    // Avoid stealing focus from the game sheet or a confirmation dialog.
    if ($('overlay').classList.contains('hidden') && card.isConnected) card.focus({ preventScroll: true });
  }
}

// The pinned games heading grows a hairline only once something has scrolled
// under it, so a page that fits on screen has no stray line across it.
{
  const view = $('view-games');
  const head = view && view.querySelector('.games-heading');
  if (view && head) {
    const mark = () => head.classList.toggle('stuck', view.scrollTop > 4);
    view.addEventListener('scroll', mark, { passive: true });
    mark();
  }
}

for (const container of [$('groups'), $('recents')]) {
  container.oncontextmenu = event => {
    const card = event.target.closest('.card, .rcard');
    if (!card) return;
    event.preventDefault();
    return openGameMenu(card, { x: event.clientX, y: event.clientY });
  };
  container.addEventListener('keydown', event => {
    const card = event.target.closest('.card, .rcard');
    if (!card || event.target.closest('button')) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      openGameMenu(card, { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + Math.min(24, rect.height / 2), keyboard: true });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      performGameAction('details', card.dataset.dir);
    }
  });
}

$('groups').onclick = async (event) => {
  if (event.target.closest('[data-ready-filter]')) {
    filters.dlss = filters.dlss === 'ready' ? 'all' : 'ready';
    renderGames();
    return;
  }
  const card = event.target.closest('.card');
  if (!card) return;
  const dir = card.dataset.dir;
  const act = event.target.closest('.tool, .card-play')?.dataset.act;

  await performGameAction(act || 'details', dir);
};

$('recents').onclick = (e) => {
  const card = e.target.closest('.rcard');
  if (card) return performGameAction('details', card.dataset.dir);
};

$('overlay').onclick = (e) => { if (e.target === $('overlay')) closeSheet(); };
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('dlgOverlay').classList.contains('hidden')) closeDialog();
  else closeSheet();
});
// Most job events are progress markers read as codes. The few that are
// advice for the person are shown in their language instead.
// DirectX 11 games that ignore dxgi.dll (#328), and the wrapped DirectX 8/9
// ones that become DirectX 11 inside dgVoodoo (#343).
const RESHADE_PROXY_APIS = ['dxgi', 'd3d8', 'd3d9', 'ddraw'];
const SPOKEN_JOB_CODES = new Set(['upliftDownloading', 'upliftReady', 'historySaveWarning', 'driverNeuralFault', 'oldShaderCompiler', 'overlaySkipped', 'feedVkLayerReady', 'neuralModelKept', 'rivalConsumerSetAside', 'overlayNotForRoute', 'multipassNext', 'forwarderRetired', 'optiDownloading', 'optiVerified', 'restoreRecovered', 'legacyNrUsed', 'nrOldCard', 'portUsed', 'portModelReplaced', 'feederLeftover', 'extraAddonKept', 'sfToggleInstalled']);
window.lab.onJob((e) => jobLog(SPOKEN_JOB_CODES.has(e.code)
  ? t(e.code, ...Object.values(e.params || {}))
  : `${e.code} ${JSON.stringify(e.params)}`));

const zone = $('dropZone');
['dragenter', 'dragover'].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.add('over'); }));
['dragleave', 'drop'].forEach((n) => zone.addEventListener(n, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
zone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const dir = window.lab.pathForFile(f);
  if (dir) pickGame(dir);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

(async () => {
  const boot = await window.lab.boot();
  state.theme = boot.theme || 'light';
  state.skin = boot.skin === 'two' ? 'two' : 'one';
  state.groupGamesByStore = boot.groupGamesByStore !== false;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.skin = state.skin;
  state.rail = boot.rail === 'on' ? 'on' : 'off';
  syncSkinChrome();
  applyLang(boot.lang || 'en');
  if ($('aboutVersion')) $('aboutVersion').textContent = `v${boot.version}`;
  // Nothing this app installs is on disk. Saying so now beats letting somebody
  // pick a game, choose a route and press Install before finding out (#220).
  if (boot.payloadMissing) log(typeof boot.payloadMissing === 'string' ? boot.payloadMissing : t('errPayloadMissing', boot.payloadMissing.params || {}));
  // Components tab: banner on the home view when files are missing.
  try { wireComponents(); refreshComponents(); } catch { /* the tab still works on its own */ }
  // AMD Radeon / Intel Arc: the route policy switches to the vendor-neutral
  // DLSS 5 port before any game sheet is drawn.
  try {
    state.gpuMode = await window.lab.gpuMode();
    if (state.gpuMode && state.gpuMode.vendorNeutral) {
      window.installRoutes.setVendorNeutral(true);
      log(t(state.gpuMode.mode === 'intel' ? 'gpuModeIntel' : 'gpuModeAmd', state.gpuMode.names || '?'));
    }
  } catch { /* NVIDIA policy stays */ }
  // The Components list defaults to the detected card, known only now.
  try { paintCompBanner(); paintCompNav(); if (document.getElementById('view-components')?.classList.contains('active')) paintComponents(); } catch { /* repainted on the next visit */ }
  showUpdateNotice();
  state.logo = boot;
  paintBrand();
  state.art = (await window.lab.artStatus()).available;
  // Artwork comes from Steam's public store endpoints, so there is nothing to
  // configure and nothing for the reader to act on.
  renderLog();
  load();
})();
