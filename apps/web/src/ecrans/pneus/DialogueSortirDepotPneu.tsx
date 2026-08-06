import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MOTIFS_SORTIE_DEPOT_PNEUS,
  type MotifSortieDepotPneus,
  type ReponseDepotPneus,
} from '@dfa/shared';

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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSortirDepotPneus } from '@/hooks/pneus/useSortirDepotPneus';

interface Props {
  readonly depot: ReponseDepotPneus | null;
  readonly onFerme: () => void;
}

/** `POST /depots-pneus/{id}/sortir` (RPP-05) — statut TERMINAL, motif OBLIGATOIRE : jamais une
 *  suppression de ligne, le motif reste consultable dans l'historique du véhicule. Pas de motif
 *  présélectionné (l'utilisateur choisit toujours explicitement). */
export function DialogueSortirDepotPneu({ depot, onFerme }: Props) {
  const { t } = useTranslation(['pneus', 'commun', 'validation']);
  const sortir = useSortirDepotPneus();
  const [motif, setMotif] = useState<MotifSortieDepotPneus | null>(null);

  useEffect(() => {
    if (depot) {
      setMotif(null);
      // Défaut corrigé : sans ce `reset()`, une erreur de mutation restée affichée depuis le jeu
      // précédent (ex. échec sur le jeu A) réapparaissait à l'ouverture du dialogue pour le jeu B
      // — même patron que `DialogueNouveauDepotPneu` (`creer.reset()` à la réinitialisation).
      sortir.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- réinitialisation à la réouverture seulement
  }, [depot]);

  function confirmer() {
    if (!depot || !motif) return;
    sortir.mutate({ id: depot.id, entree: { motif } }, { onSuccess: onFerme });
  }

  return (
    <Dialog open={depot !== null} onOpenChange={(ouvert) => !ouvert && onFerme()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pneus:sortie.titre')}</DialogTitle>
          <DialogDescription>
            {depot
              ? t('pneus:sortie.description', {
                  codeCase: depot.codeCase ?? t('pneus:jeu.sansRepere'),
                })
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="depot-pneu-motif-sortie">{t('pneus:sortie.champMotif')} *</Label>
          <Select
            value={motif ?? undefined}
            onValueChange={(valeur) => setMotif(valeur as MotifSortieDepotPneus)}
          >
            <SelectTrigger id="depot-pneu-motif-sortie" aria-label={t('pneus:sortie.champMotif')}>
              <SelectValue placeholder={t('pneus:sortie.champMotifPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {MOTIFS_SORTIE_DEPOT_PNEUS.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pneus:motifSortie.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {motif === null ? (
            <p className="texte-libelle text-muted-foreground">{t('validation:requis')}</p>
          ) : null}
        </div>

        {sortir.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(sortir.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFerme} disabled={sortir.isPending}>
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={!motif || sortir.isPending} onClick={confirmer}>
            {sortir.isPending ? t('commun:chargement.enCours') : t('pneus:jeu.actions.sortir')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
