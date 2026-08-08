import { useTranslation } from 'react-i18next';

import type { ResultatRecherche, StatutFournisseur } from '@dfa/shared';
import { STATUTS_FOURNISSEUR } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';

import { texteResume } from './resume';

export interface ProprietesResultatFournisseur {
  readonly resultat: ResultatRecherche;
}

function estStatutFournisseur(valeur: string | null): valeur is StatutFournisseur {
  return valeur !== null && (STATUTS_FOURNISSEUR as readonly string[]).includes(valeur);
}

// Même palette que `EcranListeFournisseurs.tsx` (`VARIANTE_BADGE_STATUT`).
const VARIANTE_BADGE_STATUT: Record<StatutFournisseur, 'default' | 'secondary'> = {
  actif: 'default',
  inactif: 'secondary',
};

/** Contenu d'une ligne de résultat « fournisseur ». Enveloppé dans un `CommandItem` par
 *  `PanneauResultatsRecherche` — même patron que `ResultatClient`/`ResultatOr`. */
export function ResultatFournisseur({ resultat }: ProprietesResultatFournisseur) {
  const { t } = useTranslation('pieces');

  const nom = texteResume(resultat.resume.nom) ?? '';
  const statut = texteResume(resultat.resume.statut);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className="texte-corps font-medium text-foreground">{nom}</span>
      {estStatutFournisseur(statut) ? (
        <Badge variant={VARIANTE_BADGE_STATUT[statut]}>
          {t(`pieces:fournisseurs.statuts.${statut}`)}
        </Badge>
      ) : null}
    </div>
  );
}
