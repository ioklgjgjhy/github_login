// ============================================================================
// Théâtre 3D : relief côtier, mer, aérodrome, BPC, ciel.
// Convention three.js : X = est, Y = haut, Z = sud  (NED n,e,alt -> (e, alt, -n))
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { terrainH, coastN, fbm, FIELD_ALT, RUNWAY, SHIP, DECK_H, deckHalfWidth, PAU, MISSIONS, waypoint, setTheatre, theatre, buildings } from './env.js';
import { PAU_DEM } from './pau-dem.js';

const D2R = Math.PI / 180;
export const v3 = (n, e, alt) => new THREE.Vector3(e, alt, -n);

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function speckle(g, w, h, n, colors, smin, smax) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = smin + Math.random() * (smax - smin);
    g.fillRect(Math.random() * w, Math.random() * h, s, s * (0.6 + Math.random()));
  }
}

// ---------------------------------------------------------------- terrain
function buildTerrain() {
  const E0 = -9000, E1 = 9000, N0 = -1500, N1 = 8500, step = 30;
  const nx = Math.round((E1 - E0) / step) + 1, nz = Math.round((N1 - N0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const c = new THREE.Color(), sand = new THREE.Color(0xcdbb8c), grass = new THREE.Color(0x6f8f4a), field = new THREE.Color(0x93a05a),
    forest = new THREE.Color(0x3f5f33), rock = new THREE.Color(0x7c776c), airf = new THREE.Color(0x7d9a52);
  let k = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) {
    const e = E0 + i * step, n = N0 + j * step, h = terrainH(n, e);
    pos[k * 3] = e; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -n;
    uv[k * 2] = e / 90; uv[k * 2 + 1] = n / 90;
    const d = n - coastN(e), slope = Math.abs(terrainH(n + 15, e) - h) + Math.abs(terrainH(n, e + 15) - h);
    const patch = fbm(e / 260 + 11, n / 260 + 5, 2);
    if (h < 2.6) c.copy(sand);
    else if (h < 60) { c.copy(patch > 0.5 ? grass : field); if (d > 150 && d < 800 && Math.abs(e + 100) < 1000) c.lerp(airf, 0.7); c.lerp(sand, Math.max(0, 1 - (h - 2.6) / 4)); }
    else c.copy(grass).lerp(forest, Math.min(1, (h - 60) / 120));
    if (slope > 9) c.lerp(rock, Math.min(1, (slope - 9) / 8));
    if (h > 330) c.lerp(rock, Math.min(1, (h - 330) / 100));
    const sh = 0.9 + 0.2 * patch;
    col[k * 3] = c.r * sh; col[k * 3 + 1] = c.g * sh; col[k * 3 + 2] = c.b * sh;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d2 = a + nx, e2 = d2 + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = d2; idx[k++] = b; idx[k++] = e2; idx[k++] = d2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const tex = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 5000, ['#b4b4b4', '#d8d8d8', '#bebebe', '#e2e2e2', '#a8a8a8'], 2, 9);
    speckle(x, w, h, 500, ['#9c9c9c', '#eeeeee'], 6, 22);
  }, { repeat: true });
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: tex }));
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- mer
function buildSea() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'), img = x.createImageData(N, N), H = new Float32Array(N * N);
  const waves = []; for (let i = 0; i < 26; i++) { const kx = Math.round((Math.random() * 2 - 1) * 9), ky = Math.round((Math.random() * 2 - 1) * 9) || 1; waves.push([kx, ky, Math.random() * 6.28, 1 / (0.6 + Math.hypot(kx, ky))]); }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let h = 0; for (const [kx, ky, p, a] of waves) h += a * Math.sin(2 * Math.PI * (kx * i + ky * j) / N + p); H[j * N + i] = h; }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dx = H[j * N + (i + 1) % N] - H[j * N + (i + N - 1) % N], dy = H[((j + 1) % N) * N + i] - H[((j + N - 1) % N) * N + i];
    const o = (j * N + i) * 4; img.data[o] = 128 + clamp8(dx * 70); img.data[o + 1] = 128 + clamp8(dy * 70); img.data[o + 2] = 255; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const nm = new THREE.CanvasTexture(c); nm.wrapS = nm.wrapT = THREE.RepeatWrapping; nm.repeat.set(1500, 1500); nm.anisotropy = 8;
  const dm = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); speckle(g, w, h, 900, ['#e9eef2', '#f8fbff', '#dfe8ee'], 3, 16); }, { repeat: true });
  dm.repeat.set(900, 900);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f5a7a, roughness: 0.32, metalness: 0.15, normalMap: nm, normalScale: new THREE.Vector2(0.9, 0.9), map: dm });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), mat);
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
  m.userData.nm = nm; m.userData.dm = dm;
  return m;
}
const clamp8 = (v) => Math.max(-127, Math.min(127, v));

