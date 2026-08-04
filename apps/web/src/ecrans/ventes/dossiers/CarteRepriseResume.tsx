import { useTranslation } from 'react-i18next';

import type { RepriseResume } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { formaterMontant } from '@/lib/formats';

import { BadgeStatutReprise } from './BadgeStatutReprise';

interface Props {
  readonly reprise: RepriseResume | null;
}

/**
 * Résumé de la reprise (design §8, §11) — AFFICHAGE SEULEMENT. La négociation complète (`modifier`,
 * `negocier`, `confirmer`, `refuser`) est l'écran d'un autre agent (`ecrans/ventes/reprises/**`,
 * hors périmètre de celui-ci) : cette carte n'écrit rien, elle compose `dossier.reprise`
 * (`RepriseResume`, déjà embarqué en lecture sur `ReponseDossierVente`) sans requête séparée.
 *
 * Pas de lien « Voir/gérer la reprise » : aucune route n'est encore câblée pour cet écran tiers à
 * ce jour (le routage relève de la session principale) — un lien vers une route inexistante serait
 * pire que pas de lien du tout (doctrine `EcranFonctionAVenir`).
 *
 * RÈGLES DE RENDU REPRISES TELLES QUELLES DU DESIGN (§11, à ne jamais assouplir) :
 *  1. `valeurEstimeeCentimes` et `valeurNegocieeCentimes` sont TOUJOURS rendues ensemble.
 *  2. La valeur négociée porte l'emphase visuelle (le chiffre contractuel), l'estimée reste
 *     secondaire.
 *  3. L'écart se rend en vocabulaire NEUTRE (« écart / geste commercial »), jamais un token danger
 *     ni le mot « anomalie » — un écart positif est le cas normal (RV-20).
 *  4. AUCUNE base TVA, aucun montant de TVA lié à cet écart n'apparaît ici (§8.3, non tranché —
 *     QV-05).
 */
export function CarteRepriseResume({ reprise }: Props) {
  const { t } = useTranslation('ventes');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('ventes:reprise.titre')}</CardTitle>
      </CardHeader>
      <CardContent>
        {!reprise ? (
          // `ventes:reprise.absente` a été restructuré en objet `{ titre }` par l'agent i18n en
          // cours de livraison parallèle (constaté en exécution — un `t('ventes:reprise.absente')`
          // direct fait planter React : « Objects are not valid as a React child »). `.titre` est
          // la feuille correcte ; `ventes:reprise.aucuneReprise` (feuille restée stable, même texte
          // littéral que le design §8.1) reste un repli équivalent si cette clé bouge encore.
          <p className="texte-corps text-muted-foreground">{t('ventes:reprise.absente.titre')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <BadgeStatutReprise statut={reprise.statut} />
            </div>

            <IdentiteVehicule vehicule={reprise.vehiculeRepris} />

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 texte-corps">
              <dt className="text-muted-foreground">{t('ventes:reprise.valeurNegociee')}</dt>
              <dd className="flex items-center gap-2">
                <span className="texte-donnee-proeminente">
                  {reprise.valeurNegocieeCentimes !== null
                    ? formaterMontant(reprise.valeurNegocieeCentimes)
                    : t('ventes:reprise.enNegociation')}
                </span>
                {reprise.ecartRepriseVehiculeCentimes !== null ? (
                  <Badge variant="outline" className="tabular-nums">
                    {t('ventes:reprise.ecart', {
                      montant: `${reprise.ecartRepriseVehiculeCentimes >= 0 ? '+' : '−'}${formaterMontant(
                        Math.abs(reprise.ecartRepriseVehiculeCentimes),
                      )}`,
                    })}
                  </Badge>
                ) : null}
              </dd>

              <dt className="text-muted-foreground">{t('ventes:reprise.valeurEstimee')}</dt>
              <dd className="text-muted-foreground">
                {formaterMontant(reprise.valeurEstimeeCentimes)}
              </dd>
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
