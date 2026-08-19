# Service OCR dédié — piste RapidOCR (voir moteur.py), comparée à moteur-paddleocr-conteneur/ à
# côté. python:3.10-slim SUFFIT ICI (contrairement à paddlepaddle direct) : onnxruntime est un
# runtime auto-contenu, aucun segfault constaté sur bookworm/glibc récente — vérifié avant de
# choisir cette base, pas supposé.
#
# poppler-utils : pdftoppm (rastérisation PDF -> PNG, 300dpi) + pdftotext (détection de couche
# texte native, évite l'OCR quand il y en a une — mesuré : les PDF Galaxus de l'échantillon en ont
# une, voir le rapport de livraison). pillow-heif : décodage HEIC/HEIF pur Python (libheif
# embarqué dans le wheel, pas de paquet système à compiler).
FROM python:3.10-slim
ENV HOME=/app
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# `rapidocr` (paquet unifié) ne dépend PAS automatiquement d'un moteur d'inférence -- onnxruntime
# est un extra à installer explicitement (constaté au premier build : ImportError sans lui).
RUN pip install --no-cache-dir rapidocr onnxruntime pillow pillow-heif opencv-python-headless

# Modèles PP-OCRv6 (détection, mobile) + PP-OCRv5 « latin » (reconnaissance, mobile) + classifieur
# d'angle baked au BUILD : instancier RapidOCR une fois déclenche le téléchargement dans le paquet
# installé (aucun appel réseau à l'exécution ensuite — même doctrine que les deux autres conteneurs
# OCR de ce dépôt).
# `Det.*` volontairement PAS surchargé : le détecteur par défaut (PP-OCRv6 mobile, langue-
# agnostique pour la LOCALISATION du texte) suffit pour toutes les langues -- CONSTATÉ au build :
# forcer `Det.lang_type='ch'` (implicite si on force `Det.model_type` sans langue) avec un modèle
# PP-OCRv6 mobile lève `ValueError: Unsupported det.lang_type='ch'`. Seule la RECONNAISSANCE
# (Rec.*) a besoin d'être pilotée vers le modèle multilingue latin.
RUN python -c "\
from rapidocr import RapidOCR; \
from rapidocr.utils.typings import ModelType, OCRVersion, LangRec; \
RapidOCR(params={'Rec.lang_type': LangRec.LATIN, 'Rec.model_type': ModelType.MOBILE, 'Rec.ocr_version': OCRVersion.PPOCRV5})"

COPY server.py moteur.py extraction.py entree.py deskew.py champs.py permis.py ancres.py zones_cadrees.py geometrie.py ./

ENV PORT=8092
ENV PYTHONUNBUFFERED=1
EXPOSE 8092

# Utilisateur non-root : ce service décode des documents d'identité/factures en mémoire (même
# exigence que les deux autres conteneurs OCR de ce dépôt).
RUN useradd --system --uid 10003 ocrrapid && chown -R ocrrapid:ocrrapid /app
USER ocrrapid

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8092/sante', timeout=3)" || exit 1

CMD ["python", "server.py"]
