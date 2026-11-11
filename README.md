# WebAR monster test

Print a sheet, scan its QR code with an iPhone, and an animated 3D monster stands on the printed marker.

**Live site:** https://omaregeh.github.io/webar-monster-test/
**Markers to print:** [`markers/markers.pdf`](markers/markers.pdf) (3 pages: Large, Medium, Small)

## How it works (simple version)
1. The website opens the phone's rear camera (only after you tap **Start AR**).
2. Several times a second it shrinks the camera picture to 640 px wide and looks for the black-and-white square (an "ArUco marker").
3. Each marker has its own **ID number**, and the site knows each ID's real printed size:

   | Page | Marker ID | Black square |
   |------|-----------|--------------|
   | 1 – Large  | 0 | 150 mm |
   | 2 – Medium | 1 | 100 mm |
   | 3 – Small  | 2 | 50 mm  |

4. From the 4 corners of the square, plus its real size and the camera's field of view, it works out where the paper is in 3D. A "One Euro" filter smooths out the jitter.
5. The monster is drawn on top of the camera picture, about 1.5× the marker width tall. By default the sheet is expected to be **taped upright on a wall**, with the text at the bottom. The monster then stands upright in front of the sheet, feet at the bottom edge of the black square, facing out of the wall towards you.
6. If it loses the marker for half a second, the monster disappears and a small monster in the corner says **"Look back at the marker!"**.

Tap the **top-left corner** of the screen to show or hide the debug panel (FPS, marker ID, size, distance).

## Printing
- Open `markers/markers.pdf` and print on **US Letter** paper.
- In the print dialog choose **Actual size / 100%**. **Do NOT choose "Fit to page"** or "Shrink to fit".
- After printing, measure the ruler line at the bottom of the page with a real ruler: it must be exactly **100 mm**. If it isn't, the distance shown in the debug panel will be off. Re-print with scaling set to 100%.
- Matte paper works better than glossy paper, because glossy paper reflects light.
- Keep the white border around the black square. Don't trim into it.
- Tape the sheet **upright on a wall with the text at the bottom**, and keep it flat (no bulges). If the sheet is crooked, the monster will lean the same way.

## Tweaking
All the easy settings are at the top of [`js/app.js`](js/app.js):
- `CAMERA_LONG_SIDE_FOV_DEG` (default 67): the iPhone 16 main camera's field of view. If the debug distance reads too **far**, make this number a bit smaller. If it reads too **close**, make it a bit bigger.
- `MARKER_MOUNT`: `'wall'` (default) or `'table'` (sheet lying flat, monster standing on it).
- `WALL_FEET_AT`: where the monster's feet go on a wall, in marker widths from the centre (`-0.5` = bottom edge of the black square).
- `LOST_AFTER_MS`, `MONSTER_HEIGHT_IN_MARKER_WIDTHS`, `DETECT_WIDTH`, and the smoothing settings.

## Files
| Path | What it is |
|------|------------|
| `index.html`, `css/`, `js/` | The website (plain HTML/CSS/JS, no build step) |
| `js/markers-config.js` | Marker IDs, sizes and codes. **Auto-generated** by `tools/make_markers.py` |
| `js/pose.js` | Works out the marker's 3D position from its corners |
| `js/detect-worker.js`, `js/detector-core.js` | Marker detection, run in the background |
| `vendor/` | Copies of three.js 0.186.1 and js-aruco2 2.0.0 (no CDN needed) |
| `models/monster.glb` | The monster (Quaternius, CC0), 591 KB |
| `markers/` | The printable PDF and preview PNGs |
| `tools/` | Scripts that make the markers and check them |

## Re-making the markers (only if you change sizes or the site URL)
```bash
cd ~/webar-monster-test
python3 -m venv .venv
.venv/bin/pip install opencv-python-headless numpy reportlab "qrcode[pil]"
.venv/bin/python tools/make_markers.py
```

## Checking the markers with the browser's own detector
This runs the website's detector and pose code in Node. It checks the PDF pages (right ID, exact size in mm) and 18 fake camera views where the true distance and tilt are known.
```bash
cd ~/webar-monster-test
(cd tools && npm ci)
.venv/bin/python tools/make_test_images.py
pdftoppm -r 300 -png markers/markers.pdf tools/test_images/page300
pdftoppm -scale-to-x 640 -scale-to-y -1 -png markers/markers.pdf tools/test_images/page640
node tools/verify_markers.mjs
```
Last result: all 6 PDF pages were detected, with measured sizes of 149.9 / 100.0 / 49.9 mm. All 18 out of 18 fake camera views were detected, with distance error at most 1.5% and tilt error at most 1.6°.

## Testing on your computer
```bash
cd ~/webar-monster-test
python3 -m http.server 8000
```
Then open http://localhost:8000 in Chrome. (A phone can't use the camera over plain `http://`. Use the live https site for the phone.)

## Credits
See [CREDITS.md](CREDITS.md).
