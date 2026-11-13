// ============================================================================
// Commandes de vol électriques (AFCS) – lois inspirées du NH90
//  ATT  : tenue d'assiette (le manche commande un écart d'assiette), tenue de cap,
//         coordination de virage en translation
//  SAS  : amortissement de vitesses angulaires seulement
//  DIR  : liaison directe manche -> pas de pales (cellule nue, très exigeant)
// Entrées pilote normalisées : lon (+ = manche avant), lat (+ = droite),
// ped (+ = nez à droite), coll (0..1).
// ============================================================================
import { G } from './fdm.js';
const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const expo = (x, e) => x * (1 - e + e * x * x);

const B1C = -1.5 * D2R, A1C = -1.7 * D2R; // neutre cyclique = équilibre de stationnaire
export const MODES = ['ATT', 'SAS', 'DIR'];

export class AFCS {
  constructor(fdm) { this.fdm = fdm; this.mode = 'ATT'; this.reset(); }

  reset() {
    const f = this.fdm;
    this.thRef = 1.5 * D2R; this.phRef = -2.5 * D2R;   // assiette de référence (stationnaire)
    this.thCmd = f.theta; this.phCmd = f.phi;
    this.iTh = 0; this.iPh = 0; this.iPsi = 0;
    this.trimLon = 0; this.trimLat = 0;                 // trim cyclique (modes SAS / DIR)
    this.biasLon = 0; this.biasLat = 0;                 // neutralisation manche après « trim release »
    this.out = { th0: f.p.th0Min, B1: B1C, A1: A1C, thT: 9 * D2R };
    this.pos = { lon: 0, lat: 0, ped: 0, coll: 0 };     // positions équivalentes des commandes (affichage)
  }

  // synchronise les références sur l'état courant (départ en vol)
  sync(coll) {
    const f = this.fdm, p = f.p;
    this.thRef = f.theta; this.phRef = f.phi; this.thCmd = f.theta; this.phCmd = f.phi;
    this.out.th0 = p.th0Min + coll * (p.th0Max - p.th0Min);
    // pales et intégrateurs initialisés à l'équilibre pour éviter tout à-coup au lancement
    this.out.B1 = B1C; this.out.A1 = A1C; this.out.thT = 14 * D2R + 14 * D2R * (coll - 0.5);
    this.iTh = B1C; this.iPh = A1C; this.iPsi = 0;
  }

  // changement de mode sans à-coup : le trim reprend la position courante des pales
  setMode(mode) {
    this.trimLon = this.pos.lon; this.trimLat = this.pos.lat; this.biasLon = this.biasLat = 0;
    this.thCmd = this.fdm.theta; this.phCmd = this.fdm.phi;
    if (mode === 'ATT') { this.thRef = this.fdm.theta; this.phRef = this.fdm.phi; this.iPsi = 0; }
    this.mode = mode;
  }

  // « trim release » : l'assiette courante devient la référence
  trimRelease(lon, lat) {
    if (this.mode === 'ATT') {
      this.thRef = clamp(this.thCmd, -25 * D2R, 25 * D2R); this.phRef = clamp(this.phCmd, -30 * D2R, 30 * D2R);
    } else {
      this.trimLon = clamp(this.trimLon + expo(lon - this.biasLon, 0.3), -1, 1);
      this.trimLat = clamp(this.trimLat + expo(lat - this.biasLat, 0.3), -1, 1);
    }
    this.biasLon = lon; this.biasLat = lat;
  }

