# Orchestration du scan de PERMIS DE CIRCULATION — endpoint `/scan-permis` (voir server.py),
# SEUL contrat que `client-moteur-ocr.ts` (API principale) consomme aujourd'hui. Recombine ce qui
# a été mesuré séparément :
#   - la VITESSE du chemin zoné (héritée de moteur-ocr-conteneur/, conteneur Tesseract retiré —
#     zones fixes calibrées le 18.08 sur les 13 permis réels, `zones_cadrees.py`, + repli par
#     ancrage de libellé, `ancres.py`) ;
#   - la PRÉCISION de RapidOCR (12/13 code type en pleine page, contre 0/13 Tesseract) — appliquée
#     ici sur des DÉCOUPES ciblées plutôt qu'une page entière, via le profil moteur "zone"
#     (`moteur.py`, retuné spécifiquement pour ce coût-là : voir son commentaire de tête).
#
# Rend du texte BRUT par champ, JAMAIS interprété (aucune validation ISO 3779 ni référentiel ASTRA
# ici — l'API principale n'a pas accès à ce conteneur, et ce conteneur n'a pas accès à Postgres) :
# ce module ne fait QUE de la lecture de pixels, la validation vit côté API
# (`extraction-permis.ts`/`correspondance-permis.ts`).
#
# VOTE TRIPLE-PASSE : ESSAYÉ (demande @laupernoe, 19.08) puis RETIRÉ (recalibrage du 20.08, mesuré sur le
# banc des 17 photos, PAS une estimation) une fois les zones resserrées au point qu'une seule passe
# suffit dans la quasi-totalité des cas. Comparaison en isolation, deux passes consécutives sans
# autre charge concurrente sur la même machine, mêmes zones des deux côtés :
#   - 1 passe : code type 12/17 (10/13 `cg` + 2/4 natif), VIN 2/17 -- temps moyen 2.6s (`cg`)/5.3s
#     (natif), max mesuré 6.1s.
#   - 3 passes (vote) : code type 13/17 (11/13 + 2/4), VIN 2/17 (IDENTIQUE -- aucun gain sur ce
#     champ dans les deux mesures) -- temps moyen 5.0s (`cg`)/9.6s (natif), max mesuré 10.0s.
# Un seul photo/17 gagnée par le vote (celle-ci gagnée par accord 2/3, pas 3/3), contre un temps
# quasi DOUBLÉ sur les 17 -- et le lot natif (`cg-natif`, la cible n°1 de ce recalibrage) déjà à la
# limite des 10s en mesure isolée AVEC le vote, largement au-delà sous charge réelle (14-26s mesurés
# sur ce même lot, machine chargée). Le coût dépasse largement le gain une fois les zones resserrées
# -- RETIRÉ. `vin`/`codeTypeCh` repassent en UNE SEULE passe, même chemin que les quatre autres
# champs (voir `_extraire_champs` ci-dessous, plus de branchement par champ). L'isolement de la
# ligne la plus probable avant recherche de motif (`_isoler_ligne_candidate`, INDÉPENDANT du nombre
# de passes) reste appliqué à ces deux champs -- c'est cette étape-là, pas le vote, qui portait le
# gain de précision mesuré.
#
# DEUX CHEMINS, comme moteur-ocr-conteneur/extraction-champs.mjs avant lui (même doctrine, adaptée
# au coût RapidOCR — voir `moteur.py`) :
#   1. CADRÉ (par défaut) — zones à coordonnées fixes (`zones_cadrees.py`), l'écran mobile à cadre
#      guidé impose la position de chaque champ, pas besoin de la découvrir.
#   2. REPLI (localisation par libellé, `ancres.py`) — si le chemin cadré rend trop peu de champs
#      exploitables (photo forcée hors cadre).
# AUCUN FLAG DE MODE dans la requête HTTP — même arbitrage que côté Tesseract (repli automatique,
# jamais transmis par l'appelant).
import time

from PIL import Image, ImageOps

from entree import decoder_image
from moteur import ocr_page, PARALLELISME_ZONE
from zones_cadrees import CHAMPS_AVEC_ISOLEMENT_LIGNE, CHAMPS_CONNUS_CADRE, ZONES_CADRE_PROVISOIRE
from ancres import (
    CHAMPS_CONNUS as CHAMPS_CONNUS_ANCRES,
    boite_valeur_fraction,
    localiser_ancres,
    normaliser_bbox_fraction,
)
from geometrie import BoiteFraction, elargir_et_borner_boite, fraction_vers_pixels
from extraction import regrouper_par_ligne_visuelle
from concurrent.futures import ThreadPoolExecutor

