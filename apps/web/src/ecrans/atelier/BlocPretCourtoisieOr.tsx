import { Car } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponsePretCourtoisie } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePeut } from '@/droits';
import { usePretsCourtoisieOr } from '@/hooks/atelier/usePretsCourtoisieOr';
import { formaterDate } from '@/lib/formats';

interface Props {
  readonly orId: string;
}

/** Phrase du prêt : dit ce qui est arrivé à la voiture, sans jargon de statut. */
function cleDuPret(pret: ReponsePretCourtoisie): string {
  if (pret.statut === 'reserve') return 'reserve';
  if (pret.statut === 'retourne') return 'retourne';
  return pret.enRetard ? 'enRetard' : 'enCours';
}

/**
 * « Voiture de courtoisie : <véhicule>, prêtée le jj.mm.aaaa » sur la fiche de l'OR, pour chaque
 * prêt rattaché à cet OR (les prêts annulés n'ont jamais eu lieu : ils ne sont pas montrés).
 * Aucun prêt, ou droit `courtoisie.lire` absent : rien n'est rendu (le bouton « Véhicule de
 * courtoisie » reste le point d'entrée du prêt).
 */
export function BlocPretCourtoisieOr({ orId }: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs']);
  const peutLire = usePeut('courtoisie.lire');
  const requete = usePretsCourtoisieOr(orId, peutLire);

  if (!peutLire) return null;

  if (requete.isPending) {
    return <Skeleton className="h-6 w-72" aria-hidden="true" />;
  }

  if (requete.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="texte-libelle text-destructive">
          {t('or:pretCourtoisie.erreur')} {messageErreur(requete.error, t)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void requete.refetch()}>
          {t('commun:actions.reessayer')}
        </Button>
      </div>
    );
  }

  const prets = requete.data.donnees.filter((pret) => pret.statut !== 'annule');
  if (prets.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1" aria-label={t('or:pretCourtoisie.titre')}>
      {prets.map((pret) => (
        <li key={pret.id} className="flex items-center gap-2 texte-corps">
          <Car aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {t(`or:pretCourtoisie.${cleDuPret(pret)}`, {
              vehicule: pret.vehiculePlaque
                ? `${pret.vehiculeDesignation} (${pret.vehiculePlaque})`
                : pret.vehiculeDesignation,
              date: formaterDate(pret.debutLe),
              dateRetour: pret.renduLe ? formaterDate(pret.renduLe) : '',
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
