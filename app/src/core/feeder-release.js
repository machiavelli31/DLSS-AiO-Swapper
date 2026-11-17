'use strict';

// One verified release for the shader, both client architectures and helper.
// Never mix host protocol versions: 1.17.0 speaks IPC v11, and a 1.16.x or
// 1.17.0-beta.1 half refuses to talk to it. Both halves ship from this pin, so
// a payload built from here is always a matched pair. 2.0.0 speaks IPC v12
// (the DLSS preset reaches the 32-bit host). Digest supplied by
// GitHub's release API.
module.exports = {
  version: '2.0.0',
  archive: ['DLSS5-Feeder-2.0.0.zip', 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/download/v2.0.0/DLSS5-Feeder-2.0.0.zip', 'fa41fe2c5d3da803688775b802dc373a922daab0e721c8154a17066fcdd62584'],
  // The overlay pins dlss5-feed.addon64 by size and digest before it will
  // drive Feeder's sliders, so the number lives here too and a build-time
  // check holds the two in step. #225 was this pin going stale unnoticed.
  addon64Size: 387584,
  hashes: {
    'dlss5-feed.addon32': '7ec337e0023652655fbf0f40f815bc1b4cd95eec43e1216a681a9ac0bcef2793',
    'dlss5-feed.addon64': 'd2b940c7617f8bc418ee0b02d3aed28cfd58e44e6095f0f862b6ff96a4388ffa',
    'dlss5-feed-host64.exe': '7d360bf6d7b21d2d180346a40d74eafea45581802374225e6d30737fb97bc48f',
    'reshade-shaders/Shaders/DLSS5_Feed.fx': '72f537693374f5d2f63900cccb1cf48dd067dde3ef982c94086c8801448d5f6d',
    // Feeder's own loader layer. A Vulkan game whose driver does not expose
    // the KHR external-interop extensions needs it for one launch.
    'layer-x64/VkLayer_feed_vk.dll': '64b2b8bb81856a5a558f2edd11b8eb303181b3453a4e928743fdadbd3bbd2fbc',
    'layer-x64/VkLayer_feed_vk.json': 'c15967b3f8847a145e21058a1e57e92c595ee17fc5dd23ab3278b0148ad6e9d1',
    'layer-x64/run-with-feed-layer.bat': 'bc9aa7964742e23653556be978f540f503f3cef928b6de7a38f77c570bb764f9',
    'layer-x86/VkLayer_feed_vk32.dll': 'd1d3b4c14810ea757eb83f5e4262c23cd91f44077407f8b805213003efc79792',
    'layer-x86/VkLayer_feed_vk32.json': '28f8174eb8fed02266bafa6910eab07922ec6d2bdb33110699c586f74b254921',
    'layer-x86/run-with-feed-layer32.bat': '75d4584ad01619402a10e0d8342b114613057a1d3b0ac8dbe9280b740090c3e8'
  }
};
