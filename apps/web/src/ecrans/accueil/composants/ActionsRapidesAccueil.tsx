import { CalendarPlus, HandCoins, Search, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { peutCreerOrdreReparation } from '@/ecrans/atelier/droits';
import { BoutonNouveauDevis } from '@/ecrans/facturation/BoutonNouveauDevis';
import { peutEncaisser } from '@/ecrans/facturation/droits';
import { peutCreerRendezVous } from '@/ecrans/rendez-vous/droits';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

/**
 * Ouvre la recherche globale du bandeau (`composants/layout/RechercheGlobale.tsx`) : ce composant
 * n'exporte aucun point d'ouverture, et il écoute déjà `Ctrl+K` sur `window` — on rejoue ce
 * raccourci plutôt que de monter une seconde fenêtre de recherche (deux fenêtres s'ouvriraient à
 * chaque `Ctrl+K`).
 */
function ouvrirRechercheGlobale() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
}

interface Props {
  readonly site: string | undefined;
}

/**
 * Les quatre gestes qui lancent une journée de comptoir. Chacun n'existe que pour les rôles qui en
 * ont le droit (jamais de bouton grisé) ; « Nouveau devis » gère lui-même son droit.
 */
export function ActionsRapidesAccueil({ site }: Props) {
  const { t } = useTranslation('accueil');
  const { data: session } = useSession();
  const actions = session?.actions;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label={t('actions.titre')} className="flex flex-wrap gap-2">
        {peutCreerOrdreReparation(actions) ? (
          <Button asChild>
            <Link to={chemins.atelier.ordresReparation.depuisPlaque({ site })}>
              <Wrench aria-hidden className="h-4 w-4" />
              {t('actions.creerOr')}
            </Link>
          </Button>
        ) : null}
        {peutCreerRendezVous(actions) ? (
          <Button asChild variant="outline">
            <Link to={chemins.atelier.rendezVous.agenda(site)}>
              <CalendarPlus aria-hidden className="h-4 w-4" />
              {t('actions.nouveauRendezVous')}
            </Link>
          </Button>
        ) : null}
        <BoutonNouveauDevis />
        {peutEncaisser(actions) ? (
          <Button asChild variant="outline">
            <Link to={chemins.facturation.liste(site)}>
              <HandCoins aria-hidden className="h-4 w-4" />
              {t('actions.encaisser')}
            </Link>
          </Button>
        ) : null}
      </nav>
      <Button
        type="button"
        variant="outline"
        onClick={ouvrirRechercheGlobale}
        aria-label={t('actions.rechercher')}
        className="min-w-64 flex-1 justify-start gap-2 font-normal text-muted-foreground"
      >
        <Search aria-hidden className="h-4 w-4 shrink-0" />
        <span className="truncate">{t('recherche.placeholder')}</span>
      </Button>
    </div>
  );
}
