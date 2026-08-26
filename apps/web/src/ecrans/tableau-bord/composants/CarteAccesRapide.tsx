import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  readonly titre: string;
  readonly description: string;
  readonly lien: { readonly to: string; readonly texte: string };
}

/**
 * Carte « accès rapide » — un LIEN, jamais un chiffre inventé. Réservée aux cas où un compte
 * honnête n'est structurellement pas atteignable depuis le front :
 *
 *  - Magasinier « Réservations actives » (§3.5) : `ReponseReservationPiece` ne porte ni désignation
 *    d'article ni numéro d'OR (seulement des UUID bruts, `articleId`/`ordreReparationId` —
 *    `EcranReservationsPieces.tsx` a le même constat, RECHERCHE confirmée, pas supposée) et
 *    `PageCurseur` n'expose aucun total (seulement des pages) — afficher un compte serait soit un
 *    UUID illisible, soit un chiffre potentiellement faux au-delà de la première page. Un lien
 *    direct vers l'écran des réservations, qui sait déjà gérer cette donnée brute, est le choix
 *    honnête.
 *
 * ANCIEN second usage, RETIRÉ (issue #93, testeur novice — « une carte qui me donne un itinéraire
 * au lieu d'une information ») : le comptable « À relancer » (§3.2) utilisait aussi cette carte, au
 * motif que `PageCurseur` n'expose aucun total. Faux en pratique : `TableauBordComptable.tsx`
 * calcule désormais un compte honnête (borné, « 50+ » au-delà) à partir de la première page de
 * `useListeDocumentsVente` avec le même filtre `enRetard=true&relanceNiveau=0` — voir son
 * commentaire de tête pour le détail. Le gap resté réel (l'onglet de `EcranListeFactures` ne lit
 * pas l'URL, un `?onglet=enRetard` n'aurait aucun effet) est désormais SANS CONSÉQUENCE : le lien
 * mène à la liste générale, pas à une vue pré-filtrée qu'il prétendrait activer.
 */
export function CarteAccesRapide({ titre, description, lien }: Props) {
  return (
    // DESIGN.md « densité » — titre + description + un seul bouton : contenu minimal, même
    // candidat que `CarteChiffreRequete` pour `--espace-carte-compacte`.
    <Card compact>
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
