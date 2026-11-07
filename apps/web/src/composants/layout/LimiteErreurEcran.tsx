import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EtatErreur } from '@/composants/commun/EtatErreur';
import { enregistrerErreur } from '@/diagnostic/tampon';
import { signalerErreur } from '@/observabilite/sentry';

interface EtatLimiteErreurEcran {
  readonly aPlante: boolean;
}

interface PropsInternes {
  readonly children: ReactNode;
  readonly titre: string;
  readonly description: string;
}

/** Classe interne : seule API React pour capturer une erreur de rendu côté client à ce jour
 *  (identique au patron de `App.tsx::LimiteErreur`). Les libellés traduits sont reçus en props
 *  plutôt que lus ici via `useTranslation` — un `Component` de classe ne peut pas appeler un hook. */
class LimiteErreurEcranInterne extends Component<PropsInternes, EtatLimiteErreurEcran> {
  override state: EtatLimiteErreurEcran = { aPlante: false };

  static getDerivedStateFromError(): EtatLimiteErreurEcran {
    return { aPlante: true };
  }

  override componentDidCatch(erreur: Error, info: ErrorInfo): void {
    console.error('Erreur non rattrapée dans l’écran routé :', erreur, info.componentStack);
    enregistrerErreur(erreur);
    void signalerErreur(erreur, { componentStack: info.componentStack ?? undefined });
  }

  private reessayer = (): void => {
    this.setState({ aPlante: false });
  };

  override render() {
    if (this.state.aPlante) {
      return (
        <EtatErreur
          titre={this.props.titre}
          description={this.props.description}
          onReessayer={this.reessayer}
        />
      );
    }
    return this.props.children;
  }
}

interface Props {
  readonly children: ReactNode;
}

/**
 * Limite d'erreur SCOPÉE à l'écran routé (`<Outlet/>` d'`AppShell.tsx`) — issue #77, axe 1
 * (« réduire la portée de l'écran d'erreur »). Avant ce composant, la SEULE limite d'erreur de
 * rendu de l'application était `App.tsx::LimiteErreur`, posée à la toute racine : un crash de
 * rendu dans N'IMPORTE QUEL écran (un seul champ d'un formulaire compris) remplaçait la page
 * ENTIÈRE — barre latérale, en-tête, onglets — par `EcranErreurFatale`, jusqu'au rechargement
 * complet du poste. C'est la décision de conception que le retour terrain qualifie de violente.
 *
 * En scopant la limite ICI, sous `EnTete`/`BarreLaterale`/`OngletsDomaine` mais au-dessus de
 * `<Outlet/>`, un crash de rendu confiné à l'écran affiché :
 *  - laisse le CHROME intact (le poste sait toujours dans quel garage il travaille, §sélecteur de
 *    site, `EnTete.tsx`) ;
 *  - propose un « Réessayer » qui ne fait que RÉINITIALISER cette limite locale (remonter l'écran
 *    crashé), jamais un rechargement complet de l'onglet.
 *
 * `App.tsx::LimiteErreur` reste en place, INCHANGÉE, comme ultime filet (un crash dans le shell
 * lui-même — `AppShell`, `EnTete` — reste hors de portée de celle-ci).
 *
 * Ne PRÉSERVE PAS à elle seule la saisie d'un formulaire qui plante : React détruit l'état interne
 * du sous-arbre dès qu'une limite d'erreur le capte, quel que soit l'endroit où la limite est
 * posée. C'est le rôle complémentaire de `hooks/brouillon/useSauvegardeBrouillon` (axe 2).
 */
export function LimiteErreurEcran({ children }: Props) {
  const { t } = useTranslation(['erreurs', 'commun']);

  return (
    <LimiteErreurEcranInterne
      titre={t('erreurs:inattendue.titre')}
      description={t('erreurs:inattendue.description')}
    >
      {children}
    </LimiteErreurEcranInterne>
  );
}
