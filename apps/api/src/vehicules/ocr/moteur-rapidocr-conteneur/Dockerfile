# Two stages: the builder installs the Python packages and bakes the models into a virtualenv; the
# final image copies the virtualenv only (no pip, no compiler cache).
#
# Service OCR dédié — piste RapidOCR (voir moteur.py), comparée à moteur-paddleocr-conteneur/ à
# côté. python:3.12-slim SUFFIT ICI (contrairement à paddlepaddle direct) : onnxruntime est un
# runtime auto-contenu, aucun segfault constaté sur la glibc de python:3.12-slim — vérifié avant de
# choisir cette base, pas supposé.
#
# poppler-utils : pdftoppm (rastérisation PDF -> PNG, 300dpi) + pdftotext (détection de couche
# texte native, évite l'OCR quand il y en a une — mesuré : les PDF Galaxus de l'échantillon en ont
# une, voir le rapport de livraison). pillow-heif : décodage HEIC/HEIF pur Python (libheif
# embarqué dans le wheel, pas de paquet système à compiler).
# python:3.12-slim (Debian, glibc). Pillow 13 requires Python >= 3.11, onnxruntime has cp312 wheels.
ARG PYTHON_IMAGE=python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54

# --- builder: packages + models in /opt/venv ---
FROM ${PYTHON_IMAGE} AS builder
ENV HOME=/app PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

# `rapidocr` (paquet unifié) ne dépend PAS automatiquement d'un moteur d'inférence -- onnxruntime
# est un extra à installer explicitement (constaté au premier build : ImportError sans lui).
# Pillow >= 13.0: fixes the CVEs of the 12.x line (rapidocr only requires "Pillow", no upper bound).
RUN pip install rapidocr onnxruntime "pillow>=13.0,<14" pillow-heif opencv-python-headless

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

# --- runtime: Python + virtualenv, no pip ---
FROM ${PYTHON_IMAGE} AS runtime
ENV HOME=/app
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip uninstall -y pip setuptools wheel 2>/dev/null || true

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

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
