import { useTranslation } from 'react-i18next';

import type { FinancementResume } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { BadgeStatutFinancement } from './BadgeStatutFinancement';

interface Props {
  readonly financementCourant: FinancementResume | null;
  readonly financements: readonly FinancementResume[];
  readonly financementsTronques: boolean;
}

/** `TypeFinancementVente` -> suffixe camelCase de `ventes:financement.types` — mapping trivial ici
 *  (les trois valeurs sont déjà des mots simples), gardé explicite comme partout ailleurs. */
const CLES_TYPE: Record<FinancementResume['type'], string> = {
  comptant: 'comptant',
  credit: 'credit',
  leasing: 'leasing',
};

/**
 * Résumé du financement (design §9) — AFFICHAGE SEULEMENT, même doctrine que
 * `CarteRepriseResume` : la proposition/confirmation/refus d'un financement est l'écran d'un autre
 * agent (module financement, hors périmètre de celui-ci) ; cette carte compose
 * `dossier.financement`/`dossier.financements` (déjà embarqués en lecture), sans requête séparée
 * ni action.
 *
 * `CV-03` : l'historique reste visible même après refus — un refus n'écrase jamais l'ancien
 * enregistrement, un nouveau financement s'ouvre à côté (§9.2 du design).
 */
export function CarteFinancementResume({
  financementCourant,
  financements,
  financementsTronques,
}: Props) {
  const { t } = useTranslation('ventes');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('ventes:financement.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!financementCourant ? (
          <p className="texte-corps text-muted-foreground">{t('ventes:financement.absent')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t('ventes:financement.actuel')}</Badge>
            <span className="texte-corps font-medium text-foreground">
              {t(`ventes:financement.types.${CLES_TYPE[financementCourant.type]}`)}
            </span>
            {financementCourant.organisme ? (
              <span className="texte-corps text-muted-foreground">
                {financementCourant.organisme.nomAffiche}
              </span>
            ) : null}
            <BadgeStatutFinancement statut={financementCourant.statutConfirmation} />
          </div>
        )}

        {financements.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            {/* `ventes:financement.historique` a été restructuré en objet `{ titre, vide }` par
             *  l'agent i18n en cours de livraison parallèle (même bug constaté en exécution que
             *  `ventes:reprise.absente`, voir `CarteRepriseResume.tsx`) — `.titre` est la feuille
             *  correcte. */}
            <h3 className="texte-libelle font-medium text-foreground">
              {t('ventes:financement.historique.titre')}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {financements
                .filter((f) => f.id !== financementCourant?.id)
                .map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 texte-corps">
                    <span>{t(`ventes:financement.types.${CLES_TYPE[f.type]}`)}</span>
                    {f.organisme ? (
                      <span className="text-muted-foreground">{f.organisme.nomAffiche}</span>
                    ) : null}
                    <BadgeStatutFinancement statut={f.statutConfirmation} />
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        {financementsTronques ? (
          <p className="texte-libelle text-muted-foreground">{t('ventes:financement.tronque')}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
