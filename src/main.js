// ============================================================================
// Simulateur NH90 — programme principal : boucle temps réel, vues, mission, interface
// ============================================================================
import * as THREE from 'three';
import { HeliFDM, qRot } from './fdm.js';
import { AFCS, MODES } from './afcs.js';
import { Environment, DEFAULT_CFG, DECK_H, SHIP, MISSIONS, terrainH, installDEM, buildings, fieldAlt } from './env.js';
import { PAU_DEM, PAU_DEM_PNG } from './pau-dem.js';
import { World } from './world.js';
import { buildHeli, buildCockpit, tryLoadCustomModel, EYE } from './heli.js';
import { drawPFD, drawSITAC, drawENG, drawHOV, buildRelief } from './instruments.js';
import { Input, FUNCS, BTNS } from './input.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, KT = 1.94384, FT = 3.28084, NM = 1852, H = 1 / 240;
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap360 = (d) => ((d % 360) + 360) % 360;
const pad3 = (v) => String(Math.round(wrap360(v)) || 360).padStart(3, '0');

// ---------------------------------------------------------------- rendu
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.55;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 80000);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- simulation
let cfg = { ...DEFAULT_CFG, start: 'pad', mode: 'ATT' };
// relief réel des Pyrénées : décodage de l'image d'altitude embarquée
const demReady = (async () => {
  const im = new Image(); im.src = PAU_DEM_PNG; await im.decode();
  const c = Object.assign(document.createElement('canvas'), { width: PAU_DEM.nx, height: PAU_DEM.ny }), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, PAU_DEM.nx, PAU_DEM.ny).data, h = new Float32Array(PAU_DEM.nx * PAU_DEM.ny);
  for (let r = 0; r < PAU_DEM.ny; r++) for (let i = 0; i < PAU_DEM.nx; i++) { const o = (r * PAU_DEM.nx + i) * 4; h[(PAU_DEM.ny - 1 - r) * PAU_DEM.nx + i] = (d[o] * 256 + d[o + 1]) / 4; }
  installDEM(PAU_DEM, h);
})();
const relief = {};
let env = new Environment(cfg);
const fdm = new HeliFDM();
const afcs = new AFCS(fdm);
const input = new Input();
const world = new World(scene, renderer);

// écrans de bord : les canevas incrustés servent aussi de textures pour la planche de bord
const cv = { pfd: $('ovPfd'), nd: $('ovNd'), hov: $('ovHov'), eng: Object.assign(document.createElement('canvas'), { width: 512, height: 512 }) };
const ctx = {}, tex = {};
for (const k in cv) { ctx[k] = cv[k].getContext('2d'); tex[k] = new THREE.CanvasTexture(cv[k]); tex[k].colorSpace = THREE.SRGBColorSpace; tex[k].anisotropy = 4; }
const heli = buildHeli(); scene.add(heli);
const cockpit = buildCockpit(tex); heli.add(cockpit);
heli.userData.rotor.rotation.order = 'XZY';
tryLoadCustomModel(heli).then((c) => {
  if (!c || !c.environnement) return;
  Object.assign(cfg, c.environnement);        // valeurs locales (travail/config.json) reportées dans les réglages
  for (const id in fields) { const k = fields[id][0]; if (k in c.environnement) { $(id).value = c.environnement[k] / (fields[id][2] || 1); $(id).dispatchEvent(new Event('input')); } }
});

// ---------------------------------------------------------------- état général
let state = 'menu';           // menu | ready | fly | pause | debrief
let view = 'cockpit', ovForce = null, hudOn = true;
const VIEWS = ['cockpit', 'ext', 'tour'], VIEW_LBL = { cockpit: 'COCKPIT', ext: 'EXTÉRIEURE', tour: 'TOUR / PONT' };
const look = { yaw: 0, pitch: -0.17, az: Math.PI, el: 0.2, dist: 30, fov: 72 };
let recColl = 0, acc = 0, simT = 0, frameN = 0, fps = 60, spin = 0;
const M = { phase: 0, airT: 0, td: null, settle: 0, maxTq: 0, flown: false, done: false, wp: 1, plan: [], xtk: 0, trail: [], far: false };
const STEPS = {
  mer: ['Mise en stationnaire', 'Décollage et départ vers le large', 'Transit vers le navire', 'Approche par l\'arrière bâbord', 'Stationnaire au-dessus du spot', 'Appontage'],
  pau: ['Mise en stationnaire', 'Décollage et départ', 'Navigation tactique dans la vallée', 'Approche de la zone de poser', 'Stationnaire au-dessus de la zone', 'Poser en montagne'],
};
const RANGES = [0, 1, 2, 5, 10, 20]; let rngSel = 0;

