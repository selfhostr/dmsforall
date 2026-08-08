import { useTranslation } from 'react-i18next';

import type { ResultatRecherche, StatutArticle } from '@dfa/shared';
import { STATUTS_ARTICLE } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';

import { texteResume } from './resume';

export interface ProprietesResultatArticle {
  readonly resultat: ResultatRecherche;
}

function estStatutArticle(valeur: string | null): valeur is StatutArticle {
  return valeur !== null && (STATUTS_ARTICLE as readonly string[]).includes(valeur);
}

// Même palette que `EcranListeArticles.tsx` (`VARIANTE_BADGE_STATUT`) — la recherche globale ne
// réinvente pas un second vocabulaire visuel pour la même distinction de statut.
const VARIANTE_BADGE_STATUT: Record<StatutArticle, 'default' | 'secondary' | 'outline'> = {
  actif: 'default',
  obsolete: 'secondary',
  desactive: 'outline',
};

/** Contenu d'une ligne de résultat « article » (pièce). Enveloppé dans un `CommandItem` par
 *  `PanneauResultatsRecherche` — même patron que `ResultatClient`/`ResultatOr`. */
export function ResultatArticle({ resultat }: ProprietesResultatArticle) {
  const { t } = useTranslation('pieces');

  const designation = texteResume(resultat.resume.designation) ?? '';
  const numeroArticle = texteResume(resultat.resume.numeroArticle);
  const referencePrincipale = texteResume(resultat.resume.referencePrincipale);
  const statut = texteResume(resultat.resume.statut);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className="texte-corps font-medium text-foreground">{designation}</span>
      {numeroArticle ? (
        <span className="texte-libelle text-muted-foreground">
          {t('pieces:articles.numero', { numero: numeroArticle })}
        </span>
      ) : null}
      {referencePrincipale ? (
        <span className="texte-libelle text-muted-foreground">{referencePrincipale}</span>
      ) : null}
      {estStatutArticle(statut) ? (
        <Badge variant={VARIANTE_BADGE_STATUT[statut]}>
          {t(`pieces:articles.statuts.${statut}`)}
        </Badge>
      ) : null}
    </div>
  );
}
