# Port Python de extraction-permis.ts (checksum VIN ISO 3779, candidats de bordure code type) —
# MÊME algorithme, vérifié contre les vecteurs de test canoniques NHTSA avant tout usage sur des
# données réelles (voir bench/vin_checksum.py pour la preuve). Dupliqué ici (pas d'import cross-
# langage possible) plutôt que dans moteur-paddleocr-conteneur/ : DEUX conteneurs indépendants,
# chacun autonome, jamais un import partagé qui casserait l'un si l'autre change.
import re

_TRANSLITTERATION_VIN = {
    "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8, "J": 1, "K": 2, "L": 3, "M": 4,
    "N": 5, "P": 7, "R": 9, "S": 2, "T": 3, "U": 4, "V": 5, "W": 6, "X": 7, "Y": 8, "Z": 9,
}
_POIDS_VIN = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
_ALPHABET_VIN = set("ABCDEFGHJKLMNPRSTUVWXYZ0123456789")
REGEX_VIN = re.compile(r"[A-HJ-NPR-Z0-9]{17}")
REGEX_CODE_TYPE = re.compile(r"\b[0-9][A-Z]{1,3}[0-9]{2,4}\b")


def checksum_vin_valide(vin: str) -> bool:
    if len(vin) != 17 or any(c not in _ALPHABET_VIN for c in vin):
        return False
    somme = 0
    for i, c in enumerate(vin):
        v = int(c) if c.isdigit() else _TRANSLITTERATION_VIN.get(c)
        if v is None:
            return False
        somme += v * _POIDS_VIN[i]
    reste = somme % 11
    attendu = "X" if reste == 10 else str(reste)
    return vin[8] == attendu


def vins_valides_dans_texte(texte: str) -> list[str]:
    """Candidats VIN (17 caractères de l'alphabet VIN) dont la clé ISO 3779 valide — cherchés
    LIGNE PAR LIGNE (`texte` = lignes détectées jointes par '\\n', voir extraction.py), PAS par
    fenêtre glissante sur le texte entier concaténé/nettoyé.

    MESURÉ, et c'est pourquoi ligne par ligne : une recherche par fenêtre glissante sur un texte
    pleine page nettoyé (plusieurs milliers de caractères) fait apparaître PLUSIEURS dizaines de
    candidats à clé valide par pure coïncidence arithmétique (clé mod 11, ~1 chance sur 11 par
    fenêtre testée — voir la même mesure documentée dans extraction-permis.ts,
    `MAX_SUBSTITUTIONS_SIMULTANEES`) — inutilisable (`plusieurs candidats => aucun choix`, la
    doctrine ne permet alors JAMAIS de rendre un VIN). Restreindre la recherche à l'intérieur de
    CHAQUE ligne détectée séparément (une ligne = quelques dizaines de caractères, pas des
    milliers) réduit l'espace de collision de plusieurs ordres de grandeur, au prix de rater un VIN
    dont la détection l'aurait coupé en deux boîtes distinctes (repli non couvert ici)."""
    valides: list[str] = []
    for ligne in texte.split("\n"):
        nettoye = re.sub(r"[^A-Z0-9]", "", ligne.upper())
        for i in range(len(nettoye) - 16):
            candidat = nettoye[i : i + 17]
            if REGEX_VIN.fullmatch(candidat) and checksum_vin_valide(candidat):
                valides.append(candidat)
    return list(dict.fromkeys(valides))


def candidats_code_type_dans_texte(texte: str) -> list[str]:
    """Tokens qui RESSEMBLENT à un code type ASTRA (1 chiffre + 1-3 lettres + 2-4 chiffres, ex.
    1SF960, 1MF895), cherchés LIGNE PAR LIGNE (même raison que `vins_valides_dans_texte` : moins de
    faux positifs qu'un `findall` sur le texte entier, où deux champs voisins concaténés peuvent
    former un motif qui ressemble à un code type sans en être un). Le référentiel (216 819 lignes)
    fait ensuite foi, ce motif ne fait QUE réduire l'espace de recherche."""
    candidats: list[str] = []
    for ligne in texte.split("\n"):
        majuscule = ligne.upper()
        candidats.extend(REGEX_CODE_TYPE.findall(majuscule))
        # Repli : espace parasite au sein du code (constaté sur l'échantillon réel — ex. "3FG2 48"
        # au lieu de "3FG248", l'OCR insère parfois un espace là où l'impression n'en a pas) —
        # cherche aussi sur la ligne débarrassée de ses espaces internes.
        sans_espaces = re.sub(r"\s+", "", majuscule)
        candidats.extend(REGEX_CODE_TYPE.findall(sans_espaces))
    # Repli supplémentaire : bruit de bord (une ligne visuelle regroupe TOUTE une bande horizontale
    # — voir extraction.regrouper_par_ligne_visuelle — donc une colonne de tableau voisine peut se
    # coller directement au code, ex. "3FG2486" au lieu de "3FG248" avec un chiffre de trop en
    # queue, capté depuis la colonne suivante). Jusqu'à 2 caractères retirés en tête/queue de
    # chaque candidat déjà trouvé — même doctrine que `candidatsCodeType` (extraction-permis.ts),
    # le référentiel (216 819 lignes) reste seul juge de ce qui est retenu.
    with_trim: list[str] = []
    for c in candidats:
        with_trim.append(c)
        for coupe in (1, 2):
            if len(c) - coupe >= 4:
                with_trim.append(c[:-coupe])
                with_trim.append(c[coupe:])
    return list(dict.fromkeys(with_trim))


CANTONS_CH = [
    "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
    "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]
REGEX_PLAQUE = re.compile(r"\b(" + "|".join(CANTONS_CH) + r")\s*([0-9]{1,6})\b")


def plaques_dans_texte(texte: str) -> list[str]:
    nettoye = re.sub(r"[^A-Z0-9]", " ", texte.upper())
    return [f"{m.group(1)} {m.group(2)}" for m in REGEX_PLAQUE.finditer(nettoye)]


REGEX_DATE = re.compile(r"\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b")


def dates_dans_texte(texte: str) -> list[str]:
    resultat = []
    for m in REGEX_DATE.finditer(texte):
        j, mo, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= j <= 31:
            resultat.append(f"{a:04d}-{mo:02d}-{j:02d}")
    return resultat


REGEX_MONTANT = re.compile(r"\b(\d{1,3}(?:['’.]?\d{3})*[.,]\d{2})\b")


def montants_dans_texte(texte: str) -> list[str]:
    return REGEX_MONTANT.findall(texte)
