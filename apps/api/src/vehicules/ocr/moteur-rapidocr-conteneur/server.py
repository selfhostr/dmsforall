# Service OCR dédié — HTTP minimal (http.server, stdlib), piste RapidOCR (voir moteur.py).
#
# POST /scan-permis — SEUL contrat que l'API principale consomme (`client-moteur-ocr.ts`,
# `apps/api/src/vehicules/ocr/`, hors périmètre d'écriture de ce conteneur) : reçoit une PHOTO de
# permis de circulation en corps BRUT, rend `{champs, avertissements, dureeMs}` où
# `champs[nomChamp]` est soit `null` (rien d'exploitable), soit une LISTE d'UNE lecture brute
# `{texte, confiance}` (une seule passe pour tous les champs, `vin`/`codeTypeCh` compris — le vote
# triple-passe essayé le 19.08 a été RETIRÉ le 20.08, mesuré sans gain suffisant pour son coût en
# temps, voir `permis.py`. Forme de liste conservée telle quelle côté contrat pour ne pas re-toucher
# `client-moteur-ocr.ChampMultiLectureOcr`). Remplace le conteneur Tesseract retiré
# (`moteur-ocr-conteneur/`, même route, même nom de champs `CHAMPS_OCR_PERMIS` côté API) — même
# doctrine de non-persistance : le corps de requête ne touche jamais le disque.
#
# POST /scan-document — pipeline pleine page GÉNÉRIQUE (PDF ou image, `{texteComplet, pages,
# dureeMs}`), conservé tel quel : c'est la mesure qui a validé RapidOCR (12/13 code type, voir
# extraction.py) et le contrat que `pieces/factures-fournisseur/lecture/port-ocr-texte.ts` documente
# comme cible future (`/ocr-texte`, non encore aligné — hors périmètre de ce lot). AUCUN appelant
# actuel (vérifié CodeGraph) : conservé parce qu'il ne coûte rien à garder et reste la seule route
# généraliste du conteneur, pas parce qu'il est utilisé aujourd'hui.
#
# AUCUNE ÉCRITURE DISQUE PERSISTANTE DU CONTENU REÇU, AUCUN CONTENU EXTRAIT JOURNALISÉ (voir
# extraction.py/entree.py/permis.py) — mêmes garanties que les deux autres conteneurs OCR de ce
# dépôt.
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from extraction import traiter_document
from permis import ErreurFormatImage, lire_permis

PORT = int(os.environ.get("PORT", "8092"))
TAILLE_MAX_OCTETS = int(os.environ.get("OCR_TAILLE_MAX_OCTETS", str(20 * 1024 * 1024)))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002
        pass

    def _repondre_json(self, statut: int, corps: dict):
        payload = json.dumps(corps).encode("utf-8")
        self.send_response(statut)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/sante":
            self._repondre_json(200, {"statut": "ok"})
            return
        self._repondre_json(404, {"erreur": "ROUTE_INCONNUE"})

    def do_POST(self):
        if self.path.startswith("/scan-permis"):
            self._traiter_scan_permis()
            return
        if self.path.startswith("/scan-document"):
            self._traiter_scan_document()
            return
        self._repondre_json(404, {"erreur": "ROUTE_INCONNUE"})

    def _lire_corps_borne(self):
        """Rend `None` (déjà répondu en erreur) ou les octets du corps — factorisé entre les deux
        routes POST, même validation Content-Length pour les deux."""
        longueur = int(self.headers.get("Content-Length", "0"))
        if longueur <= 0 or longueur > TAILLE_MAX_OCTETS:
            self._repondre_json(413 if longueur > TAILLE_MAX_OCTETS else 400, {"erreur": "TAILLE_INVALIDE"})
            return None
        return self.rfile.read(longueur)

    def _traiter_scan_permis(self):
        corps = self._lire_corps_borne()
        if corps is None:
            return
        try:
            resultat = lire_permis(corps)
        except ErreurFormatImage as cause:
            self._repondre_json(422, {"erreur": "FORMAT_NON_SUPPORTE", "detail": str(cause)})
            return
        except Exception as cause:  # noqa: BLE001
            print(f"vehicule-ocr-rapidocr: erreur de traitement (scan-permis): {cause}")  # jamais le contenu
            self._repondre_json(500, {"erreur": "ERREUR_INTERNE"})
            return
        self._repondre_json(200, resultat)

    def _traiter_scan_document(self):
        corps = self._lire_corps_borne()
        if corps is None:
            return
        deskew = "deskew=1" in self.path
        try:
            resultat = traiter_document(corps, appliquer_deskew=deskew)
        except Exception as cause:  # noqa: BLE001
            print(f"vehicule-ocr-rapidocr: erreur de traitement: {cause}")  # jamais le contenu
            self._repondre_json(500, {"erreur": "ERREUR_INTERNE"})
            return

        self._repondre_json(
            200,
            {
                "texteComplet": resultat.texte_complet,
                "pages": [{"source": p.source, "angleDeskew": p.angle_deskew} for p in resultat.pages],
                "dureeMs": resultat.duree_ms,
            },
        )


def main():
    from moteur import demarrer_moteur

    # Les DEUX profils moteur (voir moteur.py) sont chargés au démarrage — jamais paresseusement à
    # la première requête de chaque route, qui paierait sinon le coût de chargement modèle
    # (quelques secondes) sur le premier scan réel.
    demarrer_moteur("page")
    demarrer_moteur("zone")
    serveur = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"vehicule-ocr-rapidocr: à l'écoute sur le port {PORT}")
    serveur.serve_forever()


if __name__ == "__main__":
    main()
