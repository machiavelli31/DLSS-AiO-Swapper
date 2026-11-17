// AiO SF Toggle - locator for ShortFuse's RenoDX DLSS preset state (DLSS AiO Swapper).
// Read-only: this header never writes into the target module. It only finds
// addresses and cross-checks them; the add-on decides whether to write.
#pragma once

#include <windows.h>
#include <bcrypt.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace aio_sf {

// Reference builds this was reverse engineered from. Used only for the exact-RVA
// fast path (sha256 of the file + SizeOfImage must both match); every address is
// still verified byte-for-byte and runs through the same cross-checks as the scan.
struct KnownBuild {
  const char* label;
  const char* sha256;
  uint32_t size_of_image;
  uint32_t rva_changed_thunk;   // on_preset_changed callback (P1 start)
  uint32_t rva_draw_presets;    // lea rdx,[preset_index] inside draw_presets (P2 start)
  uint32_t off_apply_in_export; // RenoDXUpdateSetting + off -> P3 (test sil,sil / je / call apply)
};
inline constexpr KnownBuild kKnownBuilds[] = {
    // SF 26.1016.1304, VERSIONINFO 0.2026.1016.1704, 3 333 632 bytes
    {"SF 26.1016.1304", "a8fd34b531fd22c3dbd008ed8fd3cbfcca2fb451729e19cd1fc2e4c85b5068d4", 0x343000, 0x7fe30, 0x83663, 0x194},
    // SF 26.1025.0009, VERSIONINFO 0.2026.1025.409, 3 661 312 bytes
    {"SF 26.1025.0009", "dd5ed7ba6773a6168390f3a53e757f09b563ecdf1a9f4fcdec6dd3129d93bace", 0x395000, 0x99910, 0x9c813, 0x194},
};

struct Target {
  volatile LONG* preset_index = nullptr;
  void (*on_preset_off)() = nullptr;      // ShortFuse's registered on_preset_off callback
  void (*on_preset_changed)() = nullptr;  // ShortFuse's registered on_preset_changed callback
  void (*apply_settings)() = nullptr;     // routine RenoDXUpdateSetting calls after a change
  uint32_t rva_preset = 0, rva_off = 0, rva_changed = 0, rva_apply = 0, rva_callback_body = 0;
  LONG initial_value = -1;
  bool fast_path = false;
  const char* known_build = nullptr;  // label of the fast-path build, else nullptr
  const char* apply_form = "";        // how the apply routine reads preset_index
  std::string sha256;
  std::string file_version;
};

struct Result {
  bool ok = false;
  std::string reason;
  Target t;
};

namespace detail {

struct Pattern {
  std::vector<uint8_t> bytes;
  std::vector<uint8_t> mask;  // 1 = must match
};

inline Pattern MakePattern(const char* s) {
  Pattern p;
  while (*s != 0) {
    while (*s == ' ') ++s;
    if (*s == 0) break;
    if (s[0] == '?' && s[1] == '?') {
      p.bytes.push_back(0);
      p.mask.push_back(0);
      s += 2;
    } else {
      char hex[3] = {s[0], s[1], 0};
      p.bytes.push_back(static_cast<uint8_t>(strtoul(hex, nullptr, 16)));
      p.mask.push_back(1);
      s += 2;
    }
  }
  return p;
}

inline bool MatchAt(const uint8_t* at, const Pattern& p) {
  for (size_t i = 0; i < p.bytes.size(); ++i) {
    if (p.mask[i] != 0 && at[i] != p.bytes[i]) return false;
  }
  return true;
}

// All matches of p inside [begin, end).
inline std::vector<const uint8_t*> FindAll(const uint8_t* begin, const uint8_t* end, const Pattern& p, size_t limit = 4) {
  std::vector<const uint8_t*> out;
  if (end <= begin || static_cast<size_t>(end - begin) < p.bytes.size()) return out;
  const uint8_t* last = end - p.bytes.size();
  for (const uint8_t* at = begin; at <= last; ++at) {
    if (at[0] != p.bytes[0]) continue;  // first byte is never a wildcard in our patterns
    if (MatchAt(at, p)) {
      out.push_back(at);
      if (out.size() >= limit) break;
    }
  }
  return out;
}

inline int32_t Rel32(const uint8_t* at) {
  int32_t v;
  memcpy(&v, at, sizeof(v));
  return v;
}

struct Image {
  const uint8_t* base = nullptr;
  const IMAGE_NT_HEADERS64* nt = nullptr;
  const IMAGE_SECTION_HEADER* sections = nullptr;
  WORD section_count = 0;

