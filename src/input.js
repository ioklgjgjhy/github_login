// ============================================================================
// Entrées pilote : joystick (API Gamepad — Sidewinder ou autre) + clavier de secours.
// L'affectation des axes/boutons est configurable et mémorisée (localStorage).
// ============================================================================
const KEY = 'simu-nh90-joystick-v1';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const FUNCS = [
  { id: 'lat', label: 'Roulis (manche gauche/droite)', hint: 'poussez le manche à DROITE' },
  { id: 'lon', label: 'Tangage (manche avant/arrière)', hint: 'poussez le manche vers l\'AVANT' },
  { id: 'ped', label: 'Lacet (torsion du manche)', hint: 'tournez le manche vers la DROITE' },
  { id: 'coll', label: 'Collectif (manette des gaz)', hint: 'mettez la manette en position PLEIN COLLECTIF' },
];
export const BTNS = [
  { id: 'trimRel', label: 'Trim release (recale l\'assiette)' },
  { id: 'view', label: 'Changer de vue' },
  { id: 'mode', label: 'Mode AFCS (ATT / SAS / DIRECT)' },
  { id: 'brake', label: 'Freins de roues' },
];

function defaults(gp) {
  const n = gp ? gp.axes.length : 4;
  // Sidewinder (Chrome) : X=0, Y=1, torsion (Rz)=5 et curseur=6 quand le pilote expose 7+ axes, chapeau=axe 9 ; sinon 0,1,2,3
  const big = n >= 7;
  return {
    axes: { lat: { i: 0, inv: false }, lon: { i: 1, inv: false }, ped: { i: big ? 5 : 2, inv: false }, coll: { i: big ? 6 : 3, inv: true } },
    btn: { trimRel: 0, view: 1, mode: 2, brake: 3 },
    hatAxis: n >= 10 ? 9 : -1, dead: 0.04, yawDead: 0.08,
  };
}

