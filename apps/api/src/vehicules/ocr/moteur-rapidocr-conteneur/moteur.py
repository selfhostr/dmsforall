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
#
# DEUX PROFILS D'INSTANCE (refonte zones ciblées, 19.08) — deux moteurs RapidOCR EN MÉMOIRE, pas un
# seul partagé, pour une raison mesurée et précise :
#
#   "page"  — paramètres D'ORIGINE, INCHANGÉS (`Det.limit_type` par défaut du paquet, `Global.
#             use_cls` par défaut) : c'est EXACTEMENT la configuration qui a donné 12/13 code type
#             sur les 13 permis historiques (voir extraction.py, `/scan-document`) — n'importe quel
#             changement de ces paramètres (même fait pour accélérer un tout autre chemin) aurait
#             re-questionné cette mesure sans la refaire. On ne touche pas à un moteur qui a une
#             mesure de qualité déjà actée.
#   "zone"  — paramètres RETUNÉS pour l'appel RÉPÉTÉ sur de PETITES découpes (chemin `/scan-permis`,
#             voir `permis.py`), mesurés sur l'échantillon réel (rapport de livraison) :
#       - `Det.limit_type = "max"` : LE levier décisif. Le défaut du paquet est `limit_type="min"`
#         avec `limit_side_len=736` — sur une découpe ÉTROITE (large mais peu haute, typique d'une
#         zone de champ), le mode "min" UPSCALE l'image jusqu'à ce que son PLUS PETIT côté atteigne
#         736px, ce qui, sur une découpe 1800x314, la fait gonfler à ~4200x735 avant détection —
#         mesuré : une découpe de ce type passe de ~46s à ~20s en detection seule rien qu'en
#         passant à "max" (qui borne le plus GRAND côté, jamais n'agrandit une découpe déjà
#         suffisante). Sans cette bascule, le chemin zoné est STRICTEMENT PLUS LENT que la pleine
#         page qu'il est censé remplacer — l'upscale pathologique domine largement l'économie de
#         pixels que la découpe est censée apporter.
#       - `Global.use_cls = False` : le classifieur d'angle (détection de ligne à 180°) coûte un
#         3ᵃ passage modèle par fragment détecté, pour un cas — une carte de champ scannée la tête
#         en bas — déjà couvert en amont par la correction EXIF (`entree.decoder_image`, refonte du
#         même jour) ; l'accepter en repli serait payer ce coût sur CHAQUE fragment de CHAQUE
#         découpe pour un cas résiduel. Contrepartie assumée : une photo dont l'orientation EXIF
#         est absente/fausse ET dont le sujet est réellement à 180° ne sera pas lue — dégrade en
#         champ vide, jamais en valeur fausse (même doctrine que le reste de ce module).
#       - `EngineConfig.onnxruntime.intra_op_num_threads = 2` + `enable_cpu_mem_arena = True` :
#         mesuré sur l'échantillon réel — LE coût dominant d'un appel sur petite découpe est la
#         RECONNAISSANCE (un passage modèle par fragment détecté, ~0.3-0.6s/fragment sur le CPU de
#         référence), pas la détection. `intra_op_num_threads=2` (au lieu de -1, qui réclame tous
#         les cœurs par appel) laisse la marge nécessaire pour que PLUSIEURS appels tournent
#         RÉELLEMENT en parallèle (`permis.py` soumet les découpes de champs à un pool de threads
#         Python — le GIL est relâché pendant l'inférence onnxruntime, mesuré : 4 appels
#         concurrents avec ce réglage terminent ensemble en un temps proche du plus lent d'entre
#         eux, pas de la somme) sans les faire tous se battre pour les 8 fils du CPU de référence.
#         `enable_cpu_mem_arena=True` (le paquet le désactive par défaut) réduit le coût
#         d'allocation répété entre deux appels courts et fréquents — sans effet sur la qualité,
#         seulement sur la latence par appel.
#
# Aucun verrou global (`_VERROU` supprimé, refonte du 19.08) : les sessions onnxruntime sont
# thread-safe pour des appels `Run()` concurrents (documenté, et vérifié en mesure — voir
# rapport de livraison) ; sérialiser tous les appels derrière un verrou aurait annulé exactement
# le bénéfice de parallélisme que `intra_op_num_threads` réduit vient permettre.
import numpy as np
from PIL import Image
from rapidocr import RapidOCR
from rapidocr.utils.typings import ModelType, OCRVersion, LangRec

_MOTEURS: dict = {}

_PARAMS_COMMUNS = {
    "Rec.lang_type": LangRec.LATIN,
    "Rec.model_type": ModelType.MOBILE,
    "Rec.ocr_version": OCRVersion.PPOCRV5,
}

_PARAMS_PAR_PROFIL = {
    # INCHANGÉ depuis la mesure 12/13 — voir le commentaire de tête, ne pas ajouter de clé ici
    # sans refaire cette mesure.
    "page": {},
    "zone": {
        "Det.limit_type": "max",
        "Global.use_cls": False,
        "EngineConfig.onnxruntime.intra_op_num_threads": 2,
        "EngineConfig.onnxruntime.enable_cpu_mem_arena": True,
    },
}

# Nombre de découpes de champ traitées EN PARALLÈLE par `permis.py` — voir le commentaire
# `intra_op_num_threads` ci-dessus : 4 x 2 fils ≈ les 8 fils du CPU de référence (mesuré, pas une
# valeur ronde arbitraire). Exposé ici (pas dans `permis.py`) : c'est une propriété du moteur
# "zone" (son réglage de threads), pas de l'orchestration des champs.
PARALLELISME_ZONE = 4


def demarrer_moteur(profil: str = "page"):
    if profil in _MOTEURS:
        return _MOTEURS[profil]
    # Det.model_type/lang_type volontairement par défaut -- voir Dockerfile (forcer Det.model_type
    # avec un lang_type implicite 'ch' lève une ValueError côté PP-OCRv6 mobile ; le détecteur par
    # défaut localise le texte indépendamment de la langue, pour les deux profils).
    _MOTEURS[profil] = RapidOCR(params={**_PARAMS_COMMUNS, **_PARAMS_PAR_PROFIL[profil]})
    return _MOTEURS[profil]


def ocr_page(image_pil: Image.Image, profil: str = "page"):
    """Rend la liste [(texte, confiance, boite)] pour une image (page entière OU découpe de
    champ selon `profil`, voir le commentaire de tête) — une « boîte » par FRAGMENT détecté, PAS
    forcément par ligne visuelle complète (constaté sur l'échantillon réel : 187 boîtes pour une
    carte grise qui n'a qu'une cinquantaine de lignes imprimées — le détecteur PP-OCRv6 mobile
    segmente plus finement qu'un mot-clé + valeur entiers). Voir
    `extraction.regrouper_par_ligne_visuelle` (profil "page") qui recombine ces fragments par
    proximité verticale avant toute recherche de motif — chercher directement dans un fragment
    isolé couperait la valeur en deux."""
    moteur = demarrer_moteur(profil)
    resultat = moteur(np.array(image_pil))

    # `resultat.boxes` est un array numpy -- `not resultat.boxes` lève une ValueError
    # ("ambiguous truth value") dès qu'il contient plus d'un élément : comparer à `None`/longueur,
    # jamais évaluer l'array lui-même en contexte booléen.
    if resultat is None or resultat.boxes is None or len(resultat.boxes) == 0:
        return []
    return list(zip(resultat.txts, resultat.scores, resultat.boxes))
