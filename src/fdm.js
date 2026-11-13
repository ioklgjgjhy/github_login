// ============================================================================
// Modèle de vol hélicoptère classe NH90 (10 t, rotor quadripale 16,3 m)
// 6 degrés de liberté, repères : monde NED (nord, est, bas), corps FRD (avant, droite, bas)
// - rotor principal : élément de pale + quantité de mouvement, inflow dynamique,
//   battement (plan de disque) du 1er ordre, raideur de moyeu, effet de sol,
//   état d'anneaux tourbillonnaires (vortex), décrochage
// - rotor anticouple, dérive, empennage horizontal, traînée fuselage
// - turbines + régulation Nr (FADEC), panne moteur, autorotation
// - train tricycle (ressorts/amortisseurs/frottement) sur sol fixe ou pont mobile
// Aucune dépendance graphique : testable sous Node.
// ============================================================================

export const G = 9.80665;
const D2R = Math.PI / 180;

export const NH90 = {
  mass: 9800,                 // kg (masse mission ; MTOW 10 600)
  Ixx: 11000, Iyy: 70000, Izz: 65000, Ixz: 3000,
  // rotor principal
  R: 8.15, nb: 4, chord: 0.65, a: 5.7,
  omega0: 26.87,              // rad/s (256,6 tr/min) -> 219 m/s en bout de pale
  lock: 8.2,                  // nombre de Lock
  Jrot: 12000,                // inertie rotor + chaîne (kg m²)
  hub: [0.0, 0, -2.5],        // position moyeu / CG (m, corps)
  shaftTilt: 3 * D2R,         // inclinaison mât vers l'avant
  Khub: 240000,               // raideur de moyeu (N m/rad) – excentricité équivalente ~4,5 %
  cd0: 0.0095, kInd: 1.15,
  th0Min: 1.0 * D2R, th0Max: 19 * D2R,   // pas collectif à 0,75 R
  a0: 0.06,                   // conicité moyenne (rad)
  dir: 1,                     // +1 : rotor antihoraire vu de dessus (pale avançante à droite)
  // rotor anticouple
  Rt: 1.6, sigT: 0.2, omegaTRatio: 4.65, tail: [-9.7, 0, -2.0],
  thTMin: -8 * D2R, thTMax: 27 * D2R,
  // surfaces
  fx: 3.1, fy: 18, fz: 25,    // surfaces de traînée équivalentes (m²)
  stab: { S: 2.3, x: -9.0, z: -0.3, cla: 3.5 },
  fin: { S: 2.8, x: -9.6, z: -1.0, cla: 3.0, inc: 0.04 },
  // moteurs (2 x RTM322 / T700)
  P100: 3.0e6,                // W pour 100 % de couple (limite BTP)
  PmaxAEO: 3.3e6, PmaxOEI: 1.85e6, Pacc: 60e3, eta: 0.97,
  fuelMax: 2000, sfc: 0.29 / 3.6e6, // kg/J
  // train (x, y, z corps ; k N/m ; c N s/m)
  gear: [
    { r: [4.4, 0, 1.9], k: 250e3, c: 28e3, main: false },
    { r: [-1.75, -1.6, 1.9], k: 350e3, c: 42e3, main: true },
    { r: [-1.75, 1.6, 1.9], k: 350e3, c: 42e3, main: true },
  ],
  // points de structure pour la détection de collision
  hull: [[6.3, 0, 0.6], [0, 0, 1.3], [-11.6, 0, -0.6], [-9.9, 0, 0.1],
         [8.1, 0, -2.6], [-8.1, 0, -2.6], [0, 8.1, -2.6], [0, -8.1, -2.6]],
};

// ---------- petites fonctions quaternion / vecteur ----------
export function qFromEuler(phi, theta, psi) {
  const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2), cp = Math.cos(theta / 2), sp = Math.sin(theta / 2),
    cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}