export class Input {
  constructor() {
    this.keys = new Set(); this.cfg = null; this.gpIndex = -1; this.gpId = '';
    this.kb = { lon: 0, lat: 0, ped: 0, coll: 0.0 };
    this.state = { lon: 0, lat: 0, ped: 0, coll: 0, beepLon: 0, beepLat: 0 };
    this.pressed = new Set(); this.prevBtn = []; this.listeners = {};
    this.useGamepad = false; this.collKb = false;
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.axes) this.cfg = s; } catch (e) { /* stockage indisponible */ }
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.emit('key', e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', () => this.pick());
    addEventListener('gamepaddisconnected', () => this.pick());
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, a) { (this.listeners[ev] || []).forEach((f) => f(a)); }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch (e) { /* ignore */ } }
  resetCfg() { this.cfg = defaults(this.pad()); this.save(); }

  pads() { return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; }
  pick() {
    const all = this.pads();
    const best = all.find((g) => /sidewinder|joystick|stick|flight|hotas/i.test(g.id)) || all.find((g) => g.axes.length >= 3) || all[0];
    const was = this.gpIndex;
    this.gpIndex = best ? best.index : -1; this.gpId = best ? best.id : '';
    if (best && !this.cfg) { this.cfg = defaults(best); }
    if (was !== this.gpIndex) this.emit('pad', best || null);
  }
  pad() { return this.gpIndex < 0 ? null : (navigator.getGamepads()[this.gpIndex] || null); }

  rawAxis(gp, f) { const a = this.cfg.axes[f]; const v = gp.axes[a.i] ?? 0; return a.inv ? -v : v; }

  // chapeau chinois : boutons 12-15 (mapping standard) ou axe unique à 8 positions (Chrome)
  hat(gp) {
    let x = 0, y = 0;
    if (gp.mapping === 'standard' && gp.buttons.length > 15) { y = (gp.buttons[12].pressed ? 1 : 0) - (gp.buttons[13].pressed ? 1 : 0); x = (gp.buttons[15].pressed ? 1 : 0) - (gp.buttons[14].pressed ? 1 : 0); }
    const h = this.cfg.hatAxis;
    if (h >= 0 && h < gp.axes.length) {
      const v = gp.axes[h];
      if (v <= 1.05 && v >= -1.05) { const k = Math.round((v + 1) / (2 / 7)); const a = k * Math.PI / 4; x = Math.round(Math.sin(a)); y = Math.round(Math.cos(a)); }
    }
    return [x, y];
  }

  update(dt) {
    if (this.gpIndex < 0) this.pick();
    const k = this.keys, s = this.state, kb = this.kb;
    // clavier : manche virtuel à rappel au neutre (disposition physique : ZQSD = WASD)
    const ax = (cur, neg, pos, rate, ret) => { const d = (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0); return d ? clamp(cur + d * rate * dt, -1, 1) : cur * Math.exp(-dt * ret); };
    kb.lat = ax(kb.lat, 'ArrowLeft', 'ArrowRight', 1.6, 6); kb.lon = ax(kb.lon, 'ArrowDown', 'ArrowUp', 1.6, 6);
    kb.ped = ax(kb.ped, 'KeyA', 'KeyD', 2, 7);
    const dc = (k.has('KeyW') || k.has('PageUp') ? 1 : 0) - (k.has('KeyS') || k.has('PageDown') ? 1 : 0);
    if (dc) { kb.coll = clamp(kb.coll + dc * 0.22 * dt, 0, 1); this.collKb = true; }
    let beepX = (k.has('KeyL') ? 1 : 0) - (k.has('KeyJ') ? 1 : 0), beepY = (k.has('KeyI') ? 1 : 0) - (k.has('KeyK') ? 1 : 0);

    const gp = this.pad();
    this.useGamepad = !!gp && !!this.cfg;
    let lat = kb.lat, lon = kb.lon, ped = kb.ped, coll = kb.coll;
    if (this.useGamepad) {
      const dz = (v, d) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
      lat = clamp(dz(this.rawAxis(gp, 'lat'), this.cfg.dead) + kb.lat, -1, 1);
      lon = clamp(dz(-this.rawAxis(gp, 'lon'), this.cfg.dead) + kb.lon, -1, 1);       // manche poussé (axe Y négatif) = lon positif
      ped = clamp(dz(this.rawAxis(gp, 'ped'), this.cfg.yawDead) + kb.ped, -1, 1);
      const cg = clamp((this.rawAxis(gp, 'coll') + 1) / 2, 0, 1);
      if (this.lastCg === undefined || Math.abs(cg - this.lastCg) > 0.004) { if (this.lastCg !== undefined) this.collKb = false; this.lastCg = cg; }
      coll = this.collKb ? kb.coll : cg; if (!this.collKb) kb.coll = cg;
      const [hx, hy] = this.hat(gp); beepX += hx; beepY += hy;
      gp.buttons.forEach((b, i) => { if (b.pressed && !this.prevBtn[i]) { for (const id in this.cfg.btn) if (this.cfg.btn[id] === i) this.emit('btn', id); this.emit('rawbtn', i); } this.prevBtn[i] = b.pressed; });
    }
    s.lat = lat; s.lon = lon; s.ped = ped; s.coll = coll; s.beepLon = clamp(beepY, -1, 1); s.beepLat = clamp(beepX, -1, 1);
    return s;
  }

  // détection : renvoie l'axe qui a le plus bougé depuis l'instantané
  snapshot() { const gp = this.pad(); return gp ? [...gp.axes] : null; }
  movedAxis(snap) {
    const gp = this.pad(); if (!gp || !snap) return null;
    let best = -1, bd = 0.45;
    gp.axes.forEach((v, i) => { const d = Math.abs(v - snap[i]); if (d > bd && Math.abs(v) <= 1.05) { bd = d; best = i; } });
    return best < 0 ? null : { i: best, value: gp.axes[best], delta: gp.axes[best] - snap[best] };
  }
}