# Page de travail : même largeur que le calibrage Tesseract du 18.08 (1400px, voir
# moteur-ocr-conteneur/extraction-champs.mjs `LARGEUR_PAGE`) — la géométrie des zones
# (`zones_cadrees.py`) est exprimée en FRACTION, indépendante de cette valeur, mais la calibration
# visuelle d'origine a été faite en la gardant, aucune raison de la changer sans nouveau calibrage.
LARGEUR_PAGE = 1400
# Passe de repérage (repli, localisation des libellés) : résolution réduite — même mesure Tesseract
# (confiance de localisation d'un libellé IMPRIMÉ inchangée à cette résolution, ~7-8x plus rapide).
LARGEUR_REPERE_REPLI = 1100
# Sous ce nombre de champs exploitables, le chemin cadré est jugé insuffisant (photo hors cadre) —
# même seuil provisoire que côté Tesseract (voir zones-cadrees.mjs).
SEUIL_CHAMPS_SUFFISANTS_CADRE = 3

# Marges de découpe RÉDUITES par rapport au calibrage Tesseract (15%/8%, `geometrie.mjs`) : coût
# RapidOCR dominé par le NOMBRE DE FRAGMENTS captés par la découpe (~0.3-0.6s/fragment mesuré, pas
# le nombre de pixels — voir moteur.py) — une marge généreuse capte des lignes de tableau voisines
# ENTIÈRES (mesuré sur l'échantillon réel : jusqu'à 30+ fragments parasites sur une découpe censée
# ne porter qu'un champ), payées en PLEIN tarif de reconnaissance pour un bénéfice de robustesse de
# bord marginal (l'extraction en aval reste tolérante au bruit même avec une marge réduite).
MARGE_LARGEUR_ZONE = 0.05
MARGE_HAUTEUR_ZONE = 0.03


class ErreurFormatImage(Exception):
    pass


import re

# La marge de découpe (`MARGE_LARGEUR_ZONE`/`MARGE_HAUTEUR_ZONE`) capte encore, sur certaines
# photos, une ou deux lignes de tableau VOISINES entières (mesuré sur l'échantillon réel : une
# marge assez généreuse pour ne jamais couper le champ visé capte parfois le libellé/valeur de la
# ligne au-dessus ou en dessous) — la longue chaîne qui en résulte n'est PLUS la « valeur avec un
# peu de bruit de bord » que `extraction-permis.candidatsCodeType`/`rechercherVin` (côté API) savent
# digérer : ces fonctions cherchent un candidat proche des BORDS de la chaîne reçue, pas enfoui au
# milieu d'un paragraphe. Pour `CHAMPS_AVEC_ISOLEMENT_LIGNE` (vin/codeTypeCh) UNIQUEMENT, ce module
# isole donc D'ABORD la ligne visuelle la plus prometteuse avant de la rendre — mêmes motifs que
# champs.py (l'autre pipeline de ce conteneur), appliqués ligne par ligne plutôt que sur le
# paragraphe entier. INDÉPENDANT du nombre de passes (voir le commentaire de tête sur le retrait du
# vote triple-passe) : c'est cette isolation qui portait le gain de précision mesuré, pas la
# répétition d'appels.
_REGEX_CODE_TYPE_CANDIDAT = re.compile(r'[0-9][A-Z]{1,3}[0-9]{2,4}')
# >= 6 caractères de l'alphabet VIN ET AU MOINS 4 CHIFFRES : un mot de libellé (« MARKEUNDTYP »,
# « FAHRGESTELLR »…) satisfait souvent la contrainte d'alphabet (aucune des lettres I/O/Q n'y
# figure, coïncidence fréquente en fr/de) mais ne contient JAMAIS de chiffre — un VIN réel en
# contient presque toujours plusieurs (mesuré sur l'échantillon réel : ce filtre élimine les faux
# positifs de libellé sans perdre un seul run de VIN authentique testé).
_REGEX_RUN_ALPHABET_VIN = re.compile(r'[A-HJ-NPR-Z0-9]{6,}')
_MIN_CHIFFRES_RUN_VIN = 4


