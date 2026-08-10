import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  readonly titre: string;
  readonly description: string;
  readonly lien: { readonly to: string; readonly texte: string };
}

/**
 * Carte « accès rapide » — un LIEN, jamais un chiffre inventé. Deux usages, tous deux documentés
 * dans `docs/design-tableau-bord-par-role.md` comme des raccourcis honnêtes plutôt que des
 * agrégats qui n'existent pas côté serveur :
 *
 *  - Comptable « À relancer » (§3.2) : `GET /documents-vente?enRetard=true&relanceNiveau=0` est
 *    prouvé appliqué au SQL (`apps/api/src/facturation/documents/service-documents.ts:322-335`,
 *    vérifié en exécution avant construction de ce bloc), MAIS `EcranListeFactures` lit son onglet
 *    depuis un `useState` local (`onglet`), jamais depuis l'URL — un lien `?onglet=enRetard`
 *    n'aurait AUCUN effet, silencieusement. Gap supplémentaire à celui déjà signalé par le design
 *    (`chemins.facturation.liste` sans filtre) : même si ce constructeur acceptait un filtre,
 *    l'écran cible l'ignorerait. Plutôt que de construire un lien mort qui prétend filtrer, cette
 *    carte pointe honnêtement vers la liste des factures et NOMME le geste à faire une fois
 *    arrivé (ouvrir l'onglet « À relancer »).
 *  - Magasinier « Réservations actives » (§3.5) : `ReponseReservationPiece` ne porte ni désignation
 *    d'article ni numéro d'OR (seulement des UUID bruts, `articleId`/`ordreReparationId` —
 *    `EcranReservationsPieces.tsx` a le même constat, RECHERCHE confirmée, pas supposée) et
 *    `PageCurseur` n'expose aucun total (seulement des pages) — afficher un compte serait soit un
 *    UUID illisible, soit un chiffre potentiellement faux au-delà de la première page. Un lien
 *    direct vers l'écran des réservations, qui sait déjà gérer cette donnée brute, est le choix
 *    honnête.
 */
export function CarteAccesRapide({ titre, description, lien }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="secondary">
          <Link to={lien.to}>{lien.texte}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