export function qRot(q, v) { // corps -> monde
  const [w, x, y, z] = q, [a, b, c] = v;
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
}
export function qRotInv(q, v) { return qRot([q[0], -q[1], -q[2], -q[3]], v); }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class HeliFDM {
  constructor(params = {}) {
    this.p = { ...NH90, ...params };
    this.brakes = true;
    this.engFail = 0;          // 0 : 2 moteurs, 1 : un moteur en panne, 2 : panne totale
    this.reset({});
  }

  reset({ n = 0, e = 0, alt = 0, psi = 0, u = 0, theta = 0, phi = 0, fuel = 1400 } = {}) {
    const p = this.p;
    this.pos = [n, e, -alt];
    this.vb = [u, 0, 0];
    this.q = qFromEuler(phi, theta, psi);
    this.om = [0, 0, 0];
    this.omega = p.omega0;
    this.vi = 10; this.viT = 12;
    this.tiltF = 0; this.tiltR = 0;
    this.Qe = 60000; this.govI = 0; this.Qff = 60000;
    this.fuel = fuel;
    this.crashed = null; this.wow = 0; this.wowAll = false;
    this.gearLoad = [0, 0, 0];
    this.T = 0; this.Tt = 0; this.tq = 0; this.nz = 1; this.nr = 100; this.Peng = 0; this.ge = 1;
    this.vrs = 0; this.mu = 0; this.agl = 0; this.surf = null;
    this.maxTouchVs = 0; this.lastAirVs = 0;
    this.accB = [0, 0, 0];
    this.updateDerived([0, 0, 0]);
  }

  get totalMass() { return this.p.mass - 1400 + this.fuel; }

  updateDerived(wind) {
    const [w, x, y, z] = this.q;
    this.phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    this.theta = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
    this.psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    this.vw = qRot(this.q, this.vb);                   // vitesse sol NED
    const wb = qRotInv(this.q, wind);
    this.va = [this.vb[0] - wb[0], this.vb[1] - wb[1], this.vb[2] - wb[2]]; // vitesse air corps
    this.tas = Math.hypot(this.va[0], this.va[1], this.va[2]);
    this.alt = -this.pos[2];
    this.vs = -this.vw[2];
    this.gs = Math.hypot(this.vw[0], this.vw[1]);
  }

  // ctl : { th0, B1, A1, thT } angles de pale (rad) ; env : { wind[3] NED, rho, surface(n,e), gustM[3] }
  step(dt, ctl, env) {
    if (this.crashed) return;
    const p = this.p, m = this.totalMass, rho = env.rho ?? 1.225;
    const q = this.q, om = this.om, vb = this.vb;
    const wb = qRotInv(q, env.wind);
    const va = [vb[0] - wb[0], vb[1] - wb[1], vb[2] - wb[2]];
    let F = [0, 0, 0], M = [0, 0, 0];
    const addF = (r, f) => { F[0] += f[0]; F[1] += f[1]; F[2] += f[2]; const c = cross(r, f); M[0] += c[0]; M[1] += c[1]; M[2] += c[2]; };

    // ---------------- surface sous l'appareil / effet de sol ----------------
    const surf = env.surface(this.pos[0], this.pos[1]);
    this.surf = surf;
    const agl = -this.pos[2] - surf.h;
    this.agl = agl;
    const zr = Math.max(agl - p.hub[2], 0.35 * p.R);     // hauteur rotor / surface

    // ---------------- rotor principal ----------------
    const A = Math.PI * p.R * p.R, sig = p.nb * p.chord / (Math.PI * p.R);
    const OR = this.omega * p.R;
    const vh = [va[0] + om[1] * p.hub[2] - om[2] * p.hub[1], va[1] + om[2] * p.hub[0] - om[0] * p.hub[2], va[2] + om[0] * p.hub[1] - om[1] * p.hub[0]];
    const tF = this.tiltF + p.shaftTilt, tR = this.tiltR;
    let nx = Math.sin(tF), ny = Math.sin(tR), nz = -Math.cos(tF) * Math.cos(tR);
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const wUp = vh[0] * nx + vh[1] * ny + vh[2] * nz;    // vitesse du moyeu le long de l'axe de poussée
    const vin = Math.sqrt(Math.max(vh[0] ** 2 + vh[1] ** 2 + vh[2] ** 2 - wUp * wUp, 0));
    const mu = vin / Math.max(OR, 1);
    this.mu = mu;
    // effet de sol (Cheeseman-Bennett), s'efface avec la vitesse
    const ge = 1 - Math.min(0.5, (p.R / (4 * zr)) ** 2) / (1 + (vin / Math.max(this.vi, 2)) ** 2);
    this.ge = ge;
    const viE = this.vi * ge;
    const lam = (viE + wUp) / Math.max(OR, 1);
    const qA = rho * A * OR * OR;
    let T = qA * (sig * p.a / 2) * (ctl.th0 / 3 * (1 + 1.5 * mu * mu) - lam / 2);
    const Tmax = 0.17 * sig * qA;
    if (T > 0.8 * Tmax) T = 0.8 * Tmax + 0.2 * Tmax * Math.tanh((T - 0.8 * Tmax) / (0.2 * Tmax)); // décrochage progressif
    if (T < -0.3 * Tmax) T = -0.3 * Tmax;
    // inflow dynamique + vortex (plancher sur la vitesse de transport => perte de portance en descente verticale rapide)
    const vhov = Math.sqrt(Math.abs(m * G) / (2 * rho * A));
    const Vt = Math.hypot(vin, wUp + this.vi, 0.25 * vhov);
    const mApp = 0.637 * rho * (4 / 3) * Math.PI * p.R ** 3;
    this.vi += dt * (T - 2 * rho * A * this.vi * Vt) / mApp;
    this.vi = clamp(this.vi, 0, 60);
    // indicateur d'état de vortex (0..1) : descente dans son propre souffle à faible vitesse
    const vrs = sstep(-wUp / vhov, 0.45, 0.9) * (1 - sstep(vin / vhov, 0.6, 1.2)) * (T > 0.3 * m * G ? 1 : 0);
    this.vrs += (vrs - this.vrs) * Math.min(1, dt * 3);
    if (this.vrs > 0.05) T *= 1 + this.vrs * 0.12 * (env.noise ? env.noise() : 0);
    this.T = T;
    // battement : inclinaison du plan de disque (1er ordre)
    const tauF = 16 / (p.lock * Math.max(this.omega, 5));
    const kfb = Math.max(0, 8 / 3 * ctl.th0 - 2 * lam);
    const mux = vh[0] / Math.max(OR, 1), muy = vh[1] / Math.max(OR, 1);
    const tFss = ctl.B1 - kfb * mux + tauF * om[1];
    const tRss = ctl.A1 - kfb * muy - tauF * om[0]
      + p.dir * (1.33 * p.a0 * mux + 0.010 * 2 * mu * 0.06 / (mu * mu + 0.0036) * Math.sign(mux));
    const kf = Math.min(1, dt / tauF);
    this.tiltF += (clamp(tFss, -0.3, 0.3) - this.tiltF) * kf;
    this.tiltR += (clamp(tRss, -0.3, 0.3) - this.tiltR) * kf;
    addF(p.hub, [T * nx, T * ny, T * nz]);
    const kOm = (this.omega / p.omega0) ** 2;
    M[1] -= p.Khub * kOm * this.tiltF;
    M[0] += p.Khub * kOm * this.tiltR;
    // puissance rotor
    const cd = p.cd0 * (1 + 3 * Math.max(0, Math.abs(T) / Tmax - 0.6) ** 2 + 40 * Math.max(0, mu - 0.28) ** 2); // décrochage + compressibilité
    const Pmain = T * (p.kInd * viE + wUp) + rho * A * OR ** 3 * sig * cd / 8 * (1 + 4.65 * mu * mu);

    // ---------------- rotor anticouple ----------------
    const At = Math.PI * p.Rt * p.Rt, ORt = this.omega * p.omegaTRatio * p.Rt;
    const tl = p.tail;
    const vt = [va[0] + om[1] * tl[2], va[1] + om[2] * tl[0] - om[0] * tl[2], va[2] - om[1] * tl[0]];
    const muT = Math.hypot(vt[0], vt[2]) / Math.max(ORt, 1);
    const lamT = (this.viT + vt[1]) / Math.max(ORt, 1);
    const qAt = rho * At * ORt * ORt;
    let Tt = qAt * (p.sigT * p.a / 2) * (ctl.thT / 3 * (1 + 1.5 * muT * muT) - lamT / 2);
    const TtMax = 0.19 * p.sigT * qAt;
    Tt = clamp(Tt, -0.6 * TtMax, TtMax);
    const VtT = Math.hypot(vt[0], vt[2], vt[1] + this.viT, 2);
    const mAppT = 0.637 * rho * (4 / 3) * Math.PI * p.Rt ** 3;
    this.viT = clamp(this.viT + dt * (Tt - 2 * rho * At * this.viT * VtT) / mAppT, -40, 60);
    this.Tt = Tt;
    addF(tl, [0, 0.92 * Tt * p.dir, 0]);
    const Ptail = Math.abs(Tt) * 1.2 * Math.abs(this.viT) + Tt * vt[1] + rho * At * ORt ** 3 * p.sigT * 0.011 / 8 * (1 + 4.65 * muT * muT);

    // ---------------- fuselage, empennage, dérive ----------------
    const wf = va[2] + 0.8 * viE * (1 - sstep(mu, 0.1, 0.25));
    const Vf = Math.hypot(va[0], va[1], wf);
    F[0] -= 0.5 * rho * p.fx * Vf * va[0];
    F[1] -= 0.5 * rho * p.fy * Vf * va[1];
    F[2] -= 0.5 * rho * p.fz * Vf * wf;
    {
      const s = p.stab, uA = Math.abs(va[0]);
      const wh = va[2] - om[1] * s.x + 1.3 * viE * sstep(mu, 0.04, 0.09);
      const V2 = va[0] * va[0] + wh * wh;
      const Z = -0.5 * rho * s.S * clamp(s.cla * uA * wh, -V2, V2);
      addF([s.x, 0, s.z], [0, 0, Z]);
    }
    {
      const f = p.fin, uA = Math.abs(va[0]);
      const vf = va[1] + om[2] * f.x - om[0] * f.z;
      const V2 = va[0] * va[0] + vf * vf;
      const Y = -0.5 * rho * f.S * clamp(f.cla * uA * (vf - p.dir * f.inc * uA), -V2, V2);
      addF([f.x, 0, f.z], [0, Y, 0]);
    }

    // ---------------- moteurs / régulation Nr ----------------
    const Pavail = this.fuel <= 0 ? 0 : this.engFail === 0 ? p.PmaxAEO : this.engFail === 1 ? p.PmaxOEI : 0;
    const Pload = (Pmain + Ptail) / p.eta + p.Pacc;
    const Qload = Pload / Math.max(this.omega, 3);
    this.Qff += (Qload - this.Qff) * Math.min(1, dt / 0.25);
    const errN = p.omega0 - this.omega;
    const Kp = p.Jrot * 4;
    this.govI = clamp(this.govI + Kp * 1.5 * errN * dt, -40000, 40000);
    const Qcmd = clamp(this.Qff + Kp * errN + this.govI, 0, Pavail / Math.max(this.omega, 3));
    this.Qe += (Qcmd - this.Qe) * Math.min(1, dt / 0.35);
    if (Pavail === 0) { this.Qe *= Math.exp(-dt / 0.5); this.govI = 0; }
    this.omega = clamp(this.omega + dt * (this.Qe - Qload) / p.Jrot, 2, 1.35 * p.omega0);
    this.Peng = this.Qe * this.omega;
    this.tq = this.Qe / (p.P100 / p.omega0) * 100;
    this.nr = this.omega / p.omega0 * 100;
    this.fuel = Math.max(0, this.fuel - this.Peng * p.sfc * dt - 0.02 * dt);
    const Qshaft = this.Qe - (Ptail / p.eta + p.Pacc) / Math.max(this.omega, 3);
    M[2] += p.dir * Qshaft;

    // turbulence en rotation (couples perturbateurs)
    if (env.gustM) { M[0] += env.gustM[0] * p.Ixx; M[1] += env.gustM[1] * p.Iyy; M[2] += env.gustM[2] * p.Izz; }

    // ---------------- train d'atterrissage ----------------
    let wow = 0;
    const hx = qRot(q, [1, 0, 0]); const hl = Math.hypot(hx[0], hx[1]) || 1;
    const fx = hx[0] / hl, fy = hx[1] / hl;               // axe avant projeté à l'horizontale
    for (let i = 0; i < p.gear.length; i++) {
      const g = p.gear[i];
      const rw = qRot(q, g.r);
      const pn = this.pos[0] + rw[0], pe = this.pos[1] + rw[1], pd = this.pos[2] + rw[2];
      const s = i === 0 || surf.kind !== 'sea' ? env.surface(pn, pe) : surf;
      const d = s.h + pd;                                  // enfoncement (m)
      this.gearLoad[i] = 0;
      if (d <= 0) continue;
      if (s.kind === 'sea') { if (d > 0.6) this.crashed = { why: 'Amerrissage — appareil perdu en mer' }; continue; }
      const vpB = [vb[0] + om[1] * g.r[2] - om[2] * g.r[1], vb[1] + om[2] * g.r[0] - om[0] * g.r[2], vb[2] + om[0] * g.r[1] - om[1] * g.r[0]];
      const vp = qRot(q, vpB);
      const rv = [vp[0] - s.vn, vp[1] - s.ve, vp[2] - s.vd];
      if (this.gearLoad[i] === 0 && d < 0.03 && rv[2] > this.maxTouchVs) this.maxTouchVs = rv[2];
      if (d > 0.55 || (d < 0.05 && rv[2] > 4.2)) { this.crashed = { why: `Impact trop violent (${(rv[2] * 196.85).toFixed(0)} ft/min)` }; }
      let Fu = g.k * d + g.c * rv[2];
      Fu = clamp(Fu, 0, g.k * 0.6);
      const va_ = rv[0] * fx + rv[1] * fy, vl_ = -rv[0] * fy + rv[1] * fx;
      const muA = g.main ? (this.brakes ? 0.7 : 0.03) : 0.03, muL = g.main ? 0.7 : 0.45;
      const fa = -muA * Fu * va_ / Math.hypot(va_, 0.05), fl = -muL * Fu * vl_ / Math.hypot(vl_, 0.05);
      const fw = [fa * fx - fl * fy, fa * fy + fl * fx, -Fu];
      addF(g.r, qRotInv(q, fw));
      this.gearLoad[i] = Fu; wow++;
    }
    this.wow = wow; this.wowAll = wow === 3;

    // ---------------- équations du mouvement ----------------
    const gb = qRotInv(q, [0, 0, G]);
    const ax = F[0] / m, ay = F[1] / m, az = F[2] / m;
    this.accB = [ax, ay, az];
    this.nz = -az / G;
    vb[0] += dt * (ax + gb[0] - (om[1] * vb[2] - om[2] * vb[1]));
    vb[1] += dt * (ay + gb[1] - (om[2] * vb[0] - om[0] * vb[2]));
    vb[2] += dt * (az + gb[2] - (om[0] * vb[1] - om[1] * vb[0]));
    const { Ixx, Iyy, Izz, Ixz } = p;
    const Hx = Ixx * om[0] - Ixz * om[2], Hy = Iyy * om[1], Hz = Izz * om[2] - Ixz * om[0];
    const Lm = M[0] - (om[1] * Hz - om[2] * Hy), Mm = M[1] - (om[2] * Hx - om[0] * Hz), Nm = M[2] - (om[0] * Hy - om[1] * Hx);
    const det = Ixx * Izz - Ixz * Ixz;
    om[0] += dt * (Izz * Lm + Ixz * Nm) / det;
    om[1] += dt * Mm / Iyy;
    om[2] += dt * (Ixz * Lm + Ixx * Nm) / det;
    const [w, x, y, z] = q, h = 0.5 * dt;
    q[0] = w + h * (-x * om[0] - y * om[1] - z * om[2]);
    q[1] = x + h * (w * om[0] + y * om[2] - z * om[1]);
    q[2] = y + h * (w * om[1] + z * om[0] - x * om[2]);
    q[3] = z + h * (w * om[2] + x * om[1] - y * om[0]);
    const ql = Math.hypot(q[0], q[1], q[2], q[3]); q[0] /= ql; q[1] /= ql; q[2] /= ql; q[3] /= ql;
    const vw = qRot(q, vb);
    this.pos[0] += dt * vw[0]; this.pos[1] += dt * vw[1]; this.pos[2] += dt * vw[2];
    if (!wow) this.lastAirVs = vw[2] - (surf.vd || 0);
    this.updateDerived(env.wind);
    if (!Number.isFinite(this.pos[0] + this.omega + om[0])) this.crashed = { why: 'Divergence numérique' };
  }

  // collision de la structure (rotor, queue, ventre) avec le sol / le pont ; à appeler 1 fois par image
  checkHull(env) {
    if (this.crashed) return;
    for (const r of this.p.hull) {
      const rw = qRot(this.q, r);
      const s = env.surface(this.pos[0] + rw[0], this.pos[1] + rw[1]);
      if (s.h + this.pos[2] + rw[2] > 0.05) {
        this.crashed = { why: s.kind === 'sea' ? 'Amerrissage — appareil perdu en mer' : 'Collision de la structure avec la surface' };
        return;
      }
      if (env.obstacle && env.obstacle(this.pos[0] + rw[0], this.pos[1] + rw[1], -(this.pos[2] + rw[2]))) {
        this.crashed = { why: 'Collision avec un obstacle' }; return;
      }
    }
    if (this.wow && (Math.abs(this.phi) > 0.6 || Math.abs(this.theta) > 0.6)) this.crashed = { why: 'Basculement au sol' };
  }
}
