// WebAR monster test - main app.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MARKERS } from './markers-config.js';
import { estimatePose } from './pose.js';
import { OneEuroVec } from './oneeuro.js';

// ============ EASY-TO-EDIT SETTINGS ============
// Field of view of the iPhone 16 main ("1x", 26 mm-equivalent) camera, measured
// across the LONG side of the video picture. If the debug distance reads too
// far, lower this a little; if it reads too close, raise it.
const CAMERA_LONG_SIDE_FOV_DEG = 67;
const DETECT_WIDTH = 640;          // detection runs on a frame this many px wide
const LOST_AFTER_MS = 500;         // hide the monster after this long without the marker
const MONSTER_HEIGHT_IN_MARKER_WIDTHS = 1.5;
const MONSTER_URL = 'models/monster.glb';
// One Euro smoothing (see js/oneeuro.js). Position is measured in marker widths.
const POS_FILTER = { minCutoff: 0.8, beta: 2.0, dCutoff: 1.0 };
const ROT_FILTER = { minCutoff: 0.8, beta: 3.0, dCutoff: 1.0 };
// ===============================================

const $ = (id) => document.getElementById(id);
const video = $('video');
const glCanvas = $('gl');
const lostEl = $('lost');
const debugEl = $('debug');
const hintEl = $('hint');

// ---------- friendly messages ----------
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IN_APP_RE = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|\bLine\/|Twitter|LinkedInApp|Snapchat|MicroMessenger|BytedanceWebview|musical_ly|TikTok|Pinterest|KAKAOTALK|Discord/i;
const inAppBrowser = IN_APP_RE.test(navigator.userAgent);

const MESSAGES = {
  https: {
    title: 'This page needs a secure (https) link',
    body: () => `<p>Browsers only allow the camera on secure pages. Please open:</p>
      <span class="url">${httpsUrl()}</span>`,
    retry: 'Open secure link', onRetry: () => { location.href = httpsUrl(); },
  },
  denied: {
    title: 'Camera access is blocked',
    body: () => isIOS ? `<p>To let this page use the camera:</p>
      <ol>
        <li>Tap the <b>aA</b> (or page settings) button on the left of Safari's address bar, then <b>Website Settings</b> &rarr; <b>Camera</b> &rarr; <b>Allow</b>.</li>
        <li>If that's not there: open the iPhone <b>Settings</b> app &rarr; <b>Apps</b> &rarr; <b>Safari</b> &rarr; <b>Camera</b> and choose <b>Ask</b> or <b>Allow</b>.</li>
        <li>Come back here and tap <b>Try again</b> (or reload the page).</li>
      </ol>
      <p class="small">Still blocked? Check Settings &rarr; Screen Time &rarr; Content &amp; Privacy Restrictions &rarr; Allowed Apps &rarr; Camera is on.</p>`
      : `<p>Allow camera access for this site in your browser's site settings (usually the icon next to the address), then tap <b>Try again</b>.</p>`,
    retry: 'Try again', onRetry: () => location.reload(),
  },
  nocamera: {
    title: 'No camera found',
    body: () => `<p>We couldn't find a camera on this device. Please open this page on a phone with a rear camera.</p>`,
    retry: 'Try again', onRetry: () => startAR(),
  },
  busy: {
    title: 'The camera is busy',
    body: () => `<p>Another app or tab might be using the camera. Close it (for example a video call), then tap <b>Try again</b>.</p>`,
    retry: 'Try again', onRetry: () => startAR(),
  },
  webgl: {
    title: '3D graphics are not available',
    body: () => `<p>This browser can't show 3D (WebGL is off or unsupported). Please use an up-to-date Safari or Chrome.</p>
      ${isIOS ? '<p class="small">On iPhone, make sure iOS is up to date. If you changed Safari\'s <b>Advanced &rarr; Feature Flags</b>, reset them.</p>' : ''}`,
    retry: 'Reload', onRetry: () => location.reload(),
  },
  inapp: {
    title: 'Please open this in Safari',
    body: () => `<p>This app's built-in browser doesn't allow the camera. Open the page in <b>Safari</b> (or Chrome):</p>
      <ol>
        <li>Tap the <b>&middot;&middot;&middot;</b> or share button (usually at the top or bottom right).</li>
        <li>Choose <b>Open in Safari</b> / <b>Open in browser</b>.</li>
      </ol>
      <p>Or copy this link into Safari:</p><span class="url">${location.href.split('#')[0]}</span>`,
    retry: 'Copy link', onRetry: copyLink,
    alt: 'Try here anyway', onAlt: () => { hideMessage(); startAR(true); },
  },
  generic: {
    title: 'Something went wrong',
    body: (detail) => `<p>We couldn't start the camera.</p><p class="small">${escapeHtml(detail || '')}</p>`,
    retry: 'Try again', onRetry: () => location.reload(),
  },
};

