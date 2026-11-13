// Essais en vol automatiques du modèle (node test/fdm.test.mjs)
import { HeliFDM } from '../src/fdm.js';
import { AFCS } from '../src/afcs.js';
const D = 180 / Math.PI, KT = 1.94384;
const flat = { wind: [0, 0, 0], rho: 1.225, surface: () => ({ h: 0, vn: 0, ve: 0, vd: 0, kind: 'land' }) };
let fail = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fail++; };

function fly(f, a, T, pilot, env = flat, dt = 1 / 300) {
  for (let t = 0; t < T; t += dt) { f.step(dt, a.update(dt, pilot(t, f)), env); if (f.crashed) break; }
}
// pilote automatique simple : tient une hauteur avec le collectif
function altHold(target) { let ci = 0.52; return (f, dt = 1 / 300) => { const e = Math.max(-8, Math.min(8, target - f.alt)); ci += 0.006 * e * dt; return Math.max(0, Math.min(1, ci + 0.04 * e - 0.06 * f.vs)); }; }

console.log('1. Posé au sol, collectif bas');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 1.8 });
  fly(f, a, 10, () => ({ lon: 0, lat: 0, ped: 0, coll: 0 }));
  ok(!f.crashed && f.wowAll, `stable au sol, alt CG ${f.alt.toFixed(2)} m, assiette ${(f.theta * D).toFixed(1)}°, TQ ${f.tq.toFixed(0)} %, Nr ${f.nr.toFixed(1)} %`);
  ok(Math.hypot(f.pos[0], f.pos[1]) < 0.3 && Math.abs(f.psi) < 0.05, `ne glisse pas (${Math.hypot(f.pos[0], f.pos[1]).toFixed(2)} m)`);
}

console.log('2. Décollage et stationnaire HES à 30 m');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 1.8 });
  const ah = altHold(30); let coll = 0;
  fly(f, a, 60, (t, ff) => { coll = t < 3 ? 0.15 * t : ah(ff); return { lon: 0, lat: 0, ped: 0, coll }; });
  console.log(`     alt ${f.alt.toFixed(1)} m  coll ${(coll * 100).toFixed(0)} %  TQ ${f.tq.toFixed(0)} %  Nr ${f.nr.toFixed(1)} %  θ ${(f.theta * D).toFixed(1)}°  φ ${(f.phi * D).toFixed(1)}°  ψ ${(f.psi * D).toFixed(1)}°  dérive ${f.gs.toFixed(2)} m/s  P ${(f.Peng / 1000).toFixed(0)} kW  pédale ${a.pos.ped.toFixed(2)} manche ${a.pos.lon.toFixed(2)}/${a.pos.lat.toFixed(2)}`);
  ok(!f.crashed && Math.abs(f.alt - 30) < 3, 'stationnaire tenu');
  ok(f.tq > 55 && f.tq < 85, 'couple stationnaire HES réaliste (55–85 %)');
  ok(coll > 0.4 && coll < 0.68, 'collectif en stationnaire vers la mi-course');
  ok(Math.abs(f.psi) < 0.1, 'cap tenu');
}

console.log('3. Croisière : accélération par assiette à piquer, tenue d\'altitude');
for (const pitch of [-2, -5, -9]) {
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 300, u: 30 }); a.sync(0.5);
  const ah = altHold(300); let coll = 0.5;
  fly(f, a, 120, (t, ff) => { coll = ah(ff); a.thRef = pitch / D; a.phRef = 0; return { lon: 0, lat: 0, ped: 0, coll }; });
  console.log(`     θ ${pitch}° -> ${(f.tas * KT).toFixed(0)} kt  TQ ${f.tq.toFixed(0)} %  coll ${(coll * 100).toFixed(0)} %  alt ${f.alt.toFixed(0)}  φ ${(f.phi * D).toFixed(1)}°  dérapage ${(Math.atan2(f.va[1], f.va[0]) * D).toFixed(1)}°  manche ${a.pos.lon.toFixed(2)}/${a.pos.lat.toFixed(2)} péd ${a.pos.ped.toFixed(2)}`);
  ok(!f.crashed && Math.abs(f.alt - 300) < 30, 'vol stabilisé');
}

console.log('4. Vitesse maximale à la puissance maxi continue');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 300, u: 60 }); a.sync(0.6);
  let th = -4; const ah = altHold(300);
  fly(f, a, 240, (t, ff) => { const c = ah(ff); if (ff.tq < 98) th -= 0.004; else th += 0.008; a.thRef = Math.max(-16, th) / D; a.phRef = 0; return { lon: 0, lat: 0, ped: 0, coll: c }; });
  console.log(`     Vmax ≈ ${(f.tas * KT).toFixed(0)} kt à TQ ${f.tq.toFixed(0)} %, θ ${(f.theta * D).toFixed(1)}°`);
  ok(f.tas * KT > 140 && f.tas * KT < 180, 'Vmax entre 140 et 180 kt (NH90 ≈ 160 kt)');
}