  update(dt, inp) {
    const f = this.fdm, p = f.p, o = this.out;
    // biais manche : s'efface quand le manche revient vers le neutre
    for (const k of ['Lon', 'Lat']) {
      const s = inp[k.toLowerCase()], b = this['bias' + k];
      if (b !== 0) this['bias' + k] = s * b <= 0 ? 0 : Math.abs(s) < Math.abs(b) ? s : b;
    }
    const lon = expo(clamp(inp.lon - this.biasLon, -1, 1), 0.35), lat = expo(clamp(inp.lat - this.biasLat, -1, 1), 0.35);
    const ped = expo(inp.ped, 0.4), coll = clamp(inp.coll, 0, 1);
    const [pp, qq, rr] = f.om;
    const u = f.va[0], onGnd = f.wow >= 2;
    // trim « beep » (chapeau chinois)
    const bx = inp.beepLon || 0, by = inp.beepLat || 0;
    if (this.mode === 'ATT') {
      this.thRef = clamp(this.thRef - bx * 2.5 * D2R * dt, -20 * D2R, 20 * D2R);
      this.phRef = clamp(this.phRef + by * 2.5 * D2R * dt, -30 * D2R, 30 * D2R);
    } else {
      this.trimLon = clamp(this.trimLon + bx * 0.12 * dt, -1, 1); this.trimLat = clamp(this.trimLat + by * 0.12 * dt, -1, 1);
    }

    const th0c = p.th0Min + coll * (p.th0Max - p.th0Min);
    let B1c, A1c, thTc;
    const thTff = 14 * D2R + 14 * D2R * (coll - 0.5) * (1 - 0.5 * sstep(u, 15, 45)); // couplage collectif -> anticouple
    const B1dir = B1C + (lon + this.trimLon) * 12 * D2R, A1dir = A1C + (lat + this.trimLat) * 8 * D2R;

    if (this.mode === 'ATT' && !onGnd) {
      const thT = this.thRef - lon * 30 * D2R, phT = this.phRef + lat * 45 * D2R;
      const kc = Math.min(1, dt / 0.22);
      this.thCmd += (thT - this.thCmd) * kc; this.phCmd += (phT - this.phCmd) * kc;
      const eTh = f.theta - this.thCmd, ePh = this.phCmd - f.phi;
      this.iTh = clamp(this.iTh + 0.9 * eTh * dt, -0.2, 0.2);
      this.iPh = clamp(this.iPh + 0.35 * ePh * dt, -0.12, 0.12);
      B1c = 1.05 * eTh + 0.55 * qq + this.iTh;
      A1c = 0.32 * ePh - 0.07 * pp + this.iPh;
      // lacet : commande de taux + tenue de cap (intégrale du taux) + virage coordonné en translation
      const s = sstep(u, 15, 30);
      const rCoord = s * G * Math.tan(clamp(f.phi, -1, 1)) * Math.cos(f.theta) / Math.max(u, 15);
      const rCmd = ped * (0.65 - 0.4 * s) + rCoord + s * 0.02 * f.va[1];
      this.iPsi = clamp(this.iPsi + (rCmd - rr) * dt, -0.3, 0.3);
      thTc = thTff - 0.42 * (rCmd - rr) - 0.9 * this.iPsi;
    } else {
      // au sol ou modes dégradés : liaison directe (+ amortissement en SAS/ATT)
      const kd = this.mode === 'DIR' ? 0 : onGnd ? 0.4 : 1;
      B1c = B1dir + kd * 0.38 * qq;
      A1c = A1dir - kd * 0.05 * pp;
      if (this.mode === 'ATT' && coll > 0.2) { // tenue de cap active dès que l'appareil s'allège
        const rCmd = ped * 0.65; this.iPsi = clamp(this.iPsi + (rCmd - rr) * dt, -0.3, 0.3);
        thTc = thTff - 0.42 * (rCmd - rr) - 0.9 * this.iPsi;
      } else { thTc = thTff - ped * 15 * D2R + kd * 0.3 * rr; this.iPsi *= Math.exp(-dt * 2); }
      this.thCmd = f.theta; this.phCmd = f.phi;
      if (onGnd) { // les intégrateurs retiennent la position de manche équivalente pour un décollage sans à-coup
        this.iTh += (B1dir - this.iTh) * Math.min(1, dt * 3); this.iPh += (A1dir - this.iPh) * Math.min(1, dt * 3);
        if (this.mode === 'ATT') { this.thCmd = this.thRef; this.phCmd = this.phRef; }
      } else { this.iTh = B1c; this.iPh = A1c; }
    }
    B1c = clamp(B1c, -13.5 * D2R, 12 * D2R); A1c = clamp(A1c, -10 * D2R, 8 * D2R); thTc = clamp(thTc, p.thTMin, p.thTMax);
    // servocommandes : 1er ordre + limite de vitesse
    const act = (cur, cmd, rate) => cur + clamp((cmd - cur) * Math.min(1, dt / 0.04), -rate * dt, rate * dt);
    o.th0 = act(o.th0, th0c, 16 * D2R); o.B1 = act(o.B1, B1c, 28 * D2R); o.A1 = act(o.A1, A1c, 28 * D2R); o.thT = act(o.thT, thTc, 50 * D2R);
    this.pos.lon = (o.B1 - B1C) / (12 * D2R); this.pos.lat = (o.A1 - A1C) / (8 * D2R);
    this.pos.ped = -(o.thT - thTff) / (15 * D2R); this.pos.coll = coll;
    return o;
  }
}
