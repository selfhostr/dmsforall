import { useTranslation } from 'react-i18next';

import type { ReponseDepotPneus } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useChangerSaisonDepotPneus } from '@/hooks/pneus/useChangerSaisonDepotPneus';

interface Props {
  readonly depot: ReponseDepotPneus | null;
  readonly onFerme: () => void;
}

/** `POST /depots-pneus/{id}/changer-saison` (RPP-03) — inverse `monté ↔ en dépôt` du jeu ET de
 *  son jumeau actif (même véhicule, saison opposée), sans confirmation à froid : le geste est
 *  fréquent (deux fois par an, par jeu) et réversible (rejouer l'action inverse le remet dans
 *  l'état précédent) — pas de champ motif requis, contrairement à `DialogueSortirDepotPneu`
 *  (RPP-05, TERMINAL et non réversible). `ligneOrId` n'est PAS saisi ici : ce dialogue est ouvert
 *  depuis l'écran hangar, pas depuis un OR — le rattachement optionnel à une ligne d'OR reste
 *  possible plus tard depuis l'atelier (hors périmètre de cet écran). */
export function DialogueChangerSaisonPneu({ depot, onFerme }: Props) {
  const { t } = useTranslation(['pneus', 'commun']);
  const changerSaison = useChangerSaisonDepotPneus();

  function confirmer() {
    if (!depot) return;
    changerSaison.mutate({ id: depot.id, entree: {} }, { onSuccess: onFerme });
  }

  return (
    <Dialog open={depot !== null} onOpenChange={(ouvert) => !ouvert && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pneus:changementSaison.titre')}</DialogTitle>
          <DialogDescription>
            {depot
              ? t('pneus:changementSaison.description', {
                  codeCase: depot.codeCase ?? t('pneus:jeu.sansRepere'),
                })
              : null}
          </DialogDescription>
        </DialogHeader>

        {changerSaison.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(changerSaison.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onFerme}
            disabled={changerSaison.isPending}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={changerSaison.isPending} onClick={confirmer}>
            {changerSaison.isPending
              ? t('commun:chargement.enCours')
              : t('pneus:jeu.actions.changerSaison')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
