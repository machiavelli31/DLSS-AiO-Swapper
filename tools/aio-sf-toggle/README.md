# AiO SF Toggle

Small ReShade add-on (our own code, MIT) that gives ShortFuse's **RenoDX DLSS Tool** (`renodx-dlss.addon64`) an on/off hotkey: **F6** switches between its *Off* preset and the preset that was active before, exactly like picking *Off* / *Preset* in ShortFuse's menu. ShortFuse's file is never modified.

- Installed by the app next to `renodx-dlss.addon64` on the *ShortFuse DLSS Tool* route; Restore removes it.
- Key: `ReShade.ini` → `[AIO-SF-TOGGLE]` `Key=117` (virtual-key code, 117 = F6, 0 = off).
- Matched to ShortFuse SF 26.1025.0009 and 26.1016.1304 (exact build fast paths) with a pattern-scan fallback. If ShortFuse's code no longer matches, the add-on logs one line and stays inert - it never writes anything it could not verify.
- Built with MSVC (`build.cmd`) against the ReShade 6.8.0 add-on headers (BSD-3, from crosire/reshade; not included here). `build_and_test.py` runs the offline locate test against a copy of ShortFuse's add-on.

SHA-256 of the shipped build: `807e9ac98c852a6c43fd486c8a2e1f15e150a917a5158fd994e976a308f22264`
