// ============================================================================
// Écrans multifonctions (512 x 512) dessinés en Canvas 2D :
//  PFD (pilotage), SITAC (situation tactique / navigation), ENG (moteurs / commandes), HOV (stationnaire / appontage)
// ============================================================================
import { SHIP, deckHalfWidth } from './env.js';
const D2R = Math.PI / 180, W = 512;
const GREEN = '#35e06a', CYAN = '#4fd8ff', AMBER = '#ffb020', RED = '#ff4a3a', WHITE = '#f0f4f6', MAG = '#ff5cf0', GREY = '#8a949c';
const pad3 = (v) => String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, '0');

function frame(g, title) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#05080a'; g.fillRect(0, 0, W, W);
  g.lineWidth = 2; g.textBaseline = 'middle'; g.textAlign = 'center';
  if (title) { g.fillStyle = GREY; g.font = 'bold 15px sans-serif'; g.textAlign = 'left'; g.fillText(title, 8, 12); g.textAlign = 'center'; }
}
function txt(g, s, x, y, color = WHITE, font = 'bold 20px sans-serif', align = 'center') { g.fillStyle = color; g.font = font; g.textAlign = align; g.fillText(s, x, y); }

// ---------------------------------------------------------------- PFD
export function drawPFD(g, s) {
  frame(g);
  const cx = 256, cy = 205, hw = 140, hh = 150, ppd = 6;
  // horizon artificiel
  g.save(); g.beginPath(); g.rect(cx - hw, cy - hh, 2 * hw, 2 * hh); g.clip();
  g.translate(cx, cy); g.rotate(-s.roll); g.translate(0, s.pitch / D2R * ppd);
  g.fillStyle = '#2a79c9'; g.fillRect(-600, -1200, 1200, 1200); g.fillStyle = '#8a5a2b'; g.fillRect(-600, 0, 1200, 1200);
  g.strokeStyle = WHITE; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-600, 0); g.lineTo(600, 0); g.stroke();
  g.lineWidth = 2; g.font = 'bold 15px sans-serif'; g.fillStyle = WHITE;
  for (let p = -90; p <= 90; p += 5) {
    if (p === 0) continue; const y = -p * ppd, l = p % 10 === 0 ? 46 : 22;
    g.beginPath(); g.moveTo(-l, y); g.lineTo(l, y); g.stroke();
    if (p % 10 === 0) { g.fillText(Math.abs(p), -l - 16, y); g.fillText(Math.abs(p), l + 16, y); }
  }
  g.restore();
  // échelle de roulis
  g.save(); g.translate(cx, cy); g.strokeStyle = WHITE; g.lineWidth = 2;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { g.save(); g.rotate(a * D2R); g.beginPath(); g.moveTo(0, -hh + 4); g.lineTo(0, -hh + (a % 30 === 0 ? 20 : 12)); g.stroke(); g.restore(); }
  g.save(); g.rotate(-s.roll); g.fillStyle = AMBER; g.beginPath(); g.moveTo(0, -hh + 22); g.lineTo(-9, -hh + 38); g.lineTo(9, -hh + 38); g.closePath(); g.fill();
  g.fillRect(-12 + s.slip * 120, -hh + 41, 24, 6); g.restore();      // bille (dérapage)
  // maquette
  g.strokeStyle = AMBER; g.lineWidth = 5; g.beginPath(); g.moveTo(-70, 0); g.lineTo(-26, 0); g.lineTo(-26, 10); g.moveTo(70, 0); g.lineTo(26, 0); g.lineTo(26, 10); g.stroke();
  g.fillStyle = AMBER; g.fillRect(-4, -4, 8, 8);
  // référence d'assiette AFCS
  if (s.mode === 'ATT') { g.strokeStyle = MAG; g.lineWidth = 2; const y = (s.pitch - s.thRef) / D2R * ppd; g.beginPath(); g.moveTo(-18, y); g.lineTo(18, y); g.stroke(); }
  g.restore();
  g.strokeStyle = '#3a444c'; g.lineWidth = 2; g.strokeRect(cx - hw, cy - hh, 2 * hw, 2 * hh);

  // ruban de vitesse (kt)
  tape(g, 22, cy - hh, 82, 2 * hh, s.ias, 3.2, 10, 20, (v) => v >= 0, 'left');
  box(g, 22, cy - 17, 82, 34, Math.round(s.ias), s.ias > 165 ? RED : WHITE);
  txt(g, 'IAS kt', 63, cy - hh - 12, CYAN, 'bold 14px sans-serif');
  txt(g, `GS ${Math.round(s.gs)}`, 63, cy + hh + 14, GREEN, 'bold 17px sans-serif');
  // ruban d'altitude (ft)
  tape(g, 408, cy - hh, 82, 2 * hh, s.alt, 0.3, 100, 200, () => true, 'right');
  box(g, 408, cy - 17, 82, 34, Math.round(s.alt / 10) * 10, WHITE);
  txt(g, 'ALT ft', 449, cy - hh - 12, CYAN, 'bold 14px sans-serif');
  // variomètre
  const vx = 498, vh = hh - 10, vy = Math.max(-1, Math.min(1, s.vs / 2000)) * vh;
  g.strokeStyle = GREY; g.lineWidth = 1.5; for (const v of [-2, -1, -0.5, 0, 0.5, 1, 2]) { g.beginPath(); g.moveTo(vx - 4, cy - v / 2 * vh); g.lineTo(vx + 5, cy - v / 2 * vh); g.stroke(); }
  g.fillStyle = Math.abs(s.vs) > 1500 ? AMBER : GREEN; g.fillRect(vx - 2, Math.min(cy, cy - vy), 6, Math.abs(vy));
  txt(g, `${s.vs >= 0 ? '+' : '−'}${Math.abs(Math.round(s.vs / 10) * 10)}`, 449, cy + hh + 14, Math.abs(s.vs) > 1500 ? AMBER : GREEN, 'bold 17px sans-serif');
  // radiosonde
  if (s.ra < 2500) {
    g.fillStyle = '#05080a'; g.fillRect(cx + 38, cy + hh - 40, 98, 36); g.strokeStyle = GREEN; g.strokeRect(cx + 38, cy + hh - 40, 98, 36);
    txt(g, 'RA', cx + 54, cy + hh - 22, GREEN, 'bold 14px sans-serif'); txt(g, String(Math.max(0, Math.round(s.ra < 50 ? s.ra : s.ra / 5) * (s.ra < 50 ? 1 : 5))), cx + 98, cy + hh - 21, s.ra < 20 ? AMBER : GREEN, 'bold 26px sans-serif');
  }
  // annonces de mode
  txt(g, s.mode, cx - 96, 30, s.mode === 'ATT' ? GREEN : AMBER, 'bold 20px sans-serif');
  txt(g, s.mode === 'ATT' ? 'HDG' : '', cx, 30, GREEN, 'bold 20px sans-serif');
  if (s.warn) txt(g, s.warn.t, cx, cy - hh + 62, s.warn.level === 2 ? RED : AMBER, 'bold 24px sans-serif');

  // ruban de cap
  const hy = 385, ppdH = 4.2;
  g.save(); g.beginPath(); g.rect(cx - 190, hy - 22, 380, 50); g.clip();
  g.strokeStyle = WHITE; g.lineWidth = 2; g.font = 'bold 17px sans-serif'; g.fillStyle = WHITE;
  const h0 = Math.floor(s.hdg / 5) * 5;
  for (let h = h0 - 50; h <= h0 + 50; h += 5) {
    const x = cx + (h - s.hdg) * ppdH; g.beginPath(); g.moveTo(x, hy + 8); g.lineTo(x, hy + (h % 10 === 0 ? 22 : 15)); g.stroke();
    if (h % 30 === 0) { const hh2 = ((h % 360) + 360) % 360; g.fillText(hh2 === 0 ? 'N' : hh2 === 90 ? 'E' : hh2 === 180 ? 'S' : hh2 === 270 ? 'W' : String(hh2 / 10), x, hy - 6); }
  }
  let db = ((s.tgtBrg - s.hdg + 540) % 360) - 180; db = Math.max(-44, Math.min(44, db));
  g.fillStyle = MAG; g.beginPath(); const bx = cx + db * ppdH; g.moveTo(bx, hy + 8); g.lineTo(bx - 8, hy + 24); g.lineTo(bx + 8, hy + 24); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = AMBER; g.beginPath(); g.moveTo(cx, hy + 6); g.lineTo(cx - 7, hy - 8); g.lineTo(cx + 7, hy - 8); g.closePath(); g.fill();
  box(g, cx - 32, hy + 30, 64, 30, pad3(s.hdg), WHITE);
  txt(g, `${s.tgtName} ${pad3(s.tgtBrg)}° ${s.tgtDist.toFixed(1)} NM`, cx + 52, hy + 46, MAG, 'bold 17px sans-serif', 'left');
  txt(g, `VENT ${pad3(s.windDir)}/${Math.round(s.windKt)}`, cx - 52, hy + 46, CYAN, 'bold 17px sans-serif', 'right');
  // couple et régime rotor
  bar(g, 30, 462, 200, 'TQ', s.tq, 0, 130, [[0, 100, GREEN], [100, 110, AMBER], [110, 130, RED]], '%');
  bar(g, 282, 462, 200, 'NR', s.nr, 60, 120, [[60, 90, RED], [90, 97, AMBER], [97, 104, GREEN], [104, 110, AMBER], [110, 120, RED]], '%');
}
function tape(g, x, y, w, h, val, ppu, minor, major, valid, side) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = '#1b2228'; g.fillRect(x, y, w, h);
  g.strokeStyle = WHITE; g.fillStyle = WHITE; g.lineWidth = 1.5; g.font = 'bold 16px sans-serif';
  const cy = y + h / 2, v0 = Math.floor(val / minor) * minor, n = Math.ceil(h / 2 / ppu / minor) + 1;
  for (let i = -n; i <= n; i++) {
    const v = v0 + i * minor; if (!valid(v)) continue; const yy = cy - (v - val) * ppu;
    const tx = side === 'left' ? x + w : x; g.beginPath(); g.moveTo(tx, yy); g.lineTo(tx + (side === 'left' ? -1 : 1) * (v % major === 0 ? 14 : 8), yy); g.stroke();
    if (v % major === 0) { g.textAlign = side === 'left' ? 'right' : 'left'; g.fillText(String(v), side === 'left' ? x + w - 18 : x + 18, yy); }
  }
  g.restore();
}
function box(g, x, y, w, h, v, color) { g.fillStyle = '#000'; g.fillRect(x, y, w, h); g.strokeStyle = color; g.lineWidth = 2; g.strokeRect(x, y, w, h); txt(g, String(v), x + w / 2, y + h / 2 + 1, color, 'bold 24px sans-serif'); }
function bar(g, x, y, w, label, v, min, max, zones, unit) {
  const f = (u) => x + 40 + (Math.max(min, Math.min(max, u)) - min) / (max - min) * (w - 40);
  txt(g, label, x, y + 8, CYAN, 'bold 16px sans-serif', 'left');
  let col = GREEN; for (const [a, b, c] of zones) { g.fillStyle = c; g.globalAlpha = 0.35; g.fillRect(f(a), y + 16, f(b) - f(a), 5); g.globalAlpha = 1; if (v >= a && v <= b) col = c; }
  g.fillStyle = col; g.fillRect(x + 40, y, f(v) - x - 40, 14); g.strokeStyle = GREY; g.lineWidth = 1; g.strokeRect(x + 40, y, w - 40, 14);
  txt(g, `${Math.round(v)}${unit}`, x + w, y + 34, col, 'bold 22px sans-serif', 'right');
}

