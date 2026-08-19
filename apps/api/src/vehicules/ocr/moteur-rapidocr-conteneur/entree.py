# Détection de format PAR CONTENU (octets), jamais par extension de fichier — un client peut
# envoyer n'importe quel nom (même doctrine que estHeic dans moteur-ocr-conteneur/pretraitement.mjs).
# Vérifié sur l'échantillon réel : `IMG_2509.HEIC` est en fait un JPEG malgré son extension — la
# détection par octets est donc une nécessité mesurée, pas une prudence gratuite.
#
# Gère trois familles d'entrée : PDF (texte natif OU scan pur, page par page), HEIC/HEIF (photo
# iPhone native), image bitmap classique (JPEG/PNG/...). AUCUNE écriture disque de contenu utilisateur
# PERSISTANTE : les fichiers temporaires ci-dessous vivent sous /tmp (tmpfs du conteneur, jamais un
# volume), supprimés dans le même appel — poppler (pdftoppm/pdftotext) n'a pas d'API en mémoire pure,
# c'est le seul moyen de l'invoquer.
import io
import subprocess
import tempfile
from pathlib import Path

import pillow_heif
from PIL import Image

pillow_heif.register_heif_opener()

SIGNATURES_HEIC = [b"ftypheic", b"ftypheix", b"ftyphevc", b"ftypheim", b"ftypheis", b"ftypmif1", b"ftypmsf1"]


def est_pdf(octets: bytes) -> bool:
    return octets[:5] == b"%PDF-"


def est_heic(octets: bytes) -> bool:
    if len(octets) < 12:
        return False
    marqueur = octets[4:12]
    return marqueur in SIGNATURES_HEIC


def decoder_image(octets: bytes) -> Image.Image:
    """HEIC réel détecté par octets -> décodage explicite (pillow-heif) ; sinon PIL généraliste
    (couvre le cas mesuré `IMG_2509.HEIC` == JPEG malgré l'extension, PIL le sniffe correctement)."""
    if est_heic(octets):
        return Image.open(io.BytesIO(octets)).convert("RGB")
    return Image.open(io.BytesIO(octets)).convert("RGB")


def texte_natif_pdf(octets: bytes) -> str:
    """`pdftotext` (poppler) sur le PDF entier — rend la couche texte native si elle existe, chaîne
    vide sinon (scan pur). Décide si l'OCR est nécessaire DU TOUT (voir extraction.py)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(octets)
        f.flush()
        r = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, timeout=30)
    return r.stdout.decode("utf-8", errors="replace")


def rasteriser_pdf(octets: bytes, dpi: int = 300) -> list[Image.Image]:
    """`pdftoppm` (poppler) -> une image PIL par page, EN MÉMOIRE côté appelant (le répertoire
    temporaire est supprimé avant le retour, aucune trace disque persistante)."""
    with tempfile.TemporaryDirectory() as tmp:
        chemin_pdf = Path(tmp) / "doc.pdf"
        chemin_pdf.write_bytes(octets)
        prefixe = Path(tmp) / "page"
        subprocess.run(
            ["pdftoppm", "-r", str(dpi), "-png", str(chemin_pdf), str(prefixe)],
            capture_output=True, timeout=120, check=True,
        )
        pages = sorted(Path(tmp).glob("page-*.png"))
        return [Image.open(p).convert("RGB").copy() for p in pages]
