// ============================================================================
// Environnement : relief, navire (cinématique + mouvements de plate-forme),
// vent, rafales, turbulence (type Dryden simplifié), sillage aérodynamique du navire.
// Repère local NED en mètres, origine = hélisurface de l'aérodrome (altitude 12 m).
// Aucune dépendance graphique.
// ============================================================================
const D2R = Math.PI / 180, KT = 0.514444;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const FIELD_ALT = 12;
export const DECK_H = 15.5;                       // hauteur du pont d'envol au-dessus de l'eau (m)
export const SHIP = {
  L: 199, B: 32,
  spots: [
    { id: 1, f: 70, s: -6 }, { id: 2, f: 42, s: -6 }, { id: 3, f: 14, s: -6 },
    { id: 4, f: -14, s: -6 }, { id: 5, f: -42, s: -6 }, { id: 6, f: -74, s: -3 },
  ],
  island: { f0: -28, f1: 34, s0: 6.5, s1: 16, h: 15 },   // îlot tribord (repère pont)
  mast: { f0: -4, f1: 10, s0: 8, s1: 14, h: 34 },
};
// demi-largeur du pont en fonction de la position longitudinale (étrave effilée)
export function deckHalfWidth(f) {
  if (f < -99.5 || f > 99.5) return 0;
  if (f < 62) return 16;
  const t = (f - 62) / 37.5; return 16 * (1 - 0.72 * t * t);
}
// bâtiments de l'aérodrome : centre (n,e), dimensions, hauteur (pour le rendu et les collisions)
export const BUILDINGS = [
  { n: 25, e: -175, dn: 46, de: 60, h: 13, kind: 'hangar' },
  { n: -40, e: -175, dn: 46, de: 60, h: 13, kind: 'hangar' },
  { n: 95, e: -160, dn: 22, de: 70, h: 7, kind: 'terminal' },
  { n: 100, e: 150, dn: 9, de: 9, h: 24, kind: 'tower' },
  { n: -1060, e: -2300, dn: 7, de: 7, h: 32, kind: 'lighthouse' },
];
export const RUNWAY = { n: 190, e: -100, len: 1400, wid: 40 };   // piste 09/27

// ---------- bruit déterministe ----------
function hash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }

export const coastN = (e) => -520 + 130 * Math.sin(e / 900) + 55 * Math.sin(e / 310 + 1) - 520 * Math.exp(-(((e + 2300) / 420) ** 2)) + 250 * Math.exp(-(((e - 3400) / 900) ** 2));

// altitude du terrain (m) ; négatif = fond marin
export function terrainH(n, e) {
  const d = n - coastN(e);
  let h;
  if (d < 0) h = Math.max(-30, d * 0.08);
  else if (d < 45) h = 2.2 * sstep(d, 0, 45);
  else h = 2.2 + (FIELD_ALT - 2.2) * sstep(d, 45, 150);
  if (d > 150) {
    const k = sstep(d, 500, 2600);
    const hills = Math.pow(fbm(e / 1700 + 7.1, n / 1700 + 3.3, 5), 1.6) * 520 * k;
    const und = (fbm(e / 180, n / 180, 3) - 0.45) * 5 * sstep(d, 150, 400);
    // zone aérodrome parfaitement plane
    const ax = Math.max(Math.abs(e + 100) - 950, 0), an = Math.max(Math.abs(n - 90) - 260, 0);
    const flat = 1 - sstep(Math.hypot(ax, an), 0, 250);
    h += (hills + und) * (1 - flat);
  }
  // îlot rocheux au large
  const ri = Math.hypot(n + 2600, e + 1500);
  if (ri < 400) h = Math.max(h, 46 * Math.exp(-((ri / 130) ** 2)) + (fbm(e / 40, n / 40, 2) - 0.5) * 6 * Math.exp(-((ri / 160) ** 2)) - 3);
  return h;
}

function gauss() { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }

export const DEFAULT_CFG = {
  windDir: 240, windKt: 15, gustKt: 5, turb: 0.3, airwake: true,
  seaState: 3, shipHdg: 245, shipKt: 10, shipN: -4300, shipE: 2600,
  spot: 5, visKm: 25, hour: 15, mass: 9800,
};

