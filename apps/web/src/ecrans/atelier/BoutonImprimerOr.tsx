import { useTranslation } from 'react-i18next';

import { BoutonImprimerDocument } from '@/composants/motifs/BoutonImprimerDocument';
import { obtenirEnv } from '@/config/env';

interface Props {
  readonly orId: string;
}

/**
 * Imprimer la feuille d'atelier (`GET /ordres-reparation/{orId}/pdf`) — geste de CONSULTATION,
 * même droit que la lecture de l'OR (`atelier.or.lire`, arbitrage figé pour ce lot). Contrairement
 * aux transitions de `PanneauActionsOr`, ce bouton ne dépend JAMAIS de `or.actionsDisponibles` ni
 * d'un droit supplémentaire : si l'utilisateur voit la fiche, il peut imprimer, quel que soit le
 * statut de l'OR — d'où un composant séparé, rendu à côté de `PanneauActionsOr` sans emprunter sa
 * logique de disponibilité.
 *
 * DEVENU UN SIMPLE APPELANT DE `BoutonImprimerDocument` (`composants/motifs/`, chantier
 * d'unification inter-écrans, 25.08.2026) — ce fichier était la RÉFÉRENCE dont ce composant
 * partagé a été extrait (issue #155, mécanisme `<a href target="_blank">` vers l'URL réelle du
 * PDF plutôt que fetch+blob : voir l'en-tête de `BoutonImprimerDocument.tsx` pour le raisonnement
 * complet, non reproduit ici). Ce fichier ne porte plus que ce qui est propre à l'OR : construire
 * l'URL et fournir le libellé traduit.
 */
export function BoutonImprimerOr({ orId }: Props) {
  const { t } = useTranslation('or');
  const urlPdf = `${obtenirEnv().VITE_API_URL}/ordres-reparation/${orId}/pdf`;

  return <BoutonImprimerDocument url={urlPdf} libelle={t('or:actions.imprimer')} />;
}