// ---------------------------------------------------------------- SITAC (situation tactique, cap en haut)
// fond de carte : relief ombré (teintes hypsométriques), généré une fois par théâtre
export function buildRelief(B, hFn) {
  const w = Math.round((B.e1 - B.e0) / B.step), h = Math.round((B.n1 - B.n0) / B.step);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), H = new Float32Array((w + 1) * (h + 1));
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) H[j * (w + 1) + i] = hFn(B.n1 - j * B.step, B.e0 + i * B.step);
  const ramp = [[0, 38, 62, 36], [300, 58, 80, 42], [800, 84, 92, 52], [1500, 108, 98, 70], [2200, 128, 122, 112], [3000, 205, 210, 215]];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = H[j * (w + 1) + i], dx = H[j * (w + 1) + i + 1] - a, dy = H[(j + 1) * (w + 1) + i] - a, o = (j * w + i) * 4;
    if (a <= 0) { img.data[o] = 12; img.data[o + 1] = 34; img.data[o + 2] = 54; img.data[o + 3] = 255; continue; }
    let k = 0; while (k < ramp.length - 2 && a > ramp[k + 1][0]) k++;
    const t = Math.max(0, Math.min(1, (a - ramp[k][0]) / (ramp[k + 1][0] - ramp[k][0])));
    const sh = Math.max(0.45, Math.min(1.6, 1 + (dx - dy) / B.step * 1.3));          // éclairage nord-ouest
    for (let q = 0; q < 3; q++) img.data[o + q] = Math.min(255, (ramp[k][q + 1] + (ramp[k + 1][q + 1] - ramp[k][q + 1]) * t) * sh);
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { img: c, ...B };
}
export function drawSITAC(g, s) {
  frame(g, 'SITAC');
  const cx = 256, cy = 318, R = 236, rng = s.rng, m = s.map;
  const ppm = R / (rng * 1852), ch = Math.cos(s.hdg * D2R), sh = Math.sin(s.hdg * D2R);
  const P = (n, e) => { const dn = n - s.n, de = e - s.e; return [cx + (de * ch - dn * sh) * ppm, cy - (dn * ch + de * sh) * ppm]; };
  g.save(); g.beginPath(); g.rect(0, 24, W, W - 24); g.clip();
  if (m) { g.save(); g.translate(cx, cy); g.rotate(-s.hdg * D2R); g.scale(ppm, ppm); g.translate(-s.e, s.n); g.imageSmoothingEnabled = true; g.drawImage(m.img, m.e0, -m.n1, m.e1 - m.e0, m.n1 - m.n0); g.restore(); }
  // anneaux de distance
  g.strokeStyle = 'rgba(210,220,228,0.45)'; g.lineWidth = 1; g.setLineDash([4, 6]);
  for (const f of [0.5, 1]) { g.beginPath(); g.arc(cx, cy, R * f, 0, 6.3); g.stroke(); }
  g.setLineDash([]); txt(g, `${rng / 2}`, cx + R / 2 * 0.71 + 10, cy - R / 2 * 0.71, WHITE, '13px sans-serif'); txt(g, `${rng} NM`, cx + R * 0.71 - 6, cy - R * 0.71 + 14, WHITE, '13px sans-serif');
  // trace parcourue
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.5; g.setLineDash([2, 4]); g.beginPath();
  s.trail.forEach((t, i) => { const [x, y] = P(t[0], t[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.lineTo(cx, cy); g.stroke(); g.setLineDash([]);
  // plan de vol : branches, points tournants, point de poser
  const pl = s.plan;
  for (let i = 1; i < pl.length; i++) {
    const a = P(pl[i - 1].n, pl[i - 1].e), b = P(pl[i].n, pl[i].e);
    g.strokeStyle = i === s.wpI ? MAG : i < s.wpI ? 'rgba(255,92,240,0.35)' : '#ffffff'; g.lineWidth = i === s.wpI ? 3.5 : 2;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  }
  pl.forEach((p, i) => {
    const [x, y] = P(p.n, p.e), col = i === s.wpI ? MAG : i < s.wpI ? 'rgba(255,92,240,0.5)' : WHITE;
    if (p.land && s.ship) return;
    g.strokeStyle = col; g.fillStyle = '#05080a'; g.lineWidth = 2.5;
    if (p.land) { g.beginPath(); g.arc(x, y, 11, 0, 6.3); g.fill(); g.stroke(); txt(g, 'H', x, y + 1, col, 'bold 14px sans-serif'); }
    else if (i === 0) { g.strokeRect(x - 6, y - 6, 12, 12); }
    else { g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); g.fill(); g.stroke(); }
    g.lineWidth = 3; g.strokeStyle = '#05080a'; g.font = 'bold 14px sans-serif'; g.textAlign = 'left'; g.strokeText(p.name, x + 13, y - 10); txt(g, p.name, x + 13, y - 10, col, 'bold 14px sans-serif', 'left');
  });
  // navire (point de poser mobile) avec sa route à 6 min
  if (s.ship) {
    const S = s.ship, q = P(S.n, S.e);
    g.save(); g.translate(q[0], q[1]); g.rotate(S.psi - s.hdg * D2R);
    const sl = Math.max(9, 100 * ppm), sw = Math.max(3.5, 16 * ppm);
    g.fillStyle = MAG; g.strokeStyle = '#05080a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -sl - sw); g.lineTo(sw, -sl * 0.5); g.lineTo(sw, sl); g.lineTo(-sw, sl); g.lineTo(-sw, -sl * 0.5); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = MAG; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(0, -sl); g.lineTo(0, -sl - S.v * 360 * ppm); g.stroke(); g.setLineDash([]);
    g.restore();
    g.lineWidth = 3; g.strokeStyle = '#05080a'; g.font = 'bold 14px sans-serif'; g.textAlign = 'left'; g.strokeText('BPC', q[0] + 16, q[1] - 14); txt(g, 'BPC', q[0] + 16, q[1] - 14, MAG, 'bold 14px sans-serif', 'left');
  }
  g.restore();
  // rose des caps, maquette, vecteur route (1 min)
  g.save(); g.translate(cx, cy); g.strokeStyle = WHITE; g.fillStyle = WHITE; g.font = 'bold 15px sans-serif'; g.lineWidth = 1.5;
  for (let h = 0; h < 360; h += 10) {
    g.save(); g.rotate((h - s.hdg) * D2R); g.beginPath(); g.moveTo(0, -R); g.lineTo(0, -R + (h % 30 === 0 ? 14 : 8)); g.stroke();
    if (h % 30 === 0) g.fillText(h === 0 ? 'N' : String(h / 10), 0, -R + 26); g.restore();
  }
  const tr = (s.trk - s.hdg) * D2R, tl = s.gs * 0.5144 * 60 * ppm; g.strokeStyle = GREEN; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(tr) * tl, -Math.cos(tr) * tl); g.stroke();
  g.strokeStyle = '#05080a'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 16); g.moveTo(-10, 0); g.lineTo(10, 0); g.stroke();
  g.strokeStyle = AMBER; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 16); g.moveTo(-10, 0); g.lineTo(10, 0); g.moveTo(-5, 14); g.lineTo(5, 14); g.stroke();
  g.restore();
  // vent
  g.fillStyle = 'rgba(5,8,10,0.78)'; g.fillRect(4, 28, 150, 96);
  g.save(); g.translate(34, 66); g.rotate((s.windDir - s.hdg + 180) * D2R); g.strokeStyle = CYAN; g.fillStyle = CYAN; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 18); g.lineTo(0, -14); g.stroke(); g.beginPath(); g.moveTo(0, -22); g.lineTo(-7, -8); g.lineTo(7, -8); g.closePath(); g.fill(); g.restore();
  txt(g, 'VENT', 66, 52, CYAN, 'bold 13px sans-serif', 'left'); txt(g, `${pad3(s.windDir)}°/${Math.round(s.windKt)} kt`, 66, 72, CYAN, 'bold 15px sans-serif', 'left');
  txt(g, `H. SOL ${Math.round(s.ra / 10) * 10} ft`, 12, 108, s.ra < 100 ? AMBER : GREEN, 'bold 15px sans-serif', 'left');
  // bloc navigation : point actif, écart de route, point suivant
  const wp = pl[s.wpI], nx = pl[s.wpI + 1];
  g.fillStyle = 'rgba(5,8,10,0.78)'; g.fillRect(318, 28, 190, 116);
  txt(g, `► ${wp.name}`, 326, 42, MAG, 'bold 16px sans-serif', 'left'); txt(g, `${pad3(s.tgtBrg)}°   ${s.tgtDist.toFixed(s.tgtDist < 10 ? 2 : 1)} NM`, 326, 64, MAG, 'bold 18px sans-serif', 'left');
  const eta = s.gs > 15 ? s.tgtDist / s.gs * 60 : null; txt(g, eta ? `ETE ${Math.floor(eta)} min ${String(Math.floor((eta % 1) * 60)).padStart(2, '0')}` : 'ETE --', 326, 86, WHITE, '15px sans-serif', 'left');
  const xa = Math.abs(s.xtk); txt(g, `ÉCART ${xa < 1000 ? Math.round(xa / 10) * 10 + ' m' : (xa / 1852).toFixed(1) + ' NM'} ${xa < 30 ? '' : s.xtk > 0 ? 'À DROITE' : 'À GAUCHE'}`, 326, 108, xa > 500 ? AMBER : GREEN, 'bold 14px sans-serif', 'left');
  txt(g, nx ? `puis ${nx.name}` : 'POINT DE POSER', 326, 130, GREY, '14px sans-serif', 'left');
  // barre d'écart de route (CDI) : pleine échelle ± 0,5 NM
  const dx = Math.max(-1, Math.min(1, -s.xtk / 926)) * 80; g.strokeStyle = WHITE; g.lineWidth = 1; g.strokeRect(cx - 82, 478, 164, 12);
  for (const d of [-80, -40, 40, 80]) { g.beginPath(); g.arc(cx + d, 484, 2, 0, 6.3); g.stroke(); }
  g.fillStyle = MAG; g.fillRect(cx + dx - 3, 474, 6, 20); g.fillStyle = AMBER; g.fillRect(cx - 1, 474, 2, 20);
  txt(g, s.ship ? `BPC ${pad3(s.ship.psi / D2R)}°/${Math.round(s.ship.v / 0.5144)} kt` : `ALT POSER ${Math.round(s.lzAlt * 3.281 / 10) * 10} ft`, 10, 496, MAG, 'bold 14px sans-serif', 'left');
  txt(g, `GS ${Math.round(s.gs)}  TRK ${pad3(s.trk)}°`, 502, 496, GREEN, 'bold 14px sans-serif', 'right');
}

