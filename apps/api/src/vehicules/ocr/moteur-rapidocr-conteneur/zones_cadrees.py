# Zones de VALEUR par coordonnées FIXES (fraction de la page) — PORT de
# moteur-ocr-conteneur/zones-cadrees.mjs à l'origine (calibrage Tesseract du 18.08), RECALIBRÉES
# le 19.08 pour RapidOCR par inspection VISUELLE directe (rectangles dessinés sur les photos
# d'échantillon, relus un par un — voir le rapport de livraison du lot) : le calibrage Tesseract
# HÉRITÉ débordait sur 2 à 4 lignes de tableau voisines par champ (mesuré sur les 13 photos + 4
# natives), payées en PLEIN tarif de reconnaissance RapidOCR (~0.3-0.6s/FRAGMENT, quasi indépendant
# du nombre de pixels — voir moteur.py) et polluant l'extraction de candidats. Chemin CADRÉ :
# l'écran mobile à cadre guidé (apps/web/src/ecrans/scan/) impose un cadre à remplir avec le permis,
# la position de chaque champ dans la photo est donc connue d'avance, pas à découvrir par une passe
# pleine page.
#
# MÉTHODE DE RECALIBRAGE (19.08) : mesure directe, sur les photos d'échantillon, de la fraction de
# hauteur/largeur de page occupée par chaque ligne de tableau ciblée (grille de repérage superposée
# à l'image, lue à l'oeil) — PAS une estimation. Constat central : le cadrage du corpus `cg/` (13
# photos) est loin d'être uniforme (le permis occupe entre ~75% et 100% de la hauteur de la photo
# selon le cliché) — chaque zone est donc bornée à l'ENVELOPPE observée sur plusieurs photos
# représentatives de cet écart (pas à une seule mesure), avec une marge de sécurité, plutôt qu'à la
# ligne exacte d'une unique photo de référence. Sous ce régime de cadrage hétérogène, une
# isolation PARFAITE à une seule ligne n'est PAS atteignable pour `codeTypeCh`/`premiereMiseEn
# CirculationLe` sans perdre des photos entières hors enveloppe (repli automatique, voir permis.py
# `SEUIL_CHAMPS_SUFFISANTS_CADRE`) — arbitrage tranché en faveur de la couverture plutôt que du
# risque de perte totale du champ sur les photos aux extrêmes du cadrage observé.
#
# `left`/`width` resserrés pour EXCLURE la colonne d'étiquette (FR/DE/IT/RM) à gauche de chaque
# valeur — c'est ELLE, pas seulement la hauteur, qui gonflait le nombre de fragments captés (le
# texte d'étiquette est aussi segmenté en fragments par le détecteur). Bordure droite choisie pour
# rester avant la colonne de champ VOISINE (ex. "Gesamtgewicht/Poids total" à droite du code type).
#
# NE COUVRE QUE LE CAS « double page en orientation PAYSAGE » — une photo PORTRAIT n'a
# physiquement pas la place pour les deux pages côte à côte et déclenche le repli (voir
# extraction_permis.py).
ZONES_CADRE_PROVISOIRE = {
    # Nom/adresse : PAS de validation référentielle (voir CHAMPS_AVEC_ISOLEMENT_LIGNE ci-dessous) —
    # recalibrées seulement sur l'évidence d'un défaut visuel manifeste constaté au passage (le
    # calibrage Tesseract hérité plaçait "detenteurNom" sur la ligne d'ENTÊTE vide au-dessus du nom,
    # jamais sur le nom lui-même), PAS enveloppées sur tout le corpus comme les champs prioritaires
    # ci-dessous (hors du périmètre de mesure de ce lot, qui porte sur code type/VIN/temps).
    "detenteurNom": {"left": 0.17, "top": 0.17, "width": 0.35, "height": 0.06},
    "detenteurAdresse": {"left": 0.17, "top": 0.21, "width": 0.35, "height": 0.09},
    # Enveloppe observée (ligne "Schild/Plaque/Targa/Numer") : 0.11-0.21 selon le cadrage — champ
    # NON voté/validé, priorité secondaire (voir doctrine ci-dessus), resserrement plus prudent que
    # les trois champs suivants. `width` ESSAYÉE plus étroite (0.27) puis ABANDONNÉE (mesuré, pas
    # supposé) : sur le corpus natif, une zone plaque/vin plus étroite capte moins de bruit de
    # fond mais fait parfois passer le nombre de champs cadre "exploitables" (non-vides, PAS
    # validés -- voir `permis._nombre_champs_exploitables`) sous `SEUIL_CHAMPS_SUFFISANTS_CADRE`,
    # ce qui déclenche le repli PLEINE PAGE (coûteux, ~35s mesuré sur IMG_2502) là où le cadre
    # généreux, même bruité, restait sous la barre des 10s. Régression nette constatée sur le
    # banc complet -- revenu à la largeur d'origine.
    "plaque": {"left": 0.595, "top": 0.09, "width": 0.30, "height": 0.14},
    # Enveloppe observée (ligne "Fahrgestell-Nr/N° châssis", 5 photos `cg/` représentatives de
    # l'écart de cadrage) : 0.31-0.375, mais resserrée sur le NOYAU où se regroupent 3 des 5
    # photos observées (0.31-0.355) plutôt que sur l'enveloppe totale -- une zone couvrant tout
    # l'écart capte SYSTÉMATIQUEMENT la ligne "Marque et type" au-dessus pour les photos à l'extrême
    # haut de l'écart (mesuré : la capter est INÉVITABLE dès que la zone doit aussi couvrir le bas
    # de l'écart), pour un bénéfice marginal sur seulement 2 photos/13 à l'extrême bas -- ce champ
    # N'A PAS la même doctrine de couverture totale que `codeTypeCh` (voir ce champ) : une lecture
    # légèrement tronquée reste rattrapable par `extraction-permis.ts` côté API (fenêtres
    # glissantes sur le VIN), un `codeTypeCh` totalement absent de la zone ne l'est pas.
    "vin": {"left": 0.615, "top": 0.30, "width": 0.355, "height": 0.08},
    # Enveloppe observée (ligne "Typengenehmigung/Réception par type") : 0.535-0.635 -- plus large
    # que les autres champs, voir la doctrine ci-dessus (perdre ENTIÈREMENT ce champ, seul champ
    # avec le VIN à disposer d'une validation référentielle formelle, coûte plus qu'une capture
    # encore un peu large).
    "codeTypeCh": {"left": 0.63, "top": 0.535, "width": 0.155, "height": 0.11},
    # Enveloppe observée (ligne "1. Inverkehrsetzung/1re mise en circulation") : 0.755-0.835.
    "premiereMiseEnCirculationLe": {"left": 0.595, "top": 0.74, "width": 0.145, "height": 0.105},
}

CHAMPS_CONNUS_CADRE = list(ZONES_CADRE_PROVISOIRE.keys())

# Champs pour lesquels `permis._isoler_ligne_candidate` s'applique avant recherche de motif — les
# deux SEULS champs dotés d'une validation formelle côté API principale (clé de contrôle ISO 3779
# pour le VIN, présence au référentiel `type_approbation_ch` pour le code type), pour lesquels une
# capture encore un peu bruitée mérite un effort d'isolement supplémentaire. Anciennement
# `CHAMPS_VOTES` : portait aussi le déclenchement du vote triple-passe, RETIRÉ le 20.08 (mesuré sans
# gain suffisant pour son coût — voir `permis.py`, commentaire de tête). Ce nom-ci ne porte plus que
# le sens qui reste : ces deux champs restent isolés ligne par ligne, une seule passe désormais comme
# les quatre autres.
CHAMPS_AVEC_ISOLEMENT_LIGNE = ("vin", "codeTypeCh")
