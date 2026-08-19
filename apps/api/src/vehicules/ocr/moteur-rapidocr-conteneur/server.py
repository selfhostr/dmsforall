# Service OCR dédié — HTTP minimal (http.server, stdlib), piste RapidOCR (voir moteur.py).
# POST /scan-document reçoit un PDF ou une image en corps BRUT, rend {texteComplet, pages,
# dureeMs} — contrat plus large que /scan-permis (moteur-tesseract.mjs / moteur-paddleocr) : ce
# conteneur ne présuppose PAS un document carte grise (voir extraction.py, pipeline pleine page
# générique, aussi utilisé pour les factures dans le protocole de mesure).
#
# AUCUNE ÉCRITURE DISQUE PERSISTANTE DU CONTENU REÇU, AUCUN CONTENU EXTRAIT JOURNALISÉ (voir
# extraction.py/entree.py) — mêmes garanties que les deux autres conteneurs OCR de ce dépôt.
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from extraction import traiter_document

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
        if not self.path.startswith("/scan-document"):
            self._repondre_json(404, {"erreur": "ROUTE_INCONNUE"})
            return

        longueur = int(self.headers.get("Content-Length", "0"))
        if longueur <= 0 or longueur > TAILLE_MAX_OCTETS:
            self._repondre_json(413 if longueur > TAILLE_MAX_OCTETS else 400, {"erreur": "TAILLE_INVALIDE"})
            return

        corps = self.rfile.read(longueur)
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

    demarrer_moteur()
    serveur = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"vehicule-ocr-rapidocr: à l'écoute sur le port {PORT}")
    serveur.serve_forever()


if __name__ == "__main__":
    main()