// ---------------------------------------------------------------- aérodrome
function flatRect(n, e, dn, de, tex, y = 0.06, rot = 0, alt = FIELD_ALT) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(de, dn), new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(e, alt + y, -n); m.receiveShadow = true;
  return m;
}
function buildAirport(scene, A = { alt: FIELD_ALT, rw: { ...RUNWAY, hdg: 90, a: '09', b: '27' }, taxi: true }) {
  const g = new THREE.Group(), ALT = A.alt, RW = A.rw, rh = RW.hdg * D2R;
  // piste 09/27
  const rw = canvasTex(4096, 128, (x, w, h) => {
    x.fillStyle = '#3b3d40'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 6000, ['#35373a', '#424447', '#3f4144', '#303234'], 2, 10);
    x.fillStyle = '#e8e8e8';
    x.fillRect(0, 2, w, 3); x.fillRect(0, h - 5, w, 3);
    for (let i = 300; i < w - 300; i += 176) x.fillRect(i, h / 2 - 1.5, 88, 3);
    for (const x0 of [40, w - 130]) for (let k = 0; k < 8; k++) x.fillRect(x0, 12 + k * 13.5 + (k > 3 ? 6 : 0), 90, 7);
    x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(190, h / 2); x.rotate(Math.PI / 2); x.fillText(RW.a, 0, 0); x.restore();
    x.save(); x.translate(w - 190, h / 2); x.rotate(-Math.PI / 2); x.fillText(RW.b, 0, 0); x.restore();
  });
  g.add(flatRect(RW.n, RW.e, RW.wid, RW.len, rw, 0.05, Math.PI / 2 - rh, ALT));
  // taxiway + aire de trafic
  const tw = canvasTex(64, 512, (x, w, h) => { x.fillStyle = '#4a4c4f'; x.fillRect(0, 0, w, h); speckle(x, w, h, 500, ['#444649', '#505255'], 2, 8); x.fillStyle = '#d8b400'; x.fillRect(w / 2 - 1.5, 0, 3, h); });
  if (A.taxi) { g.add(flatRect(120, 0, 110, 18, tw, 0.04)); g.add(flatRect(120, -120, 110, 18, tw, 0.04)); }
  else { g.add(flatRect(330, 60, 560, 18, tw, 0.04, -0.25, ALT)); }
  const ap = canvasTex(2048, 1024, (x, w, h) => {
    // 1 px = 0,125 m : aire 256 m x 128 m, centre = hélisurface principale
    x.fillStyle = '#6d6f70'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 14000, ['#666869', '#747677', '#6a6c6d', '#7a7c7c', '#5f6162'], 2, 9);
    x.strokeStyle = 'rgba(40,40,40,0.55)'; x.lineWidth = 1.5;
    for (let i = 0; i <= w; i += 48) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
    for (let j = 0; j <= h; j += 48) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
    const pad = (cx, cy, label) => {
      x.strokeStyle = '#f2c800'; x.lineWidth = 5; x.beginPath(); x.arc(cx, cy, 104, 0, 6.3); x.stroke();
      x.strokeStyle = '#ffffff'; x.lineWidth = 3; x.strokeRect(cx - 120, cy - 120, 240, 240);
      x.fillStyle = '#ffffff'; x.fillRect(cx - 34, cy - 44, 12, 88); x.fillRect(cx + 22, cy - 44, 12, 88); x.fillRect(cx - 34, cy - 6, 68, 12);
      x.fillStyle = '#f2c800'; x.font = 'bold 36px sans-serif'; x.textAlign = 'center'; x.fillText(label, cx, cy + 160);
    };
    pad(w / 2, h / 2, 'H1'); pad(w / 2 + 560, h / 2, 'H2'); pad(w / 2 - 560, h / 2, 'H3');
    x.strokeStyle = '#d8b400'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 60); x.lineTo(w, 60); x.stroke();
  });
  g.add(flatRect(0, 0, 128, 256, ap, 0.07, 0, ALT));
  // bâtiments
  const wall = new THREE.MeshLambertMaterial({ color: 0xb9bcc0 }), roof = new THREE.MeshLambertMaterial({ color: 0x5c6670 }), glass = new THREE.MeshLambertMaterial({ color: 0x2c4a5c });
  for (const b of buildings()) {
    const base = terrainH(b.n, b.e);
    if (b.kind === 'tower') {
      const s = new THREE.Mesh(new THREE.BoxGeometry(5, b.h - 5, 5), wall); s.position.set(b.e, base + (b.h - 5) / 2, -b.n);
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4.2, 4, 8), glass); cab.position.set(b.e, base + b.h - 3, -b.n);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.6, 8), roof); top.position.set(b.e, base + b.h - 0.7, -b.n);
      g.add(s, cab, top);
    } else if (b.kind === 'lighthouse') {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, b.h - 4, 12), new THREE.MeshLambertMaterial({ color: 0xf2f2ee })); s.position.set(b.e, base + (b.h - 4) / 2, -b.n);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 3.0, 6, 12), new THREE.MeshLambertMaterial({ color: 0xc23a2e })); band.position.set(b.e, base + b.h * 0.45, -b.n);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.2, 10), glass); lamp.position.set(b.e, base + b.h - 2.4, -b.n);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2, 1.6, 10), new THREE.MeshLambertMaterial({ color: 0xc23a2e })); cap.position.set(b.e, base + b.h, -b.n);
      g.add(s, band, lamp, cap);
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.de, b.h, b.dn), wall); m.position.set(b.e, base + b.h / 2, -b.n);
      const r = new THREE.Mesh(new THREE.BoxGeometry(b.de + 1.5, 1, b.dn + 1.5), roof); r.position.set(b.e, base + b.h + 0.5, -b.n);
      g.add(m, r);
      if (b.kind === 'hangar') { const d = new THREE.Mesh(new THREE.PlaneGeometry(b.dn * 0.8, b.h * 0.82), new THREE.MeshLambertMaterial({ color: 0x4d5560 })); d.rotation.y = Math.PI / 2; d.position.set(b.e + b.de / 2 + 0.05, base + b.h * 0.41, -b.n); g.add(d); }
    }
  }
  g.traverse((o) => { if (o.isMesh && o.geometry.type !== 'PlaneGeometry') { o.castShadow = true; } });
  // manche à air
  const sock = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd })); pole.position.y = 3.5;
  const cone = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.055, 0.42 - (i + 1) * 0.055, 0.7, 10, 1, true),
      new THREE.MeshLambertMaterial({ color: i % 2 ? 0xffffff : 0xe2442a, side: THREE.DoubleSide }));
    seg.rotation.x = Math.PI / 2; seg.position.z = 0.35 + i * 0.7; cone.add(seg);
  }
  cone.position.y = 6.8; sock.add(pole, cone);
  sock.position.set(48, ALT, 48); sock.userData.cone = cone;
  g.add(sock);
  // balisage
  const pts = [], cols = [];
  for (let d = -RW.len / 2; d <= RW.len / 2; d += 60) for (const s of [-1, 1]) {
    const o = s * (RW.wid / 2 + 1); pts.push(RW.e + d * Math.sin(rh) + o * Math.cos(rh), ALT + 0.4, -(RW.n + d * Math.cos(rh) - o * Math.sin(rh))); cols.push(1, 1, 0.85);
  }
  for (let a = 0; a < 16; a++) { pts.push(13.5 * Math.cos(a * Math.PI / 8), ALT + 0.3, 13.5 * Math.sin(a * Math.PI / 8)); cols.push(0.3, 1, 0.4); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.add(new THREE.Points(lg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true })));
  scene.add(g);
  return { sock, makeSock: () => { const c = sock.clone(true); c.userData.cone = c.children[1]; return c; } };
}

