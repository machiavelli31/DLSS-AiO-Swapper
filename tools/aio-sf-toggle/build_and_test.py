"""Build AiO SF Toggle + offline locator test, then test against BOTH ShortFuse builds.

Expects read-only reference copies (never the game-folder files) in .\\ref\\:
  ref\\renodx-dlss-26.1016.addon64  (sha a8fd34b5...)
  ref\\renodx-dlss-26.1025.addon64  (sha dd5ed7ba...)
Mutated copies are written to .\\out\\ only.
"""
import hashlib
import os
import shutil
import struct
import subprocess
import sys

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, 'out')
REFS = {
    '26.1016': (os.path.join(D, 'ref', 'renodx-dlss-26.1016.addon64'),
                'a8fd34b531fd22c3dbd008ed8fd3cbfcca2fb451729e19cd1fc2e4c85b5068d4'),
    '26.1025': (os.path.join(D, 'ref', 'renodx-dlss-26.1025.addon64'),
                'dd5ed7ba6773a6168390f3a53e757f09b563ecdf1a9f4fcdec6dd3129d93bace'),
}


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def rva_to_off(b, rva):
    e_lfanew = struct.unpack_from('<I', b, 0x3C)[0]
    nsec = struct.unpack_from('<H', b, e_lfanew + 6)[0]
    opt = struct.unpack_from('<H', b, e_lfanew + 20)[0]
    sh = e_lfanew + 24 + opt
    for i in range(nsec):
        vsize, va, rawsize, rawptr = struct.unpack_from('<IIII', b, sh + i * 40 + 8)
        if va <= rva < va + max(vsize, rawsize):
            return rva - va + rawptr
    raise ValueError(hex(rva))


def mutate(src, dst, rva, expect, new):
    b = bytearray(open(src, 'rb').read())
    off = rva_to_off(b, rva)
    assert b[off:off + len(expect)] == expect, (dst, b[off:off + len(expect)].hex())
    b[off:off + len(new)] = new
    open(dst, 'wb').write(b)
    return dst


def main():
    for k, (p, h) in REFS.items():
        if not os.path.exists(p) or sha(p) != h:
            print('missing/wrong reference copy', k, p)
            return 2
    r = subprocess.run(['cmd', '/c', os.path.join(D, 'build.cmd')], cwd=D, capture_output=True, text=True, errors='replace')
    print(r.stdout[-6000:]); print(r.stderr[-3000:]); print('build exit', r.returncode)
    if r.returncode != 0:
        return r.returncode
    old, new = REFS['26.1016'][0], REFS['26.1025'][0]
    muts = [
        # one byte of the on_preset_changed thunk ('ret' -> 'nop') -> P1 no longer found
        (mutate(old, os.path.join(OUT, 'mut-1016-thunk.addon64'), 0x7fe3d, b'\xC3', b'\x90'), 'pattern count mismatch'),
        (mutate(new, os.path.join(OUT, 'mut-1025-thunk.addon64'), 0x9991d, b'\xC3', b'\x90'), 'pattern count mismatch'),
        # apply routine no longer gates on preset_index
        (mutate(old, os.path.join(OUT, 'mut-1016-apply.addon64'), 0x2898e + 6, b'\x00', b'\x01'),
         'settings apply routine does not test preset_index'),
        (mutate(new, os.path.join(OUT, 'mut-1025-apply.addon64'), 0x34d5c, b'\x85\xD2', b'\x85\xC0'),
         'settings apply routine does not test preset_index'),
    ]
    args = [os.path.join(OUT, 'test_locate.exe'), old, new]
    for p, why in muts:
        args += [p, why]
    t = subprocess.run(args, capture_output=True, text=True, errors='replace')
    a = os.path.join(OUT, 'aio-sf-toggle.addon64')
    tail = (f"\nexit code {t.returncode}\n"
            f"artifact out\\aio-sf-toggle.addon64 sha256 {sha(a)} ({os.path.getsize(a)} bytes)\n"
            + ''.join(f"reference {k} still sha256 {sha(p)}\n" for k, (p, _) in REFS.items()))
    text = t.stdout + t.stderr + tail
    for dst in (os.path.join(OUT, 'test_output.txt'), os.path.join(D, 'test_output.txt')):
        open(dst, 'w', encoding='utf-8').write(text)
    print(text)
    if t.returncode == 0:
        shutil.copy2(a, os.path.join(D, 'aio-sf-toggle.addon64'))
        shutil.copy2(os.path.join(OUT, 'test_locate.exe'), os.path.join(D, 'test_locate.exe'))
        print('copied artifact to', D)
    return t.returncode


if __name__ == '__main__':
    sys.exit(main())
