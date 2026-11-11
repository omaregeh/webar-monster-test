#!/usr/bin/env python3
"""Render synthetic 'phone camera' views of each marker with a KNOWN pose, so
tools/verify_markers.mjs can check that the browser detector finds the right
ID and that js/pose.js recovers the right distance and tilt.

Run from repo root:  .venv/bin/python tools/make_test_images.py
"""
import json
import math
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from make_markers import DICT_NAME, MARKERS  # noqa: E402

OUT = os.path.join(ROOT, "tools", "test_images")
W, H = 640, 1138            # portrait frame, same as the browser's detection canvas
LONG_SIDE_FOV_DEG = 67.0    # must match CAMERA_LONG_SIDE_FOV_DEG in js/app.js
F = (max(W, H) / 2) / math.tan(math.radians(LONG_SIDE_FOV_DEG) / 2)
K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1]])


def rot(axis, deg):
    v = np.array(axis, float) * math.radians(deg)
    return cv2.Rodrigues(v)[0]


def render(bits, size_m, R, t, rng, blur=0.0, noise=4.0):
    # Texture: marker plus one cell of white quiet zone plus a bit more paper
    cells = 6 + 2 + 2
    px = 40
    tex = np.full((cells * px, cells * px), 255, np.uint8)
    for r in range(6):
        for c in range(6):
            if bits[r, c] == 0:
                tex[(r + 2) * px:(r + 3) * px, (c + 2) * px:(c + 3) * px] = 0
    S = size_m * cells / 6  # physical width of the texture
    Wt = tex.shape[1]
    A = np.array([[S / Wt, 0, -S / 2], [0, -S / Wt, S / 2], [0, 0, 1]])
    Hm = K @ np.column_stack([R[:, 0], R[:, 1], t]) @ A
    bg = np.full((H, W), 90, np.uint8)
    bg = (bg + rng.normal(0, 12, bg.shape)).clip(0, 255).astype(np.uint8)
    warped = cv2.warpPerspective(tex, Hm, (W, H), flags=cv2.INTER_AREA, borderValue=0)
    mask = cv2.warpPerspective(np.full_like(tex, 255), Hm, (W, H), flags=cv2.INTER_LINEAR)
    img = np.where(mask > 127, warped, bg).astype(np.float32)
    img = img * 0.8 + 25  # camera never sees pure black/white
    if blur > 0:
        img = cv2.GaussianBlur(img, (0, 0), blur)
    img += rng.normal(0, noise, img.shape)
    return cv2.cvtColor(img.clip(0, 255).astype(np.uint8), cv2.COLOR_GRAY2RGB)


def main():
    os.makedirs(OUT, exist_ok=True)
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, DICT_NAME))
    rng = np.random.default_rng(1)
    cases = []
    # (distance in marker-widths, tilt about X deg, tilt about Y deg, in-plane spin deg, blur)
    views = [(3, 0, 0, 0, 0), (4, 35, 0, 20, 0.6), (5, -40, 15, 120, 0.8),
             (6, 25, -30, 200, 1.0), (8, 50, 10, 300, 0.7), (10, 15, 20, 45, 0.5)]
    for m in MARKERS:
        bits = (cv2.aruco.generateImageMarker(d, m["id"], 6) > 127).astype(np.uint8)
        s = m["size_mm"] / 1000
        for k, (dist, ax, ay, spin, blur) in enumerate(views):
            # Marker faces the camera (its +Z towards camera = camera -Z), then tilt & spin.
            R = rot([1, 0, 0], 180) @ rot([1, 0, 0], ax) @ rot([0, 1, 0], ay) @ rot([0, 0, 1], spin)
            t = np.array([rng.uniform(-0.12, 0.12) * dist * s, rng.uniform(-0.3, 0.3) * dist * s, dist * s])
            img = render(bits, s, R, t, rng, blur=blur)
            name = f"synth_id{m['id']}_{k}.png"
            cv2.imwrite(os.path.join(OUT, name), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
            # OpenCV's own answer on the same image, for comparison
            det = cv2.aruco.ArucoDetector(d, cv2.aruco.DetectorParameters())
            corners, ids, _ = det.detectMarkers(img)
            cv_t = None
            if ids is not None and m["id"] in ids.flatten():
                c = corners[list(ids.flatten()).index(m["id"])].reshape(4, 2)
                h = s / 2
                objp = np.array([[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]])
                ok, rv, tv = cv2.solvePnP(objp, c, K, None, flags=cv2.SOLVEPNP_IPPE_SQUARE)
                cv_t = tv.flatten().tolist() if ok else None
            cases.append({"file": name, "id": m["id"], "sizeMm": m["size_mm"],
                          "R": R.flatten().tolist(), "t": t.tolist(), "opencv_t": cv_t})
    with open(os.path.join(OUT, "truth.json"), "w") as f:
        json.dump({"width": W, "height": H, "fx": F, "fy": F, "cx": W / 2, "cy": H / 2,
                   "cases": cases}, f, indent=1)
    print(f"wrote {len(cases)} images to {OUT}  (f = {F:.1f} px)")


if __name__ == "__main__":
    main()
