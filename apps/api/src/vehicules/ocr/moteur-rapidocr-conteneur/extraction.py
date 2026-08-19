# Orchestration — pipeline GÉNÉRIQUE pleine page (pas de zones à coordonnées fixes comme
# moteur-paddleocr-conteneur/zones_cadrees.py) : nécessaire ici, les nouveaux échantillons (photos
# natives iPhone, PDF scannés, factures) n'ont NI la même mise en page double-page que les 13
# cartes grises historiques, NI une mise en page connue d'avance pour les factures. Le texte
# reconnu (pleine page, toutes les pages d'un PDF concaténées) est passé à `champs.py` qui
# cherche chaque motif PARTOUT dans le texte, jamais dans une zone présupposée.
#
# AUCUNE ÉCRITURE DISQUE PERSISTANTE, AUCUN CONTENU EXTRAIT JOURNALISÉ : voir entree.py (fichiers
# temporaires poppler supprimés dans le même appel) et server.py (jamais de print du texte reconnu).
from dataclasses import dataclass, field

from deskew import angle_inclinaison, corriger_inclinaison
from entree import decoder_image, est_pdf, rasteriser_pdf, texte_natif_pdf
from moteur import ocr_page

SEUIL_TEXTE_NATIF_CARACTERES = 20  # en dessous, on considère le PDF comme un scan pur (pas de
# couche texte exploitable) — quelques artefacts de métadonnées ne suffisent pas à l'écarter de
# l'OCR.


@dataclass
class ResultatPage:
    texte: str
    source: str  # "texte_natif" | "ocr"
    angle_deskew: float = 0.0


@dataclass
class ResultatDocument:
    pages: list = field(default_factory=list)
    texte_complet: str = ""
    duree_ms: int = 0


def traiter_document(octets: bytes, appliquer_deskew: bool = False) -> ResultatDocument:
    import time

    debut = time.time()
    pages_resultat: list[ResultatPage] = []

    if est_pdf(octets):
        natif = texte_natif_pdf(octets)
        if len(natif.strip()) >= SEUIL_TEXTE_NATIF_CARACTERES:
            pages_resultat.append(ResultatPage(texte=natif, source="texte_natif"))
        else:
            for page_img in rasteriser_pdf(octets, dpi=300):
                pages_resultat.append(_ocr_une_page(page_img, appliquer_deskew))
    else:
        image = decoder_image(octets)
        pages_resultat.append(_ocr_une_page(image, appliquer_deskew))

    texte_complet = "\n".join(p.texte for p in pages_resultat)
    return ResultatDocument(
        pages=pages_resultat, texte_complet=texte_complet, duree_ms=round((time.time() - debut) * 1000)
    )


LARGEUR_MAX_PAGE = 2000  # borne le temps d'inférence sur les scans 300dpi (souvent 2400px+ de
# large) et les photos natives haute résolution -- au-delà, aucun gain de justesse mesuré côté
# Tesseract/PaddleOCR sur ce type de document (voir les deux autres conteneurs), juste du temps
# perdu sur une détection pleine page qui doit déjà balayer beaucoup plus de texte qu'une zone
# ciblée.


def _redimensionner_si_besoin(image_pil):
    if image_pil.width <= LARGEUR_MAX_PAGE:
        return image_pil
    ratio = LARGEUR_MAX_PAGE / image_pil.width
    from PIL import Image

    return image_pil.resize((LARGEUR_MAX_PAGE, round(image_pil.height * ratio)), Image.LANCZOS)


def _y_centre(boite) -> float:
    return sum(pt[1] for pt in boite) / len(boite)


def _x_gauche(boite) -> float:
    return min(pt[0] for pt in boite)


def _hauteur_boite(boite) -> float:
    ys = [pt[1] for pt in boite]
    return max(ys) - min(ys)


def regrouper_par_ligne_visuelle(lignes) -> list[str]:
    """Recombine les fragments détectés (voir moteur.ocr_page, docstring) en lignes VISUELLES —
    fragments dont le centre vertical tombe dans la même bande (tolérance = la moitié de la
    hauteur de boîte, mesure empirique : trop étroit laisse des fragments de la même ligne dans
    des bandes séparées à cause du léger désalignement de la détection, trop large fusionne deux
    lignes réellement distinctes) sont triés par position horizontale puis joints par un espace —
    condition nécessaire pour qu'une valeur détectée en plusieurs boîtes (ex. VIN scindé en deux
    fragments) redevienne une chaîne contiguë avant recherche de motif (`champs.py`)."""
    if not lignes:
        return []
    elements = sorted(
        [
            {"texte": t, "y": _y_centre(b), "x": _x_gauche(b), "h": _hauteur_boite(b)}
            for t, _, b in lignes
        ],
        key=lambda e: e["y"],
    )
    groupes: list[list[dict]] = []
    for e in elements:
        if groupes and abs(e["y"] - groupes[-1][-1]["y"]) <= max(groupes[-1][-1]["h"], e["h"]) / 2:
            groupes[-1].append(e)
        else:
            groupes.append([e])
    return [" ".join(el["texte"] for el in sorted(g, key=lambda el: el["x"])) for g in groupes]


def _ocr_une_page(image_pil, appliquer_deskew: bool) -> ResultatPage:
    image_pil = _redimensionner_si_besoin(image_pil)
    angle = 0.0
    if appliquer_deskew:
        angle = angle_inclinaison(image_pil)
        if abs(angle) >= 0.1:
            image_pil = corriger_inclinaison(image_pil, angle)
    lignes = ocr_page(image_pil)
    lignes_visuelles = regrouper_par_ligne_visuelle(lignes)
    texte = "\n".join(lignes_visuelles)
    return ResultatPage(texte=texte, source="ocr", angle_deskew=angle)