function reset() {
  env = new Environment(cfg);
  const th = env.mission.theatre;
  world.setTheatre(th); world.applyConfig(cfg);
  if (!relief[th]) relief[th] = buildRelief(th === 'pau' ? { n0: PAU_DEM.n0, n1: PAU_DEM.n1, e0: PAU_DEM.e0, e1: PAU_DEM.e1, step: 100 } : { n0: -9000, n1: 8500, e0: -9000, e1: 9000, step: 50 }, terrainH);
  fdm.p.mass = cfg.mass; fdm.engFail = 0; fdm.brakes = true;
  const S = env.ship, L = env.landing(), plan = env.plan(), last = plan.length - 1;
  // axe d'approche : axe du navire, ou dernière branche du plan de vol
  const apsi = env.hasShip ? S.psi : Math.atan2(L.e - plan[last - 1].e, L.n - plan[last - 1].n), ax = Math.cos(apsi), ay = Math.sin(apsi), vT = env.hasShip ? S.v : 0;
  const dens = 1 + 0.1 * L.h / 1400;        // à iso-masse, il faut plus de pas en altitude
  let o = { n: 0, e: 0, alt: fieldAlt() + 1.8, psi: Math.round(Math.atan2(plan[1].e, plan[1].n) * R2D / 10) * 10 * D2R, u: 0, theta: 0, phi: 0 }, wp0 = 1;
  recColl = 0;
  const back = (d, hgt, u, th2, c) => {
    const n = L.n - ax * d, e = L.e - ay * d;
    o = { n, e, alt: Math.max(L.h + hgt, d > 0 ? env.surface(n, e).h + 45 : 0), psi: apsi, u, theta: th2 * D2R, phi: u < 15 ? -2.5 * D2R : 0 }; recColl = c; wp0 = last;
  };
  if (cfg.start === 'transit') {
    if (env.hasShip) { const b = Math.atan2(L.e, L.n), d = 2 * NM; o = { n: L.n - Math.cos(b) * d, e: L.e - Math.sin(b) * d, alt: 152, psi: b, u: 51, theta: -2.5 * D2R, phi: 0 }; wp0 = last - 1; }
    else { const m = Math.ceil(last / 2), a = plan[m], b = plan[m + 1], hd = Math.atan2(b.e - a.e, b.n - a.n); o = { n: a.n, e: a.e, alt: terrainH(a.n, a.e) + 150, psi: hd, u: 51, theta: -2.5 * D2R, phi: 0 }; wp0 = m + 1; }
    recColl = 0.34 * dens;
  }
  if (cfg.start === 'final') back(0.5 * NM, 76, 31, 0.5, 0.31 * dens);
  if (cfg.start === 'short') back(150, 26, vT + 11, 2.5, 0.40 * dens);
  if (cfg.start === 'deckhover') back(0, 1.9 + 4.6, vT, 1.5, 0.47 * dens);
  if (cfg.start === 'deck') back(0, 1.8, vT, 0, 0);
  fdm.reset(o);
  afcs.reset(); afcs.mode = cfg.mode;
  if (recColl > 0) afcs.sync(recColl);
  input.kb.coll = recColl; input.collKb = true;
  env.update(0, fdm); fdm.updateDerived(env.wind);
  fdm.surf = env.surface(fdm.pos[0], fdm.pos[1]); fdm.agl = fdm.alt - fdm.surf.h;
  Object.assign(M, { phase: 0, airT: 0, td: null, settle: 0, maxTq: 0, flown: recColl > 0, done: false, wp: wp0, plan, xtk: 0, trail: [], far: cfg.start !== 'pad', prevWow: 0, navT: 0, aglSum: 0, aglMin: 1e9, xtkSum: 0, trailT: 0 });
  $('mTitle').textContent = env.hasShip ? 'Mission : appontage BPC' : `Mission : ${L.name}`;
  acc = 0; simT = 0; look.yaw = 0; look.pitch = -0.17;
  $('debrief').classList.add('hide'); $('alert').textContent = '';
  state = 'ready';
}

// ---------------------------------------------------------------- interface : réglages
const fields = {
  cWindDir: ['windDir', (v) => `${pad3(v)}°`], cWindKt: ['windKt', (v) => `${v} kt`], cGust: ['gustKt', (v) => `± ${v} kt`],
  cTurb: ['turb', (v) => (v == 0 ? 'nulle' : v < 25 ? 'faible' : v < 55 ? 'modérée' : v < 80 ? 'forte' : 'sévère'), 0.01],
  cSea: ['seaState', (v) => `mer ${v}`], cVis: ['visKm', (v) => `${v} km`], cHour: ['hour', (v) => `${Math.floor(v)} h ${v % 1 ? '30' : '00'}`],
  cShipHdg: ['shipHdg', (v) => `${pad3(v)}°`], cShipKt: ['shipKt', (v) => `${v} kt`], cMass: ['mass', (v) => `${v} kg`],
};
for (const id in fields) { const el = $(id), out = el.parentElement.querySelector('output'), f = fields[id]; const upd = () => { out.textContent = f[1](+el.value); }; el.addEventListener('input', upd); upd(); }
function readMenu() {
  for (const id in fields) { const f = fields[id]; cfg[f[0]] = +$(id).value * (f[2] || 1); }
  cfg.start = $('cStart').value; cfg.mission = $('cMission').value; cfg.spot = +$('cSpot').value; cfg.mode = $('cMode').value; cfg.airwake = $('cWake').value === '1';
}
function showMenu(resumable) { state = resumable ? 'pause' : 'menu'; $('menu').classList.remove('hide'); $('resume').classList.toggle('hide', !resumable); buildPadTable(); }
$('bGo').onclick = async () => { readMenu(); audio.init(); await demReady; $('menu').classList.add('hide'); reset(); };
$('bResume').onclick = () => { $('menu').classList.add('hide'); state = 'fly'; };
$('dAgain').onclick = () => { reset(); }; $('dMenu').onclick = () => { $('debrief').classList.add('hide'); showMenu(false); };