  const IMAGE_SECTION_HEADER* SectionOf(uint32_t rva) const {
    for (WORD i = 0; i < section_count; ++i) {
      const auto& s = sections[i];
      const uint32_t size = s.Misc.VirtualSize > s.SizeOfRawData ? s.Misc.VirtualSize : s.SizeOfRawData;
      if (rva >= s.VirtualAddress && rva < s.VirtualAddress + size) return &s;
    }
    return nullptr;
  }
  bool IsCode(uint32_t rva) const {
    const auto* s = SectionOf(rva);
    return s != nullptr && (s->Characteristics & IMAGE_SCN_MEM_EXECUTE) != 0;
  }
  bool IsWritableData(uint32_t rva) const {
    const auto* s = SectionOf(rva);
    return s != nullptr && (s->Characteristics & IMAGE_SCN_MEM_WRITE) != 0
           && (s->Characteristics & IMAGE_SCN_MEM_EXECUTE) == 0;
  }
  uint32_t Rva(const void* p) const { return static_cast<uint32_t>(static_cast<const uint8_t*>(p) - base); }
  bool InImage(const void* p, size_t n) const {
    const auto* b = static_cast<const uint8_t*>(p);
    return b >= base && b + n <= base + nt->OptionalHeader.SizeOfImage;
  }
};

inline std::string Sha256File(const wchar_t* path) {
  HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, 0, nullptr);
  if (f == INVALID_HANDLE_VALUE) return {};
  BCRYPT_ALG_HANDLE alg = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  std::string hex;
  if (BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0))
      && BCRYPT_SUCCESS(BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0))) {
    std::vector<uint8_t> buf(1 << 20);
    DWORD got = 0;
    bool ok = true;
    while (ReadFile(f, buf.data(), static_cast<DWORD>(buf.size()), &got, nullptr) && got > 0) {
      if (!BCRYPT_SUCCESS(BCryptHashData(hash, buf.data(), got, 0))) {
        ok = false;
        break;
      }
    }
    uint8_t digest[32] = {};
    if (ok && BCRYPT_SUCCESS(BCryptFinishHash(hash, digest, sizeof(digest), 0))) {
      static const char* kHex = "0123456789abcdef";
      for (uint8_t b : digest) {
        hex.push_back(kHex[b >> 4]);
        hex.push_back(kHex[b & 15]);
      }
    }
  }
  if (hash != nullptr) BCryptDestroyHash(hash);
  if (alg != nullptr) BCryptCloseAlgorithmProvider(alg, 0);
  CloseHandle(f);
  return hex;
}

inline std::string FileVersionOf(HMODULE module) {
  // Read VS_FIXEDFILEINFO straight from the mapped RT_VERSION resource.
  HRSRC res = FindResourceW(module, MAKEINTRESOURCEW(1), MAKEINTRESOURCEW(16) /* RT_VERSION */);
  if (res == nullptr) return {};
  HGLOBAL h = LoadResource(module, res);
  const auto* data = static_cast<const uint8_t*>(LockResource(h));
  const DWORD size = SizeofResource(module, res);
  if (data == nullptr || size < 0x60) return {};
  for (DWORD i = 0; i + sizeof(VS_FIXEDFILEINFO) <= size; i += 4) {
    VS_FIXEDFILEINFO info;
    memcpy(&info, data + i, sizeof(info));
    if (info.dwSignature == 0xFEEF04BD) {
      char out[64];
      snprintf(out, sizeof(out), "%u.%u.%u.%u",
               HIWORD(info.dwFileVersionMS), LOWORD(info.dwFileVersionMS),
               HIWORD(info.dwFileVersionLS), LOWORD(info.dwFileVersionLS));
      return out;
    }
  }
  return {};
}

}  // namespace detail

