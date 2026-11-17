'use strict';
// Per-file SHA-256 pins for everything the component manager downloads.
// Generated from the verified release archives (each archive digest is pinned
// in components.js too); every value equals the file in the 2.2.9 payload.
module.exports = {
  // sl.* from Streamline 2.13.0.0 - only the plugins the payload uses.
  streamline: {
  'sl.common.dll': 'a4b2b5acbe49fbc6d44dd432cac19cd53218f698b2539dc7ed0fb268c72cfc8d',
  'sl.dlss.dll': '1eb5fb3d6f01d340fe086d981cc2de4f18aa6d05ee276e5cf28ecd54818dcc8b',
  'sl.dlss_g.dll': 'b8b5effd7debdb750abd216de43385fb653261712bc315d85eba68811fb3ee02',
  'sl.dlss_nr.dll': '9f6672e5e0170dc118a3188d21bda187e1fc1aa3502895b21ab846d23165c11d',
  'sl.interposer.dll': '27b2190057994c0b287c2c5716953bf1586f6499ac12fbbb2092b9aaf8396570',
  'sl.nis.dll': '6039e38a1af56c8e86f3e936596e2db910bf3d76bbf4268562a3b13763049dfa',
  'sl.pcl.dll': '12aa4e76c28a27c735e4ecb3072f44d09428acb107b70ac38e4bd48ddb05f88d',
  'sl.reflex.dll': 'ecf12973cdcec2ffced2ea77b1c7e45f4d387e7c864ddb5531b66a6f947effb3'
},
  // License texts placed beside the NVIDIA DLLs (optional, informational).
  streamlineLicenses: [
  [
    'nis.license.txt',
    'https://raw.githubusercontent.com/NVIDIAGameWorks/NVIDIAImageScaling/35e13ba316c98eeecf16f37eae70ce88019911f6/licence.txt',
    '62207f1c0fae72800ea7d28ee108e7dbeb852dde20b00c70fc7b0d235e19e46d'
  ],
  [
    'nvngx_dlss.license.txt',
    'https://raw.githubusercontent.com/NVIDIA/DLSS/9981c6350dc58c0ce21f024fd65e31e851c31689/LICENSE.txt',
    'd4216e39ebef5f9b50a6712ebb37beeb5379862a67733a9999c651f21592aaf0'
  ],
  [
    'reflex.license.txt',
    'https://raw.githubusercontent.com/NVIDIA-RTX/Streamline/e8aaa6eaac968711fb62473d4ae8256dde20919b/external/reflex-sdk-vk/reflex.license.txt',
    'ebf83c07fb3b2939908c3795d887afde3161c89a28ba391724efc784ce1bdabe'
  ]
],
  // DLSS5-Feeder 2.0.0 zip: path inside the zip -> sha256.
  feederZip: {
  'dlss5-feed.addon32': '7ec337e0023652655fbf0f40f815bc1b4cd95eec43e1216a681a9ac0bcef2793',
  'dlss5-feed.addon64': 'd2b940c7617f8bc418ee0b02d3aed28cfd58e44e6095f0f862b6ff96a4388ffa',
  'dlss5-feed-helper.addon64': '39d03c2d489b99a3074d843342bf453fe8fa2ba2781a221cfe803c1a28297298',
  'Verify-DLSS5Feeder.ps1': 'a3b1a4aea238508fb8971d07cb40ece0b37ec512d89b49421a2a0ae3e31f948c',
  'host64/dlss5-feed-host64.exe': '7d360bf6d7b21d2d180346a40d74eafea45581802374225e6d30737fb97bc48f',
  'layer-x64/run-with-feed-layer.bat': 'bc9aa7964742e23653556be978f540f503f3cef928b6de7a38f77c570bb764f9',
  'layer-x64/VkLayer_feed_vk.dll': '64b2b8bb81856a5a558f2edd11b8eb303181b3453a4e928743fdadbd3bbd2fbc',
  'layer-x64/VkLayer_feed_vk.json': 'c15967b3f8847a145e21058a1e57e92c595ee17fc5dd23ab3278b0148ad6e9d1',
  'layer-x86/run-with-feed-layer32.bat': '75d4584ad01619402a10e0d8342b114613057a1d3b0ac8dbe9280b740090c3e8',
  'layer-x86/VkLayer_feed_vk32.dll': 'd1d3b4c14810ea757eb83f5e4262c23cd91f44077407f8b805213003efc79792',
  'layer-x86/VkLayer_feed_vk32.json': '28f8174eb8fed02266bafa6910eab07922ec6d2bdb33110699c586f74b254921',
  'reshade-shaders/Shaders/DLSS5_Feed.fx': '72f537693374f5d2f63900cccb1cf48dd067dde3ef982c94086c8801448d5f6d'
},
  // Shader dependencies and license files the Feeder release does not carry:
  // [path below payload\feeder, raw URL at a pinned commit, sha256].
  feederExtras: [
  [
    'reshade-shaders/Shaders/vort_Motion.fx',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/vort_Motion.fx',
    '71ef3086ccf86792f5a333346eebb7b857434583712d3a51b9998db99e562edc'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_ACES.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_ACES.fxh',
    '967cb4914457f18cc91e8844e6f7ccef0b353e4091e38f9c8667d36d45309b61'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_Bloom.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_Bloom.fxh',
    'a3ab7942b73c61dcabe9b83ae42dafe65956c7a60d627aea27ede48a7cfb3c04'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_BlueNoise.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_BlueNoise.fxh',
    'a1eca01ddc6bdfef2b0c52601d297c59d7dabd71039d1489b7092532407cb455'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_ColorChanges.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_ColorChanges.fxh',
    '0cbd91dff9aa5ab615a206f56ba760378810a5540d4f2928e35138c7980b1538'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_ColorTex.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_ColorTex.fxh',
    'f5eef2db313c73b0419503295731c03bc4365fe1ed219f4afa618707b59e8d6c'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_Defs.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_Defs.fxh',
    'a00e99ece8b07899a7918a5248a2d603fd7f98882c795e3d31b9470cfe70a61c'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_Depth.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_Depth.fxh',
    '92d4f0a93b3945452c861e580117bb875bb594157694b3c8741790eaf3826205'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_Filters.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_Filters.fxh',
    '8d98a78f2fd7fe91f34bf4044d81094bd40fbb2c7b8f520ef66c5043f720f98d'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_HDRTex.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_HDRTex.fxh',
    '5d3d002a6d4d0fc6e67dcdd4a68497163268fbb590c7477220dac8f1293f916e'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_MotionBlur.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_MotionBlur.fxh',
    '67edbc5db1645d3c10c08375eb0bec0911c59c4fc1d3dde2d3e9c46a292ea35b'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_MotionBlur_Cheap.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_MotionBlur_Cheap.fxh',
    '0837c8151a50ef57c77bab7a3b14dd4c3b92354e4021ee37f54eb47f3f5589c7'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_MotionUtils.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_MotionUtils.fxh',
    '2d353b23cea6961ca40308a6aebf1e56d509485a728399d5f6b36427b7023027'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_MotionVectors.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_MotionVectors.fxh',
    '22d5c8f8a5f2cccee0ddde994ba04a7bc5379c54b1b3e9c7cf7d46f1f8ead87d'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_Motion_UI.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_Motion_UI.fxh',
    '29783705b01d7b83a408d29a9d4b72c5a90012a91fb05ebdf1166ba9e9aeac2b'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_OKColors.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_OKColors.fxh',
    '5a0a8468e97eaa9e8e018246e12002a86e3fb0c7a9cb97a3bc38390fc3f854e2'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_Static_UI.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_Static_UI.fxh',
    'ccd75ef28359b5324cf479fe568fbad7586ac203f6b1921f1b6fae48ae19bef2'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_TAA.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_TAA.fxh',
    '9b5c701fdacb37f15e565ca1aa3a861e4df3f55db493cd6589d509927ed08ede'
  ],
  [
    'reshade-shaders/Shaders/Includes/vort_Tonemap.fxh',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Shaders/Includes/vort_Tonemap.fxh',
    '9413eef6190303e920356310bc3aa2a270c052a1bcfde44f024f0a8986095f30'
  ],
  [
    'reshade-shaders/Shaders/ReShade.fxh',
    'https://raw.githubusercontent.com/crosire/reshade-shaders/ee30868391d4ad103db60489820102d8fd40e3c1/Shaders/ReShade.fxh',
    '6dabfbbaf968c3871905d2ea17f96572ff7b1cec01310b5d0e5252b66b30174f'
  ],
  [
    'reshade-shaders/Shaders/ReShadeUI.fxh',
    'https://raw.githubusercontent.com/crosire/reshade-shaders/ee30868391d4ad103db60489820102d8fd40e3c1/Shaders/ReShadeUI.fxh',
    '78adf672df47460297eb9fe6dd238d2aafa24510b52b84feb1a745dff70eb901'
  ],
  [
    'reshade-shaders/Textures/vort_BlueNoise.png',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Textures/vort_BlueNoise.png',
    '050d26db9283fbaece3b6883e300d22403631d83a12a5f2f79dc8b789b860305'
  ],
  [
    'reshade-shaders/Textures/vort_MLUT.png',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/Textures/vort_MLUT.png',
    'acb25ed926e7e847aeb0ef521745287d4ddda3c7f22e472ee42d61bb3064bbd7'
  ],
  [
    'licenses/VORT-LICENSE.txt',
    'https://raw.githubusercontent.com/vortigern11/vort_Shaders/b410b9f0c0fbb83c8cb42164aaf1655fab386f4a/LICENSE',
    '800bacb0f9db4df8203f0dad1f99947109a44f4097380807e0483bd62dee0d41'
  ],
  [
    'licenses/DLSS5-Feeder-LICENSE.txt',
    'https://raw.githubusercontent.com/jlrouzies-fr/DLSS5-Feeder/v2.0.0/LICENSE',
    '6562d5a5e3d7534711e34f4b34335f23f067acc839ae5274c1250bf5f4654b8b'
  ]
],
  // Files taken from the zip appended to ReShade_Setup_6.8.0_Addon.exe.
  reshadeVulkan: {
  'ReShade64.dll': '0cee63f9c9f13f3ac909c5b4903f4dbb4b719a7ab3b4f13b0deaf83c814b94f7',
  'ReShade64.json': 'aa21713718843e531da396e2bfc80772c9cb3c369d6c30b836be6b0ae812d503',
  'ReShade32.dll': 'da430e0a9c6eecefa0d1b27d05e16c426fb5d04e808b194d914eaac4b31bc0f8',
  'ReShade32.json': 'dbfdbadb8c64b398b2f8bf30469841ab8c35e10c9da40ba69b966559d5fa15f6'
}
};