// ---------------------------------------------------------------- interface : joystick
let detect = null;
function buildPadTable() {
  const gp = input.pad(), t = $('padTable');
  $('padName').textContent = gp ? `— ${gp.id.slice(0, 60)}` : '— aucun joystick détecté';
  $('padHelp').textContent = gp ? 'Cliquez « Détecter » puis bougez l\'axe indiqué : l\'affectation et le sens sont réglés automatiquement et mémorisés.'
    : 'Branchez le joystick puis appuyez sur un de ses boutons pour que le navigateur le reconnaisse. Sans joystick, le clavier suffit pour essayer.';
  if (!gp || !input.cfg) { t.innerHTML = ''; return; }
  const opts = (n, sel) => Array.from({ length: n }, (_, i) => `<option ${i === sel ? 'selected' : ''}>${i}</option>`).join('');
  let h = '<tr><th>Fonction</th><th>Axe</th><th>Inversé</th><th></th><th>Valeur</th></tr>';
  for (const f of FUNCS) { const a = input.cfg.axes[f.id]; h += `<tr><td>${f.label}</td><td><select data-ax="${f.id}">${opts(gp.axes.length, a.i)}</select></td><td><input type="checkbox" data-inv="${f.id}" ${a.inv ? 'checked' : ''}></td><td><button data-det="${f.id}">Détecter</button></td><td><div class="bar"><i data-bar="${f.id}"></i></div></td></tr>`; }
  h += '<tr><th>Bouton</th><th>N°</th><th></th><th></th><th></th></tr>';
  for (const b of BTNS) h += `<tr><td>${b.label}</td><td><select data-bt="${b.id}">${opts(gp.buttons.length, input.cfg.btn[b.id])}</select></td><td></td><td><button data-detb="${b.id}">Détecter</button></td><td></td></tr>`;
  h += `<tr><td>Chapeau (trim)</td><td><select data-hat><option value="-1">boutons</option>${opts(gp.axes.length, input.cfg.hatAxis)}</select></td><td></td><td><button data-reset>Valeurs par défaut</button></td><td></td></tr>`;
  t.innerHTML = h;
  t.querySelectorAll('[data-ax]').forEach((s) => s.onchange = () => { input.cfg.axes[s.dataset.ax].i = +s.value; input.save(); });
  t.querySelectorAll('[data-inv]').forEach((s) => s.onchange = () => { input.cfg.axes[s.dataset.inv].inv = s.checked; input.save(); });
  t.querySelectorAll('[data-bt]').forEach((s) => s.onchange = () => { input.cfg.btn[s.dataset.bt] = +s.value; input.save(); });
  t.querySelector('[data-hat]').onchange = (e) => { input.cfg.hatAxis = +e.target.value; input.save(); };
  t.querySelector('[data-reset]').onclick = () => { input.resetCfg(); buildPadTable(); };
  t.querySelectorAll('[data-det]').forEach((b) => b.onclick = () => { const f = FUNCS.find((x) => x.id === b.dataset.det); detect = { kind: 'axis', id: f.id, snap: input.snapshot(), t: 0 }; $('padHelp').innerHTML = `<b class="warn">Détection : ${f.hint}…</b>`; });
  t.querySelectorAll('[data-detb]').forEach((b) => b.onclick = () => { detect = { kind: 'btn', id: b.dataset.detb, t: 0 }; $('padHelp').innerHTML = '<b class="warn">Détection : appuyez sur le bouton voulu…</b>'; });
}
function pollDetect(dt) {
  if (!detect) return;
  detect.t += dt;
  if (detect.kind === 'axis') {
    const m = input.movedAxis(detect.snap);
    if (m) {
      const a = input.cfg.axes[detect.id]; a.i = m.i;
      a.inv = detect.id === 'lon' ? m.delta > 0 : detect.id === 'coll' ? m.value < 0 : m.delta < 0;
      input.save(); detect = null; buildPadTable();
    }
  }
  if (detect && detect.t > 8) { detect = null; buildPadTable(); }
}
input.on('rawbtn', (i) => { if (detect && detect.kind === 'btn') { input.cfg.btn[detect.id] = i; input.save(); detect = null; buildPadTable(); } });
input.on('pad', () => { if (state === 'menu' || state === 'pause') buildPadTable(); });
function padBars() {
  const gp = input.pad(); if (!gp || !input.cfg) return;
  for (const f of FUNCS) { const el = document.querySelector(`[data-bar="${f.id}"]`); if (el) el.style.left = `${(clamp(input.rawAxis(gp, f.id), -1, 1) + 1) * 50}%`; }
}

// ---------------------------------------------------------------- commandes discrètes
function action(a) {
  if (detect) return;
  if (a === 'start' && state === 'ready') { state = 'fly'; $('ready').classList.add('hide'); return; }
  if (a === 'view') { view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]; return; }
  if (a === 'pause') { if (state === 'fly' || state === 'ready') showMenu(true); else if (state === 'pause') $('bResume').click(); return; }
  if (a === 'restart' && state !== 'menu') { $('menu').classList.add('hide'); reset(); return; }
  if (state !== 'fly' && state !== 'ready') return;
  if (a === 'trimRel') { if (state === 'ready') action('start'); else afcs.trimRelease(input.state.lon, input.state.lat); }
  if (a === 'mode') { afcs.setMode(MODES[(MODES.indexOf(afcs.mode) + 1) % MODES.length]); flash(`AFCS ${afcs.mode}`); }
  if (a === 'brake') { fdm.brakes = !fdm.brakes; flash(fdm.brakes ? 'FREINS SERRÉS' : 'FREINS LIBRES'); }
  if (a === 'engfail') { fdm.engFail = (fdm.engFail + 1) % 3; flash(['MOTEURS RÉTABLIS', 'PANNE MOTEUR 1', 'PANNE TOTALE MOTEURS — AUTOROTATION'][fdm.engFail]); }
}
const KEYMAP = { Enter: 'start', Space: 'start', KeyV: 'view', KeyC: 'view', KeyP: 'pause', Escape: 'pause', KeyR: 'restart', KeyT: 'trimRel', KeyM: 'mode', KeyB: 'brake', KeyE: 'engfail' };
input.on('key', (code) => {
  if (KEYMAP[code]) action(KEYMAP[code]);
  if (code === 'KeyO') ovForce = !(ovForce ?? view !== 'cockpit');
  if (code === 'KeyH') hudOn = !hudOn;
  if (code === 'KeyN') audio.toggle();
  if (code === 'KeyG') { rngSel = (rngSel + 1) % RANGES.length; flash(RANGES[rngSel] ? `SITAC ${RANGES[rngSel]} NM` : 'SITAC ÉCHELLE AUTO'); }
});
input.on('btn', (id) => action(id));
let flashT = 0; function flash(t) { $('alert').textContent = t; $('alert').className = ''; flashT = 2; }

