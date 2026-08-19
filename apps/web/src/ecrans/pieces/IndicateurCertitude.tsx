import { Check, CircleDashed, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { CertitudeValeurFacture } from './utils-factures-fournisseur';

interface Props {
  readonly certitude: CertitudeValeurFacture;
  readonly className?: string;
}

/**
 * Marqueur de certitude d'une valeur LUE sur une facture fournisseur — TROIS ÉTATS DISTINCTS,
 * jamais confondus (brief), même doctrine que `ecrans/scan/ChampConfiance.tsx` (le problème est
 * identique : une valeur reconnue automatiquement, avec ou sans garantie). ICÔNE + MOT, jamais la
 * seule couleur : un magasinier daltonien doit voir la distinction aussi bien qu'un autre.
 *
 * AUCUN TOKEN `--statut-*` NI `--avertissement` — même raisonnement que `ChampConfiance` : ce
 * marqueur n'est pas un statut d'OR/de ligne, et n'est pas non plus un écart (réservé à
 * `PastilleEcart.tsx`, qui LUI utilise `--avertissement`). Neutre (`foreground`/`muted-foreground`),
 * différencié par l'icône et le poids de texte.
 */
export function IndicateurCertitude({ certitude, className }: Props) {
  const { t } = useTranslation('pieces');

  const config: Record<
    CertitudeValeurFacture,
    { readonly icone: typeof Check; readonly cle: string }
  > = {
    certaine: { icone: Check, cle: 'pieces:facturesFournisseur.certitude.certaine' },
    incertaine: { icone: TriangleAlert, cle: 'pieces:facturesFournisseur.certitude.incertaine' },
    absente: { icone: CircleDashed, cle: 'pieces:facturesFournisseur.certitude.absente' },
  };
  const Icone = config[certitude].icone;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 texte-libelle font-normal text-muted-foreground',
        certitude === 'incertaine' && 'font-semibold text-foreground',
        className,
      )}
    >
      <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(config[certitude].cle)}
    </span>
  );
}
