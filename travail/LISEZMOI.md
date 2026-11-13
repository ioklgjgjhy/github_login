# Dossier de travail

Déposez ici vos éléments locaux ; ils sont chargés au démarrage quand le simulateur est lancé avec `lancer.py`.

| Fichier | Rôle |
|---|---|
| `config.json` | Configuration locale (voir `config.exemple.json`) |
| `nh90.glb` (ou autre nom) | Modèle 3D glTF/GLB qui remplace la cellule générée par code |

Réglages du modèle 3D (`modele` dans `config.json`) :

- `fichier` : nom du fichier glTF/GLB dans ce dossier ;
- `longueur` : longueur voulue en mètres (mise à l'échelle automatique), ou `echelle` pour imposer un facteur ;
- `rotationY` : rotation en degrés si le nez du modèle ne pointe pas vers l'avant (essayer 90, 180, 270) ;
- `dx`, `dy`, `dz` : décalage en mètres (droite, haut, arrière) du centre du modèle par rapport au centre de gravité ;
- `rotorsInclus` : `true` si le modèle contient déjà ses rotors (les rotors animés du simulateur sont alors masqués).

`environnement` permet de changer les valeurs par défaut (vent, mer, position et route du navire en mètres
dans le repère local : `shipN` vers le nord, `shipE` vers l'est, origine = hélisurface).