// souris : regard libre / orbite, molette = zoom
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY];
  if (view === 'cockpit') { look.yaw = clamp(look.yaw - dx * 0.004, -2.4, 2.4); look.pitch = clamp(look.pitch - dy * 0.004, -1.3, 1.2); }
  else { look.az -= dx * 0.006; look.el = clamp(look.el + dy * 0.005, -0.3, 1.45); }
});
canvas.addEventListener('dblclick', () => { look.yaw = 0; look.pitch = -0.17; look.az = Math.PI; look.el = 0.2; });
canvas.addEventListener('wheel', (e) => { if (view === 'ext') look.dist = clamp(look.dist * (1 + Math.sign(e.deltaY) * 0.1), 12, 400); else look.fov = clamp(look.fov + Math.sign(e.deltaY) * 3, 25, 95); }, { passive: true });

// ---------------------------------------------------------------- son (synthèse)
const audio = {
  ctx: null, on: true,
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const a = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = buf.getChannelData(0); let b = 0;
      for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
      const n = a.createBufferSource(); n.buffer = buf; n.loop = true;
      this.lp = a.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 500;
      this.slap = a.createGain(); this.lfo = a.createOscillator(); this.lfo.type = 'sawtooth'; this.lfo.frequency.value = 17;
      const lg = a.createGain(); lg.gain.value = 0.5; this.lfo.connect(lg); lg.connect(this.slap.gain);
      this.whine = a.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 900; const wg = this.wg = a.createGain(); wg.gain.value = 0.012;
      const wl = a.createBiquadFilter(); wl.type = 'bandpass'; wl.frequency.value = 1200; wl.Q.value = 2;
      this.master = a.createGain(); this.master.gain.value = 0;
      n.connect(this.lp); this.lp.connect(this.slap); this.slap.connect(this.master); this.whine.connect(wl); wl.connect(wg); wg.connect(this.master); this.master.connect(a.destination);
      n.start(); this.lfo.start(); this.whine.start();
    } catch (e) { this.ctx = null; }
  },
  toggle() { this.on = !this.on; flash(this.on ? 'SON ACTIVÉ' : 'SON COUPÉ'); },
  update() {
    if (!this.ctx) return; const t = this.ctx.currentTime, nr = fdm.nr / 100, live = this.on && (state === 'fly' || state === 'ready');
    this.lfo.frequency.setTargetAtTime(17.1 * nr, t, 0.1); this.whine.frequency.setTargetAtTime(900 * nr, t, 0.1);
    this.lp.frequency.setTargetAtTime((view === 'cockpit' ? 320 : 700) + fdm.tq * 5, t, 0.1);
    this.slap.gain.setTargetAtTime(0.5 + fdm.tq / 160, t, 0.1);
    this.master.gain.setTargetAtTime(live ? (view === 'cockpit' ? 0.5 : 0.8) * nr : 0, t, 0.2);
  },
};

