# Redressement (deskew) — mesure l'angle d'inclinaison du texte (cv2.minAreaRect sur les pixels
# de premier plan après binarisation) et corrige par rotation. Appliqué UNIQUEMENT sur demande
# explicite (paramètre `appliquer_deskew` de `extraction.py`) pour pouvoir comparer le score AVEC
# et SANS — voir le rapport de livraison pour la mesure de l'apport réel sur l'échantillon
# factures/scans (documents les plus susceptibles d'être inclinés).
import cv2
import numpy as np
from PIL import Image


def angle_inclinaison(image_pil: Image.Image) -> float:
    """Rend l'angle estimé (degrés) — 0.0 si aucune inclinaison mesurable détectée."""
    gris = cv2.cvtColor(np.array(image_pil.convert("RGB")), cv2.COLOR_RGB2GRAY)
    _, binaire = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(binaire)
    if coords is None or len(coords) < 100:
        return 0.0
    rect = cv2.minAreaRect(coords)
    angle = rect[-1]
    # cv2.minAreaRect rend un angle dans [-90, 0) (OpenCV >= 4.5) — normaliser vers une rotation
    # de correction dans [-45, 45] (une page peut être inclinée dans les deux sens).
    if angle < -45:
        angle = 90 + angle
    return angle


def corriger_inclinaison(image_pil: Image.Image, angle: float) -> Image.Image:
    if abs(angle) < 0.1:
        return image_pil
    return image_pil.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
