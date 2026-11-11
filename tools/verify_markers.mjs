// Runs the SAME detector + pose code the website uses, in Node, on:
//   1. the printed PDF pages rendered to PNG (checks ID, corner order and real mm size)
//   2. synthetic camera views with a known pose (checks distance & tilt accuracy)
//
// Usage (from repo root):
//   cd tools && npm ci && cd ..
//   .venv/bin/python tools/make_test_images.py
//   pdftoppm -r 300 -png markers/markers.pdf tools/test_images/page300
//   pdftoppm -scale-to-x 640 -scale-to-y -1 -png markers/markers.pdf tools/test_images/page640
//   node tools/verify_markers.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const AR = require(path.join(root, 'vendor/js-aruco2/aruco.js')).AR;
const { createDetector } = require(path.join(root, 'js/detector-core.js'));
const { estimatePose, rotationDistance } = await import(path.join(root, 'js/pose.js'));
const { MARKERS } = await import(path.join(root, 'js/markers-config.js'));

const det = createDetector(AR, MARKERS);
const imgDir = path.join(here, 'test_images');
const load = (f) => PNG.sync.read(readFileSync(path.join(imgDir, f)));
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

// ---------- 1. PDF pages ----------
console.log('PDF pages @300 dpi (full res) and @640 px wide (browser detection size):');
const pages = readdirSync(imgDir).filter((f) => /^page(300|640)-\d\.png$/.test(f)).sort();
if (pages.length !== 6) fail(`expected 6 rendered pages, found ${pages.length}`);
for (const f of pages) {
  const img = load(f);
  const pageIdx = Number(f.match(/-(\d)\.png/)[1]) - 1;
  const expected = MARKERS[pageIdx];
  const found = det.detect(img);
  if (found.length !== 1 || found[0].id !== expected.id) {
    fail(`${f}: expected only ID ${expected.id}, got ${JSON.stringify(found.map((m) => m.id))}`);
    continue;
  }
  const c = found[0].corners;
  // corner 0 must be the marker's top-left as printed (smallest x+y on an upright page)
  const sums = c.map((p) => p.x + p.y);
  if (sums.indexOf(Math.min(...sums)) !== 0) fail(`${f}: corner order is not TL,TR,BR,BL`);
  let msg = `  ${f}: ID ${found[0].id} (${expected.name}) found, corner order OK`;
  if (f.startsWith('page300')) {
    const side = [0, 1, 2, 3].map((i) => Math.hypot(c[(i + 1) % 4].x - c[i].x, c[(i + 1) % 4].y - c[i].y));
    const mmSize = (side.reduce((a, b) => a + b) / 4 / 300) * 25.4;
    msg += `, measured ${mmSize.toFixed(2)} mm (expected ${expected.sizeMm})`;
    if (Math.abs(mmSize - expected.sizeMm) > 0.6) fail(`${f}: size ${mmSize.toFixed(2)} mm`);
  }
  console.log(msg);
}

// ---------- 2. synthetic views with known pose ----------
const truth = JSON.parse(readFileSync(path.join(imgDir, 'truth.json'), 'utf8'));
const K = { fx: truth.fx, fy: truth.fy, cx: truth.cx, cy: truth.cy };
console.log(`\nSynthetic camera views (${truth.width}x${truth.height}, f=${K.fx.toFixed(0)} px):`);
console.log('  file              id   dist(cm) true   est   err%   tilt err   OpenCV dist');
let worstD = 0, worstR = 0, detected = 0;
for (const cse of truth.cases) {
  const img = load(cse.file);
  const t0 = performance.now();
  const found = det.detect(img).filter((m) => m.id === cse.id);
  const ms = performance.now() - t0;
  const others = det.detect(img).filter((m) => m.id !== cse.id);
  if (others.length) fail(`${cse.file}: false detection of ID ${others.map((o) => o.id)}`);
  if (!found.length) { fail(`${cse.file}: ID ${cse.id} not detected`); continue; }
  detected++;
  const size = cse.sizeMm / 1000;
  const p = estimatePose(found[0].corners, size, K);
  if (!p) { fail(`${cse.file}: pose failed`); continue; }
  const dTrue = Math.hypot(...cse.t), dEst = Math.hypot(...p.t);
  const dErr = (100 * Math.abs(dEst - dTrue)) / dTrue;
  const rErr = (rotationDistance(p.R, cse.R) * 180) / Math.PI;
  worstD = Math.max(worstD, dErr); worstR = Math.max(worstR, rErr);
  const cv = cse.opencv_t ? (Math.hypot(...cse.opencv_t) * 100).toFixed(1) : '  -';
  console.log(`  ${cse.file.padEnd(17)} ${cse.id}   ${(dTrue * 100).toFixed(1).padStart(6)} ${(dEst * 100).toFixed(1).padStart(6)}  ${dErr.toFixed(1).padStart(5)}  ${rErr.toFixed(1).padStart(6)} deg  ${cv.padStart(6)}   (${ms.toFixed(0)} ms)`);
  if (dErr > 5) fail(`${cse.file}: distance error ${dErr.toFixed(1)}%`);
  if (rErr > 10) fail(`${cse.file}: tilt error ${rErr.toFixed(1)} deg`);
}
console.log(`\nDetected ${detected}/${truth.cases.length} synthetic views. Worst distance error ${worstD.toFixed(1)}%, worst tilt error ${worstR.toFixed(1)} deg.`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
