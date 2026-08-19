# Moteur OCR — RapidOCR (modèles PP-OCR exportés en ONNX, exécutés par onnxruntime, SANS le
# runtime paddlepaddle). Piste indiquée par @laupernoe (Immich utilise cette même combinaison) : ÉVITE
# ENTIÈREMENT la bataille ABI numpy/protobuf/Cython/glibc rencontrée avec paddlepaddle==2.6.2
# (voir moteur-paddleocr-conteneur/Dockerfile) — mesuré ici : `pip install rapidocr` seul, aucun
# pin de version nécessaire, aucun segfault, sur `python:3.10-slim` (bookworm) sans avoir besoin de
# revenir à `bullseye`. Package RENOMMÉ depuis la publication initiale de RapidOCR : `rapidocr`
# (unifié, >=3.x) est le paquet PyPI actuel, PAS `rapidocr-onnxruntime` (ancien nom, verrouillé sur
# les modèles PP-OCRv4 chinois seulement, plus maintenu comme référence multilingue) — vérifié par
# essai direct des deux avant de trancher.
#
# Modèles MOBILE (légers, CPU) : détection PP-OCRv6 « small » + reconnaissance PP-OCRv5 « latin »
# mobile (couvre FR/DE/IT/ES/PT en un seul modèle — même choix multilingue que côté PaddleOCR
# direct, ici sur une génération de modèle plus récente). Téléchargés une fois au BUILD (bake, voir
# Dockerfile) depuis ModelScope — aucun appel réseau à l'exécution ensuite.
import threading

from rapidocr import RapidOCR
from rapidocr.utils.typings import ModelType, OCRVersion, LangRec

_MOTEUR = None
_VERROU = threading.Lock()


def demarrer_moteur():
    global _MOTEUR
    if _MOTEUR is not None:
        return _MOTEUR
    # Det.* volontairement par défaut -- voir Dockerfile (forcer Det.model_type avec un lang_type
    # implicite 'ch' lève une ValueError côté PP-OCRv6 mobile ; le détecteur par défaut localise le
    # texte indépendamment de la langue).
    _MOTEUR = RapidOCR(
        params={
            "Rec.lang_type": LangRec.LATIN,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
        }
    )
    return _MOTEUR


def ocr_page(image_pil):
    """Rend la liste [(texte, confiance, boite)] pour une page entière — une « boîte » par
    FRAGMENT détecté, PAS forcément par ligne visuelle complète (constaté sur l'échantillon réel :
    187 boîtes pour une carte grise qui n'a qu'une cinquantaine de lignes imprimées — le détecteur
    PP-OCRv6 mobile segmente plus finement qu'un mot-clé + valeur entiers). Voir
    `extraction.regrouper_par_ligne_visuelle` qui recombine ces fragments par proximité verticale
    avant toute recherche de motif (VIN, code type…) — chercher directement dans un fragment isolé
    couperait la valeur en deux."""
    import numpy as np

    moteur = demarrer_moteur()
    with _VERROU:
        resultat = moteur(np.array(image_pil))

    # `resultat.boxes` est un array numpy -- `not resultat.boxes` lève une ValueError
    # ("ambiguous truth value") dès qu'il contient plus d'un élément : comparer à `None`/longueur,
    # jamais évaluer l'array lui-même en contexte booléen.
    if resultat is None or resultat.boxes is None or len(resultat.boxes) == 0:
        return []
    return list(zip(resultat.txts, resultat.scores, resultat.boxes))
