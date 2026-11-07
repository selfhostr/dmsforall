import { CheckCircle2, Circle, CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEtapesDemarrage } from '@/hooks/accueil/useEtapesDemarrage';
import { chemins } from '@/routes/chemins';

interface Props {
  readonly nombreComptesCrees: number;
  /** Ferme l'assistant (arrivée à la fin : il ne se rouvrira plus tout seul). */
  readonly onTerminer: () => void;
}

/** Étape 6 — récapitulatif (état réel relu sur `GET /accueil/etat-demarrage`) et trois suites. */
export function EtapeTermine({ nombreComptesCrees, onTerminer }: Props) {
  const { t } = useTranslation(['assistant', 'accueil']);
  const { etapes, enChargement } = useEtapesDemarrage();

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="assistant-recap-titre" className="flex flex-col gap-2">
        <h3 id="assistant-recap-titre" className="texte-libelle font-medium">
          {t('assistant:termine.recapitulatif')}
        </h3>
        {enChargement ? (
          <div role="status" aria-label={t('assistant:chargement')} className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {etapes.map((e) => {
              const Icone =
                e.etat === 'fait' ? CheckCircle2 : e.etat === 'inconnu' ? CircleHelp : Circle;
              const mot =
                e.etat === 'aFaire' && e.facultative
                  ? t('assistant:termine.etat.aFaireFacultatif')
                  : t(`assistant:termine.etat.${e.etat}`);
              return (
                <li key={e.id} className="flex items-center gap-3 py-2 texte-corps">
                  <Icone className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{t(`accueil:demarrage.etapes.${e.id}.titre`)}</span>
                  <span className="text-muted-foreground">{mot}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="texte-corps text-muted-foreground">
          {t('assistant:termine.comptesCrees', { nombre: nombreComptesCrees })}
        </p>
      </section>

      <div className="flex flex-wrap gap-3 border-t pt-4">
        <Button asChild>
          <Link to={chemins.atelier.ordresReparation.depuisPlaque()} onClick={onTerminer}>
            {t('assistant:termine.creerOr')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={chemins.clients.liste()} onClick={onTerminer}>
            {t('assistant:termine.ajouterClient')}
          </Link>
        </Button>
        <Button type="button" variant="outline" onClick={onTerminer}>
          {t('assistant:termine.accueil')}
        </Button>
      </div>
    </div>
  );
}