// ---------------------------------------------------------------- végétation, village, objets en mer
function buildScatter(scene) {
  const rnd = mulberry(12345), dummy = new THREE.Object3D();
  // arbres
  const NT = 9000, tg = new THREE.ConeGeometry(3.2, 9, 6); tg.translate(0, 5.5, 0);
  const trees = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0xffffff }), NT);
  let k = 0, tries = 0; const tc = new THREE.Color();
  while (k < NT && tries++ < NT * 30) {
    const near = rnd() < 0.6;
    const e = near ? -2500 + rnd() * 5200 : -8800 + rnd() * 17600, n = near ? -500 + rnd() * 2600 : -700 + rnd() * 9000;
    const d = n - coastN(e), h = terrainH(n, e);
    if (d < 170 || h < 5 || h > 330) continue;
    if (Math.abs(e + 100) < 1000 && Math.abs(n - 90) < 330) continue;
    if (fbm(e / 330 + 3, n / 330 + 9, 2) < 0.5) continue;
    const s = 0.7 + rnd() * 0.9; dummy.position.set(e, h - 0.5, -n); dummy.scale.set(s, s * (0.8 + rnd() * 0.5), s); dummy.rotation.y = rnd() * 6; dummy.updateMatrix();
    trees.setMatrixAt(k, dummy.matrix); tc.setHSL(0.27 + rnd() * 0.06, 0.4, 0.2 + rnd() * 0.1); trees.setColorAt(k, tc); k++;
  }
  trees.count = k; scene.add(trees);
  // maisons
  const NH = 420, hg = new THREE.BoxGeometry(9, 5.5, 7); hg.translate(0, 2.75, 0);
  const rg = new THREE.ConeGeometry(7.4, 3.2, 4); rg.rotateY(Math.PI / 4); rg.scale(1, 1, 0.8); rg.translate(0, 7.1, 0);
  const houses = new THREE.InstancedMesh(hg, new THREE.MeshLambertMaterial({ color: 0xe9e2d2 }), NH), roofs = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ color: 0xa8553a }), NH);
  k = 0; tries = 0;
  const centers = [[700, 2300, 420], [1500, -3100, 350], [-150, 1500, 160], [2600, 500, 300], [300, -1900, 200]];
  while (k < NH && tries++ < NH * 40) {
    const c = centers[(rnd() * centers.length) | 0], a = rnd() * 6.28, r = Math.sqrt(rnd()) * c[2];
    const n = c[0] + r * Math.cos(a), e = c[1] + r * Math.sin(a), h = terrainH(n, e);
    if (h < 3 || n - coastN(e) < 60) continue;
    if (Math.abs(e + 100) < 1000 && Math.abs(n - 90) < 330) continue;
    const s = 0.8 + rnd() * 0.7; dummy.position.set(e, h - 0.3, -n); dummy.scale.set(s, s, s); dummy.rotation.y = Math.round(rnd() * 4) * 0.4 + rnd() * 0.2; dummy.updateMatrix();
    houses.setMatrixAt(k, dummy.matrix); roofs.setMatrixAt(k, dummy.matrix); k++;
  }
  houses.count = roofs.count = k; scene.add(houses, roofs);
  // bouées et petits bateaux (repères visuels en mer)
  const NB = 60, bg = new THREE.CylinderGeometry(0.5, 1.3, 3.4, 8); bg.translate(0, 1.2, 0);
  const buoys = new THREE.InstancedMesh(bg, new THREE.MeshLambertMaterial({ color: 0xffffff }), NB);
  const bcol = [0xd9382b, 0x2fa04a, 0xf0c020];
  for (let i = 0; i < NB; i++) {
    let n, e;
    if (i < 24) { const t = i / 23; n = -700 - t * 3900 + (i % 2 ? 60 : -60) * 0.5; e = 200 + t * 2300 + (i % 2 ? 90 : -90); } // chenal vers le large
    else { do { e = -6000 + rnd() * 12000; n = -700 - rnd() * 7000; } while (terrainH(n, e) > -2); }
    dummy.position.set(e, 0, -n); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); buoys.setMatrixAt(i, dummy.matrix);
    buoys.setColorAt(i, tc.setHex(i < 24 ? bcol[i % 2] : bcol[2]));
  }
  scene.add(buoys);
  const boat = new THREE.BoxGeometry(4, 2, 12); boat.translate(0, 0.6, 0);
  const boats = new THREE.InstancedMesh(boat, new THREE.MeshLambertMaterial({ color: 0xf4f4f0 }), 14);
  const cabin = new THREE.BoxGeometry(3, 2.2, 4); cabin.translate(0, 2.6, 1.5);
  const cabins = new THREE.InstancedMesh(cabin, new THREE.MeshLambertMaterial({ color: 0x2e5f8a }), 14);
  for (let i = 0; i < 14; i++) {
    let n, e; do { e = -5000 + rnd() * 10000; n = -800 - rnd() * 5000; } while (terrainH(n, e) > -3);
    dummy.position.set(e, 0, -n); dummy.rotation.y = rnd() * 6.28; dummy.updateMatrix(); boats.setMatrixAt(i, dummy.matrix); cabins.setMatrixAt(i, dummy.matrix);
  }
  scene.add(boats, cabins);
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- théâtre Pyrénées (relief réel)
function buildPauTerrain() {
  const D = PAU_DEM, nx = D.nx, nz = D.ny, step = D.step;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), hh = new Float32Array(nx * nz);
  let k = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) hh[k] = terrainH(D.n0 + j * step, D.e0 + i * step);
  const c = new THREE.Color(), C = (h) => new THREE.Color(h);
  const f1 = C(0x8aa04e), f2 = C(0xb5ad62), f3 = C(0x6d8c46), f4 = C(0x9c8a5c), mead = C(0x6f9448), forest = C(0x3f6238), alp = C(0x8a8f58), rock = C(0x807b72), snow = C(0xf2f4f6), water = C(0x2f5f7c);
  k = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) {
    const e = D.e0 + i * step, n = D.n0 + j * step, h = hh[k];
    pos[k * 3] = e; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -n; uv[k * 2] = e / 90; uv[k * 2 + 1] = n / 90;
    const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nx - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, nz - 1);
    const sl = Math.hypot(hh[j * nx + i1] - hh[j * nx + i0], hh[j1 * nx + i] - hh[j0 * nx + i]) / (2 * step);
    const p1 = fbm(e / 420 + 3, n / 420 + 8, 2), p2 = fbm(e / 150 + 31, n / 150 + 17, 2), p3 = fbm(e / 900, n / 900, 3);
    if (h < 380 && sl < 0.12) { const q = Math.floor(p2 * 9) % 4; c.copy(q === 0 ? f1 : q === 1 ? f2 : q === 2 ? f3 : f4); if (p1 > 0.58) c.lerp(forest, 0.75); }
    else if (h < 1750) { c.copy(mead); const fo = Math.min(1, Math.max(0, (sl - 0.12) * 5 + (p1 - 0.45) * 3)); c.lerp(forest, fo); if (h > 1450) c.lerp(alp, (h - 1450) / 300 * (1 - fo * 0.5)); }
    else c.copy(alp).lerp(rock, Math.min(1, (h - 1750) / 600));
    if (sl > 0.75 && h > 500) c.lerp(rock, Math.min(1, (sl - 0.75) * 3));
    if (h > 2250 + 250 * (p3 - 0.5)) c.lerp(snow, Math.min(1, (h - 2250) / 250 + 0.3));
    if (h > 400 && sl < 0.004 && Math.hypot(n + 56400, e + 1800) < 1500) c.copy(water);                          // lac de Bious-Artigues
    const shd = 0.86 + 0.28 * p2;
    col[k * 3] = c.r * shd; col[k * 3 + 1] = c.g * shd; col[k * 3 + 2] = c.b * shd;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, d2 = a + nx, e2 = d2 + 1; idx[k++] = a; idx[k++] = b; idx[k++] = d2; idx[k++] = b; idx[k++] = e2; idx[k++] = d2; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  const tex = canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, w, h); speckle(x, w, h, 5000, ['#b4b4b4', '#d8d8d8', '#bebebe', '#e2e2e2', '#a8a8a8'], 2, 9); speckle(x, w, h, 500, ['#9c9c9c', '#eeeeee'], 6, 22); }, { repeat: true });
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: tex })); m.receiveShadow = true;
  return m;
}
function buildPau(g) {
  g.add(buildPauTerrain());
  const base = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000), new THREE.MeshLambertMaterial({ color: 0x7c9150 })); base.rotation.x = -Math.PI / 2; base.position.y = 95; g.add(base);
  const ap = buildAirport(g, { alt: PAU.fieldAlt, rw: { ...PAU.runway, a: '13', b: '31' }, taxi: false });
  const socks = [ap.sock], rnd = mulberry(777), dummy = new THREE.Object3D(), tc = new THREE.Color();
  // zones de poser : marquage H, manche à air, bivouac
  const hTex = canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.strokeStyle = '#f5d000'; x.lineWidth = 12; x.beginPath(); x.arc(w / 2, h / 2, 112, 0, 6.3); x.stroke();
    x.fillStyle = '#ffffff'; x.fillRect(78, 62, 22, 132); x.fillRect(156, 62, 22, 132); x.fillRect(78, 117, 100, 22);
  });
  for (const id in MISSIONS) {
    const z = MISSIONS[id].lz; if (!z) continue; const h = terrainH(z.n, z.e);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshLambertMaterial({ map: hTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(z.e, h + 0.08, -z.n); pad.receiveShadow = true; g.add(pad);
    const sk = ap.makeSock(); sk.position.set(z.e + 32, h, -z.n + 20); g.add(sk); socks.push(sk);
    const tent = new THREE.MeshLambertMaterial({ color: 0x4f5a3a }), truck = new THREE.MeshLambertMaterial({ color: 0x3f4a34 });
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(4, 3, 4), tent); t.rotation.y = Math.PI / 4; t.position.set(z.e - 38 - i * 9, h + 1.5, -z.n - 30); t.castShadow = true; g.add(t); }
    for (let i = 0; i < 2; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 6.5), truck); t.position.set(z.e - 40, h + 1.3, -z.n + 28 + i * 5); t.rotation.y = 0.3; t.castShadow = true; g.add(t); }
    const fum = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.55, depthWrite: false })); fum.rotation.x = Math.PI; fum.position.set(z.e + 24, h + 7, -z.n - 24); g.add(fum);
  }
  // villages
  const total = PAU.towns.reduce((a, t) => a + t[4], 0);
  const hg = new THREE.BoxGeometry(10, 6, 8); hg.translate(0, 3, 0);
  const rg = new THREE.ConeGeometry(8.2, 3.4, 4); rg.rotateY(Math.PI / 4); rg.scale(1, 1, 0.8); rg.translate(0, 7.6, 0);
  const houses = new THREE.InstancedMesh(hg, new THREE.MeshLambertMaterial({ color: 0xe6dfcf }), total), roofs = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ color: 0x5b6470 }), total);
  let k = 0;
  for (const [name, tn0, te0, rad, cnt] of PAU.towns) {
    const w = waypoint(name), tn = w ? w[0] : tn0, te = w ? w[1] : te0;
    for (let i = 0; i < cnt; i++) {
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * rad, n = tn + r * Math.cos(a), e = te + r * Math.sin(a), h = terrainH(n, e);
      const s = 0.8 + rnd() * 0.8; dummy.position.set(e, h - 0.4, -n); dummy.scale.set(s, s, s); dummy.rotation.set(0, Math.round(rnd() * 4) * 0.4 + rnd() * 0.2, 0); dummy.updateMatrix();
      houses.setMatrixAt(k, dummy.matrix); roofs.setMatrixAt(k, dummy.matrix); k++;
    }
  }
  houses.count = roofs.count = k; g.add(houses, roofs);
  // arbres le long du couloir de vol (repères de hauteur en vol tactique)
  const legs = []; for (const id in MISSIONS) { const m = MISSIONS[id]; if (!m.route) continue; let p = [0, 0]; for (const w of [...m.route.map(waypoint), [m.lz.n, m.lz.e]]) { legs.push([p, w]); p = w; } }
  const NT = 22000, tg = new THREE.ConeGeometry(4, 13, 6); tg.translate(0, 7.5, 0);
  const trees = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0xffffff }), NT);
  k = 0; let tries = 0;
  while (k < NT && tries++ < NT * 12) {
    const [a, b] = legs[(rnd() * legs.length) | 0], t = rnd(), w = (rnd() + rnd() - 1) * 2600;
    const dn = b[0] - a[0], de = b[1] - a[1], l = Math.hypot(dn, de) || 1;
    const n = a[0] + dn * t - de / l * w, e = a[1] + de * t + dn / l * w, h = terrainH(n, e);
    if (h > 1800 || Math.hypot(n, e) < 900) continue;
    const sl = Math.abs(terrainH(n + 40, e) - h) + Math.abs(terrainH(n, e + 40) - h);
    const p1 = fbm(e / 420 + 3, n / 420 + 8, 2);
    if (h < 380 ? p1 < 0.56 : (sl < 5 && p1 < 0.5)) continue;
    if (sl > 45) continue;
    const s = 0.7 + rnd() * 0.8; dummy.position.set(e, h - 0.6, -n); dummy.scale.set(s, s * (0.8 + rnd() * 0.5), s); dummy.rotation.set(0, rnd() * 6, 0); dummy.updateMatrix();
    trees.setMatrixAt(k, dummy.matrix); tc.setHSL(0.27 + rnd() * 0.07, 0.42, 0.19 + rnd() * 0.1); trees.setColorAt(k, tc); k++;
  }
  trees.count = k; g.add(trees);
  return { socks };
}

