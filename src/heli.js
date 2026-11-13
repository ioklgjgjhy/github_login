// ============================================================================
// Modèle 3D extérieur (silhouette type NH90, générée par code) + poste de pilotage.
// Repère local du modèle : X = droite, Y = haut, Z = arrière ; origine = centre de gravité.
// Un modèle glTF/GLB peut remplacer la cellule : voir travail/config.json.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// corps profilé par sections en super-ellipse : [z, yCentre, demiLargeur, demiHauteur, exposant]
function loft(sections, colorFn, seg = 28, sub = 5) {
  const rings = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    for (let s = 0; s < sub; s++) { const t = s / sub, u = t * t * (3 - 2 * t); rings.push(a.map((v, k) => (k === 0 ? v + (b[k] - v) * t : v + (b[k] - v) * u))); }
  }
  rings.push(sections[sections.length - 1]);
  const pos = [], col = [], idx = [], c = new THREE.Color();
  for (const [z, yc, w, h, n] of rings) for (let j = 0; j <= seg; j++) {
    const a = j / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), e = 2 / n;
    const x = w * Math.sign(ca) * Math.pow(Math.abs(ca), e), y = yc + h * Math.sign(sa) * Math.pow(Math.abs(sa), e);
    pos.push(x, y, z); colorFn(c, x, y, z, yc, h, w); col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, d = a + seg + 1, e = d + 1; idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildHeli() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);          // cellule (masquée en vue cockpit)
  const GREY = 0x6f7a84, DARK = 0x3d444b, GLASS = 0x10181f;
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide });
  const grey = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.55, metalness: 0.25 }), dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.6, metalness: 0.3 });
  const cg = new THREE.Color(GREY), cgl = new THREE.Color(GLASS), cdk = new THREE.Color(0x5d6770);
  const fus = loft([
    [-6.65, -0.42, 0.04, 0.04, 2.2], [-6.25, -0.36, 0.55, 0.42, 2.3], [-5.5, -0.2, 0.98, 0.82, 2.6], [-4.5, -0.03, 1.24, 1.12, 3.2],
    [-3.2, 0.03, 1.3, 1.22, 4], [1.6, 0.03, 1.3, 1.22, 4], [3.1, 0.3, 1.0, 0.9, 3.2], [4.6, 0.62, 0.55, 0.58, 2.6], [7.6, 0.82, 0.3, 0.38, 2.3], [9.9, 0.95, 0.16, 0.3, 2.2],
  ], (c, x, y, z, yc, h, w) => {
    const glassNose = z > -6.3 && z < -3.75 && y > yc + 0.12 * h && !(Math.abs(x) < 0.07 && z > -5.9) && !(y > yc + 0.93 * h);
    const win = z > -2.6 && z < 1.0 && y > yc + 0.25 * h && y < yc + 0.7 * h && Math.abs(x) > 0.9 * w && (Math.floor((z + 2.6) / 0.9) % 2 === 0);
    c.copy(glassNose || win ? cgl : y < yc - 0.75 * h ? cdk : cg);
  });
  const fm = new THREE.Mesh(fus, paint); fm.castShadow = true; body.add(fm);
  const cowl = new THREE.Mesh(loft([[-2.6, 1.15, 0.1, 0.1, 2.2], [-1.9, 1.45, 0.75, 0.5, 2.6], [-0.3, 1.55, 0.95, 0.62, 3], [1.6, 1.5, 0.95, 0.58, 3], [3.2, 1.25, 0.5, 0.4, 2.5], [4.4, 1.0, 0.1, 0.12, 2.2]],
    (c, x, y, z) => c.copy(z > -1.9 && z < -1.2 && Math.abs(x) > 0.3 && y > 1.4 ? cgl : cg)), paint);
  cowl.castShadow = true; body.add(cowl);
  for (const s of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.9, 10), dark); ex.rotation.set(Math.PI / 2 - 0.3, 0, s * 0.5); ex.position.set(s * 0.85, 1.55, 2.4); body.add(ex);
    const sp = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), grey); sp.scale.set(0.42, 0.42, 1.5); sp.position.set(s * 1.42, -0.95, 1.4); sp.castShadow = true; body.add(sp);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 })); wh.rotation.z = Math.PI / 2; wh.position.set(s * 1.6, -1.56, 1.75); body.add(wh);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), dark); leg.position.set(s * 1.55, -1.25, 1.75); body.add(leg);
    const nw = wh.clone(); nw.scale.set(0.8, 0.8, 0.8); nw.position.set(s * 0.16, -1.62, -4.4); body.add(nw);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: s < 0 ? 0xff2a1a : 0x1aff4a })); lamp.position.set(s * 1.5, -0.6, 0.6); body.add(lamp);
  }
  const nleg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), dark); nleg.position.set(0, -1.3, -4.4); body.add(nleg);
  // dérive et empennage
  const fs = new THREE.Shape(); fs.moveTo(8.3, 0.7); fs.lineTo(9.9, 0.7); fs.lineTo(10.75, 3.25); fs.lineTo(9.95, 3.25); fs.closePath();
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.18, bevelEnabled: false }), grey);
  fin.rotation.y = -Math.PI / 2; fin.position.x = 0.09; fin.castShadow = true; body.add(fin);   // forme (z,y) -> plan vertical
  const stab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.85), grey); stab.position.set(1.3, 1.0, 9.1); stab.castShadow = true; body.add(stab);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2200 })); strobe.position.set(0, 3.33, 10.3); root.add(strobe);

  // rotor principal (4 pales, antihoraire vu de dessus)
  const rotor = new THREE.Group(); rotor.position.set(0, 2.5, 0); root.add(rotor);
  const bladeM = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.y = i * Math.PI / 2;
    const bg = new THREE.BoxGeometry(7.55, 0.05, 0.65); bg.translate(4.35, 0, 0);
    const b = new THREE.Mesh(bg, bladeM); b.rotation.z = 0.045; b.castShadow = true; arm.add(b);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.055, 0.66), new THREE.MeshStandardMaterial({ color: 0xd8b020 })); tip.position.set(7.85, 0.35, 0); arm.add(tip);
    rotor.add(arm);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.75, 12), dark); hub.position.set(0, 2.2, 0); root.add(hub);
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.6, 8.15, 48), new THREE.MeshBasicMaterial({ color: 0x20242a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(0, 2.78, 0); root.add(disc);
  // rotor anticouple
  const tail = new THREE.Group(); tail.position.set(-0.42, 2.0, 9.7); root.add(tail);
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.55, 0.26), bladeM); b.geometry.translate(0, 0.8, 0); b.rotation.x = i * Math.PI / 2; tail.add(b); }
  const tdisc = new THREE.Mesh(new THREE.RingGeometry(0.15, 1.6, 24), new THREE.MeshBasicMaterial({ color: 0x20242a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  tdisc.rotation.y = Math.PI / 2; tdisc.position.copy(tail.position); root.add(tdisc);

  root.userData = { body, rotor, tail, disc, tdisc, strobe };
  return root;
}

// Remplacement optionnel de la cellule par un modèle glTF (déposé dans travail/)
export async function tryLoadCustomModel(root) {
  try {
    const r = await fetch('travail/config.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const cfg = await r.json(); const m = cfg.modele;
    if (!m || !m.fichier) return cfg;
    const gltf = await new GLTFLoader().loadAsync('travail/' + m.fichier);
    const obj = gltf.scene, box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
    const holder = new THREE.Group(); holder.add(obj);
    const sc = m.echelle || (m.longueur || 16.1) / Math.max(size.x, size.z);
    obj.position.sub(box.getCenter(new THREE.Vector3())); holder.scale.setScalar(sc);
    holder.rotation.y = (m.rotationY || 0) * Math.PI / 180;
    holder.position.set(m.dx || 0, m.dy ?? 0.4, m.dz ?? 1.6);
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const u = root.userData; u.body.clear(); u.body.add(holder);
    if (m.rotorsInclus) { u.rotor.visible = false; u.tail.visible = false; }
    return cfg;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- poste de pilotage
export const EYE = new THREE.Vector3(0.45, 0.62, -4.2);     // œil du pilote (place droite)

export function buildCockpit(screens) {
  const g = new THREE.Group();
  const panelM = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.85 }), frameM = new THREE.MeshStandardMaterial({ color: 0x6a7075, roughness: 0.8 }),
    trimM = new THREE.MeshStandardMaterial({ color: 0x222529, roughness: 0.9 }), greyM = new THREE.MeshStandardMaterial({ color: 0x50565c, roughness: 0.8 });
  const box = (w, h, d, x, y, z, m = panelM, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  // planche de bord (inclinée vers le pilote) + casquette
  const tilt = -0.2, pz = -5.02, py = 0.17;
  const panel = new THREE.Group(); panel.position.set(0, py, pz); panel.rotation.x = tilt; g.add(panel);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.44, 0.06), panelM); panel.add(board);
  const xs = [-0.6, -0.3, 0, 0.3, 0.6], order = ['pfd', 'nd', 'eng', 'hov', 'pfd'];
  xs.forEach((x, i) => {
    const bez = new THREE.Mesh(new THREE.BoxGeometry(0.285, 0.285, 0.02), trimM); bez.position.set(x, 0.045, 0.035); panel.add(bez);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), new THREE.MeshBasicMaterial({ map: screens[order[i]], toneMapped: false }));
    scr.position.set(x, 0.045, 0.047); panel.add(scr);
  });
  // rangée de boutons sous les écrans
  const btn = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.012), greyM); btn.position.set(0, -0.14, 0.036); panel.add(btn);
  box(1.86, 0.03, 0.3, 0, 0.415, -5.06, trimM, -0.06);                      // casquette anti-reflets
  box(1.9, 0.08, 0.5, 0, 0.34, -5.38, trimM, 0.25);                             // dessus de planche vers le pare-brise
  // pupitre central + console inter-sièges
  box(0.44, 0.5, 0.1, 0, -0.29, -4.93, panelM, -0.5);
  box(0.44, 0.2, 1.2, 0, -0.52, -4.15, panelM);
  box(0.36, 0.012, 0.7, 0, -0.415, -4.2, greyM);
  // montants : central, latéraux, traverse haute, plafond
  box(0.05, 1.25, 0.07, 0, 1.05, -5.42, frameM, 0.52);
  for (const s of [-1, 1]) {
    box(0.06, 1.3, 0.08, s * 1.05, 1.0, -5.08, frameM, 0.5, 0, -s * 0.12);   // montant de pare-brise
    box(0.07, 1.1, 0.1, s * 1.2, 0.85, -3.75, frameM, 0, 0, -s * 0.1);       // montant de porte arrière
    box(0.06, 0.07, 1.4, s * 1.17, 1.42, -4.35, frameM);                      // haut de porte
    box(0.06, 0.22, 1.5, s * 1.2, -0.2, -4.4, frameM, 0, 0, -s * 0.08);        // bas de porte (sous la vitre)
    box(0.55, 0.05, 1.3, s * 0.78, -0.78, -4.2, frameM);                      // plancher sous le siège
    box(0.1, 0.06, 0.24, s * 0.45 - 0.13, -0.6, -5.05, greyM, 0.5);           // palonniers
    box(0.1, 0.06, 0.24, s * 0.45 + 0.13, -0.6, -5.05, greyM, 0.5);
  }
  box(2.3, 0.07, 0.12, 0, 1.47, -4.92, frameM);                                // traverse haute du pare-brise
  box(0.46, 0.09, 1.25, 0, 1.44, -4.25, panelM);                               // panneau plafond
  box(2.4, 0.05, 1.0, 0, 1.52, -3.7, frameM);                                  // toit arrière
  box(2.4, 2.4, 0.05, 0, 0.35, -3.2, trimM);                                   // cloison cabine (derrière le pilote)
  // manche cyclique et levier de collectif (animés)
  const cyc = new THREE.Group(); cyc.position.set(0.45, -0.75, -4.55);
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 8), trimM); st.position.y = 0.31; cyc.add(st);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.14, 8), greyM); grip.position.y = 0.66; grip.rotation.x = -0.25; cyc.add(grip);
  g.add(cyc);
  const col = new THREE.Group(); col.position.set(0.16, -0.5, -3.75);
  const lv = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), trimM); lv.rotation.x = Math.PI / 2; lv.position.z = -0.3; col.add(lv);
  const hd = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.13), greyM); hd.position.z = -0.62; col.add(hd);
  g.add(col);
  g.userData = { cyc, col };
  return g;
}
