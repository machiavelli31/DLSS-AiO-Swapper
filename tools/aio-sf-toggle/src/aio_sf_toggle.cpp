// AiO SF Toggle - companion add-on for ShortFuse's RenoDX DLSS (renodx-dlss.addon64).
// F6 (configurable) flips ShortFuse's preset between "Off" and the preset that was active
// before, the same way his own preset selector does, without modifying his file.
//
// What a toggle does (all inside ShortFuse's module, on the present thread, i.e. the same
// thread his overlay changes settings on):
//   Off: preset_index = 0; run his registered on_preset_off callback; run his settings-apply
//        routine (the one his exported RenoDXUpdateSetting calls) so the NR request block is
//        rebuilt with Off (NR passes forced to 0) right away.
//   On : preset_index = previous (1..3); run his on_preset_changed callback; run the apply
//        routine again. Setting values are untouched while Off, so no ini reload is needed.
// Anything that does not match the reference layout -> one log line, no memory writes.

#include <windows.h>

#include <atomic>
#include <cstdio>
#include <string>

#include <reshade.hpp>

#include "locate.hpp"

extern "C" __declspec(dllexport) const char* NAME = "AiO SF Toggle";
extern "C" __declspec(dllexport) const char* DESCRIPTION = "F6 toggles ShortFuse RenoDX DLSS on/off";

namespace {

constexpr wchar_t kTargetModule[] = L"renodx-dlss.addon64";
constexpr char kSection[] = "AIO-SF-TOGGLE";
constexpr ULONGLONG kDebounceMs = 250;

enum class State { kUnresolved, kReady, kInert };

State state = State::kUnresolved;
aio_sf::Target target;
LONG last_preset = 1;  // RenoDX framework default (preset_index = 1)
uint32_t hotkey = VK_F6;
ULONGLONG last_toggle_ms = 0;
bool missing_logged = false;
std::atomic<bool> overlay_open{false};

void Log(reshade::log::level level, const std::string& text) {
  reshade::log::message(level, ("AiO SF Toggle: " + text).c_str());
}

std::string PresetName(LONG v) {
  return v == 0 ? std::string("Off") : "preset " + std::to_string(v);
}

// SEH wrapper: no C++ objects with destructors in here (C2712).
bool CallGuarded(void (*first)(), void (*second)(), DWORD* code) {
  __try {
    first();
    second();
    return true;
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    *code = GetExceptionCode();
    return false;
  }
}

void TryResolve() {
  HMODULE module = GetModuleHandleW(kTargetModule);
  if (module == nullptr) {
    if (!missing_logged) {
      missing_logged = true;
      Log(reshade::log::level::warning, "renodx-dlss.addon64 is not loaded; hotkey does nothing until it is");
    }
    return;  // stay unresolved, retry on the next key press
  }
  const aio_sf::Result r = aio_sf::Locate(module);
  if (!r.ok) {
    state = State::kInert;
    Log(reshade::log::level::warning,
        "ShortFuse build not recognised (" + r.reason + ", file " + r.t.file_version + ", sha " + r.t.sha256.substr(0, 16)
            + ") - staying inert, nothing is written");
    return;
  }
  target = r.t;
  if (r.t.initial_value != 0) last_preset = r.t.initial_value;
  state = State::kReady;
  char buf[384];
  snprintf(buf, sizeof(buf),
           "bound to RenoDX DLSS %s (sha %.16s, %s): preset_index rva 0x%X = %ld, off cb 0x%X, changed cb 0x%X, apply 0x%X [%s]; key 0x%X",
           r.t.file_version.c_str(), r.t.sha256.c_str(), r.t.fast_path ? r.t.known_build : "pattern scan",
           r.t.rva_preset, static_cast<long>(r.t.initial_value), r.t.rva_off, r.t.rva_changed, r.t.rva_apply,
           r.t.apply_form, hotkey);
  Log(reshade::log::level::info, buf);
}

void Toggle() {
  const LONG current = *target.preset_index;
  if (current < 0 || current > 3) {
    state = State::kInert;
    Log(reshade::log::level::warning, "preset_index holds " + std::to_string(current) + " (expected 0..3) - going inert");
    return;
  }
  const char* suffix = overlay_open.load() ? " [overlay open]" : "";
  DWORD code = 0;
  if (current != 0) {
    last_preset = current;
    InterlockedExchange(target.preset_index, 0);
    if (!CallGuarded(target.on_preset_off, target.apply_settings, &code)) {
      state = State::kInert;
      char buf[128];
      snprintf(buf, sizeof(buf), "exception 0x%08lX inside ShortFuse's preset-off path - going inert", code);
      Log(reshade::log::level::error, buf);
      return;
    }
    Log(reshade::log::level::info, "NR off (" + PresetName(current) + " -> Off)" + suffix);
  } else {
    const LONG restore = (last_preset >= 1 && last_preset <= 3) ? last_preset : 1;
    InterlockedExchange(target.preset_index, restore);
    if (!CallGuarded(target.on_preset_changed, target.apply_settings, &code)) {
      state = State::kInert;
      char buf[128];
      snprintf(buf, sizeof(buf), "exception 0x%08lX inside ShortFuse's preset-change path - going inert", code);
      Log(reshade::log::level::error, buf);
      return;
    }
    Log(reshade::log::level::info, "NR on (Off -> " + PresetName(restore) + ")" + suffix);
  }
}

void OnPresent(reshade::api::effect_runtime* runtime) {
  if (state == State::kInert || hotkey == 0 || runtime == nullptr) return;
  if (state == State::kUnresolved && !missing_logged) TryResolve();  // early, once, so the log shows the binding
  if (!runtime->is_key_pressed(hotkey)) return;
  const ULONGLONG now = GetTickCount64();
  if (now - last_toggle_ms < kDebounceMs) return;
  last_toggle_ms = now;
  if (state == State::kUnresolved) TryResolve();
  if (state != State::kReady) return;
  Toggle();
}

bool OnOpenOverlay(reshade::api::effect_runtime*, bool open, reshade::api::input_source) {
  overlay_open.store(open);
  return false;  // never block the overlay
}

void LoadConfig() {
  int key = VK_F6;
  if (reshade::get_config_value(nullptr, kSection, "Key", key)) {
    if (key < 0 || key > 0xFE) {
      Log(reshade::log::level::warning, "[AIO-SF-TOGGLE] Key=" + std::to_string(key) + " is not a VK code; using F6 (117)");
      key = VK_F6;
    }
  }
  hotkey = static_cast<uint32_t>(key);
  if (hotkey == 0) Log(reshade::log::level::info, "hotkey disabled ([AIO-SF-TOGGLE] Key=0)");
}

}  // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  switch (reason) {
    case DLL_PROCESS_ATTACH:
      if (!reshade::register_addon(module)) return FALSE;
      LoadConfig();
      reshade::register_event<reshade::addon_event::reshade_present>(OnPresent);
      reshade::register_event<reshade::addon_event::reshade_open_overlay>(OnOpenOverlay);
      break;
    case DLL_PROCESS_DETACH:
      reshade::unregister_event<reshade::addon_event::reshade_open_overlay>(OnOpenOverlay);
      reshade::unregister_event<reshade::addon_event::reshade_present>(OnPresent);
      reshade::unregister_addon(module);
      break;
  }
  return TRUE;
}