// ---------------------------------------------------------------- BPC (type Mistral)
function buildShip() {
  const g = new THREE.Group();
  const grey = new THREE.MeshLambertMaterial({ color: 0x8d949b }), dark = new THREE.MeshLambertMaterial({ color: 0x5b6269 }), hullM = new THREE.MeshLambertMaterial({ color: 0x7f868d });
  // coque : contour du pont extrudé vers le bas
  const sh = new THREE.Shape(); const pts = [];
  for (let f = -99.5; f <= 99.5; f += 2.5) pts.push([deckHalfWidth(f), f]);
  sh.moveTo(-pts[0][0], pts[0][1]);
  for (const [w, f] of pts) sh.lineTo(-w, f);
  sh.lineTo(0, 101.5);
  for (let i = pts.length - 1; i >= 0; i--) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: DECK_H + 5, bevelEnabled: false }), hullM);
  hull.rotation.x = -Math.PI / 2; hull.position.y = -5;       // shape (x, f) -> monde (x, y, -f)
  hull.castShadow = true; g.add(hull);
  const boot = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: 0x22262a }));
  boot.rotation.x = -Math.PI / 2; boot.position.y = -0.4; boot.scale.set(1.004, 1.002, 1); g.add(boot);
  // pont d'envol texturé (8 px/m)
  const W = 256, L = 1600, ppm = 8;
  const deckTex = canvasTex(W, L, (x, w, h) => {
    x.fillStyle = '#4a4f55'; x.fillRect(0, 0, w, h);
    speckle(x, w, h, 9000, ['#454a50', '#50555b', '#484d53', '#565b61', '#3f4449'], 2, 7);
    const X = (s) => w / 2 + s * ppm, Y = (f) => h / 2 - f * ppm;
    x.strokeStyle = '#f0f0f0'; x.lineWidth = 2.5;
    x.setLineDash([]); x.beginPath(); x.moveTo(X(-15), Y(-98)); x.lineTo(X(-15), Y(62)); x.stroke();   // limite bâbord
    x.beginPath(); x.moveTo(X(5), Y(-98)); x.lineTo(X(5), Y(60)); x.stroke();                             // limite zone îlot
    x.strokeStyle = '#e8c200'; x.lineWidth = 3; x.beginPath(); x.moveTo(X(-6), Y(-96)); x.lineTo(X(-6), Y(92)); x.stroke(); // axe d'alignement
    for (const sp of SHIP.spots) {
      const cx = X(sp.s), cy = Y(sp.f);
      x.strokeStyle = '#ffffff'; x.lineWidth = 4; x.beginPath(); x.arc(cx, cy, 9 * ppm, 0, 6.3); x.stroke();
      x.lineWidth = 2.5; x.beginPath(); x.arc(cx, cy, 2 * ppm, 0, 6.3); x.stroke();
      x.beginPath(); x.moveTo(cx - 9 * ppm, cy); x.lineTo(cx + 9 * ppm, cy); x.stroke();
      x.fillStyle = '#ffffff'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(sp.id), cx - 3.0 * ppm, cy + 5 * ppm);
    }
    x.fillStyle = '#ffffff'; x.font = 'bold 90px sans-serif'; x.textAlign = 'center'; x.fillText('L', X(-6), Y(88));
    x.strokeStyle = '#c23a2e'; x.lineWidth = 4; x.strokeRect(X(5.6), Y(35), 10.4 * ppm, 64 * ppm);       // zone interdite îlot
  });
  const dk = new THREE.Mesh(new THREE.PlaneGeometry(32, 200), new THREE.MeshLambertMaterial({ map: deckTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  dk.rotation.x = -Math.PI / 2; dk.position.y = DECK_H + 0.03; dk.receiveShadow = true;
  // découpe de l'étrave : on masque le pont hors contour grâce à la forme (ShapeGeometry + UV manuels)
  const dg = new THREE.ShapeGeometry(sh); const p = dg.attributes.position, uvs = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uvs[i * 2] = (p.getX(i) + 16) / 32; uvs[i * 2 + 1] = (p.getY(i) + 100) / 200; }
  dg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); dk.geometry = dg;
  g.add(dk);
  // îlot tribord
  const I = SHIP.island, add = (f0, f1, s0, s1, y0, y1, mat = grey) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s1 - s0, y1 - y0, f1 - f0), mat);
    m.position.set((s0 + s1) / 2, DECK_H + (y0 + y1) / 2, -(f0 + f1) / 2); m.castShadow = true; g.add(m); return m;
  };
  add(I.f0, I.f1, I.s0, I.s1, 0, 9);
  add(I.f0 + 6, I.f1 - 4, I.s0 + 0.6, I.s1 - 0.5, 9, I.h);
  add(I.f1 - 16, I.f1 - 3, I.s0 + 0.3, I.s1 - 0.3, 10.2, 12.4, new THREE.MeshLambertMaterial({ color: 0x1f2c36 }));  // passerelle
  add(-22, -10, 9, 14.5, I.h, I.h + 6, dark);                    // cheminée
  add(SHIP.mast.f0 + 4, SHIP.mast.f1 - 4, 10, 12.5, I.h, SHIP.mast.h - 6);   // mât
  add(SHIP.mast.f0 + 2, SHIP.mast.f1 - 2, 8.5, 14, SHIP.mast.h - 9, SHIP.mast.h - 8, dark);
  const radar = add(1.5, 4.5, 8.2, 14.3, SHIP.mast.h - 5, SHIP.mast.h - 4.2, dark);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), new THREE.MeshLambertMaterial({ color: 0xdfe3e6 })); dome.position.set(11.5, DECK_H + I.h + 2.2, -26); g.add(dome);
  add(-99, -92, -15.5, 15.5, -9, -0.6, dark);                    // radier (arrière)
  // filets de sécurité bâbord, sillage
  const wakeT = canvasTex(64, 256, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 10); }
    const g2 = x.createLinearGradient(0, 0, w, 0); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.3, 'rgba(0,0,0,0)'); g2.addColorStop(0.7, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = g2; x.fillRect(0, 0, w, h);
  });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(60, 420), new THREE.MeshBasicMaterial({ map: wakeT, transparent: true, depthWrite: false }));
  wake.rotation.x = -Math.PI / 2; wake.position.set(0, 0.25, 99 + 205); g.add(wake);
  g.userData = { radar, wake };
  return g;
}

