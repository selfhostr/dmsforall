import { Ban, Lock, PencilLine, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * État affiché du document de vente — `design-etape-2-facturation.md` §2.1. Volontairement
 * restreint aux trois valeurs que ce badge sait représenter (`brouillon`/`emis`/`annule_par_avoir`) :
 * les six autres valeurs de `StatutDocumentVente` (`accepte`, `refuse`, `expire`, `remplace`,
 * `transforme`, `annule`, `abandonne`) appartiennent à la chaîne devis/bon de commande, hors
 * périmètre des cinq écrans facture/avoir de ce lot — un futur écran « fiche devis » ajoutera son
 * propre mapping plutôt que d'étendre celui-ci en silence.
 */
export type EtatDocumentAffichable = 'brouillon' | 'emis' | 'annule_par_avoir';

type TokenStatut = 'neutre' | 'terminal';

interface EntreeEtat {
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: 'plein' | 'contour';
}

const CONFIG_ETAT: Readonly<Record<EtatDocumentAffichable, EntreeEtat>> = {
  brouillon: { cle: 'brouillon', icone: PencilLine, token: 'neutre', forme: 'contour' },
  emis: { cle: 'emis', icone: Lock, token: 'terminal', forme: 'contour' },
  annule_par_avoir: { cle: 'annuleParAvoir', icone: Ban, token: 'neutre', forme: 'contour' },
};

const CLASSES_CONTOUR: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-statut-neutre bg-background text-statut-neutre',
  terminal: 'border-statut-terminal bg-background text-statut-terminal',
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
  const Icone = config.icone;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        CLASSES_CONTOUR[config.token],
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`facturation:document.etat.${config.cle}`)}
    </span>
  );
}