export class Environment {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULT_CFG, ...cfg };
    this.t = 0; this.rho = 1.225;
    this.wind = [0, 0, 0]; this.gustM = [0, 0, 0];
    this.g = [0, 0, 0]; this.gr = [0, 0, 0]; this.gs = 0; this.gd = 0;
    this.wakeF = 0; this.meanWind = [0, 0, 0];
    this.ship = {};
    this.updateShip();
    this.surface = this.surface.bind(this); this.obstacle = this.obstacle.bind(this);
    this.noise = () => gauss();
  }

  // ---------- navire ----------
  shipPoseAt(t) {
    const c = this.cfg, ss = c.seaState, psi = c.shipHdg * D2R, v = c.shipKt * KT;
    const w1 = 2 * Math.PI / 11.3, w2 = 2 * Math.PI / 7.1, w3 = 2 * Math.PI / 8.4, w4 = 2 * Math.PI / 9.7, w5 = 2 * Math.PI / 13.9;
    const roll = ss * 0.5 * D2R * (0.75 * Math.sin(w1 * t) + 0.3 * Math.sin(w2 * t + 1.3));
    const rollD = ss * 0.5 * D2R * (0.75 * w1 * Math.cos(w1 * t) + 0.3 * w2 * Math.cos(w2 * t + 1.3));
    const pitch = ss * 0.22 * D2R * (0.8 * Math.sin(w3 * t + 0.6) + 0.3 * Math.sin(w5 * t));
    const pitchD = ss * 0.22 * D2R * (0.8 * w3 * Math.cos(w3 * t + 0.6) + 0.3 * w5 * Math.cos(w5 * t));
    const heave = ss * 0.2 * (0.8 * Math.sin(w4 * t + 2.1) + 0.3 * Math.sin(w2 * t));
    const heaveD = ss * 0.2 * (0.8 * w4 * Math.cos(w4 * t + 2.1) + 0.3 * w2 * Math.cos(w2 * t));
    return {
      n: c.shipN + v * Math.cos(psi) * t, e: c.shipE + v * Math.sin(psi) * t, psi, v,
      vn: v * Math.cos(psi), ve: v * Math.sin(psi), cp: Math.cos(psi), sp: Math.sin(psi),
      roll, pitch, heave, rollD, pitchD, heaveD,
    };
  }
  updateShip() { this.ship = this.shipPoseAt(this.t); }
  // monde -> repère pont (f avant, s tribord)
  toDeck(n, e) { const S = this.ship, dn = n - S.n, de = e - S.e; return [dn * S.cp + de * S.sp, -dn * S.sp + de * S.cp]; }
  fromDeck(f, s) { const S = this.ship; return [S.n + f * S.cp - s * S.sp, S.e + f * S.sp + s * S.cp]; }
  deckHeight(f, s) { const S = this.ship; return DECK_H + S.heave + f * Math.sin(S.pitch) - s * Math.sin(S.roll); }
  spotWorld(id = this.cfg.spot) {
    const sp = SHIP.spots.find((x) => x.id === id) || SHIP.spots[4];
    const [n, e] = this.fromDeck(sp.f, sp.s);
    return { n, e, h: this.deckHeight(sp.f, sp.s), f: sp.f, s: sp.s };
  }

  // ---------- surface sous un point (sol, pont, mer) ----------
  surface(n, e) {
    const S = this.ship, dn = n - S.n, de = e - S.e;
    if (Math.abs(dn) < 130 && Math.abs(de) < 130) {
      const f = dn * S.cp + de * S.sp, s = -dn * S.sp + de * S.cp;
      if (Math.abs(s) <= deckHalfWidth(f)) {
        return { h: DECK_H + S.heave + f * Math.sin(S.pitch) - s * Math.sin(S.roll), vn: S.vn, ve: S.ve, vd: -(S.heaveD + f * S.pitchD - s * S.rollD), kind: 'deck', f, s };
      }
      return { h: 0, vn: 0, ve: 0, vd: 0, kind: 'sea' };
    }
    const h = terrainH(n, e);
    if (h <= 0) return { h: 0, vn: 0, ve: 0, vd: 0, kind: 'sea' };
    return { h, vn: 0, ve: 0, vd: 0, kind: 'land' };
  }

  // ---------- obstacles (îlot du navire, bâtiments) ----------
  obstacle(n, e, alt) {
    const S = this.ship, dn = n - S.n, de = e - S.e;
    if (Math.abs(dn) < 130 && Math.abs(de) < 130) {
      const f = dn * S.cp + de * S.sp, s = -dn * S.sp + de * S.cp, z = alt - DECK_H - S.heave;
      const i = SHIP.island, m = SHIP.mast;
      if (f > i.f0 && f < i.f1 && s > i.s0 && s < i.s1 && z < i.h) return true;
      if (f > m.f0 && f < m.f1 && s > m.s0 && s < m.s1 && z < m.h) return true;
      return false;
    }
    if (alt > 50) return false;
    for (const b of BUILDINGS) if (Math.abs(n - b.n) < b.dn / 2 && Math.abs(e - b.e) < b.de / 2 && alt < terrainH(b.n, b.e) + b.h) return true;
    return false;
  }

  // ---------- vent et turbulence au point de l'appareil ----------
  update(dt, fdm) {
    this.t += dt;
    this.updateShip();
    const c = this.cfg, W = c.windKt * KT;
    // rafales lentes (module et direction)
    const tg = 5;
    this.gs += -this.gs * dt / tg + Math.sqrt(2 * dt / tg) * gauss();
    this.gd += -this.gd * dt / 9 + Math.sqrt(2 * dt / 9) * gauss();
    const agl = Math.max(fdm ? fdm.agl : 10, 3);
    const prof = clamp(Math.pow(agl / 10, 0.13), 0.8, 1.5);
    const spd = Math.max(0, W * prof + this.gs * c.gustKt * KT * 0.5);
    const dir = c.windDir * D2R + this.gd * 0.06 * (c.gustKt > 0 ? 1 : 0);
    let wn = -spd * Math.cos(dir), we = -spd * Math.sin(dir);
    // sillage aérodynamique du navire (sous le vent de l'îlot) + turbulence de pont
    let wake = 0;
    if (fdm && c.airwake) {
      const S = this.ship, [f, s] = this.toDeck(fdm.pos[0], fdm.pos[1]);
      const z = fdm.alt - DECK_H;
      if (Math.abs(f) < 300 && Math.abs(s) < 300 && z < 45) {
        const rn = wn - S.vn, re = we - S.ve, rl = Math.hypot(rn, re) || 1;
        const df = (rn * S.cp + re * S.sp) / rl, ds = (-rn * S.sp + re * S.cp) / rl; // direction du vent relatif (repère pont)
        const rf = f - 3, rs = s - 11;
        const along = rf * df + rs * ds, crossd = Math.abs(-rf * ds + rs * df);
        wake = sstep(along, -5, 25) * (1 - sstep(along, 60, 220)) * Math.exp(-((crossd / 22) ** 2)) * (1 - sstep(z, 20, 45));
        if (Math.abs(s) < 18 && Math.abs(f) < 100) wake = Math.max(wake, 0.25 * (1 - sstep(z, 5, 25)));
        wake *= clamp(rl / 10, 0, 1.5);
        wn -= 0.35 * wake * rn; we -= 0.35 * wake * re;
      }
    }
    this.wakeF = wake;
    this.meanWind = [wn, we, 0];
    // turbulence : processus de Gauss-Markov par axe
    const sig = c.turb * (1.2 + 0.22 * W) + wake * 0.16 * (W + c.shipKt * KT);
    const V = Math.max(fdm ? fdm.tas : 0, W, 5);
    const Lh = 140, Lv = clamp(agl, 12, 140);
    const sv = sig * clamp(agl / 20, 0.5, 1);
    const g = this.g;
    const ou = (x, tau, s) => x - x * dt / tau + s * Math.sqrt(2 * dt / tau) * gauss();
    g[0] = ou(g[0], Lh / V, sig); g[1] = ou(g[1], Lh / V, sig); g[2] = ou(g[2], Lv / V, sv);
    const gr = this.gr;
    gr[0] = ou(gr[0], 0.35, sig * 0.10); gr[1] = ou(gr[1], 0.5, sig * 0.035); gr[2] = ou(gr[2], 0.5, sig * 0.04);
    this.wind[0] = wn + g[0]; this.wind[1] = we + g[1]; this.wind[2] = g[2];
    this.gustM[0] = gr[0]; this.gustM[1] = gr[1]; this.gustM[2] = gr[2];
  }
}