def _isoler_ligne_candidate(lignes: list[str], nom_champ: str) -> str | None:
    if nom_champ == 'codeTypeCh':
        for ligne in lignes:
            majuscule = ligne.upper()
            # Ponctuation parasite au sein du code (constaté sur l'échantillon réel — ex. « 1SE9.60 »
            # ou « 1SE9 60 » au lieu de « 1SE960 », l'OCR insère parfois un espace/point là où
            # l'impression n'en a pas) — cherche d'abord tel quel, puis la ligne débarrassée de ses
            # espaces internes (même repli que `champs.candidats_code_type_dans_texte`, l'autre
            # pipeline de ce conteneur), puis de TOUTE ponctuation (`.`/`-`/`,`… — un cran plus loin
            # que `champs.py`, nécessaire ici faute de redondance inter-lignes sur une découpe
            # ciblée : une seule ligne candidate, pas une page entière où le motif réapparaît).
            trouve = (
                _REGEX_CODE_TYPE_CANDIDAT.findall(majuscule)
                or _REGEX_CODE_TYPE_CANDIDAT.findall(re.sub(r'\s+', '', majuscule))
                or _REGEX_CODE_TYPE_CANDIDAT.findall(re.sub(r'[^A-Z0-9]', '', majuscule))
            )
            if trouve:
                return max(trouve, key=len)
        return None
    if nom_champ == 'vin':
        meilleur: str | None = None
        for ligne in lignes:
            nettoyee = re.sub(r'[^A-Z0-9]', '', ligne.upper())
            for run in _REGEX_RUN_ALPHABET_VIN.findall(nettoyee):
                if sum(c.isdigit() for c in run) < _MIN_CHIFFRES_RUN_VIN:
                    continue
                if meilleur is None or len(run) > len(meilleur):
                    meilleur = run
        return meilleur
    return None


def _texte_zone(fragments, nom_champ: str | None = None) -> dict | None:
    """Fragments RapidOCR (voir `moteur.ocr_page`) d'UNE découpe -> `{texte, confiance}` unique,
    lignes visuelles recombinées (`extraction.regrouper_par_ligne_visuelle`, même fonction que le
    chemin `/scan-document` — un VIN/code type scindé en plusieurs boîtes doit redevenir une chaîne
    contiguë avant recherche de motif côté API). `None` si rien d'exploitable — jamais une chaîne
    vide qui laisserait croire à une valeur lue.

    `nom_champ` dans `zones_cadrees.CHAMPS_AVEC_ISOLEMENT_LIGNE` (vin/codeTypeCh) -> ESSAIE D'ABORD
    d'isoler la ligne la plus prometteuse (`_isoler_ligne_candidate`, précision maximale quand ça
    marche) — voir le commentaire de tête. Aucun candidat isolable => REPLI sur le paragraphe entier
    (même comportement que les champs sans isolement) : un isolement raté est un signal FAIBLE (le
    motif attendu n'est peut-être pas sur une ligne visuelle propre, ex. fragmentée entre deux
    groupes), pas une preuve d'absence — priver `extraction-permis.ts` (côté API, tolérant au bruit
    de bord) de tout texte serait pire qu'un paragraphe bruyant."""
    if not fragments:
        return None
    lignes = regrouper_par_ligne_visuelle(fragments)
    texte_repli = '\n'.join(lignes).strip()
    if nom_champ in CHAMPS_AVEC_ISOLEMENT_LIGNE:
        isole = _isoler_ligne_candidate(lignes, nom_champ)
        texte = isole if isole is not None else texte_repli
    else:
        texte = texte_repli
    if not texte:
        return None
    confiance = sum(c for _, c, _ in fragments) / len(fragments)
    return {'texte': texte, 'confiance': float(confiance)}


def _lire_zone(page: Image.Image, boite_pixel, nom_champ: str) -> dict | None:
    crop = page.crop(
        (boite_pixel.left, boite_pixel.top, boite_pixel.left + boite_pixel.width, boite_pixel.top + boite_pixel.height)
    )
    fragments = ocr_page(crop, profil='zone')
    return _texte_zone(fragments, nom_champ)


def _boite_pixel_fraction(boite_fraction: dict, page: Image.Image):
    return elargir_et_borner_boite(
        fraction_vers_pixels(BoiteFraction(**boite_fraction), page.width, page.height),
        page.width,
        page.height,
        marge_largeur=MARGE_LARGEUR_ZONE,
        marge_hauteur=MARGE_HAUTEUR_ZONE,
    )