function httpsUrl() { return 'https://' + location.host + location.pathname + location.search; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function copyLink() {
  const url = location.href.split('#')[0];
  try { await navigator.clipboard.writeText(url); $('msgRetry').textContent = 'Copied!'; }
  catch { prompt('Copy this link:', url); }
}

function showMessage(key, detail) {
  const m = MESSAGES[key];
  $('msgTitle').textContent = m.title;
  $('msgBody').innerHTML = m.body(detail);
  $('msgRetry').textContent = m.retry;
  $('msgRetry').onclick = m.onRetry;
  const alt = $('msgAlt');
  alt.hidden = !m.alt;
  if (m.alt) { alt.textContent = m.alt; alt.onclick = m.onAlt; }
  $('start').hidden = true;
  $('message').hidden = false;
}
function hideMessage() { $('message').hidden = true; }

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

// ---------- 3D scene ----------
let renderer, scene, camera3d, anchor, monsterHolder, mainMixer, mainMaterials = [], shadowBlob;
let lostRenderer, lostScene, lostCamera, lostMixer;
let modelHeight = 1;
let lastFrameMs = performance.now();

async function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  camera3d = new THREE.PerspectiveCamera(50, 1, 0.01, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(0.5, 1, 1.5);
  scene.add(sun);

  // anchor = the marker. Its +Z axis sticks out of the paper.
  anchor = new THREE.Group();
  anchor.matrixAutoUpdate = true;
  anchor.visible = false;
  scene.add(anchor);
  // holder turns the Y-up model so it stands on the paper (Y -> marker +Z) and
  // faces the bottom edge of the printed page (where you usually stand).
  monsterHolder = new THREE.Group();
  monsterHolder.rotation.x = Math.PI / 2;
  anchor.add(monsterHolder);

  const gltf = await new GLTFLoader().loadAsync(MONSTER_URL);
  const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Idle') || gltf.animations[0];
  const waveClip = THREE.AnimationClip.findByName(gltf.animations, 'Wave') || idleClip;

  // Main monster (own materials so it can fade independently)
  const main = gltf.scene;
  main.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      o.material = o.material.clone();
      mainMaterials.push(o.material);
    }
  });
  mainMixer = new THREE.AnimationMixer(main);
  mainMixer.clipAction(idleClip).play();
  mainMixer.update(0);
  main.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(main);
  modelHeight = Math.max(0.001, box.max.y - Math.min(0, box.min.y));
  monsterHolder.add(main);

  // soft round shadow under the feet
  const sc = document.createElement('canvas');
  sc.width = sc.height = 128;
  const g = sc.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shadowBlob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadowBlob.position.z = 0.0005;
  anchor.add(shadowBlob);
  mainMaterials.push(shadowBlob.material);

  // Second copy for the "look back" overlay, waving at you
  lostRenderer = new THREE.WebGLRenderer({ canvas: $('lostgl'), alpha: true, antialias: true });
  lostRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  lostRenderer.setSize(160, 200, false);
  lostScene = new THREE.Scene();
  lostScene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 2.4));
  const sun2 = new THREE.DirectionalLight(0xffffff, 1.8);
  sun2.position.set(0.5, 1, 2);
  lostScene.add(sun2);
  const buddy = cloneSkinned(gltf.scene);
  buddy.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      // own opaque materials: the main monster's materials fade out when lost
      o.material = o.material.clone();
      o.material.transparent = false;
      o.material.opacity = 1;
    }
  });
  buddy.rotation.y = -0.35; // slight turn, still facing you
  lostScene.add(buddy);
  lostMixer = new THREE.AnimationMixer(buddy);
  lostMixer.clipAction(waveClip).play();
  const h = modelHeight;
  lostCamera = new THREE.PerspectiveCamera(30, 160 / 200, 0.1, 100);
  lostCamera.position.set(0, h * 0.55, h * 3.4);
  lostCamera.lookAt(0, h * 0.48, 0);
}