// ---------------------------------------------------------------- mission et débriefing
// cible de l'écran « stationnaire » : hélisurface de départ tant qu'on ne l'a pas quittée, sinon point de poser
function target() {
  const L = env.landing(), f = fdm, dl = Math.hypot(L.n - f.pos[0], L.e - f.pos[1]), dp = Math.hypot(f.pos[0], f.pos[1]);
  if (!M.far) return { kind: 'pad', name: 'HÉLISURFACE', n: 0, e: 0, h: fieldAlt(), psi: f.psi, vn: 0, ve: 0, vu: 0, dist: dp };
  return { ...L, dist: dl, spot: L.kind === 'deck' ? SHIP.spots.find((x) => x.id === cfg.spot) : null };
}
function missionUpdate(dt) {
  const f = fdm, L = env.landing(), plan = env.plan(), sea = env.hasShip; M.plan = plan;
  const dl = Math.hypot(L.n - f.pos[0], L.e - f.pos[1]), dp = Math.hypot(f.pos[0], f.pos[1]);
  if (dp > 600) M.far = true;
  M.maxTq = Math.max(M.maxTq, f.tq);
  if (!f.wow) { M.airT += dt; if (M.airT > 8) M.flown = true; }
  // séquencement du plan de vol : point validé à moins de 500 m, ou une fois son travers dépassé
  while (M.wp < plan.length - 1) {
    const w = plan[M.wp], nx = plan[M.wp + 1], d = Math.hypot(w.n - f.pos[0], w.e - f.pos[1]);
    const along = (f.pos[0] - w.n) * (nx.n - w.n) + (f.pos[1] - w.e) * (nx.e - w.e);
    if (d < 500 || (along > 0 && d < 3000)) M.wp++; else break;
  }
  const a = plan[M.wp - 1], b = plan[M.wp], ln = b.n - a.n, le = b.e - a.e, ll = Math.hypot(ln, le) || 1;
  M.xtk = ((f.pos[1] - a.e) * ln - (f.pos[0] - a.n) * le) / ll;            // > 0 : à droite de la route
  M.trailT -= dt; if (M.trailT <= 0 && dt > 0) { M.trailT = 3; M.trail.push([f.pos[0], f.pos[1]]); if (M.trail.length > 500) M.trail.shift(); }
  // phase courante
  const over = sea ? (f.surf && f.surf.kind === 'deck' && f.agl < 20) : (dl < 70 && f.alt - L.h < 25);
  let ph;
  if ((f.wow || (state === 'ready' && recColl === 0)) && !M.flown) ph = 0;
  else if (over && M.flown) ph = f.wow ? 5 : 4;
  else if (!M.far) ph = f.wow ? 0 : 1;
  else if (dl < (sea ? NM : 1800)) ph = 3;
  else ph = 2;
  M.phase = ph;
  if (ph === 2 && !f.wow && dt > 0) { M.navT += dt; M.aglSum += f.agl * dt; M.aglMin = Math.min(M.aglMin, f.agl); M.xtkSum += Math.abs(M.xtk) * dt; }
  // toucher des roues
  if (f.wow && !M.prevWow && M.flown) {
    const S = env.ship, s = f.surf, rel = Math.hypot(f.vw[0] - s.vn, f.vw[1] - s.ve);
    M.td = { vs: Math.max(f.lastAirVs, f.maxTouchVs), kind: s.kind, rel, hdgErr: Math.abs(Math.atan2(Math.sin(f.psi - S.psi), Math.cos(f.psi - S.psi))) * R2D, t: simT };
    if (s.kind === 'deck') { const spt = SHIP.spots.find((x) => x.id === cfg.spot); M.td.df = s.f - spt.f; M.td.ds = s.s - spt.s; M.td.err = Math.hypot(M.td.df, M.td.ds); }
    else if (!sea) { M.td.err = dl; M.td.onLz = dl < 150; M.td.brg = Math.atan2(f.pos[1] - L.e, f.pos[0] - L.n) * R2D; }
  }
  if (!f.wow) f.maxTouchVs = 0;
  M.prevWow = f.wow;
  // immobilisation après le poser
  const relSpd = f.surf ? Math.hypot(f.vw[0] - f.surf.vn, f.vw[1] - f.surf.ve) : 0;
  if (f.wowAll && M.flown && M.td && input.state.coll < 0.3 && relSpd < 0.6) M.settle += dt; else M.settle = 0;
  if (M.settle > 2.5 && !M.done) { M.done = true; debrief(false); }
  // consignes
  const brg = pad3(Math.atan2(b.e - f.pos[1], b.n - f.pos[0]) * R2D), dw = (Math.hypot(b.n - f.pos[0], b.e - f.pos[1]) / NM).toFixed(1), S = env.ship;
  const hints = sea ? [
    `Freins serrés. Montez doucement le collectif (≈ 50 %) jusqu'au décollage des roues, stabilisez à 10 ft.`,
    `Assiette à piquer 5° pour accélérer, montez vers 500 ft. Cap ${brg}° vers ${b.name}.`,
    `Croisière 500 ft / 100–120 kt. ${b.name} au ${brg}° / ${dw} NM. Navire : route ${pad3(S.psi * R2D)}° à ${Math.round(S.v * KT)} kt.`,
    `Présentez-vous dans l'axe arrière bâbord (ligne jaune). 60 kt à 0,5 NM / 250 ft, puis 30 kt à 0,2 NM / 100 ft. Évitez Vz > 500 ft/min sous 30 kt (vortex).`,
    `Stationnaire au-dessus du spot ${cfg.spot} : accompagnez le navire (${Math.round(S.v * KT)} kt), attendez une accalmie du pont, puis descendez franchement.`,
    `Roues posées : baissez le collectif à fond pour valider l'appontage.`,
  ] : [
    `Freins serrés. Montez doucement le collectif (≈ 50 %) jusqu'au décollage des roues, stabilisez à 10 ft.`,
    `Assiette à piquer 5° pour accélérer. Cap ${brg}° vers ${b.name}.`,
    `Vol tactique : ${b.name} au ${brg}° / ${dw} NM. Suivez le fond de vallée entre 150 et 300 ft sol, 90–110 kt ; anticipez les montées (zone de poser à ${Math.round(L.h * FT / 10) * 10} ft).`,
    `Approche ${L.name} (${Math.round(L.h * FT / 10) * 10} ft) : lisez le vent au fumigène et à la manche à air, 60 kt à 1 km, finale face au vent. En altitude la marge de puissance est réduite : surveillez le couple.`,
    `Stationnaire au-dessus du H : descente verticale, Vz inférieure à 300 ft/min.`,
    `Roues posées : baissez le collectif à fond pour valider le poser.`,
  ];
  $('mSteps').innerHTML = STEPS[sea ? 'mer' : 'pau'].map((t, i) => `<li class="${i === ph ? 'cur' : i < ph ? 'done' : ''}">${t}${i === 2 && ph === 2 ? ` — ${b.name} (${M.wp}/${plan.length - 1})` : ''}</li>`).join('');
  $('mHint').textContent = hints[ph];
  return target();
}
function grade(v, lims) { for (let i = 0; i < lims.length; i++) if (v <= lims[i][0]) return lims[i]; return lims[lims.length - 1]; }
function debrief(crash) {
  state = 'debrief'; $('debrief').classList.remove('hide');
  const td = M.td, rows = [], sea = env.hasShip, L = env.landing(); let score = 100;
  const nav = () => { if (M.navT > 20) { rows.push(['Hauteur sol moyenne en navigation', `${Math.round(M.aglSum / M.navT * FT / 10) * 10} ft (mini ${Math.round(M.aglMin * FT)} ft)`, '']); rows.push(['Écart moyen au plan de vol', `${Math.round(M.xtkSum / M.navT / 10) * 10} m`, '']); } };
  if (crash) {
    $('dTitle').textContent = 'Appareil perdu'; $('dTitle').className = 'bad'; $('dSub').textContent = fdm.crashed.why; $('score').textContent = '';
    if (td) rows.push(['Vitesse verticale au toucher', `${Math.round(td.vs * 196.85)} ft/min`, '']);
    rows.push(['Vitesse au moment de l\'accident', `${Math.round(fdm.gs * KT)} kt sol, Vz ${Math.round(fdm.vs * 196.85)} ft/min`, '']);
    nav(); rows.push(['Durée du vol', `${Math.floor(simT / 60)} min ${Math.round(simT % 60)} s`, '']);
  } else {
    const onDeck = td.kind === 'deck', onLz = !!td.onLz, good = onDeck || onLz;
    $('dTitle').textContent = onDeck ? `Appontage réussi — spot ${cfg.spot}` : onLz ? `Poser réussi — ${L.name}` : 'Atterrissage hors zone'; $('dTitle').className = good ? 'ok' : 'warn';
    $('dSub').textContent = good ? 'Analyse du toucher des roues' : 'Posé en dehors du point prévu : mission non réalisée, analyse du poser.';
    const add = (label, val, g) => { score -= g[1]; rows.push([label, val, `<span class="${g[1] === 0 ? 'ok' : g[1] < 20 ? 'warn' : 'bad'}">${g[2]}</span>`]); };
    add('Vitesse verticale au toucher', `${Math.round(td.vs * 196.85)} ft/min`, grade(td.vs * 196.85, [[200, 0, 'excellent'], [350, 10, 'correct'], [500, 25, 'ferme'], [1e9, 45, 'dur']]));
    if (onDeck) {
      add('Écart au centre du spot', `${td.err.toFixed(1)} m (${Math.abs(td.df).toFixed(1)} m ${td.df > 0 ? 'en avant' : 'en arrière'}, ${Math.abs(td.ds).toFixed(1)} m ${td.ds > 0 ? 'à droite' : 'à gauche'})`, grade(td.err, [[1.5, 0, 'excellent'], [3, 10, 'correct'], [6, 25, 'imprécis'], [1e9, 40, 'hors spot']]));
      add('Alignement avec l\'axe du navire', `${td.hdgErr.toFixed(0)}°`, grade(td.hdgErr, [[5, 0, 'excellent'], [10, 5, 'correct'], [20, 15, 'désaxé'], [1e9, 25, 'très désaxé']]));
    } else if (onLz) add('Écart au centre de la zone (H)', `${td.err.toFixed(1)} m au ${pad3(td.brg)}°`, grade(td.err, [[3, 0, 'excellent'], [8, 10, 'correct'], [20, 25, 'imprécis'], [1e9, 40, 'hors marquage']]));
    add('Vitesse relative au toucher', `${(td.rel * KT).toFixed(1)} kt`, grade(td.rel * KT, [[2, 0, 'excellent'], [4, 10, 'glissé'], [1e9, 20, 'trop rapide']]));
    add('Couple maximal pendant le vol', `${Math.round(M.maxTq)} %`, grade(M.maxTq, [[100, 0, 'dans les limites'], [110, 5, 'transitoire'], [1e9, 15, 'surcouple']]));
    nav(); rows.push(['Durée du vol', `${Math.floor(simT / 60)} min ${Math.round(simT % 60)} s`, '']);
    if (!good) score = Math.min(score, 50);
    $('score').innerHTML = `<span class="${score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'bad'}">${Math.max(0, score)} / 100</span>`;
  }
  $('dTable').innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td><b>${r[1]}</b></td><td>${r[2]}</td></tr>`).join('');
}

// ---------------------------------------------------------------- données instruments
function snapshot(tg) {
  const f = fdm, wp = M.plan[M.wp], wn = wp.n - f.pos[0], we = wp.e - f.pos[1];
  const dn = tg.n - f.pos[0], de = tg.e - f.pos[1], c = Math.cos(f.psi), s = Math.sin(f.psi);
  const rvn = f.vw[0] - tg.vn, rve = f.vw[1] - tg.ve;
  const cautions = [];
  if (f.engFail === 2) cautions.push({ t: 'PANNE MOTEURS', level: 2 }); else if (f.engFail === 1) cautions.push({ t: 'PANNE MOT 1', level: 2 });
  if (f.nr < 95) cautions.push({ t: 'NR BAS', level: 2 }); if (f.nr > 106) cautions.push({ t: 'NR HAUT', level: 1 });
  if (f.tq > 110) cautions.push({ t: 'SURCOUPLE', level: 2 }); else if (f.tq > 100) cautions.push({ t: 'COUPLE LIMITE', level: 1 });
  if (f.vrs > 0.35) cautions.push({ t: 'VORTEX', level: 2 });
  if (f.tas * KT > 165) cautions.push({ t: 'VNE', level: 1 });
  if (f.fuel < 250) cautions.push({ t: 'CARBURANT BAS', level: 1 });
  const mw = env.meanWind;
  return {
    ias: f.tas * KT, alt: f.alt * FT, ra: Math.max(0, f.agl - 1.85) * FT, vs: f.vs * 196.85, hdg: wrap360(f.psi * R2D), pitch: f.theta, roll: f.phi,
    slip: clamp(f.accB[1] / 9.81, -0.3, 0.3), tq: f.tq, nr: f.nr, gs: f.gs * KT, trk: f.gs > 1 ? wrap360(Math.atan2(f.vw[1], f.vw[0]) * R2D) : wrap360(f.psi * R2D),
    windDir: wrap360(Math.atan2(-mw[1], -mw[0]) * R2D), windKt: Math.hypot(mw[0], mw[1]) * KT, mode: afcs.mode, thRef: afcs.thRef, phRef: afcs.phRef,
    tgtBrg: wrap360(Math.atan2(we, wn) * R2D), tgtDist: Math.hypot(wn, we) / NM, tgtName: wp.name, warn: cautions.find((x) => x.level === 2) || cautions[0],
    n: f.pos[0], e: f.pos[1], ship: env.hasShip ? env.ship : null, cautions, map: relief[env.mission.theatre], plan: M.plan, wpI: M.wp, xtk: M.xtk, trail: M.trail, lzAlt: env.landing().h,
    rng: RANGES[rngSel] || (Math.hypot(wn, we) / NM > 7 ? 10 : Math.hypot(wn, we) / NM > 2.5 ? 5 : Math.hypot(wn, we) / NM > 0.8 ? 2 : 1), coll: input.state.coll, lon: input.state.lon, lat: input.state.lat, ped: input.state.ped,
    swLon: afcs.pos.lon, swLat: afcs.pos.lat, swPed: afcs.pos.ped, fuel: f.fuel, ff: f.Peng * f.p.sfc * 3600, mass: f.totalMass, brakes: f.brakes, wow: f.wow, nz: f.nz,
    engFail: f.engFail, pkw: f.Peng / 1000,
    hov: {
      dx: dn * c + de * s, dy: -dn * s + de * c, relHdg: tg.kind === 'deck' ? tg.psi - f.psi : 0, vx: rvn * c + rve * s, vy: -rvn * s + rve * c,
      hgt: Math.max(0, f.alt - 1.85 - tg.h), vz: f.vs - tg.vu, kind: tg.kind, name: tg.name, spot: tg.spot, heave: env.ship.heave, roll: env.ship.roll, pitch: env.ship.pitch,
    },
  };
}

// ---------------------------------------------------------------- boucle principale
const tmpM = new THREE.Matrix4(), vR = new THREE.Vector3(), vU = new THREE.Vector3(), vB = new THREE.Vector3(), camQ = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
let last = performance.now(), snap = null, hudT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; frameN++;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  const inp = input.update(dt);
  if (state === 'menu' || state === 'pause') { pollDetect(dt); padBars(); }

  if (state === 'fly') {
    acc += dt;
    while (acc >= H) {
      env.update(H, fdm);
      fdm.step(H, afcs.update(H, inp), env);
      acc -= H; simT += H;
    }
    fdm.checkHull(env);
    if (fdm.crashed) { flash(''); debrief(true); }
  } else if (state === 'ready') {
    env.updateShip(); afcs.pos.coll = inp.coll;
    const okC = Math.abs(inp.coll - recColl) < 0.06;
    const r = $('ready'); r.classList.remove('hide');
    r.innerHTML = `${recColl > 0 ? `Départ en vol : placez le collectif vers <b>${Math.round(recColl * 100)} %</b> (repère orange) — actuellement <b class="${okC ? 'ok' : 'warn'}">${Math.round(inp.coll * 100)} %</b>.` : `Collectif en bas (actuellement <b class="${inp.coll < 0.1 ? 'ok' : 'warn'}">${Math.round(inp.coll * 100)} %</b>), manche au neutre.`}<br>Appuyez sur la <b>gâchette</b> ou <b>Entrée</b> pour lancer le vol.`;
  }

  // ---- pose de l'hélicoptère (NED -> three)
  const q = fdm.q, f3 = qRot(q, [1, 0, 0]), r3 = qRot(q, [0, 1, 0]), d3 = qRot(q, [0, 0, 1]);
  vR.set(r3[1], -r3[2], -r3[0]); vU.set(-d3[1], d3[2], d3[0]); vB.set(-f3[1], f3[2], f3[0]);
  tmpM.makeBasis(vR, vU, vB); heli.quaternion.setFromRotationMatrix(tmpM);
  heli.position.set(fdm.pos[1], -fdm.pos[2], -fdm.pos[0]);
  const u = heli.userData;
  if (state === 'fly') spin += fdm.omega * dt;
  u.rotor.rotation.set(-(fdm.tiltF + 0.052), spin, -fdm.tiltR); u.tail.rotation.x = spin * 4.65;
  u.disc.rotation.x = -Math.PI / 2 - (fdm.tiltF + 0.052); u.disc.material.opacity = 0.16 * clamp(fdm.nr / 100, 0, 1);
  u.strobe.visible = (now % 1200) < 90;
  const cu = cockpit.userData; cu.cyc.rotation.set(-afcs.pos.lon * 0.16 - inp.lon * 0.1, 0, -afcs.pos.lat * 0.16 - inp.lat * 0.1); cu.col.rotation.x = 0.1 + inp.coll * 0.45;
  heli.updateMatrixWorld(true);

  // ---- caméra
  const inCockpit = view === 'cockpit';
  u.body.visible = !inCockpit; cockpit.visible = inCockpit;
  if (inCockpit) {
    camera.position.copy(EYE).applyMatrix4(heli.matrixWorld);
    eul.set(look.pitch, look.yaw, 0); camQ.setFromEuler(eul); camera.quaternion.copy(heli.quaternion).multiply(camQ);
    camera.fov = look.fov;
  } else if (view === 'ext') {
    const az = fdm.psi + look.az, ce = Math.cos(look.el);
    camera.position.set(heli.position.x + Math.sin(az) * ce * look.dist, heli.position.y + Math.sin(look.el) * look.dist + 1.5, heli.position.z - Math.cos(az) * ce * look.dist);
    const s = env.surface(-camera.position.z, camera.position.x); camera.position.y = Math.max(camera.position.y, s.h + 1.2);
    camera.lookAt(heli.position.x, heli.position.y + 1, heli.position.z); camera.fov = 55;
  } else {
    const S = env.ship, L = env.landing(), TOWER = buildings().find((b) => b.kind === 'tower');
    const ds = Math.hypot(fdm.pos[0] - L.n, fdm.pos[1] - L.e), dtw = Math.hypot(fdm.pos[0] - TOWER.n, fdm.pos[1] - TOWER.e);
    if (ds < dtw && env.hasShip) { const [n, e] = env.fromDeck(-20, 12); camera.position.set(e, DECK_H + S.heave + 19, -n); }
    else if (ds < dtw) camera.position.set(L.e + 55, terrainH(L.n - 35, L.e + 55) + 2.5, -(L.n - 35));          // observateur au sol près de la zone de poser
    else camera.position.set(TOWER.e, fieldAlt() + TOWER.h + 1, -TOWER.n + 7);
    camera.lookAt(heli.position); camera.fov = clamp(2 * Math.atan(26 / camera.position.distanceTo(heli.position)) * R2D, 4, 60);
  }
  camera.updateProjectionMatrix();
  world.update(state === 'fly' ? dt : 0, env, camera.position, heli.position);

  // ---- instruments (un écran par image) et bandeau
  if (state === 'fly' || state === 'ready' || !snap) {
    const tg = missionUpdate(state === 'fly' ? dt : 0);
    snap = snapshot(tg);
    const k = ['pfd', 'nd', 'hov', 'eng'][frameN % 4];
    ({ pfd: drawPFD, nd: drawSITAC, hov: drawHOV, eng: drawENG })[k](ctx[k], snap); tex[k].needsUpdate = true;
  }
  hudT -= dt;
  if (hudT <= 0 && snap) {
    hudT = 0.1;
    const s = snap, ov = (ovForce ?? !inCockpit) && state !== 'menu';
    for (const id of ['ovPfd', 'ovNd', 'ovHov']) $(id).classList.toggle('hide', !ov);
    const flying = state === 'fly' || state === 'ready';
    $('hud').classList.toggle('hide', !hudOn || !flying); $('mission').classList.toggle('hide', !hudOn || !flying); $('status').classList.toggle('hide', !hudOn || !flying); $('collbar').classList.toggle('hide', !flying);
    $('hIas').textContent = Math.round(s.ias); $('hAlt').textContent = Math.round(s.alt / 10) * 10; $('hRa').textContent = s.ra < 2500 ? Math.round(s.ra) : '—';
    $('hVs').textContent = Math.round(s.vs / 10) * 10; $('hHdg').textContent = pad3(s.hdg); $('hTq').textContent = `${Math.round(s.tq)} %`; $('hTq').className = s.tq > 110 ? 'bad' : s.tq > 100 ? 'warn' : '';
    $('hNr').textContent = `${Math.round(s.nr)} %`; $('hNr').className = s.nr < 95 ? 'bad' : ''; $('hMode').textContent = s.mode; $('hView').textContent = VIEW_LBL[view];
    $('collFill').style.height = `${s.coll * 192}px`; $('collMark').style.bottom = `${4 + recColl * 192}px`; $('collMark').style.display = state === 'ready' ? '' : 'none';
    $('status').innerHTML = `Vent <b>${pad3(s.windDir)}° / ${Math.round(s.windKt)} kt</b> · ${env.hasShip ? `mer <b>${cfg.seaState}</b>` : `sol <b>${Math.round(fdm.surf ? fdm.surf.h * FT / 10 : 0) * 10} ft</b>`}<br>${input.useGamepad ? `Joystick : <b>${input.gpId.slice(0, 28)}</b>` : '<b>Clavier</b> (aucun joystick)'}<br>${Math.round(fps)} images/s · P = pause`;
    if (flashT > 0) { flashT -= 0.1; if (flashT <= 0) $('alert').textContent = ''; }
    else if (state === 'fly' && s.warn && s.warn.level === 2) { $('alert').textContent = s.warn.t; $('alert').className = 'bad'; }
    else if (state === 'fly') $('alert').textContent = '';
    audio.update();
  }
  renderer.render(scene, camera);
}

world.setTheatre('mer'); world.applyConfig(cfg);
showMenu(false);
requestAnimationFrame(frame);
// accès console pour les essais
window.SIM = { fdm, afcs, input, get env() { return env; }, get state() { return state; }, action, setView: (v) => { view = v; }, look, cfg, reset, M };
