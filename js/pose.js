// Marker pose from 4 corners + known marker size + camera focal length.
//
// Coordinates follow the OpenCV convention:
//   camera:  x right, y down, z forward (into the scene)
//   marker:  origin at centre, X to the marker's right, Y to the marker's top,
//            Z out of the paper (towards the viewer)
// Corner order (same as js-aruco2): top-left, top-right, bottom-right, bottom-left.
//
// Method: homography -> initial pose -> Levenberg-Marquardt refinement of the
// reprojection error. Because a flat square seen almost head-on can be read
// two ways (the "flip" ambiguity), we also refine the mirrored solution and
// keep the better one (or the one closest to the previous pose if they tie).

// ---------- tiny linear-algebra helpers (3x3 as row-major arrays of 9) ----------
const matMul = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const col = (R, j) => [R[j], R[3 + j], R[6 + j]];
const fromCols = (c0, c1, c2) => [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];

// Rodrigues: rotation vector -> matrix
function rodrigues(w) {
  const th = norm(w);
  if (th < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
  const k = scale(w, 1 / th), c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  const [x, y, z] = k;
  return [
    c + x * x * v, x * y * v - z * s, x * z * v + y * s,
    y * x * v + z * s, c + y * y * v, y * z * v - x * s,
    z * x * v - y * s, z * y * v + x * s, c + z * z * v,
  ];
}

// Closest rotation to (c0, c1) using a symmetric Gram-Schmidt.
function orthonormalize(c0, c1) {
  let a = scale(c0, 1 / norm(c0)), b = scale(c1, 1 / norm(c1));
  const m = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mn = scale(m, 1 / norm(m)), dn = scale(d, 1 / norm(d));
  a = scale([mn[0] + dn[0], mn[1] + dn[1], mn[2] + dn[2]], Math.SQRT1_2);
  b = scale([mn[0] - dn[0], mn[1] - dn[1], mn[2] - dn[2]], Math.SQRT1_2);
  return fromCols(a, b, cross(a, b));
}

// Solve A x = b (n x n, row-major), Gaussian elimination with partial pivoting.
function solve(A, b, n) {
  const M = A.slice(), x = b.slice();
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r * n + i]) > Math.abs(M[p * n + i])) p = r;
    if (Math.abs(M[p * n + i]) < 1e-15) return null;
    if (p !== i) {
      for (let c = 0; c < n; c++) [M[i * n + c], M[p * n + c]] = [M[p * n + c], M[i * n + c]];
      [x[i], x[p]] = [x[p], x[i]];
    }
    for (let r = i + 1; r < n; r++) {
      const f = M[r * n + i] / M[i * n + i];
      for (let c = i; c < n; c++) M[r * n + c] -= f * M[i * n + c];
      x[r] -= f * x[i];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let c = i + 1; c < n; c++) s -= M[i * n + c] * x[c];
    x[i] = s / M[i * n + i];
  }
  return x;
}

// ---------- pose ----------
function objectPoints(size) {
  const h = size / 2;
  return [[-h, h], [h, h], [h, -h], [-h, -h]];
}

// Homography mapping marker plane (X, Y) to normalized image coords (x, y).
function homography(obj, img) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = obj[i], [x, y] = img[i];
    A.push(X, Y, 1, 0, 0, 0, -x * X, -x * Y); b.push(x);
    A.push(0, 0, 0, X, Y, 1, -y * X, -y * Y); b.push(y);
  }
  const h = solve(A, b, 8);
  return h ? [...h, 1] : null;
}

function residuals(R, t, obj, img, out) {
  for (let i = 0; i < 4; i++) {
    const [X, Y] = obj[i];
    const px = R[0] * X + R[1] * Y + t[0];
    const py = R[3] * X + R[4] * Y + t[1];
    const pz = R[6] * X + R[7] * Y + t[2];
    out[2 * i] = px / pz - img[i][0];
    out[2 * i + 1] = py / pz - img[i][1];
  }
  return out;
}
const sumSq = (r) => r.reduce((s, v) => s + v * v, 0);