function setMonsterOpacity(a) {
  for (const m of mainMaterials) {
    const isShadow = m === shadowBlob.material;
    m.opacity = a;
    if (!isShadow) {
      const wantTransparent = a < 0.999;
      if (m.transparent !== wantTransparent) { m.transparent = wantTransparent; m.needsUpdate = true; }
    }
  }
}

// ---------- layout: match the 3D camera to the full-screen video ----------
let viewW = 0, viewH = 0;
function resize() {
  const r = $('stage').getBoundingClientRect();
  if (r.width === viewW && r.height === viewH) return;
  viewW = r.width; viewH = r.height;
  renderer.setSize(viewW, viewH, false);
}

function videoFocalPx() {
  const vw = video.videoWidth, vh = video.videoHeight;
  return (Math.max(vw, vh) / 2) / Math.tan(THREE.MathUtils.degToRad(CAMERA_LONG_SIDE_FOV_DEG) / 2);
}

function updateCameraProjection() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || !viewW) return;
  const s = Math.max(viewW / vw, viewH / vh); // object-fit: cover
  const fScreen = videoFocalPx() * s;          // focal length in CSS px on screen
  camera3d.aspect = viewW / viewH;
  camera3d.fov = THREE.MathUtils.radToDeg(2 * Math.atan(viewH / 2 / fScreen));
  camera3d.updateProjectionMatrix();
}

// ---------- detection loop (Web Worker) ----------
const detectCanvas = document.createElement('canvas');
const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });
let worker, workerBusy = false, spareBuffer = null, lastVideoTime = -1;
const stats = { detMs: 0, detCount: 0, detFps: 0, renderFps: 0, frames: 0, statT: performance.now() };

function initWorker() {
  return new Promise((resolve, reject) => {
    worker = new Worker('js/detect-worker.js');
    worker.onerror = (e) => reject(e);
    worker.onmessage = (e) => {
      if (e.data.type === 'ready') { worker.onmessage = onWorkerMessage; resolve(); }
    };
    worker.postMessage({ type: 'init', markers: MARKERS });
  });
}

function sendFrame() {
  if (workerBusy || video.readyState < 2 || !video.videoWidth) return;
  if (video.currentTime === lastVideoTime) return; // no new camera frame yet
  lastVideoTime = video.currentTime;
  const w = DETECT_WIDTH, h = Math.round(DETECT_WIDTH * video.videoHeight / video.videoWidth);
  if (detectCanvas.width !== w || detectCanvas.height !== h) { detectCanvas.width = w; detectCanvas.height = h; spareBuffer = null; }
  detectCtx.drawImage(video, 0, 0, w, h);
  const img = detectCtx.getImageData(0, 0, w, h);
  let buf = spareBuffer && spareBuffer.byteLength === img.data.byteLength ? new Uint8ClampedArray(spareBuffer) : null;
  if (buf) buf.set(img.data); else buf = img.data;
  workerBusy = true;
  worker.postMessage({ type: 'frame', width: w, height: h, buffer: buf.buffer, frameTime: performance.now() }, [buf.buffer]);
}

// ---------- tracking state ----------
const posFilter = new OneEuroVec(3, POS_FILTER.minCutoff, POS_FILTER.beta, POS_FILTER.dCutoff);
const rotFilter = new OneEuroVec(4, ROT_FILTER.minCutoff, ROT_FILTER.beta, ROT_FILTER.dCutoff);
let lastSeen = -Infinity, currentId = null, prevR = null, lastQ = null, everSeen = false;
const track = { id: null, name: '', sizeMm: 0, distCm: 0, rms: 0, hamming: 0 };
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();

