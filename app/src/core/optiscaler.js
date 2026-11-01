'use strict';

const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');
const pe = require('./pe');
const ini = require('./feeder-config');
const { cached, fetchVerified } = require('./runtime-components');
const { safePath } = require('./file-journal');
// More than one pinned build, because upgrading one broke a game and there was
// no way back: No Man's Sky runs on 0.1.1.5 and crashes on 0.2.0-patch1, and
// the only cure anybody had was to keep an old copy of the whole app (#238).
//
// This is not the "put your own DLL in the components folder" that #191 asked
// for and that the folder deliberately refuses. Every entry here is pinned by
// URL and by digest exactly as the single one was; there is simply more than
// one, and a game may name it. Nothing unverified becomes installable.
//
// Two lineages, not one line of versions. Dagherbou's build reaches the model
// through a small forwarder DLL and carries its own colour work - the highlight
// proxy, multi-point exposure calibration, the game's live exposure. wilsjo2's
// pre-SR fork runs the model before the upscaler with independent controls per
// pass, squeezes the periphery to spend less on it, and rebuilds lighting and
// colour when the model runs below 100%; it opens the runtime directly, so it
// has no forwarder at all - and a leftover one from the other build stops its
// pass without saying so, which is why installing it clears one away. The build
// pinned here is the DLSS5-Feeder author's fork of it, which fixes what the
// model is handed below 100% and the motion-vector scale in games that upscale,
// the two things that made every resolution under 100% flicker.
const FORWARDED = Object.freeze({
  forwarder: 'nvngx.dll_dlssnr.dll',
  notes: 'READ ME - DLSS Neural Rendering.txt',
  licenses: Object.freeze(['DirectX_LICENSE.txt', 'FidelityFX_v2_LICENSE.md', 'RenoDX_ATTRIBUTION.txt', 'XeSS_LICENSE.txt'])
});
const DIRECT = Object.freeze({
  forwarder: null,
  notes: 'INSTALL-DLSSNR.md',
  // Its GPL text rides in the archive rather than being fetched beside it.
  gpl: 'LICENSE',
  licenses: Object.freeze(['DirectX_LICENSE.txt', 'FidelityFX_v1_LICENSE.md', 'FidelityFX_v2_LICENSE.md',
    'PeripheralWarp_LICENSE.txt', 'RenoDX_ATTRIBUTION.txt', 'XeSS_LICENSE.txt'])
});
// janblade's F5 fork (GPL-3.0). Same forwarder lineage, but it also publishes
// an optional vendor-neutral forwarder that runs the DLSS 5 network itself on
// D3D12 compute + DirectML instead of NVIDIA's NGX core - the only way the model
// runs on AMD Radeon and Intel Arc. It reads the weights from NVIDIA's own,
// signed nvngx_dlssnr.dll and needs 310.9 or newer (it runs 310.9's small
// network = model B). Upstream says it was exercised on NVIDIA with the port
// forced in, not yet on real AMD/Intel hardware: the route is experimental.
const F5 = Object.freeze({
  forwarder: 'nvngx.dll_dlssnr.dll',
  notes: 'INSTALL-DLSSNR.md',
  gpl: 'LICENSE',
  licenses: Object.freeze(['DirectX_LICENSE.txt', 'FidelityFX_v2_LICENSE.md', 'PeripheralWarp_LICENSE.txt', 'RenoDX_ATTRIBUTION.txt', 'XeSS_LICENSE.txt'])
});
const PORT = Object.freeze({
  url: 'https://github.com/janblade/OptiScaler-F5-DLSSNR-Multipass/releases/download/v0.1.35.1/Optional-Vendor-Neutral-DLSS5-Forwarder.zip',
  sha256: '74a24eb103ef05a54ede6598d70f4c7093a2c683f59c40972d7a635e36ce8ae9',
  files: Object.freeze({
    'nvngx.dll_dlssnr.dll': '30aefc7aa19399c2905bfa64f69cca7eb1574135425d905c0e2f052fc523099c',
    'nr_port.ini': '61d305b3631a7b9f7252fcdb6eeccc6f4663e89c806872e66266918cf15c7020',
    'README-Vendor-Neutral-Port.txt': '12681eb33d63f1c8f03e4e77c3df24c8cdf7ddece9cb1b32e6004f13a825e08a'
  }),
  // The port reads the 310.9 small network; an older model file runs the big
  // one, slowly.
  minModel: '310.9'
});
const F5_RELEASE = Object.freeze({
  version: '0.1.35.1-f5',
  label: '0.1.35.1 - F5 (janblade)',
  url: 'https://github.com/janblade/OptiScaler-F5-DLSSNR-Multipass/releases/download/v0.1.35.1/OptiScaler-DLSSNR-F5-v0.1.35.1-with-dlss-fg.zip',
  sha256: '29532c7dff93a7171e5825238fc0bdd0cfb9828cde7d4fcef5608537d589dc23',
  layout: F5,
  port: PORT
});
const RELEASES = Object.freeze([
  Object.freeze({
    version: '0.2.0-patch1',
    url: 'https://github.com/Dagherbou/OptiScaler_DLSSNR/releases/download/v0.2.0-patch1/OptiScaler-DLSSNR-v0.2.0-onimusha-fix.zip',
    sha256: '5db547216fa8a7dbd8ab0a193da1e3bce0ea4bd71f91189afa4ed2ede8bb9561',
    licenseUrl: 'https://raw.githubusercontent.com/Dagherbou/OptiScaler_DLSSNR/393e070/LICENSE',
    licenseHash: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986',
    layout: FORWARDED
  }),
  // The pre-SR multipass fork, pinned at the Feeder author's fixed build.
  Object.freeze({
    version: '0.8.92-presr',
    label: '0.8.92 - pre-SR multipass',
    url: 'https://github.com/jlrouzies-fr/OptiScaler-DLSSNR-PreSR-Multipass/releases/download/v0.8.92/OptiScaler-NR-v0.8.92.zip',
    sha256: '9605352af2378eeb5ef96aedf69c648b36152eea40a388cb5413ca6a408bf728',
    layout: DIRECT
  }),
  // What 2.2.1 shipped. Same archive layout, so it satisfies the same
  // validation; kept for the titles the newer build regressed on.
  Object.freeze({
    version: '0.1.1.5-dlssnr',
    url: 'https://github.com/Dagherbou/OptiScaler_DLSSNR/releases/download/v0.1.1.5-dlssnr/OptiScaler-DLSSNR-v0.1.1.5-dlssnr.zip',
    sha256: '735b10b4077bc187ba4d07d607e864349aca386344c6126aba61ced746d27ece',
    licenseUrl: 'https://raw.githubusercontent.com/Dagherbou/OptiScaler_DLSSNR/393e070/LICENSE',
    licenseHash: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986',
    layout: FORWARDED
  }),
  F5_RELEASE
]);
const RELEASE = RELEASES[0];
// An unknown name resolves to the current build rather than failing: a state
// file naming a version this app no longer carries must not stop an install.
const releaseFor = (version) => RELEASES.find((r) => r.version === version) || RELEASE;
const LIBRARIES = [
  'libxess.dll', 'libxess_dx11.dll', 'libxess_fg.dll', 'libxell.dll',
  'amd_fidelityfx_vk.dll', 'amd_fidelityfx_upscaler_dx12.dll',
  'amd_fidelityfx_loader_dx12.dll', 'amd_fidelityfx_framegeneration_dx12.dll',
  'D3D12_OptiScaler/D3D12Core.dll'
];
// The GPL text is written under one name whichever build supplied it.
const GPL_AS = 'OptiScaler/licenses/LICENSE.GPL-3.0.txt';
function fail(code, message = code) { return Object.assign(new Error(message), { code }); }
function versionAtLeast(version, min) {
  const a = String(version || '0').split('.').map(Number);
  const b = String(min).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}
