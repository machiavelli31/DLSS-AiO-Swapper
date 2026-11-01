'use strict';

// The two RenoDX neural consumers this app installs, pinned by release URL and
// by digest exactly like the Feeder. Until now they had to be sitting beside
// the source tree with the right digest, because nobody published them as
// downloads; the RHI repository - the same one the Feeder's own installer
// pulls from - publishes both, so a build machine no longer needs a copy on
// its desktop. The local file is still accepted as a fallback.
//
// The generic build is what every route installs. The DLSS Tool build REPLACES
// it on the multipass route rather than joining it: two neural consumers in one
// game leave the tickbox saying yes while the picture says no.
const CONSUMER = Object.freeze({
  // lecram's generic DLSS5 add-on. 8.5 adds the Look controls (colour, tone,
  // detail, halo), detail stability, up to four passes and crash containment;
  // it still reads NRPreset, so the model A/B switch keeps working.
  version: '8.5.0-rc10',
  file: 'renodx-dlss5.addon64',
  archive: Object.freeze(['renodx-dlss5_8.5.0-rc10.zip', 'https://github.com/RankFTW/rhi-repo/releases/download/renodx-dlss5-8.5.0-rc10/renodx-dlss5_8.5.0-rc10.zip', 'a745040cb2e93e3a1500a6c5a322972acc4c5c667108fcea31c748285d6364a9']),
  size: 3141632,
  sha256: 'dcd93881e976ad033d83c2bb01f4bc3e4ddc59c15fe0dd4ca165bc5fc7d1ac68'
});
// ShortFuse's DLSS Tool build, carrying DirectNeuralRenderingPassCount (#251).
// 26.1016 adds its own model choice (DirectNeuralRenderingPreset: Default /
// Preset A / Preset B), Tone and Character Intensity and a host transport for
// D3D9 / OpenGL.
const MULTIPASS = Object.freeze({
  version: 'SF 26.1016.1304',
  file: 'renodx-dlss.addon64',
  archive: Object.freeze(['renodx-dlss_SF_26.1016.1304.zip', 'https://github.com/RankFTW/rhi-repo/releases/download/renodx-dlss-SF-26.1016.1304/renodx-dlss_SF_26.1016.1304.zip', 'bc4ec58d31565f6919c4e0c1aad8d8ea6443199e12b54f9e019b2ffd8afaaabf']),
  size: 3333632,
  sha256: 'a8fd34b531fd22c3dbd008ed8fd3cbfcca2fb451729e19cd1fc2e4c85b5068d4'
});
// Every neural evaluate faults inside NVIDIA's own NGX runtime on driver
// 616.64 and newer with the 4.x consumers - measured upstream across three
// machines and reported as DLSS5-Feeder #54. The 6.x line passes the same
// self-test 300/300 on 617.14, so the warning belongs to the build rather than
// to the driver: it is raised only when the consumer being installed is one of
// these. Keyed by digest, because that is the only thing a build cannot lie
// about.
const FAULTING = Object.freeze({
  'd5adf82eb44b065f4c590ac91fe824bab07afea0eb9f994bde936710c8593952': '4.70',
  '9150097cdee2953cdc9894d2e5606ea5100e6c8f95fc7bb1b407328b4391a07a': '4.55',
  '87aef9ddd937c7241e6bf8d8efea0045d63559135e254c60dab316db3d3a4aee': '4.x'
});
// Every add-on build this app has shipped as its built-in choice. "Update
// installed DLSS 5" only swaps files with one of these digests (or an own build
// imported through the app), never something placed by hand.
const SHIPPED = Object.freeze([
  CONSUMER.sha256,
  MULTIPASS.sha256,
  '1310119c87e4ab5ad0af41511411bd4608ff3c3030a29196ae0e4bba32c84585', // DLSS Tool SF 26.1003.2350 (3.0.5 - 3.0.13)
  '342341f669f1d64e0c70c8593a07a2fab5075e073dfae97c331c9a6776260a0a' // RenoDX DLSS5 6.5.3 (3.0.0 - 3.0.4)
]);
module.exports = { CONSUMER, MULTIPASS, FAULTING, SHIPPED, faults: (sha256) => Boolean(FAULTING[String(sha256).toLowerCase()]) };
