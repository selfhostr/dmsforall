# Géométrie partagée entre les deux chemins de localisation de zone (cadré et repli) — PORT de
# moteur-ocr-conteneur/geometrie.mjs (même doctrine, même arrondi), conservé identique : ce n'est
# QUE de l'arithmétique fraction<->pixel, indépendante du moteur OCR qui consomme la zone obtenue.
#
# MOTIF (mesuré sur l'échantillon réel, voir extraction-permis.ts `candidatsCodeType`) : une
# découpe pile sur la bordure théorique du champ ampute parfois un caractère de bord (VIN, code
# type). Mieux vaut inclure un peu de blanc/texte voisin — l'extraction en aval (côté API
# principale) est déjà tolérante au bruit de bord — que perdre un caractère qui appartient au
# champ.

from dataclasses import dataclass

# Marge horizontale plus généreuse que la verticale : le bord de coupe qui ampute un caractère est
# presque toujours latéral (le texte continue à droite/gauche hors du cadre), rarement en haut/bas
# (une ligne de texte ne se coupe pas horizontalement). Une marge verticale trop large risquerait
# en revanche de capter la ligne du champ voisin.
MARGE_LARGEUR_DEFAUT = 0.15
MARGE_HAUTEUR_DEFAUT = 0.08


@dataclass(frozen=True)
class BoiteFraction:
    left: float
    top: float
    width: float
    height: float


@dataclass(frozen=True)
class BoitePixel:
    left: int
    top: int
    width: int
    height: int


def fraction_vers_pixels(boite: BoiteFraction, largeur_page: float, hauteur_page: float) -> dict:
    return {
        "left": boite.left * largeur_page,
        "top": boite.top * hauteur_page,
        "width": boite.width * largeur_page,
        "height": boite.height * hauteur_page,
    }


def elargir_et_borner_boite(
    boite: dict,
    largeur_page: float,
    hauteur_page: float,
    marge_largeur: float = MARGE_LARGEUR_DEFAUT,
    marge_hauteur: float = MARGE_HAUTEUR_DEFAUT,
) -> BoitePixel:
    """Élargit un rectangle PIXEL (marge proportionnelle à sa propre taille) puis le borne à la
    page. Toujours appliqué EN DERNIER, après toute autre conversion — même ordre d'arrondi que
    geometrie.mjs (left/top arrondis D'ABORD, largeur/hauteur dérivées du même arrondi) : arrondir
    les quatre bords indépendamment peut pousser `left + width` au-delà de `largeur_page`, ce que
    PIL `Image.crop` tolère (il borne silencieusement) mais qu'on préfère éviter par construction,
    même comportement que sharp côté Node."""
    marge_x = boite["width"] * marge_largeur
    marge_y = boite["height"] * marge_hauteur

    left = max(0.0, boite["left"] - marge_x)
    top = max(0.0, boite["top"] - marge_y)
    droite = min(largeur_page, boite["left"] + boite["width"] + marge_x)
    bas = min(hauteur_page, boite["top"] + boite["height"] + marge_y)

    left_arrondi = round(left)
    top_arrondi = round(top)
    largeur_page_entiere = round(largeur_page)
    hauteur_page_entiere = round(hauteur_page)

    return BoitePixel(
        left=left_arrondi,
        top=top_arrondi,
        width=max(1, min(round(droite) - left_arrondi, largeur_page_entiere - left_arrondi)),
        height=max(1, min(round(bas) - top_arrondi, hauteur_page_entiere - top_arrondi)),
    )