// ---------------------------------------------------------------- monde
export class World {
  constructor(scene, renderer) {
    this.scene = scene; this.groups = {}; this.socks = [];
    // ciel + éclairage
    this.sky = new Sky(); this.sky.scale.setScalar(70000); scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe2ff, 0x5a5648, 1.1); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbfd3e6, 0.00005);
    // moutons (écume) : repères de vitesse et de hauteur au-dessus de l'eau
    const NW = 1400, wp = new Float32Array(NW * 3); this.capBase = new Float32Array(NW * 2);
    for (let i = 0; i < NW; i++) { this.capBase[i * 2] = Math.random() * 2400; this.capBase[i * 2 + 1] = Math.random() * 2400; wp[i * 3 + 1] = 0.35; }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    this.caps = new THREE.Points(cg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false }));
    this.caps.frustumCulled = false; scene.add(this.caps);
    this.sunDir = new THREE.Vector3();
  }

  // construit (à la première demande) et affiche le théâtre voulu : 'mer' ou 'pau'
  setTheatre(id) {
    setTheatre(id);
    if (!this.groups[id]) {
      const g = this.groups[id] = new THREE.Group(); this.scene.add(g);
      if (id === 'mer') {
        g.add(buildTerrain()); this.sea = buildSea(); g.add(this.sea);
        g.userData.socks = [buildAirport(g).sock]; buildScatter(g);
        this.ship = buildShip(); this.ship.rotation.order = 'YXZ'; g.add(this.ship);
      } else g.userData.socks = buildPau(g).socks;
    }
    for (const k in this.groups) this.groups[k].visible = k === id;
    this.socks = this.groups[id].userData.socks; this.th = id; this.caps.visible = id === 'mer';
  }

  applyConfig(cfg) {
    const el = Math.max(-2, 62 * Math.sin((cfg.hour - 6) / 12 * Math.PI)), az = 180 + (cfg.hour - 12) * 15;
    const phi = (90 - el) * D2R, theta = -az * D2R;
    this.sunDir.setFromSphericalCoords(1, phi, theta + Math.PI);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir); u.turbidity.value = 4 + 30 / Math.max(cfg.visKm, 3); u.rayleigh.value = el < 8 ? 2.6 : 1.3; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    const low = Math.min(1, Math.max(0, (el + 2) / 18));
    this.sun.intensity = 0.4 + 2.4 * low; this.sun.color.setHSL(0.09 + 0.04 * low, 0.5 * (1 - low) + 0.1, 0.5 + 0.45 * low);
    this.hemi.intensity = 0.35 + 0.85 * low;
    const fogC = new THREE.Color().setHSL(0.58, 0.3 * low + 0.1, 0.25 + 0.55 * low);
    this.scene.fog.color.copy(fogC); this.scene.fog.density = 1.9 / (cfg.visKm * 1000);
    this.caps.material.opacity = Math.min(0.75, Math.max(0.12, (cfg.windKt - 4) / 22));
    this.caps.material.size = 1.6 + cfg.windKt * 0.07;
    this.windDir = cfg.windDir * D2R;
  }

  update(dt, env, camPos, heliPos) {
    const wd = this.windDir + Math.PI;
    if (this.th === 'mer') {
      const S = env.ship, sg = this.ship;
      sg.position.set(S.e, S.heave, -S.n); sg.rotation.set(S.pitch, -S.psi, -S.roll);
      sg.userData.radar.rotation.y += dt * 2.2;
      // mer : défilement des vagues dans le sens du vent
      const o = this.sea.userData.nm.offset;
      o.x += Math.sin(wd) * dt * 0.035; o.y += Math.cos(wd) * dt * 0.035;
      this.sea.position.set(Math.round(camPos.x / 6000) * 6000, 0, Math.round(camPos.z / 6000) * 6000);
      // moutons : pavage périodique centré sur la caméra, dérivant lentement avec le vent
      const p = this.caps.geometry.attributes.position, L = 2400, t = env.t;
      const dx = Math.sin(wd) * t * 2.5, dz = -Math.cos(wd) * t * 2.5;
      for (let i = 0; i < p.count; i++) {
        const bx = this.capBase[i * 2] + dx, bz = this.capBase[i * 2 + 1] + dz;
        const x = bx + Math.floor((camPos.x - bx) / L + 0.5) * L, z = bz + Math.floor((camPos.z - bz) / L + 0.5) * L;
        p.array[i * 3] = x; p.array[i * 3 + 2] = z;
        p.array[i * 3 + 1] = terrainH(-z, x) > -1.5 ? -50 : 0.35;
      }
      p.needsUpdate = true;
    }
    // manches à air
    const w = env.meanWind, spd = Math.hypot(w[0], w[1]);
    for (const sk of this.socks) {
      sk.rotation.y = Math.atan2(w[1], -w[0]);            // le cône (axe +Z local) pointe sous le vent
      sk.userData.cone.rotation.x = Math.max(0, 1.25 - spd / 7.5) + 0.04 * Math.sin(env.t * 9);
    }
    // soleil / ombres centrés sur l'hélicoptère
    this.sun.position.copy(heliPos).addScaledVector(this.sunDir, 300); this.sun.target.position.copy(heliPos);
    this.sky.position.copy(camPos);
  }
}