function validatePayload(root, release = RELEASE) {
  const layout = release.layout;
  for (const rel of ['OptiScaler.dll', layout.forwarder, ...LIBRARIES.map(f => 'OptiScaler/' + f)].filter(Boolean)) {
    if (pe.getBitness(safePath(root, rel)) !== 64) throw fail('errOptiPayload');
  }
  for (const rel of ['OptiScaler.ini', layout.notes, layout.gpl, ...layout.licenses.map(f => 'Licenses/' + f)].filter(Boolean)) {
    if (!fs.existsSync(safePath(root, rel))) throw fail('errOptiPayload');
  }
}
const crypto = require('crypto');
const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// The vendor-neutral forwarder, fetched beside the build that publishes it.
async function ensurePort(cacheRoot, release) {
  const port = release.port;
  if (!port) throw fail('errOptiNoPort');
  const base = path.join(path.resolve(cacheRoot), 'components', `OptiScaler-${release.version}-port`);
  const archive = base + '.zip';
  if (!cached(archive, port.sha256)) await fetchVerified(port.url, port.sha256, archive);
  await extractZip(archive, { dir: base });
  for (const [name, sha] of Object.entries(port.files)) {
    const file = safePath(base, name);
    if (!fs.existsSync(file) || sha256Of(file) !== sha) throw fail('errOptiPayload');
  }
  if (pe.getBitness(safePath(base, release.layout.forwarder)) !== 64) throw fail('errOptiPayload');
  return base;
}
async function ensureOptiScaler(cacheRoot, version, opts = {}) {
  const release = opts.vendorNeutral ? F5_RELEASE : releaseFor(version);
  const base = path.join(path.resolve(cacheRoot), 'components', `OptiScaler-${release.version}`);
  const archive = base + '.zip';
  if (!cached(archive, release.sha256)) await fetchVerified(release.url, release.sha256, archive);
  // Re-extract verified bytes on every install. The installer below copies an
  // explicit file list, not unknown files that may have appeared in the cache.
  await extractZip(archive, { dir: base });
  // One build publishes its licence beside the archive; the other carries it
  // inside. Either way what reaches the game is verified bytes.
  if (release.licenseUrl) {
    const license = path.join(base, 'OptiScaler-GPL-3.0.txt');
    if (!cached(license, release.licenseHash)) await fetchVerified(release.licenseUrl, release.licenseHash, license);
  }
  validatePayload(base, release);
  if (opts.vendorNeutral) await ensurePort(cacheRoot, release);
  return base;
}
const portRoot = (optiRoot) => optiRoot + '-port';
function hookFor(api) { return api === 'vulkan' ? 'winmm.dll' : 'dxgi.dll'; }
function configure(text, target) {
  let out = text;
  // On AMD/Intel, OptiScaler's own GPU spoofing ('auto') is what lets a game
  // offer DLSS at all; on NVIDIA it stays off as before.
  for (const [section, key, value] of [
    ['DlssNr', 'Enabled', 'true'], ['Log', 'LogToFile', 'true'], ['Log', 'LogLevel', '2'],
    ['Spoofing', 'Dxgi', target.vendorNeutral ? 'auto' : 'false'], ['Plugins', 'LoadAsiPlugins', 'false'],
    ['ProcessFilter', 'TargetProcessName', path.basename(target.exePath)]
  ]) out = ini.setIni(out, section, key, value);
  if (target.vendorNeutral) {
    // NVIDIA's DLSS upscaler cannot run without NGX: hand the game's DLSS/FSR/
    // XeSS calls to FidelityFX, and to its D3D12 bridge on DX11/Vulkan.
    out = ini.setIni(out, 'Upscalers', 'Dx12Upscaler', 'ffx');
    out = ini.setIni(out, 'Upscalers', 'Dx11Upscaler', 'ffx_12');
    out = ini.setIni(out, 'Upscalers', 'VulkanUpscaler', 'ffx_12');
    return out;
  }
  // DX11/Vulkan NR needs the documented D3D12 bridge, not native DLSS output.
  // Set defaults for all APIs: games can change renderer via launch arguments
  // without changing their executable's import table or scanner result.
  for (const field of ['Dx12Upscaler', 'Dx11Upscaler', 'VulkanUpscaler']) {
    const current = ini.getIni(out, 'Upscalers', field);
    const bridge = field !== 'Dx12Upscaler';
    if (!current || current === 'auto' || (bridge && !current.endsWith('_12'))) {
      out = ini.setIni(out, 'Upscalers', field, bridge ? 'ffx_12' : 'dlss');
    }
  }
  return out;
}
function copyPlan(root, api, release = RELEASE, vendorNeutral = false) {
  const layout = release.layout;
  const port = vendorNeutral && release.port ? portRoot(root) : null;
  return [
    ['OptiScaler.dll', hookFor(api)],
    ...(layout.forwarder && !port ? [[layout.forwarder, layout.forwarder]] : []),
    ...(port ? [[path.relative(root, path.join(port, layout.forwarder)), layout.forwarder],
      [path.relative(root, path.join(port, 'nr_port.ini')), 'nr_port.ini'],
      [path.relative(root, path.join(port, 'README-Vendor-Neutral-Port.txt')), 'OptiScaler/README-Vendor-Neutral-Port.txt']] : []),
    ...LIBRARIES.map(f => ['OptiScaler/' + f, 'OptiScaler/' + f]),
    ...layout.licenses.map(f => ['Licenses/' + f, 'OptiScaler/licenses/' + f]),
    [layout.gpl || 'OptiScaler-GPL-3.0.txt', GPL_AS],
    [layout.notes, 'OptiScaler/README-DLSSNR.txt']
  ].map(([from, to]) => ({ from: from.startsWith('..') ? path.resolve(root, from) : safePath(root, from), to }));
}
function checkConflicts(gameDir, exePath, manifest, api) {
  // Inspect the baseline too: switching restores it before installing. Never
  // silently clobber another proxy, OptiScaler install or ASI loader.
  const { originalPath } = require('./apply');
  const exeDir = path.dirname(exePath);
  const added = new Set((manifest?.added || []).map(f => f.toLowerCase()));
  const replacements = new Map((manifest?.replaced || []).map(f => [f.rel.toLowerCase(), f]));
  const names = new Set([...fs.readdirSync(exeDir), 'dxgi.dll', 'winmm.dll', 'OptiScaler.ini']);
  const hook = hookFor(api);
  for (const name of names) {
    if (!/^(?:dxgi|winmm|version|dbghelp|dbgcore|d3d12|d3d11|d3d9|opengl32|wininet|winhttp|nvngx|nvapi64|OptiScaler)\.(?:dll|ini|asi)$/i.test(name) && !/\.asi$/i.test(name)) continue;
    const rel = path.relative(gameDir, path.join(exeDir, name));
    if (added.has(rel.toLowerCase())) continue;
    const file = replacements.has(rel.toLowerCase()) ? originalPath(gameDir, manifest, rel) : safePath(gameDir, rel);
    if (!fs.existsSync(file)) continue;
    // A pre-existing ReShade under the selected proxy name can be replaced
    // with a tracked backup. Other proxies require explicit user cleanup.
    if (name.toLowerCase() === hook && pe.versionMentions(file, 'ReShade')) continue;
    // dbghelp/dbgcore are on the list because Ultimate ASI Loader ships under
    // those names - but they are also genuine Windows components that games
    // ship for their own crash reporting. Cyberpunk 2077 carries both, and
    // every OptiScaler install there was refused as "another loader/mod".
    // Microsoft own the real ones; the loaders do not claim to.
    if (/^dbg(?:help|core)\.dll$/i.test(name) && pe.versionMentions(file, 'Microsoft')) continue;
    throw fail('errOptiConflict', `Conflicting pre-existing file: ${path.join(exeDir, name)}. Restore/remove the other mod with its own installer first.`);
  }
  const pluginDir = path.join(exeDir, 'OptiScaler', 'plugins');
  if (fs.existsSync(pluginDir) && fs.readdirSync(pluginDir).some(f => /\.(dll|asi)$/i.test(f))) throw fail('errOptiConflict', 'Existing OptiScaler plugins need to be removed with their original installer first.');
  for (const name of LIBRARIES) {
    const rel = path.relative(gameDir, path.join(exeDir, 'OptiScaler', name));
    if (!added.has(rel.toLowerCase()) && fs.existsSync(safePath(gameDir, rel))) throw fail('errOptiConflict', `Pre-existing OptiScaler component: ${rel}`);
  }
}
// The forwarder belongs to one lineage only. Left beside a build that opens the
// runtime directly, the neural pass quietly does nothing - upstream lists it
// with FinishedPicture and a wrong TargetProcessName as the three settings that
// stop the pass without a word in any log. It is retired the way any replaced
// file is, so Restore originals still puts the game back exactly as it was.
async function retireForwarder(manifest, gameDir, exeDir, log) {
  const { trackBeforeWrite, saveActiveManifest } = require('./apply');
  const file = path.join(exeDir, FORWARDED.forwarder);
  if (!fs.existsSync(file)) return;
  const rel = await trackBeforeWrite(manifest, gameDir, file, { kind: 'optiscaler' });
  await saveActiveManifest(gameDir, manifest);
  await fs.promises.chmod(file, 0o666).catch(() => {});
  await fs.promises.unlink(file);
  log({ code: 'forwarderRetired', params: { rel } });
}
async function install(config, log) {
  const { beginManifest, copyTracked, writeTracked, saveActiveManifest } = require('./apply');
  const { gameDir, exePath, api, optiRoot, source } = config;
  // Which build this game asked for. #238 gave every game its own choice, and
  // the manifest recorded the default no matter what was installed.
  const vendorNeutral = Boolean(config.vendorNeutral);
  const release = vendorNeutral ? F5_RELEASE : releaseFor(config.optiVersion);
  validatePayload(optiRoot, release);
  const nr = source.payload.find(f => f.name.toLowerCase() === 'nvngx_dlssnr.dll');
  if (!nr || pe.getBitness(nr.path) !== 64) throw fail('errNoNeuralRuntime');
  if (vendorNeutral && !versionAtLeast(pe.getFileVersion(nr.path), PORT.minModel)) throw fail('errPortNeedsModel');
  const manifest = beginManifest(gameDir, exePath, api);
  manifest.route = 'optiscaler';
  manifest.game.bitness = 64;
  manifest.game.apiLabel = config.apiLabel;
  manifest.optiscaler = { version: release.version, hook: hookFor(api), vendorNeutral };
  const exeDir = path.dirname(exePath);
  if (!release.layout.forwarder) await retireForwarder(manifest, gameDir, exeDir, log);
  for (const item of copyPlan(optiRoot, api, release, vendorNeutral)) {
    const rel = await copyTracked(manifest, gameDir, item.from, path.join(exeDir, item.to), { kind: 'optiscaler' });
    log({ code: 'added', params: { rel } });
  }
  // The model that ships here is NVIDIA's stock one, which runs on Blackwell.
  // Older architectures need a modded build, supplied by the person for their
  // own card, and copying ours over it would quietly break exactly the setup
  // they came here with. An existing model is left alone; ours is installed
  // only when there is none.
  const model = path.join(exeDir, nr.name);
  if (fs.existsSync(model) && vendorNeutral && !versionAtLeast(pe.getFileVersion(model), PORT.minModel)) {
    // The port would find this older file first and run the big network.
    await copyTracked(manifest, gameDir, nr.path, model, { kind: 'runtime' });
    log({ code: 'portModelReplaced', params: { rel: path.relative(gameDir, model) } });
  } else if (fs.existsSync(model)) {
    log({ code: 'neuralModelKept', params: { rel: path.relative(gameDir, model) } });
  } else {
    await copyTracked(manifest, gameDir, nr.path, model, { kind: 'runtime' });
  }
  const file = path.join(exeDir, 'OptiScaler.ini');
  const prior = config.profile?.[path.relative(gameDir, file)] ?? ini.readText(file);
  await writeTracked(manifest, gameDir, file, configure(prior || ini.readText(path.join(optiRoot, 'OptiScaler.ini')), { ...config, vendorNeutral }), { kind: 'config' });
  await saveActiveManifest(gameDir, manifest);
  return manifest;
}
module.exports = { RELEASE, RELEASES, F5_RELEASE, PORT, ensurePort, releaseFor, LIBRARIES, ensureOptiScaler, validatePayload, configure, copyPlan, hookFor, checkConflicts, install };