// ---------------------------------------------------------------- ENG / commandes de vol
function arc(g, cx, cy, r, label, v, max, zones, unit) {
  const a0 = 0.8 * Math.PI, a1 = 2.2 * Math.PI, f = (u) => a0 + Math.max(0, Math.min(max, u)) / max * (a1 - a0);
  let col = GREEN; g.lineWidth = 7;
  for (const [a, b, c] of zones) { g.strokeStyle = c; g.globalAlpha = 0.4; g.beginPath(); g.arc(cx, cy, r, f(a), f(b)); g.stroke(); g.globalAlpha = 1; if (v >= a) col = c; }
  g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(f(v)) * (r + 2), cy + Math.sin(f(v)) * (r + 2)); g.stroke();
  txt(g, label, cx, cy + r * 0.55, CYAN, 'bold 15px sans-serif'); txt(g, `${Math.round(v)}${unit}`, cx, cy + r * 0.95, col, 'bold 22px sans-serif');
}
export function drawENG(g, s) {
  frame(g, 'MOTEURS / CDV');
  const tz = [[0, 100, GREEN], [100, 110, AMBER], [110, 130, RED]];
  const t1 = s.engFail >= 1 ? 0 : s.engFail ? s.tq : s.tq, t2 = s.engFail === 2 ? 0 : s.engFail === 1 ? s.tq * 2 : s.tq;
  arc(g, 92, 100, 62, 'TQ 1', t1, 130, tz, '%'); arc(g, 256, 100, 62, 'TQ 2', Math.min(t2, 130), 130, s.engFail === 1 ? [[0, 110, GREEN], [110, 125, AMBER], [125, 130, RED]] : tz, '%');
  arc(g, 420, 100, 62, 'NR', s.nr, 120, [[0, 90, RED], [90, 97, AMBER], [97, 104, GREEN], [104, 110, AMBER], [110, 120, RED]], '%');
  const tot = (tq) => 380 + tq * 4.3;
  txt(g, `TOT ${Math.round(tot(t1))}°C`, 92, 184, t1 > 108 ? AMBER : WHITE, '16px sans-serif'); txt(g, `TOT ${Math.round(tot(Math.min(t2, 130)))}°C`, 256, 184, t2 > 108 ? AMBER : WHITE, '16px sans-serif');
  txt(g, `PUISS. ${Math.round(s.pkw)} kW`, 420, 184, WHITE, '16px sans-serif');
  g.strokeStyle = '#3a444c'; g.lineWidth = 1; g.beginPath(); g.moveTo(10, 204); g.lineTo(502, 204); g.stroke();
  // collectif
  txt(g, 'COLLECTIF', 56, 222, CYAN, 'bold 14px sans-serif');
  g.strokeStyle = GREY; g.lineWidth = 1.5; g.strokeRect(40, 236, 32, 190); g.fillStyle = GREEN; g.fillRect(42, 424 - s.coll * 186, 28, s.coll * 186);
  txt(g, `${Math.round(s.coll * 100)}%`, 56, 444, WHITE, 'bold 18px sans-serif');
  // cyclique (croix : position manche ; point : position plateau)
  txt(g, 'CYCLIQUE', 190, 222, CYAN, 'bold 14px sans-serif');
  g.strokeRect(110, 236, 160, 160); g.beginPath(); g.moveTo(190, 236); g.lineTo(190, 396); g.moveTo(110, 316); g.lineTo(270, 316); g.stroke();
  const cl = (v) => Math.max(-1, Math.min(1, v));
  g.fillStyle = GREEN; g.beginPath(); g.arc(190 + cl(s.swLat) * 78, 316 - cl(s.swLon) * 78, 7, 0, 6.3); g.fill();
  g.strokeStyle = WHITE; g.lineWidth = 2.5; const sx = 190 + cl(s.lat) * 78, sy = 316 - cl(s.lon) * 78; g.beginPath(); g.moveTo(sx - 9, sy); g.lineTo(sx + 9, sy); g.moveTo(sx, sy - 9); g.lineTo(sx, sy + 9); g.stroke();
  // palonnier
  txt(g, 'PALONNIER', 190, 412, CYAN, 'bold 14px sans-serif'); g.strokeStyle = GREY; g.lineWidth = 1.5; g.strokeRect(110, 424, 160, 16);
  g.fillStyle = GREEN; g.fillRect(190 + cl(s.swPed) * 78 - 4, 425, 8, 14); g.fillStyle = WHITE; g.fillRect(190 + cl(s.ped) * 78 - 1.5, 421, 3, 22);
  // états
  const L = (y, k, v, c = WHITE) => { txt(g, k, 296, y, GREY, '15px sans-serif', 'left'); txt(g, v, 500, y, c, 'bold 16px sans-serif', 'right'); };
  L(226, 'AFCS', s.mode === 'ATT' ? 'ATT (tenue assiette)' : s.mode === 'SAS' ? 'SAS (amortisseur)' : 'DIRECT', s.mode === 'ATT' ? GREEN : AMBER);
  L(250, 'Réf. assiette', `${(s.thRef / D2R).toFixed(1)}° / ${(s.phRef / D2R).toFixed(1)}°`, MAG);
  L(274, 'Carburant', `${Math.round(s.fuel)} kg`, s.fuel < 250 ? AMBER : WHITE);
  L(298, 'Débit', `${Math.round(s.ff)} kg/h`);
  L(322, 'Masse', `${Math.round(s.mass)} kg`);
  L(346, 'Freins', s.brakes ? 'SERRÉS' : 'LIBRES', s.brakes ? GREEN : AMBER);
  L(370, 'Train', s.wow ? `SOL (${s.wow}/3)` : 'VOL', s.wow ? CYAN : WHITE);
  L(394, 'Facteur de charge', `${s.nz.toFixed(2)} g`, s.nz > 2 ? AMBER : WHITE);
  // alarmes
  let y = 462; g.textAlign = 'left';
  if (!s.cautions.length) txt(g, 'AUCUNE ALARME', 256, 478, GREEN, 'bold 16px sans-serif');
  s.cautions.slice(0, 3).forEach((c, i) => { g.fillStyle = c.level === 2 ? RED : AMBER; g.fillRect(20 + i * 160, y, 152, 30); txt(g, c.t, 96 + i * 160, y + 16, '#000', 'bold 15px sans-serif'); });
}