// Patterns (x64). Identical bytes in SF 26.1016.1304 and SF 26.1025.0009 unless noted:
//  P1  ShortFuse's two preset callbacks registered by settings::Use():
//        on_preset_changed: cmp dword [rip+preset_index],0 / jne apply / ret / int3 int3
//        on_preset_off:     jmp apply
//  P2  draw_presets: lea rdx,[rip+preset_index] / movsxd rax,[rip+preset_index] /
//        mov rcx,[rip+preset_strings] / shl rax,5   (ImGui::SliderInt("Preset", &preset_index, ...))
//  P3  RenoDXUpdateSetting (exported): test sil,sil / je / call apply_settings / mov al,1
//  P4  callback body: cmp dword [rip+preset_index],1 within its first 0x40 bytes
//  P5  apply_settings body, within its first 0x100 bytes, one of:
//        A (26.1016): cmp dword [rip+preset_index],0
//        B (26.1025): mov r32,[rip+preset_index] ... test r32,r32 (<=0x40 later)
//                     ... cmove x,r32 (<=0x20 later)  => NR passes forced to 0 when Off
inline constexpr char kP1[] = "83 3D ?? ?? ?? ?? 00 0F 85 ?? ?? ?? ?? C3 CC CC E9 ?? ?? ?? ??";
inline constexpr char kP2[] = "48 8D 15 ?? ?? ?? ?? 48 63 05 ?? ?? ?? ?? 48 8B 0D ?? ?? ?? ?? 48 C1 E0 05";
inline constexpr char kP3[] = "40 84 F6 74 ?? E8 ?? ?? ?? ?? B0 01";
inline constexpr char kP4[] = "83 3D ?? ?? ?? ?? 01";
inline constexpr char kP5[] = "83 3D ?? ?? ?? ?? 00";

namespace detail {

// P5 check. Returns the form name or nullptr if the apply routine does not gate on preset_index.
inline const char* ApplyGatesOnPreset(const Image& img, const uint8_t* fn, const uint8_t* text_end, uint32_t preset_rva) {
  const uint8_t* end = (fn + 0x100 < text_end) ? fn + 0x100 : text_end;
  // Form A: cmp dword [rip+preset_index],0
  const Pattern p5 = MakePattern(kP5);
  for (const uint8_t* at : FindAll(fn, end, p5, 8)) {
    if (img.Rva(at + 7) + Rel32(at + 2) == preset_rva) return "cmp [preset],0";
  }
  // Form B: mov r32,[rip+preset_index] (8B, mod=00 rm=101, no REX) -> test r32,r32 -> cmove x,r32
  for (const uint8_t* at = fn; at + 6 <= end; ++at) {
    if (at[0] != 0x8B || (at[1] & 0xC7) != 0x05) continue;
    if (fn < at && (at[-1] & 0xF0) == 0x40) continue;  // REX-prefixed: different register file, not handled
    if (img.Rva(at + 6) + Rel32(at + 2) != preset_rva) continue;
    const uint8_t reg = (at[1] >> 3) & 7;
    const uint8_t test_modrm = static_cast<uint8_t>(0xC0 | (reg << 3) | reg);
    const uint8_t* t_end = (at + 6 + 0x40 < text_end) ? at + 6 + 0x40 : text_end;
    for (const uint8_t* t = at + 6; t + 2 <= t_end; ++t) {
      if (t[0] != 0x85 || t[1] != test_modrm) continue;
      const uint8_t* c_end = (t + 2 + 0x20 < text_end) ? t + 2 + 0x20 : text_end;
      for (const uint8_t* c = t + 2; c + 3 <= c_end; ++c) {
        if (c[0] == 0x0F && c[1] == 0x44 && (c[2] & 0xC0) == 0xC0 && (c[2] & 7) == reg) return "mov r32,[preset]; test; cmove";
      }
    }
  }
  return nullptr;
}

}  // namespace detail

