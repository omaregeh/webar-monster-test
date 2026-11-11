// One Euro filter (Casiez, Roussel, Vogel - CHI 2012).
// Smooths a lot when the marker is still (kills jitter) and very little when
// it moves fast (no lag). minCutoff: lower = smoother when still.
// beta: higher = less lag when moving.
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}
const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.reset();
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.last = null; this.tPrev = null; }
  filter(value, tSeconds) {
    if (this.tPrev === null) { this.tPrev = tSeconds; this.last = value; this.x.filter(value, 1); this.dx.filter(0, 1); return value; }
    const dt = Math.max(1e-3, tSeconds - this.tPrev);
    this.tPrev = tSeconds;
    const d = this.dx.filter((value - this.last) / dt, alpha(this.dCutoff, dt));
    this.last = value;
    return this.x.filter(value, alpha(this.minCutoff + this.beta * Math.abs(d), dt));
  }
}

// Filters an array of numbers (e.g. xyz or a quaternion) channel by channel.
export class OneEuroVec {
  constructor(n, minCutoff, beta, dCutoff) { this.f = Array.from({ length: n }, () => new OneEuro(minCutoff, beta, dCutoff)); }
  reset() { this.f.forEach((f) => f.reset()); }
  filter(arr, t) { return arr.map((v, i) => this.f[i].filter(v, t)); }
}
