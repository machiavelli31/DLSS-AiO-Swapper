// Offline test for aio_sf::Locate - maps COPIES of renodx-dlss.addon64 without running them
// (DONT_RESOLVE_DLL_REFERENCES: no DllMain, no imports) and runs the add-on's locator.
// Nothing in the mapped images is written.
//
// usage: test_locate <copy SF 26.1016.1304> <copy SF 26.1025.0009> [<mutated copy> <expected reason substring>]...
#include <windows.h>

#include <cstdio>
#include <string>
#include <vector>

#include "locate.hpp"

static int failures = 0;
static int checks = 0;
static void Check(bool ok, const std::string& what) {
  ++checks;
  std::printf("[%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
  if (!ok) ++failures;
}

static void Print(const std::string& label, const aio_sf::Result& r) {
  if (!r.ok) {
    std::printf("%s: INERT - %s (file %s, sha %.16s)\n", label.c_str(), r.reason.c_str(), r.t.file_version.c_str(),
                r.t.sha256.c_str());
    return;
  }
  std::printf("%s: OK (%s) file %s sha %s\n", label.c_str(), r.t.fast_path ? r.t.known_build : "pattern scan",
              r.t.file_version.c_str(), r.t.sha256.c_str());
  std::printf("   preset_index      rva 0x%X  value %ld\n", r.t.rva_preset, static_cast<long>(r.t.initial_value));
  std::printf("   on_preset_off     rva 0x%X\n", r.t.rva_off);
  std::printf("   on_preset_changed rva 0x%X  (both jump to 0x%X)\n", r.t.rva_changed, r.t.rva_callback_body);
  std::printf("   apply_settings    rva 0x%X  (called by RenoDXUpdateSetting; gate: %s)\n", r.t.rva_apply, r.t.apply_form);
}

struct Expect {
  const char* label;
  const char* version;
  uint32_t preset, off, changed, apply, body;
};

static void TestBuild(const wchar_t* path, const Expect& e) {
  std::printf("\n=== %s ===\n", e.label);
  HMODULE m = LoadLibraryExW(path, nullptr, DONT_RESOLVE_DLL_REFERENCES);
  Check(m != nullptr, std::string(e.label) + ": map copy (DONT_RESOLVE_DLL_REFERENCES)");
  if (m == nullptr) return;

  const auto fast = aio_sf::Locate(m, false);
  Print(std::string(e.label) + " locate (default)", fast);
  const auto scan = aio_sf::Locate(m, true);
  Print(std::string(e.label) + " locate (forced scan)", scan);

  const std::string L = e.label;
  Check(fast.ok && fast.t.fast_path && std::string(fast.t.known_build) == e.label, L + ": exact-RVA fast path for this build");
  Check(scan.ok && !scan.t.fast_path, L + ": forced pattern scan resolves too");
  Check(fast.ok && scan.ok && fast.t.rva_preset == scan.t.rva_preset && fast.t.rva_off == scan.t.rva_off
            && fast.t.rva_changed == scan.t.rva_changed && fast.t.rva_apply == scan.t.rva_apply
            && fast.t.rva_callback_body == scan.t.rva_callback_body,
        L + ": fast path and scan agree on every address");
  char buf[256];
  snprintf(buf, sizeof(buf), "%s: preset_index 0x%X, off 0x%X, changed 0x%X, apply 0x%X, callback body 0x%X", e.label,
           e.preset, e.off, e.changed, e.apply, e.body);
  Check(scan.ok && scan.t.rva_preset == e.preset && scan.t.rva_off == e.off && scan.t.rva_changed == e.changed
            && scan.t.rva_apply == e.apply && scan.t.rva_callback_body == e.body,
        buf);
  Check(scan.ok && scan.t.file_version == e.version, L + ": file version " + e.version);
  Check(scan.ok && scan.t.initial_value == 1, L + ": initial preset_index == 1 (Preset #1)");
  const LONG after = scan.ok ? *scan.t.preset_index : -1;
  Check(after == 1, L + ": preset_index unchanged after locating (read-only)");
  FreeLibrary(m);
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 3 || (argc - 3) % 2 != 0) {
    std::printf("usage: test_locate <copy 26.1016> <copy 26.1025> [<mutated copy> <expected reason>]...\n");
    return 2;
  }
  TestBuild(argv[1], {"SF 26.1016.1304", "0.2026.1016.1704", 0x30d918, 0x7fe40, 0x7fe30, 0x28910, 0x48f40});
  TestBuild(argv[2], {"SF 26.1025.0009", "0.2026.1025.409", 0x35aa08, 0x99920, 0x99910, 0x34cd0, 0x5f630});

  std::printf("\n=== negatives ===\n");
  const auto k32 = aio_sf::Locate(GetModuleHandleW(L"kernel32.dll"), false);
  Print("locate (kernel32.dll)", k32);
  Check(!k32.ok, "foreign module -> inert");
  Check(!aio_sf::Locate(nullptr).ok, "module not loaded -> inert");

  for (int i = 3; i + 1 < argc; i += 2) {
    char name[MAX_PATH * 2] = {};
    char want[256] = {};
    WideCharToMultiByte(CP_UTF8, 0, argv[i], -1, name, sizeof(name), nullptr, nullptr);
    WideCharToMultiByte(CP_UTF8, 0, argv[i + 1], -1, want, sizeof(want), nullptr, nullptr);
    const char* base = strrchr(name, '\\');
    base = base ? base + 1 : name;
    HMODULE mut = LoadLibraryExW(argv[i], nullptr, DONT_RESOLVE_DLL_REFERENCES);
    Check(mut != nullptr, std::string("map mutated copy ") + base);
    if (mut == nullptr) continue;
    const auto bad = aio_sf::Locate(mut, false);
    Print(std::string("locate (") + base + ")", bad);
    Check(!bad.ok && bad.t.preset_index == nullptr, std::string(base) + " -> inert, nothing exposed for writing");
    Check(!bad.ok && bad.reason.find(want) != std::string::npos, std::string(base) + " -> reason contains \"" + want + "\"");
    FreeLibrary(mut);
  }
  std::printf("\n%d/%d checks passed, %d failure(s)\n", checks - failures, checks, failures);
  return failures == 0 ? 0 : 1;
}
