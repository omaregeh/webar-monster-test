#!/usr/bin/env python3
"""Generate the printable ArUco marker sheets (markers/markers.pdf) and the
browser config (js/markers-config.js) from ONE list, so the website always
knows each marker's real printed size.

Run from the repo root:   .venv/bin/python tools/make_markers.py
"""
import json
import os

import cv2
import numpy as np
import qrcode
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_URL = "https://omaregeh.github.io/webar-monster-test/"

# OpenCV DICT_4X4_50. IDs 0,1,2 differ from each other by >= 8 of 16 bits in
# every rotation, so they can never be confused for one another.
DICT_NAME = "DICT_4X4_50"
MARKERS = [
    # id, name, black-square width in mm
    {"id": 0, "name": "Large", "size_mm": 150.0},
    {"id": 1, "name": "Medium", "size_mm": 100.0},
    {"id": 2, "name": "Small", "size_mm": 50.0},
]

PAGE_W, PAGE_H = letter  # points (612 x 792) = 215.9 x 279.4 mm
PRINTER_MARGIN = 0.25 * 72  # 0.25 inch in points
GRID = 6  # 4x4 data + 1-cell black border each side


def marker_bits(dictionary, marker_id):
    """6x6 matrix, 1 = white, 0 = black, straight from OpenCV."""
    img = cv2.aruco.generateImageMarker(dictionary, marker_id, GRID)
    return (img > 127).astype(np.uint8)


def draw_cells(c, bits, x0, y_top, cell):
    """Draw black cells. (x0, y_top) is the top-left corner in PDF points."""
    c.setFillColorRGB(0, 0, 0)
    n = bits.shape[0]
    for r in range(n):
        for col in range(n):
            if bits[r, col] == 0:
                c.rect(x0 + col * cell, y_top - (r + 1) * cell, cell, cell, stroke=0, fill=1)


def draw_qr(c, url, x0, y_top, size):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    m = np.array(qr.get_matrix(), dtype=bool)  # includes the 4-module border
    cell = size / m.shape[0]
    c.setFillColorRGB(0, 0, 0)
    for r in range(m.shape[0]):
        for col in range(m.shape[1]):
            if m[r, col]:
                # tiny overlap avoids hairline gaps in some PDF viewers
                c.rect(x0 + col * cell, y_top - (r + 1) * cell, cell + 0.05, cell + 0.05, stroke=0, fill=1)


def draw_ruler(c, x0, y, length=100 * mm):
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.6)
    c.line(x0, y, x0 + length, y)
    for i in range(0, 101):
        x = x0 + i * mm
        h = 4 * mm if i % 10 == 0 else (2.5 * mm if i % 5 == 0 else 1.2 * mm)
        c.setLineWidth(0.5 if i % 10 == 0 else 0.25)
        c.line(x, y, x, y + h)
    c.setFont("Helvetica", 7)
    for i in range(0, 101, 10):
        c.drawCentredString(x0 + i * mm, y - 3 * mm, str(i))
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x0 + length + 2 * mm, y - 1, "100 mm")


def draw_page(c, m, bits):
    size = m["size_mm"] * mm
    cell = size / GRID
    quiet = max(cell, 10 * mm)  # at least one cell of white all round
    zone = size + 2 * quiet
    top = PAGE_H - PRINTER_MARGIN - 2 * mm

    # Marker, centred horizontally, near the top
    mx = (PAGE_W - size) / 2
    my_top = top - quiet
    draw_cells(c, bits, mx, my_top, cell)

    # Light-grey corner ticks show where the white quiet zone ends (cut line).
    c.setStrokeColorRGB(0.7, 0.7, 0.7)
    c.setLineWidth(0.4)
    zx0, zy0, zx1, zy1 = (PAGE_W - zone) / 2, top - zone, (PAGE_W + zone) / 2, top
    t = 4 * mm
    for (x, y, dx, dy) in [(zx0, zy1, 1, -1), (zx1, zy1, -1, -1), (zx0, zy0, 1, 1), (zx1, zy0, -1, 1)]:
        c.line(x, y, x + dx * t, y)
        c.line(x, y, x, y + dy * t)

    # Info block under the marker
    left = PRINTER_MARGIN + 6 * mm
    info_top = top - zone - 6 * mm
    qr_size = 40 * mm if m["size_mm"] >= 150 else 50 * mm
    qr_x = PAGE_W - PRINTER_MARGIN - 4 * mm - qr_size
    draw_qr(c, SITE_URL, qr_x, info_top + 2 * mm, qr_size)
    c.setFont("Helvetica", 7)
    c.drawCentredString(qr_x + qr_size / 2, info_top + 2 * mm - qr_size - 1 * mm, "Scan with the iPhone Camera app")

    y = info_top - 6 * mm
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(left, y, f"{m['name']} marker  -  ID {m['id']}")
    y -= 8 * mm
    c.setFont("Helvetica", 12)
    c.drawString(left, y, f"Black square: {m['size_mm']:.0f} mm x {m['size_mm']:.0f} mm   (ArUco {DICT_NAME})")
    y -= 10 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, "Print at 100% / Actual size — do not fit to page")
    y -= 5.5 * mm
    c.setFont("Helvetica", 9)
    c.drawString(left, y, "Check: the ruler below must measure exactly 100 mm. Keep the white border around the marker.")
    y -= 13 * mm
    draw_ruler(c, left, y)
    c.setFont("Helvetica", 7)
    c.setFillColorRGB(0.35, 0.35, 0.35)
    c.drawString(left, PRINTER_MARGIN + 3 * mm, SITE_URL)


def main():
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, DICT_NAME))
    os.makedirs(os.path.join(ROOT, "markers"), exist_ok=True)

    pdf_path = os.path.join(ROOT, "markers", "markers.pdf")
    c = canvas.Canvas(pdf_path, pagesize=letter)
    c.setTitle("WebAR monster markers")
    c.setAuthor("webar-monster-test")
    config = []
    for m in MARKERS:
        bits = marker_bits(dictionary, m["id"])
        draw_page(c, m, bits)
        c.showPage()
        # Inner 4x4 data bits as a 16-char string, row-major, 1 = white.
        # This is exactly the format js-aruco2 uses for its dictionaries.
        data = "".join(str(b) for b in bits[1:5, 1:5].flatten())
        config.append({"id": m["id"], "name": m["name"], "sizeMm": m["size_mm"], "bits": data})
        # Preview PNG: 20 px per cell plus one white cell all round.
        png = cv2.aruco.generateImageMarker(dictionary, m["id"], GRID * 20)
        png = cv2.copyMakeBorder(png, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
        cv2.imwrite(os.path.join(ROOT, "markers", f"marker_id{m['id']}_{m['name'].lower()}.png"), png)
    c.save()

    js = (
        "// AUTO-GENERATED by tools/make_markers.py - do not edit by hand.\n"
        "// Each printed marker ID has its own known physical size.\n"
        f"export const SITE_URL = {json.dumps(SITE_URL)};\n"
        f"export const DICTIONARY = {json.dumps(DICT_NAME)};\n"
        f"export const MARKERS = {json.dumps(config, indent=2)};\n"
    )
    with open(os.path.join(ROOT, "js", "markers-config.js"), "w") as f:
        f.write(js)
    print("wrote", pdf_path)
    for m in config:
        print(f"  ID {m['id']}: {m['name']} {m['sizeMm']} mm  bits={m['bits']}")


if __name__ == "__main__":
    main()
