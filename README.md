# Simulateur NH90 — appontage BPC et vol tactique en montagne

Simulateur d'hélicoptère pilotable au joystick (Sidewinder ou autre), dans un navigateur, **sans installation ni connexion** : tout tient dans `index.html`.

## Lancer

- **Le plus simple** : double-clic sur `index.html` (Chrome ou Edge conseillés pour le joystick).
- **Avec le dossier de travail** (`travail/` : modèle 3D personnel, configuration) : `python3 lancer.py`, ou double-clic sur `lancer.command` (Mac) / `lancer.bat` (Windows).

Branchez le joystick, appuyez sur un de ses boutons, puis réglez les axes dans l'écran d'accueil (bouton « Détecter » : on bouge l'axe demandé, l'affectation et le sens sont mémorisés).

## Missions

| Mission | Théâtre | Objectif |
|---|---|---|
| Marine | Côte fictive, aérodrome en bord de mer | Décoller, rejoindre le BPC en route et apponter sur un spot (pont mobile : roulis, tangage, pilonnement) |
| Terre — Bénou | **Relief réel** Pau → vallée d'Ossau (maille 100 m) | Vol tactique Pau, Gan, Rébénacq, Arudy, Bielle, poser sur le plateau du Bénou (877 m) |
| Terre — Bious | idem | Remonter la vallée par Laruns, les Eaux-Chaudes, Gabas ; poser à Bious-Artigues (1 406 m) |

Chaque mission peut démarrer à l'hélisurface, à mi-parcours, en finale, en courte finale, en stationnaire au-dessus du point de poser, ou posé dessus. Un débriefing note le toucher (vitesse verticale, écart au point, alignement, vitesse relative, couple) et, en mission terre, la hauteur sol moyenne et l'écart au plan de vol.

## Commandes

| Action | Joystick | Clavier |
|---|---|---|
| Cyclique | manche | flèches |
| Palonnier | torsion du manche | Q / D |
| Collectif | manette des gaz | Z / S |
| Trim d'assiette | chapeau | I J K L |
| Trim release (l'assiette courante devient la référence) | gâchette | T |
| Vue cockpit / extérieure / tour-pont-sol | bouton 2 | V |
| Mode AFCS : ATT, SAS, DIRECT | bouton 3 | M |
| Freins de roues | bouton 4 | B |
| Échelle de la SITAC | — | G |
| Écrans incrustés, bandeau | — | O, H |
| Panne moteur (1 puis 2 : autorotation) | — | E |
| Pause / réglages, recommencer, son | — | P, R, N |

Souris : glisser pour regarder autour, molette pour zoomer, double-clic pour recentrer.

## Poste de pilotage

Cinq écrans : **PFD** (horizon, vitesse, altitude, radiosonde, vario, cap, couple, NR), **SITAC** (relief ombré, plan de vol, point actif, point de poser — BPC ou zone de poser —, trace, vent, écart de route), **moteurs / commandes de vol**, **stationnaire / appontage** (position et vitesse relatives au spot ou au H, hauteur des roues, mouvements du pont).

## Modèle de vol

Six degrés de liberté, intégré à 240 Hz (`src/fdm.js`) : rotor principal par élément de pale et quantité de mouvement, vitesse induite dynamique, battement du disque, raideur de moyeu, effet de sol, état de vortex, décrochage ; rotor anticouple, dérive, empennage, traînée fuselage ; turbines avec régulation NR, panne moteur et autorotation ; train tricycle avec frottement sur sol fixe ou pont mobile ; densité de l'air selon l'altitude.

Calage sur un appareil de la classe NH90 (9,8 t par défaut, rotor 16,3 m, 256 tr/min) : stationnaire hors effet de sol vers 70 % de couple, Vmax vers 165 kt, autorotation vers 2 000 ft/min.

Lois de pilotage (`src/afcs.js`) : **ATT** (tenue d'assiette et de cap, virage coordonné — comportement nominal d'un appareil à commandes électriques), **SAS** (amortissement seul), **DIRECT** (cellule nue).

Environnement (`src/env.js`) : vent moyen avec gradient, rafales, turbulence, sillage aérodynamique de l'îlot du navire, ascendances et rabattants de relief.

## Dossier `travail/`

Voir `travail/LISEZMOI.md` : on peut y déposer un modèle 3D glTF/GLB (par exemple un NH90) qui remplace la cellule générée par code, et un `config.json` de réglages par défaut.

## Développement

```
npm install        # three.js et esbuild
npm run build      # reconstruit index.html à partir de src/
npm test           # essais en vol automatiques du modèle
node test/deck.test.mjs   # appontage automatique sur pont mobile
```

Le relief des Pyrénées (`src/pau-dem.js`) provient des tuiles d'altitude ouvertes Mapzen / AWS Terrain Tiles.

## Limites connues de ce premier jet

- Silhouette NH90 et BPC générées par code (simplifiées) ; le cockpit est une évocation, pas une reproduction.
- Le théâtre marin est fictif ; seul le théâtre Pyrénées utilise un relief réel, sans imagerie aérienne.
- Les arbres et les maisons ne sont pas des obstacles ; les bâtiments de l'aérodrome et l'îlot du navire le sont.
- Pas de modes supérieurs du pilote automatique (tenue d'altitude, de vitesse, stationnaire automatique).
