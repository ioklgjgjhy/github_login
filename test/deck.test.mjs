// Essai d'appontage automatique sur pont mobile (node test/deck.test.mjs)
import { HeliFDM } from '../src/fdm.js';
import { AFCS } from '../src/afcs.js';
import { Environment } from '../src/env.js';
const D = 180 / Math.PI; let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
for (const [sea, wind, turb] of [[0, 0, 0], [4, 20, 0.3], [6, 30, 0.6]]) {
  const env = new Environment({ seaState: sea, windKt: wind, turb, gustKt: wind / 3 });
  const f = new HeliFDM(), a = new AFCS(f), S = env.ship, sp = env.spotWorld();
  f.reset({ n: sp.n, e: sp.e, alt: sp.h + 1.9 + 5, psi: S.psi, u: S.v, theta: 1.5 / D, phi: -2.5 / D }); a.sync(0.47);
  const dt = 1 / 240; let ci = 0.47, landedT = 0, c = 0.47, tdVs = 0, t = 0, ix = 0, iy = 0;
  for (; t < 90 && !f.crashed; t += dt) {
    env.update(dt, f);
    const s = env.spotWorld(), cs = Math.cos(f.psi), sn = Math.sin(f.psi);
    const dn = s.n - f.pos[0], de = s.e - f.pos[1], rvn = f.vw[0] - S.vn, rve = f.vw[1] - S.ve;
    const dx = dn * cs + de * sn, dy = -dn * sn + de * cs, vx = rvn * cs + rve * sn, vy = -rvn * sn + rve * cs;
    // pilote automatique : tenue de position au-dessus du spot puis descente à 1 m/s
    ix += dx * dt * 0.02; iy += dy * dt * 0.02;
    const lon = Math.max(-0.5, Math.min(0.5, 0.05 * dx - 0.14 * vx + ix)), lat = Math.max(-0.5, Math.min(0.5, 0.05 * dy - 0.14 * vy + iy));
    const hgt = f.alt - 1.85 - s.h, vzT = t < 15 ? 0 : -0.9, e = vzT - (f.vs - (env.ship.heaveD));
    if (f.wow >= 2) landedT += dt;
    if (landedT > 0) c = Math.max(0, c - 0.25 * dt); else { ci += 0.02 * e * dt; c = Math.max(0, Math.min(1, ci + 0.05 * e + (t < 15 ? 0.03 * (5 - hgt) : 0))); }
    if (f.wow && !tdVs) tdVs = Math.max(f.lastAirVs, f.maxTouchVs);
    f.step(dt, a.update(dt, { lon: f.wow ? 0 : lon, lat: f.wow ? 0 : lat, ped: 0, coll: c }), env);
    if (landedT > 20) break;
  }
  const [df, ds] = env.toDeck(f.pos[0], f.pos[1]); const spd = Math.hypot(f.vw[0] - env.ship.vn, f.vw[1] - env.ship.ve);
  console.log(`mer ${sea}, vent ${wind} kt : t=${t.toFixed(0)} s, posé ${landedT.toFixed(0)} s, toucher ${(tdVs * 196.85).toFixed(0)} ft/min, écart spot ${(df + 42).toFixed(1)} / ${(ds + 6).toFixed(1)} m, glissement ${spd.toFixed(2)} m/s, φ ${(f.phi * D).toFixed(1)}° θ ${(f.theta * D).toFixed(1)}° ${f.crashed ? 'CRASH: ' + f.crashed.why : ''}`);
  ok(!f.crashed && landedT > 19, 'apponté et immobile');
  ok(Math.hypot(df + 42, ds + 6) < 6 && spd < 0.3, 'reste sur le spot sans glisser');
}
process.exit(fail ? 1 : 0);