// Levenberg-Marquardt on 6 parameters (small rotation vector + translation).
function refine(R0, t0, obj, img, iters = 12) {
  let R = R0, t = t0.slice();
  const r = new Array(8), rp = new Array(8), J = new Array(48);
  residuals(R, t, obj, img, r);
  let err = sumSq(r), lambda = 1e-3;
  for (let it = 0; it < iters; it++) {
    // numeric Jacobian
    for (let k = 0; k < 6; k++) {
      const e = k < 3 ? 1e-6 : 1e-6 * Math.max(1e-3, Math.abs(t[2]));
      let Rk = R, tk = t;
      if (k < 3) { const w = [0, 0, 0]; w[k] = e; Rk = matMul(rodrigues(w), R); }
      else { tk = t.slice(); tk[k - 3] += e; }
      residuals(Rk, tk, obj, img, rp);
      for (let i = 0; i < 8; i++) J[i * 6 + k] = (rp[i] - r[i]) / e;
    }
    const JtJ = new Array(36).fill(0), Jtr = new Array(6).fill(0);
    for (let i = 0; i < 8; i++)
      for (let a = 0; a < 6; a++) {
        Jtr[a] -= J[i * 6 + a] * r[i];
        for (let c = 0; c < 6; c++) JtJ[a * 6 + c] += J[i * 6 + a] * J[i * 6 + c];
      }
    let improved = false;
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const A = JtJ.slice();
      for (let a = 0; a < 6; a++) A[a * 6 + a] *= 1 + lambda;
      const d = solve(A, Jtr, 6);
      if (!d) break;
      const Rn = matMul(rodrigues([d[0], d[1], d[2]]), R);
      const tn = [t[0] + d[3], t[1] + d[4], t[2] + d[5]];
      residuals(Rn, tn, obj, img, rp);
      const en = sumSq(rp);
      if (en < err) {
        R = Rn; t = tn; err = en; for (let i = 0; i < 8; i++) r[i] = rp[i];
        lambda = Math.max(lambda / 10, 1e-9); improved = true;
      } else lambda *= 10;
    }
    if (!improved || err < 1e-14) break;
  }
  return { R, t, err };
}

// Rotation taking unit vector a onto unit vector b (minimal angle).
function rotBetween(a, b) {
  const ax = cross(a, b), s = norm(ax), c = dot(a, b);
  if (s < 1e-12) return c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : rodrigues([Math.PI, 0, 0]);
  return rodrigues(scale(ax, Math.atan2(s, c) / s));
}

// Angle between two rotation matrices (radians).
export function rotationDistance(A, B) {
  // trace(A^T B)
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += A[j * 3 + i] * B[j * 3 + i];
  return Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
}

/**
 * @param corners [{x,y}] x4 in pixels (TL, TR, BR, BL)
 * @param size    marker black-square width (any unit; t comes back in the same unit)
 * @param K       {fx, fy, cx, cy} in pixels
 * @param prevR   optional previous rotation (row-major 9) to break ties
 * @returns {R, t, rmsPx} or null
 */
export function estimatePose(corners, size, K, prevR = null) {
  const obj = objectPoints(size);
  const img = corners.map((p) => [(p.x - K.cx) / K.fx, (p.y - K.cy) / K.fy]);
  const H = homography(obj, img);
  if (!H) return null;
  let h1 = [H[0], H[3], H[6]], h2 = [H[1], H[4], H[7]], h3 = [H[2], H[5], H[8]];
  let lam = 2 / (norm(h1) + norm(h2));
  if (h3[2] * lam < 0) lam = -lam; // marker must be in front of the camera
  const R0 = orthonormalize(scale(h1, lam), scale(h2, lam));
  const t0 = scale(h3, lam);

  const A = refine(R0, t0, obj, img);

  // Mirrored ("flipped") candidate: reflect the plane normal about the line of sight.
  const v = scale(A.t, 1 / norm(A.t));
  const n = col(A.R, 2);
  const nd = dot(n, v);
  const n2 = [2 * nd * v[0] - n[0], 2 * nd * v[1] - n[1], 2 * nd * v[2] - n[2]];
  const B = refine(matMul(rotBetween(n, scale(n2, 1 / norm(n2))), A.R), A.t, obj, img);

  let best = A;
  const valid = (s) => s.t[2] > 0 && Number.isFinite(s.err);
  if (valid(B)) {
    if (B.err < A.err * 0.5) best = B;               // clearly better
    else if (B.err < A.err * 2 && prevR &&            // ambiguous: stay consistent
             rotationDistance(B.R, prevR) < rotationDistance(A.R, prevR)) best = B;
  }
  if (!valid(best)) return null;
  const rmsPx = Math.sqrt(best.err / 4) * K.fx;
  return { R: best.R, t: best.t, rmsPx };
}