// ---------------------------------------------------------------- HOV : aide au stationnaire / à l'appontage
export function drawHOV(g, s) {
  frame(g, 'STATIONNAIRE / APPONTAGE');
  const cx = 236, cy = 262, h = s.hov;       // h : { dx (avant), dy (droite) de la cible en m, relHdg, vx, vy relatifs, hgt, vz, kind, heave }
  const dist = Math.hypot(h.dx, h.dy), scale = dist > 140 ? 0.5 : dist > 55 ? 1.2 : 3.2;   // px par mètre
  g.save(); g.beginPath(); g.rect(10, 26, 452, 476); g.clip();
  g.translate(cx, cy);
  // cercles de distance
  g.strokeStyle = '#33404a'; g.lineWidth = 1; const stepm = scale > 3 ? 10 : scale > 1 ? 25 : 100;
  for (let r = stepm; r * scale < 330; r += stepm) { g.beginPath(); g.arc(0, 0, r * scale, 0, 6.3); g.stroke(); }
  txt(g, `${stepm} m`, stepm * scale * 0.71 + 16, -stepm * scale * 0.71, GREY, '12px sans-serif');
  // cible (pont du navire ou hélisurface) dans le repère de l'appareil : avant = haut
  g.save(); g.translate(h.dy * scale, -h.dx * scale); g.rotate(h.relHdg);
  if (h.kind === 'deck') {
    const sp = h.spot; g.translate(-sp.s * scale, sp.f * scale);
    g.fillStyle = '#2b3138'; g.strokeStyle = '#9aa4ac'; g.lineWidth = 1.5; g.beginPath();
    for (let f = -99.5; f <= 99.5; f += 3) { const w = deckHalfWidth(f); f === -99.5 ? g.moveTo(-w * scale, -f * scale) : g.lineTo(-w * scale, -f * scale); }
    for (let f = 99.5; f >= -99.5; f -= 3) g.lineTo(deckHalfWidth(f) * scale, -f * scale);
    g.closePath(); g.fill(); g.stroke();
    const I = SHIP.island; g.fillStyle = '#7a3a34'; g.fillRect(I.s0 * scale, -I.f1 * scale, (I.s1 - I.s0) * scale, (I.f1 - I.f0) * scale);
    for (const p of SHIP.spots) { g.strokeStyle = p.id === sp.id ? MAG : '#77828a'; g.lineWidth = p.id === sp.id ? 2.5 : 1; g.beginPath(); g.arc(p.s * scale, -p.f * scale, 9 * scale, 0, 6.3); g.stroke(); if (scale > 1) txt(g, String(p.id), p.s * scale, -p.f * scale, p.id === sp.id ? MAG : '#77828a', 'bold 14px sans-serif'); }
    g.strokeStyle = '#e8c200'; g.lineWidth = 1; g.beginPath(); g.moveTo(-6 * scale, 96 * scale); g.lineTo(-6 * scale, -92 * scale); g.stroke();
  } else {
    g.strokeStyle = MAG; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, 13 * scale, 0, 6.3); g.stroke(); g.strokeRect(-15 * scale, -15 * scale, 30 * scale, 30 * scale); txt(g, 'H', 0, 1, MAG, 'bold 20px sans-serif');
  }
  g.restore();
  // maquette : disque rotor + fuselage
  g.strokeStyle = AMBER; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 8.15 * scale, 0, 6.3); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.moveTo(0, -6.5 * scale); g.lineTo(0, 10 * scale); g.moveTo(-1.6 * scale, 1.7 * scale); g.lineTo(1.6 * scale, 1.7 * scale); g.stroke();
  // vecteur vitesse relative (1 m/s = 22 px) et accélération
  const vx = h.vy * 22, vy = -h.vx * 22; g.strokeStyle = GREEN; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(vx, vy); g.stroke(); g.beginPath(); g.arc(vx, vy, 6, 0, 6.3); g.stroke();
  g.restore();
  // hauteur des roues au-dessus de la cible
  const bx = 474, by = 60, bh = 380, hmax = 100, hf = Math.max(0, Math.min(hmax, h.hgt * 3.281));
  g.strokeStyle = GREY; g.lineWidth = 1.5; g.strokeRect(bx, by, 26, bh);
  g.font = '12px sans-serif'; g.fillStyle = GREY; g.textAlign = 'right'; for (const v of [0, 10, 20, 30, 50, 75, 100]) { const yy = by + bh - v / hmax * bh; g.fillText(String(v), bx - 3, yy); g.beginPath(); g.moveTo(bx, yy); g.lineTo(bx + 6, yy); g.stroke(); }
  g.fillStyle = hf < 10 ? AMBER : GREEN; g.fillRect(bx + 2, by + bh - hf / hmax * bh, 22, hf / hmax * bh);
  txt(g, 'ft', bx + 13, by - 12, CYAN, 'bold 13px sans-serif'); txt(g, String(Math.round(h.hgt * 3.281)), bx + 13, by + bh + 16, WHITE, 'bold 18px sans-serif');
  // textes
  txt(g, h.kind === 'deck' ? `SPOT ${h.spot.id}` : h.name, 18, 40, MAG, 'bold 16px sans-serif', 'left');
  txt(g, `${Math.abs(h.dx).toFixed(dist < 50 ? 1 : 0)} m ${h.dx >= 0 ? 'DEVANT' : 'DERRIÈRE'}`, 18, 62, WHITE, 'bold 16px sans-serif', 'left');
  txt(g, `${Math.abs(h.dy).toFixed(dist < 50 ? 1 : 0)} m ${h.dy >= 0 ? 'À DROITE' : 'À GAUCHE'}`, 18, 82, WHITE, 'bold 16px sans-serif', 'left');
  txt(g, `V rel ${(Math.hypot(h.vx, h.vy) * 1.944).toFixed(1)} kt`, 18, 478, GREEN, 'bold 16px sans-serif', 'left');
  txt(g, `Vz rel ${h.vz >= 0 ? '+' : '−'}${Math.abs(Math.round(h.vz * 196.85 / 10) * 10)} ft/min`, 18, 498, Math.abs(h.vz) > 2.5 ? AMBER : GREEN, 'bold 16px sans-serif', 'left');
  if (h.kind === 'deck') txt(g, `PONT  roulis ${(h.roll / D2R).toFixed(1)}°  tangage ${(h.pitch / D2R).toFixed(1)}°  pilonnement ${h.heave.toFixed(1)} m`, 456, 40, CYAN, '13px sans-serif', 'right');
}
