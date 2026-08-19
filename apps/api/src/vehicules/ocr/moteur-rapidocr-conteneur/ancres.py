# Localisation des champs par leurs LIBELLÉS imprimés — PORT de moteur-ocr-conteneur/ancres.mjs,
# adapté à la sortie RapidOCR (une bbox par FRAGMENT détecté, polygone à 4 points, PAS forcément
# une ligne visuelle complète ni un seul mot — voir moteur.py) plutôt qu'aux mots individuels
# rendus par Tesseract. Le permis de circulation suisse harmonisé porte des libellés fixes en 4
# langues (fr/de/it/rm) à côté de chaque champ numéroté — des mots CONNUS D'AVANCE, bien plus
# faciles à reconnaître pour l'OCR qu'une valeur manuscrite/tapuscrite variable. Une fois le
# libellé localisé (bbox), la VALEUR se trouve à sa droite/en dessous, sur la même cellule de
# tableau — la structure du formulaire fait le travail qu'une lecture libre ferait mal.
#
# Chemin de REPLI uniquement (voir extraction_permis.py) : le chemin CADRÉ (zones_cadrees.py) est
# toujours tenté en premier, ce module ne s'active qu'à défaut.
import re
import unicodedata

ANCRES_PAR_CHAMP = {
    "vin": ["chassisno", "chassis", "fahrgestellnr", "fahrgestell", "telaion", "telaio", "schassisnr"],
    "codeTypeCh": [
        "typengenehmigung",
        "receptionpartype",
        "reception",
        "approvazionedeltipo",
        "approvaziundaltip",
    ],
    "plaque": ["schild", "plaque", "targa", "numer"],
    "premiereMiseEnCirculationLe": [
        "inverkehrsetzung",
        "messeencirculation",
        "entradaincirculaziun",
        "circulation",
    ],
    "detenteurNom": ["vornamen", "prenoms", "prenomi", "prenumssecialas"],
    "detenteurAdresse": ["wohnort", "domicile", "domicilio", "domicil"],
}

# Même géométrie de zone VALEUR que côté Tesseract (ancres.mjs `GEOMETRIE_VALEUR`) — la position du
# libellé sur la page ne dépend pas du moteur qui l'a lu, seulement de l'impression du formulaire.
MARGE_APRES_LIBELLE = 0.01

GEOMETRIE_VALEUR = {
    "vin": {"largeur": 0.38, "hauteur": 0.065, "centree_sur_ligne": True},
    "codeTypeCh": {"largeur": 0.26, "hauteur": 0.065, "centree_sur_ligne": True},
    "plaque": {"largeur": 0.38, "hauteur": 0.065, "centree_sur_ligne": True},
    "premiereMiseEnCirculationLe": {"largeur": 0.22, "hauteur": 0.065, "centree_sur_ligne": True},
    "detenteurNom": {"largeur": 0.32, "hauteur": 0.05},
    "detenteurAdresse": {"largeur": 0.34, "hauteur": 0.11, "depuis_bas_libelle": True},
}

CHAMPS_CONNUS = list(ANCRES_PAR_CHAMP.keys())


def normaliser_mot(texte: str) -> str:
    sans_accent = unicodedata.normalize("NFD", (texte or "").lower())
    sans_accent = "".join(c for c in sans_accent if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z]", "", sans_accent)


def _bbox_depuis_polygone(polygone) -> dict:
    """Polygone RapidOCR (4 points [x,y]) -> bbox {x0,y0,x1,y1} en pixels, même forme que la bbox
    Tesseract consommée par ancres.mjs."""
    xs = [pt[0] for pt in polygone]
    ys = [pt[1] for pt in polygone]
    return {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}


def localiser_ancres(fragments) -> dict:
    """`fragments` : liste de (texte, confiance, polygone) rendue par `moteur.ocr_page`. Pour
    chaque champ connu, garde le fragment dont le texte normalisé matche le mieux (confiance la
    plus haute en cas de plusieurs correspondances) — même seuil de collision que ancres.mjs
    (`normalise.length >= 8` pour la branche « fragment COURT contenu dans l'ancre », évite qu'un
    sous-mot isolé comme « type » ne matche l'ancre `typengenehmigung`)."""
    resultat = {}
    for champ, variantes in ANCRES_PAR_CHAMP.items():
        meilleur = None
        meilleure_confiance = -1.0
        for texte, confiance, polygone in fragments:
            normalise = normaliser_mot(texte)
            if len(normalise) < 4:
                continue
            correspond = any(
                v in normalise or (len(v) >= 6 and len(normalise) >= 8 and normalise in v)
                for v in variantes
            )
            if not correspond:
                continue
            if meilleur is None or confiance > meilleure_confiance:
                meilleur = polygone
                meilleure_confiance = confiance
        resultat[champ] = (
            {"bbox": _bbox_depuis_polygone(meilleur), "confiance": meilleure_confiance}
            if meilleur is not None
            else None
        )
    return resultat


def normaliser_bbox_fraction(bbox_pixel: dict, largeur_page: float, hauteur_page: float) -> dict:
    return {
        "x0": bbox_pixel["x0"] / largeur_page,
        "x1": bbox_pixel["x1"] / largeur_page,
        "y0": bbox_pixel["y0"] / hauteur_page,
        "y1": bbox_pixel["y1"] / hauteur_page,
    }


def boite_valeur_fraction(champ: str, ancre_bbox_fraction: dict) -> dict:
    """Bbox de la zone VALEUR d'un champ, en FRACTION de page, depuis la bbox de son ancre
    (fraction elle aussi) — TOUJOURS relatif à l'ancre trouvée sur CETTE photo, jamais une fraction
    de page absolue (voir ancres.mjs pour la mesure qui a fait abandonner cette approche)."""
    geo = GEOMETRIE_VALEUR[champ]
    largeur = geo["largeur"]
    hauteur = geo["hauteur"]

    left = ancre_bbox_fraction["x1"] + MARGE_APRES_LIBELLE

    if geo.get("depuis_bas_libelle"):
        top = ancre_bbox_fraction["y1"]
    elif geo.get("centree_sur_ligne"):
        top = (ancre_bbox_fraction["y0"] + ancre_bbox_fraction["y1"]) / 2 - hauteur / 2
    else:
        top = ancre_bbox_fraction["y0"] - hauteur * 0.15

    return {"left": max(0.0, left), "top": max(0.0, top), "width": largeur, "height": hauteur}