def _extraire_champs(boites_par_champ: dict, page: Image.Image):
    """`boites_par_champ` : `{nom_champ: boite_pixel | None}` (`None` = ancre non localisée, chemin
    repli). Soumet TOUTES les découpes (UNE passe par champ — voir le commentaire de tête sur le
    retrait du vote triple-passe) à un pool borné (`PARALLELISME_ZONE`, voir moteur.py pour la
    mesure qui fixe cette valeur) — c'est ce parallélisme, pas la taille des découpes, qui ramène le
    temps total sous la cible. `champs[nom]` reste une LISTE (0 ou 1 lecture, jamais plus) — forme de
    fil identique à avant le retrait du vote, pour ne pas re-toucher le contrat côté API
    (`client-moteur-ocr.ChampMultiLectureOcr`) pour un simple changement de cardinalité."""
    with ThreadPoolExecutor(max_workers=PARALLELISME_ZONE) as executeur:
        taches: dict[str, object] = {}
        for nom, boite_pixel in boites_par_champ.items():
            taches[nom] = executeur.submit(_lire_zone, page, boite_pixel, nom) if boite_pixel is not None else None

        champs: dict[str, list | None] = {}
        avertissements: list[str] = []
        for nom, tache in taches.items():
            lecture = tache.result() if tache is not None else None
            champs[nom] = [lecture] if lecture is not None else None
            if lecture is None:
                avertissements.append(f'zone_vide:{nom}')
    return champs, avertissements


def _extraire_cadre(page: Image.Image):
    boites = {nom: _boite_pixel_fraction(ZONES_CADRE_PROVISOIRE[nom], page) for nom in CHAMPS_CONNUS_CADRE}
    return _extraire_champs(boites, page)


def _extraire_repli(page: Image.Image):
    page_repere = page.resize(
        (LARGEUR_REPERE_REPLI, round(page.height * LARGEUR_REPERE_REPLI / page.width))
    )
    fragments_reperage = ocr_page(page_repere, profil='zone')
    ancres = localiser_ancres(fragments_reperage)

    boites: dict[str, dict | None] = {}
    libelles_non_localises: list[str] = []
    for nom in CHAMPS_CONNUS_ANCRES:
        ancre = ancres.get(nom)
        if ancre is None:
            boites[nom] = None
            libelles_non_localises.append(nom)
            continue
        ancre_fraction = normaliser_bbox_fraction(ancre['bbox'], page_repere.width, page_repere.height)
        boite_fraction = boite_valeur_fraction(nom, ancre_fraction)
        boites[nom] = _boite_pixel_fraction(boite_fraction, page)

    champs, avertissements = _extraire_champs(boites, page)
    avertissements = [f'libelle_non_localise:{n}' for n in libelles_non_localises] + avertissements
    return champs, avertissements


def _nombre_champs_exploitables(champs: dict) -> int:
    return sum(1 for v in champs.values() if v)


def lire_permis(octets: bytes) -> dict:
    debut = time.time()
    try:
        image = decoder_image(octets)
    except Exception as cause:  # noqa: BLE001 -- traduit en erreur de contrat, voir server.py
        raise ErreurFormatImage(
            'Image illisible (format non reconnu ou fichier corrompu).'
        ) from cause

    # Redressement EXIF (JPEG notamment) — nécessaire ICI, pas seulement recommandé : le profil
    # moteur "zone" désactive le classifieur d'angle (`Global.use_cls=False`, voir moteur.py) qui
    # aurait pu rattraper une orientation résiduelle. `heic-convert`/pillow-heif applique déjà
    # l'orientation au décodage (aucun effet, mais `exif_transpose` reste sans risque à appeler).
    image = ImageOps.exif_transpose(image) or image

    largeur_cible = LARGEUR_PAGE
    if image.width > largeur_cible:
        ratio = largeur_cible / image.width
        image = image.resize((largeur_cible, round(image.height * ratio)), Image.LANCZOS)

    etiquette_orientation = 'orientation:portrait' if image.height > image.width else 'orientation:paysage'

    champs_cadre, avertissements_cadre = _extraire_cadre(image)
    if _nombre_champs_exploitables(champs_cadre) >= SEUIL_CHAMPS_SUFFISANTS_CADRE:
        return {
            'champs': champs_cadre,
            'avertissements': [*avertissements_cadre, etiquette_orientation, 'mode:cadre'],
            'dureeMs': round((time.time() - debut) * 1000),
        }

    champs_repli, avertissements_repli = _extraire_repli(image)
    return {
        'champs': champs_repli,
        'avertissements': [
            *[f'cadre_insuffisant:{a}' for a in avertissements_cadre],
            *avertissements_repli,
            etiquette_orientation,
            'mode:repli',
        ],
        'dureeMs': round((time.time() - debut) * 1000),
    }
