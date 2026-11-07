import { Ban, Lock, PencilLine, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import type { FormeBadge, TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * État affiché du document de vente — `design-etape-2-facturation.md` §2.1. Volontairement
 * restreint aux trois valeurs que ce badge sait représenter (`brouillon`/`emis`/`annule_par_avoir`) :
 * les six autres valeurs de `StatutDocumentVente` (`accepte`, `refuse`, `expire`, `remplace`,
 * `transforme`, `annule`, `abandonne`) appartiennent à la chaîne devis/bon de commande, hors
 * périmètre des cinq écrans facture/avoir de ce lot — un futur écran « fiche devis » ajoutera son
 * propre mapping plutôt que d'étendre celui-ci en silence.
 */
export type EtatDocumentAffichable = 'brouillon' | 'emis' | 'annule_par_avoir';

interface EntreeEtat {
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_ETAT: Readonly<Record<EtatDocumentAffichable, EntreeEtat>> = {
  brouillon: { cle: 'brouillon', icone: PencilLine, token: 'neutre', forme: 'contour' },
  emis: { cle: 'emis', icone: Lock, token: 'terminal', forme: 'contour' },
  annule_par_avoir: { cle: 'annuleParAvoir', icone: Ban, token: 'neutre', forme: 'contour' },
};

interface Props {
  readonly etat: EtatDocumentAffichable;
  readonly className?: string;
}

/** Badge « Brouillon / Émise / Annulée par avoir » (§2.1) — même patron que `BadgeStatutOr` :
 *  forme + icône + mot, jamais la couleur seule. */
export function BadgeEtatDocument({ etat, className }: Props) {
  const { t } = useTranslation('facturation');
  const config = CONFIG_ETAT[etat];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`facturation:document.etat.${config.cle}`)}
    </BadgeStatut>
  );
}
