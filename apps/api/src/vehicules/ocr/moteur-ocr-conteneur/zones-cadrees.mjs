// Zones de VALEUR par coordonnées FIXES (fraction de la page), pour le chemin CADRÉ — celui de
// l'écran mobile à cadre guidé (`apps/web/src/ecrans/scan/`) : l'utilisateur remplit un cadre avec
// le permis, donc la position de chaque champ dans la photo n'est plus à découvrir par OCR pleine
// page (`ancres.mjs`, coûteux) mais connue d'avance par la structure du formulaire.
//
// RECALIBRÉ sur le corpus réel (13 photos, 18.08) — CORRIGE UNE HYPOTHÈSE FAUSSE de la première
// livraison. Cette première version supposait un RECTO SEUL (une page) avec tous les champs
// empilés verticalement (plaque, date, nom, adresse, VIN, code type de haut en bas). Les 13 photos
// réelles contredisent : sans exception, le permis y est photographié LIVRET OUVERT À PLAT, DOUBLE
// PAGE — page GAUCHE (n°2) = bloc détenteur (nom puis domicile empilés dans UNE cellule), page
// DROITE (n°3) = bloc véhicule (plaque en haut, VIN au milieu, code type d'approbation en dessous,
// 1re mise en circulation près du bas). Les deux pages occupent chacune une MOITIÉ horizontale de
// la photo — d'où des zones page-gauche (nom/adresse) et page-droite (plaque/VIN/codeType/date) à
// des `left` très différents, jamais la même colonne.
//
// ⚠️ TOUJOURS PROVISOIRE malgré la recalibration : mesuré sur seulement 13 photos LIBRES (pas
// prises à travers un cadre guidé — cet écran n'existait pas encore à la capture), avec un cadrage/
// zoom qui varie fortement d'une photo à l'autre (certaines cadrent la double page avec une marge
// large, d'autres zooment jusqu'à remplir le cadre presque bord à bord) : c'est cette variance de
// cadrage, pas la structure du formulaire, qui borne la précision atteignable par des fractions
// FIXES. Zones délibérément LARGES (marge de calibrage) plutôt qu'étroites — une zone trop large
// dégrade peu (l'extraction en aval, `extraction-permis.ts`, est tolérante au bruit), une zone trop
// étroite perd le champ entier. Le cadre guidé (une fois branché côté écran) réduit cette variance
// à la source ; en attendant, la marge de sécurité ci-dessous absorbe ce que le cadrage libre ne
// permet pas de garantir.
//
// NE COUVRE QUE LE CAS « double page en orientation PAYSAGE » (12 photos du corpus réel sur 13) —
// voir `SEUIL_ORIENTATION_PORTRAIT` dans `extraction-champs.mjs` : une photo PORTRAIT n'a physique-
// ment pas la place pour les deux pages côte à côte (mesuré sur l'unique photo portrait du corpus :
// une seule page dans le cadre, jamais les deux) et déclenche directement le repli plutôt qu'une
// tentative cadrée vouée à l'échec sur un cadrage structurellement différent.
export const ZONES_CADRE_PROVISOIRE = {
  // Page gauche (détenteur) — colonne de labels (numéro de ligne + texte fr/de/it/rm empilé)
  // jusque vers x≈0.17, valeur ensuite jusqu'à la marge/reliure de la page vers x≈0.52.
  detenteurNom: { left: 0.17, top: 0.1, width: 0.35, height: 0.06 },
  detenteurAdresse: { left: 0.17, top: 0.155, width: 0.35, height: 0.12 },
  // Page droite (véhicule) — colonne de labels jusque vers x≈0.58 (lettre de bloc + numéro de
  // champ + texte fr/de/it/rm empilé), valeur ensuite. Plaque/VIN occupent la LARGEUR ENTIÈRE de
  // leur ligne (pas de deuxième cellule sur la même ligne) ; code type/date partagent leur ligne
  // avec un champ de poids/émissions non extrait à droite — largeur volontairement plus étroite
  // pour ne pas capter ce voisin dans la même découpe.
  plaque: { left: 0.54, top: 0.075, width: 0.44, height: 0.1 },
  vin: { left: 0.55, top: 0.26, width: 0.43, height: 0.1 },
  codeTypeCh: { left: 0.58, top: 0.505, width: 0.24, height: 0.08 },
  premiereMiseEnCirculationLe: { left: 0.58, top: 0.67, width: 0.26, height: 0.12 },
};

export const CHAMPS_CONNUS_CADRE = Object.keys(ZONES_CADRE_PROVISOIRE);
