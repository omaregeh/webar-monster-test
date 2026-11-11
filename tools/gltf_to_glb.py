#!/usr/bin/env python3
"""Pack a .gltf whose buffer is an embedded base64 data: URI (as in the
Quaternius Ultimate Monsters pack) into a single binary .glb file.

Usage: python3 tools/gltf_to_glb.py input.gltf output.glb
"""
import base64
import json
import struct
import sys


def main(src, dst):
    with open(src) as f:
        g = json.load(f)
    if len(g["buffers"]) != 1:
        raise SystemExit("expected exactly one buffer")
    uri = g["buffers"][0]["uri"]
    if not uri.startswith("data:"):
        raise SystemExit("buffer is not an embedded data: URI")
    blob = base64.b64decode(uri.split(",", 1)[1])
    del g["buffers"][0]["uri"]
    g["buffers"][0]["byteLength"] = len(blob)
    g.setdefault("asset", {})["extras"] = {
        "source": "Quaternius - Ultimate Monsters (CC0 1.0)",
        "url": "https://quaternius.com/packs/ultimatemonsters.html",
    }
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    blob += b"\0" * (-len(blob) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + blob)
    print(f"wrote {dst}: {total / 1024:.0f} KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