// Locates ShortFuse's preset_index and the module's own preset/apply routines.
// force_scan = ignore the exact-RVA fast path (used by the offline test).
inline Result Locate(HMODULE module, bool force_scan = false) {
  using namespace detail;
  Result r;
  if (module == nullptr) {
    r.reason = "module not loaded";
    return r;
  }
  Image img;
  img.base = reinterpret_cast<const uint8_t*>(module);
  const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(img.base);
  if (dos->e_magic != IMAGE_DOS_SIGNATURE) {
    r.reason = "no MZ header";
    return r;
  }
  img.nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(img.base + dos->e_lfanew);
  if (img.nt->Signature != IMAGE_NT_SIGNATURE || img.nt->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64) {
    r.reason = "not an x64 PE image";
    return r;
  }
  img.sections = IMAGE_FIRST_SECTION(img.nt);
  img.section_count = img.nt->FileHeader.NumberOfSections;

  // 1) Identity: ReShade add-on NAME export must read "RenoDX DLSS".
  const auto* name_export = reinterpret_cast<const char* const*>(GetProcAddress(module, "NAME"));
  if (name_export == nullptr || !img.InImage(name_export, sizeof(void*)) || !img.InImage(*name_export, 12)
      || strcmp(*name_export, "RenoDX DLSS") != 0) {
    r.reason = "NAME export is not \"RenoDX DLSS\"";
    return r;
  }
  const auto* update_export = reinterpret_cast<const uint8_t*>(GetProcAddress(module, "RenoDXUpdateSetting"));
  if (update_export == nullptr || !img.IsCode(img.Rva(update_export))) {
    r.reason = "RenoDXUpdateSetting export missing";
    return r;
  }

  wchar_t path[MAX_PATH * 2] = {};
  GetModuleFileNameW(module, path, static_cast<DWORD>(std::size(path)));
  r.t.sha256 = Sha256File(path);
  r.t.file_version = FileVersionOf(module);
  const KnownBuild* known = nullptr;
  if (!force_scan) {
    for (const auto& kb : kKnownBuilds) {
      if (r.t.sha256 == kb.sha256 && img.nt->OptionalHeader.SizeOfImage == kb.size_of_image) known = &kb;
    }
  }

  // Bounds of the code section that holds the export.
  const auto* text = img.SectionOf(img.Rva(update_export));
  const uint8_t* text_begin = img.base + text->VirtualAddress;
  const uint8_t* text_end = text_begin + text->Misc.VirtualSize;

  const Pattern p1 = MakePattern(kP1), p2 = MakePattern(kP2), p3 = MakePattern(kP3);
  const Pattern p4 = MakePattern(kP4);

  const uint8_t* m1 = nullptr;
  const uint8_t* m2 = nullptr;
  const uint8_t* m3 = nullptr;
  if (known != nullptr) {
    m1 = img.base + known->rva_changed_thunk;
    m2 = img.base + known->rva_draw_presets;
    m3 = update_export + known->off_apply_in_export;
    if (!img.InImage(m1, p1.bytes.size()) || !img.InImage(m2, p2.bytes.size()) || !img.InImage(m3, p3.bytes.size())
        || !MatchAt(m1, p1) || !MatchAt(m2, p2) || !MatchAt(m3, p3)) {
      r.reason = std::string("known build ") + known->label + " but bytes at the recorded RVAs differ";
      return r;
    }
    r.t.fast_path = true;
    r.t.known_build = known->label;
  } else {
    auto a1 = FindAll(text_begin, text_end, p1);
    auto a2 = FindAll(text_begin, text_end, p2);
    const uint8_t* e_end = (update_export + 0x400 < text_end) ? update_export + 0x400 : text_end;
    auto a3 = FindAll(update_export, e_end, p3);
    if (a1.size() != 1 || a2.size() != 1 || a3.size() != 1) {
      char buf[160];
      snprintf(buf, sizeof(buf), "pattern count mismatch (callbacks=%zu draw_presets=%zu update_export=%zu, want 1/1/1)",
               a1.size(), a2.size(), a3.size());
      r.reason = buf;
      return r;
    }
    m1 = a1[0];
    m2 = a2[0];
    m3 = a3[0];
  }

  // 2) Decode and cross-check.
  const uint32_t preset_rva = img.Rva(m1 + 7) + Rel32(m1 + 2);    // cmp [rip+d32],imm8 ends at +7
  const uint32_t jne_rva = img.Rva(m1 + 13) + Rel32(m1 + 9);      // jne rel32 ends at +13
  const uint32_t jmp_rva = img.Rva(m1 + 21) + Rel32(m1 + 17);     // jmp rel32 ends at +21
  const uint32_t lea_rva = img.Rva(m2 + 7) + Rel32(m2 + 3);
  const uint32_t movsxd_rva = img.Rva(m2 + 14) + Rel32(m2 + 10);
  const uint32_t apply_rva = img.Rva(m3 + 10) + Rel32(m3 + 6);

  if (jne_rva != jmp_rva) {
    r.reason = "preset callbacks do not share one target";
    return r;
  }
  if (lea_rva != preset_rva || movsxd_rva != preset_rva) {
    r.reason = "draw_presets does not use the callbacks' preset_index";
    return r;
  }
  if (!img.IsWritableData(preset_rva) || (preset_rva & 3) != 0) {
    r.reason = "preset_index is not an aligned writable data address";
    return r;
  }
  if (!img.IsCode(jne_rva) || !img.IsCode(apply_rva)) {
    r.reason = "routine targets are outside the code section";
    return r;
  }
  auto body_refs = [&](uint32_t fn_rva, size_t span, const Pattern& p) {
    const uint8_t* b = img.base + fn_rva;
    const uint8_t* e = (b + span < text_end) ? b + span : text_end;
    for (const uint8_t* at : FindAll(b, e, p, 8)) {
      if (img.Rva(at + 7) + Rel32(at + 2) == preset_rva) return true;
    }
    return false;
  };
  if (!body_refs(jne_rva, 0x40, p4)) {
    r.reason = "preset callback body does not test preset_index";
    return r;
  }
  const char* apply_form = ApplyGatesOnPreset(img, img.base + apply_rva, text_end, preset_rva);
  if (apply_form == nullptr) {
    r.reason = "settings apply routine does not test preset_index";
    return r;
  }

  auto* preset = reinterpret_cast<volatile LONG*>(const_cast<uint8_t*>(img.base) + preset_rva);
  const LONG value = *preset;
  if (value < 0 || value > 3) {
    char buf[96];
    snprintf(buf, sizeof(buf), "preset_index value %ld is outside 0..3", static_cast<long>(value));
    r.reason = buf;
    return r;
  }

  r.t.preset_index = preset;
  r.t.on_preset_changed = reinterpret_cast<void (*)()>(const_cast<uint8_t*>(m1));
  r.t.on_preset_off = reinterpret_cast<void (*)()>(const_cast<uint8_t*>(m1 + 16));
  r.t.apply_settings = reinterpret_cast<void (*)()>(const_cast<uint8_t*>(img.base) + apply_rva);
  r.t.rva_preset = preset_rva;
  r.t.rva_changed = img.Rva(m1);
  r.t.rva_off = img.Rva(m1 + 16);
  r.t.rva_apply = apply_rva;
  r.t.rva_callback_body = jne_rva;
  r.t.initial_value = value;
  r.t.apply_form = apply_form;
  r.ok = true;
  return r;
}

}  // namespace aio_sf