console.log('5. Réponse à un échelon de manche latéral (stationnaire)');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 50 }); a.sync(0.55);
  const ah = altHold(50);
  fly(f, a, 15, (t, ff) => ({ lon: 0, lat: 0, ped: 0, coll: ah(ff) }));
  const ph0 = f.phi; let pmax = 0;
  fly(f, a, 1.5, (t, ff) => { pmax = Math.max(pmax, ff.om[0]); return { lon: 0, lat: 0.5, ped: 0, coll: ah(ff) }; });
  console.log(`     Δφ après 1,5 s : ${((f.phi - ph0) * D).toFixed(1)}°, p max ${(pmax * D).toFixed(0)}°/s`);
  ok((f.phi - ph0) * D > 8 && (f.phi - ph0) * D < 25, 'réponse en roulis franche et amortie');
}

console.log('6. Pédales en stationnaire : taux de lacet');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 50 }); a.sync(0.55);
  const ah = altHold(50);
  fly(f, a, 10, (t, ff) => ({ lon: 0, lat: 0, ped: 0, coll: ah(ff) }));
  fly(f, a, 4, (t, ff) => ({ lon: 0, lat: 0, ped: 0.6, coll: ah(ff) }));
  console.log(`     r = ${(f.om[2] * D).toFixed(1)}°/s (pied droit 60 %)`);
  ok(f.om[2] * D > 8, 'le nez part à droite au pied droit');
}

console.log('7. Mode DIRECT : la cellule nue est instable mais pilotable (pas de divergence immédiate)');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 50 }); a.sync(0.55);
  fly(f, a, 10, (t, ff) => ({ lon: 0, lat: 0, ped: 0, coll: 0.55 })); a.setMode('DIR');
  fly(f, a, 2, () => ({ lon: 0, lat: 0, ped: 0, coll: 0.55 }));
  console.log(`     après 2 s sans correction : θ ${(f.theta * D).toFixed(1)}°, φ ${(f.phi * D).toFixed(1)}°`);
  ok(Math.abs(f.theta) < 0.5 && Math.abs(f.phi) < 0.6, 'divergence lente');
}

console.log('8. Panne totale moteurs à 80 kt : autorotation');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 600, u: 41 }); a.sync(0.5);
  const ah = altHold(600);
  fly(f, a, 20, (t, ff) => ({ lon: 0, lat: 0, ped: 0, coll: ah(ff) }));
  f.engFail = 2; let nrMin = 200;
  fly(f, a, 20, (t, ff) => { nrMin = Math.min(nrMin, ff.nr); a.thRef = 2 / D; return { lon: 0, lat: 0, ped: 0, coll: t < 1 ? 0.5 : 0.08 }; });
  console.log(`     Nr ${f.nr.toFixed(0)} % (mini ${nrMin.toFixed(0)} %), Vz ${(f.vs * 196.85).toFixed(0)} ft/min, ${(f.tas * KT).toFixed(0)} kt`);
  ok(f.nr > 85 && f.nr < 125, 'le rotor reste entraîné en autorotation');
  ok(f.vs * 196.85 < -1200 && f.vs * 196.85 > -3500, 'taux de chute d\'autorotation plausible');
}

console.log('9. Descente verticale rapide : entrée en vortex');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 800 }); a.sync(0.55);
  const ah = altHold(800);
  fly(f, a, 15, (t, ff) => ({ lon: 0, lat: 0, ped: 0, coll: ah(ff) }));
  let vmax = 0, vsEnd;
  fly(f, a, 12, (t, ff) => ({ lon: 0, lat: 0, ped: 0, coll: 0.3 }));
  fly(f, a, 8, (t, ff) => { vmax = Math.max(vmax, ff.vrs); return { lon: 0, lat: 0, ped: 0, coll: 0.58 }; });
  console.log(`     Vz ${(f.vs * 196.85).toFixed(0)} ft/min avec collectif de stationnaire remis, indicateur vortex max ${vmax.toFixed(2)}`);
  ok(vmax > 0.5, 'état de vortex détecté');
}

console.log('10. Effet de sol');
{
  const f = new HeliFDM(), a = new AFCS(f); f.reset({ alt: 1.8 });
  const ah = altHold(3.3); let c = 0;
  fly(f, a, 40, (t, ff) => { c = t < 3 ? 0.15 * t : ah(ff); return { lon: 0, lat: 0, ped: 0, coll: c }; });
  console.log(`     stationnaire DES roues à ${(f.agl - 1.8).toFixed(1)} m : TQ ${f.tq.toFixed(0)} %`);
  ok(f.tq < 72, 'moins de couple en effet de sol');
}
console.log(fail ? `\n${fail} ÉCHEC(S)` : '\nTous les essais passent.');
process.exit(fail ? 1 : 0);