function onWorkerMessage(e) {
  const msg = e.data;
  if (msg.type !== 'result') return;
  workerBusy = false;
  spareBuffer = msg.buffer;
  stats.detMs = msg.ms; stats.detCount++;
  if (!msg.markers.length) return;

  // Prefer the marker we're already tracking, otherwise the biggest one on screen.
  const perim = (c) => c.reduce((s, p, i) => s + Math.hypot(c[(i + 1) % 4].x - p.x, c[(i + 1) % 4].y - p.y), 0);
  let m = msg.markers.find((k) => k.id === currentId);
  if (!m) m = msg.markers.slice().sort((a, b) => perim(b.corners) - perim(a.corners))[0];

  const kScale = DETECT_WIDTH / video.videoWidth;
  const f = videoFocalPx() * kScale;
  const K = { fx: f, fy: f, cx: detectCanvas.width / 2, cy: detectCanvas.height / 2 };
  const size = m.sizeMm / 1000; // metres
  const pose = estimatePose(m.corners, size, K, m.id === currentId ? prevR : null);
  if (!pose) return;

  const now = performance.now();
  const wasLost = now - lastSeen > LOST_AFTER_MS;
  if (m.id !== currentId || wasLost) { posFilter.reset(); rotFilter.reset(); lastQ = null; }
  currentId = m.id;
  prevR = pose.R;
  lastSeen = now;
  everSeen = true;

  // OpenCV camera (y down, z forward) -> three.js camera (y up, z backward)
  const R = pose.R, t = pose.t;
  tmpM.set(
    R[0], R[1], R[2], t[0],
    -R[3], -R[4], -R[5], -t[1],
    -R[6], -R[7], -R[8], -t[2],
    0, 0, 0, 1);
  tmpM.decompose(tmpP, tmpQ, tmpS);
  if (lastQ && lastQ.dot(tmpQ) < 0) tmpQ.set(-tmpQ.x, -tmpQ.y, -tmpQ.z, -tmpQ.w); // same hemisphere

  const ts = msg.frameTime / 1000;
  const p = posFilter.filter([tmpP.x / size, tmpP.y / size, tmpP.z / size], ts);
  const q = rotFilter.filter([tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w], ts);
  anchor.position.set(p[0] * size, p[1] * size, p[2] * size);
  anchor.quaternion.set(q[0], q[1], q[2], q[3]).normalize();
  lastQ = anchor.quaternion.clone();

  const sMon = (MONSTER_HEIGHT_IN_MARKER_WIDTHS * size) / modelHeight;
  monsterHolder.scale.setScalar(sMon);
  shadowBlob.scale.setScalar(size * 0.9);

  Object.assign(track, { id: m.id, name: m.name, sizeMm: m.sizeMm, distCm: Math.hypot(...t) * 100, rms: pose.rmsPx, hamming: m.hamming });
}

// ---------- render loop ----------
let monsterOpacity = 0, debugOn = false;

function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now();
  const dt = Math.min((nowMs - lastFrameMs) / 1000, 0.1);
  lastFrameMs = nowMs;
  resize();
  updateCameraProjection();
  sendFrame();

  const now = performance.now();
  const tracking = now - lastSeen <= LOST_AFTER_MS;
  const target = tracking ? 1 : 0;
  monsterOpacity += Math.sign(target - monsterOpacity) * Math.min(Math.abs(target - monsterOpacity), dt / 0.3);
  anchor.visible = monsterOpacity > 0.01;
  setMonsterOpacity(monsterOpacity);
  mainMixer.update(dt);
  renderer.render(scene, camera3d);

  // overlay appears after LOST_AFTER_MS without the marker (also before the first sighting)
  const showLost = !tracking && arRunning;
  lostEl.classList.toggle('show', showLost);
  if (showLost || parseFloat(getComputedStyle(lostEl).opacity) > 0.01) {
    lostMixer.update(dt);
    lostRenderer.render(lostScene, lostCamera);
  }

  stats.frames++;
  if (now - stats.statT > 500) {
    const s = (now - stats.statT) / 1000;
    stats.renderFps = stats.frames / s; stats.detFps = stats.detCount / s;
    stats.frames = 0; stats.detCount = 0; stats.statT = now;
    if (debugOn) updateDebug(tracking);
  }
}

function updateDebug(tracking) {
  const track0 = video.srcObject && video.srcObject.getVideoTracks()[0];
  debugEl.textContent = [
    `FPS        ${stats.renderFps.toFixed(0)} render / ${stats.detFps.toFixed(0)} detect (${stats.detMs.toFixed(0)} ms)`,
    `Marker     ${tracking ? `ID ${track.id} (${track.name})` : 'not seen'}`,
    `Size       ${tracking ? track.sizeMm + ' mm' : '-'}`,
    `Distance   ${tracking ? track.distCm.toFixed(1) + ' cm' : '-'}`,
    `Fit error  ${tracking ? track.rms.toFixed(2) + ' px, ' + track.hamming + ' bad bits' : '-'}`,
    `Video      ${video.videoWidth}x${video.videoHeight}, detect ${detectCanvas.width}x${detectCanvas.height}`,
    `Focal      ${videoFocalPx().toFixed(0)} px (FOV ${CAMERA_LONG_SIDE_FOV_DEG} deg)`,
    `Camera     ${track0 ? track0.label : '-'}`,
  ].join('\n');
}

$('debugHit').addEventListener('click', () => {
  debugOn = !debugOn;
  debugEl.hidden = !debugOn;
  hintEl.classList.remove('show');
  if (debugOn) updateDebug(performance.now() - lastSeen <= LOST_AFTER_MS);
});

// ---------- camera start ----------
let arRunning = false, threeReady = null;

async function startAR(force = false) {
  hideMessage();
  if (!window.isSecureContext) return showMessage('https');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return showMessage(inAppBrowser || isIOS ? 'inapp' : 'generic', 'This browser does not support camera access.');
  }
  if (inAppBrowser && !force) return showMessage('inapp');
  $('startBtn').disabled = true;
  $('startBtn').textContent = 'Starting camera…';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  } catch (err) {
    resetStartButton();
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') {
      return showMessage(inAppBrowser ? 'inapp' : 'denied');
    }
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return showMessage('nocamera');
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return showMessage('busy');
    if (n === 'NotSupportedError' || n === 'TypeError') return showMessage(inAppBrowser ? 'inapp' : 'generic', `${n}: ${err.message}`);
    return showMessage('generic', `${n || 'Error'}: ${(err && err.message) || err}`);
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true;
  try { await video.play(); } catch (e) { /* autoplay muted should be fine; keep going */ }
  stream.getVideoTracks()[0].addEventListener('ended', () => { if (document.visibilityState === 'visible') restartCamera(); });

  try { await threeReady; } catch (e) { return showMessage('generic', 'Could not load the monster: ' + (e.message || e)); }
  $('start').hidden = true;
  if (!arRunning) {
    arRunning = true;
    lastSeen = -Infinity;
    hintEl.classList.add('show');
    setTimeout(() => hintEl.classList.remove('show'), 5000);
    requestAnimationFrame(frame);
  }
}

function resetStartButton() { $('startBtn').disabled = false; $('startBtn').textContent = 'Start AR'; }

async function restartCamera() {
  const old = video.srcObject;
  if (old) old.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  await startAR(true);
}

// iOS stops the camera when you leave the page; restart it when you come back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !arRunning) return;
  const tr = video.srcObject && video.srcObject.getVideoTracks()[0];
  if (!tr || tr.readyState === 'ended') restartCamera();
  else video.play().catch(() => {});
});
window.addEventListener('scroll', () => hintEl.classList.remove('show'), { passive: true });

// ---------- boot ----------
(function boot() {
  if (!window.isSecureContext) return showMessage('https');
  if (!hasWebGL()) return showMessage('webgl');
  if (inAppBrowser) showMessage('inapp');
  threeReady = Promise.all([initThree(), initWorker()]);
  threeReady.then(resetStartButton).catch((e) => showMessage('generic', 'Could not load: ' + (e.message || e)));
  $('startBtn').addEventListener('click', () => startAR());
})();
