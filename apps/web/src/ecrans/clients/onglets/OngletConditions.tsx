import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { ReponseClientCondition } from '@dfa/shared';

import { useConditionsClient } from '@/hooks/clients/useConditionsClient';
import { formaterDate, formaterMontant, formaterPourmille } from '@/lib/formats';

import { texteOuVide } from '../utils';
import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
}

/**
 * CORRECTIF issue #72 (rapport terrain réceptionniste) : « en face de Taux horaire, il est écrit
 * ATELIER — un mot, pas un prix », le code seul ne permettant pas d'expliquer une facture au
 * client. `tauxHoraireLibelle`/`tauxHoraireMontantCentimes` (`ReponseClientCondition`, @dfa/shared)
 * sont résolus par le serveur À LA DATE DE VALIDITÉ de cette condition, jamais recalculés ici.
 *
 * Replis, jamais de blanc : libellé + montant si les deux sont connus ; libellé seul si le montant
 * n'a pas pu être résolu (référentiel modifié depuis) ; à défaut, le CODE brut (cas d'un taux
 * retiré du référentiel) ; `—` seulement si aucun taux horaire n'est renseigné du tout.
 */
function renduTauxHoraire(condition: ReponseClientCondition, t: TFunction): string {
  if (condition.tauxHoraireLibelle) {
    return condition.tauxHoraireMontantCentimes != null
      ? t('clients:conditions.tauxHoraireDetail', {
          libelle: condition.tauxHoraireLibelle,
          montant: formaterMontant(condition.tauxHoraireMontantCentimes),
        })
      : condition.tauxHoraireLibelle;
  }
  return texteOuVide(condition.tauxHoraireCode);
}

/**
 * Onglet « Conditions commerciales » (RM-07, DATÉES) — lecture seule au lot 1 : le contrat
 * n'expose aucune action « ajouter » pour cette sous-collection (négociation commerciale, hors
 * saisie comptoir). `valideAuLe` absent = période ouverte, affiché via `texteOuVide`.
 */
export function OngletConditions({ clientId }: Props) {
  const { t } = useTranslation('clients');
  const requete = useConditionsClient(clientId);

  const lignes = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  return (
    <div className="space-y-3">
      <h3 className="texte-titre-section font-medium text-foreground">
        {t('clients:conditions.titre')}
      </h3>
      <EtatSousCollection
        enChargement={requete.isLoading}
        erreur={requete.error}
        onReessayer={() => void requete.refetch()}
        vide={lignes.length === 0}
        texteVide={t('clients:conditions.vide')}
      >
        {/* `divide-y` (filet seul entre lignes) — même motif que `PanneauTravauxReportes.tsx`
         *  (vehicules/), DESIGN.md « bordure structurelle uniquement ». */}
        <ul className="divide-y">
          {lignes.map((condition) => (
            <li key={condition.id} className="grid grid-cols-2 gap-x-4 gap-y-1 py-3 texte-corps">
              <span className="text-muted-foreground">{t('clients:conditions.rabaisMo')}</span>
              <span className="text-right tabular-nums">
                {formaterPourmille(condition.rabaisMoPourmille)}
              </span>
              <span className="text-muted-foreground">{t('clients:conditions.rabaisPieces')}</span>
              <span className="text-right tabular-nums">
                {formaterPourmille(condition.rabaisPiecesPourmille)}
              </span>
              <span className="text-muted-foreground">{t('clients:conditions.rabaisPneus')}</span>
              <span className="text-right tabular-nums">
                {formaterPourmille(condition.rabaisPneusPourmille)}
              </span>
              <span className="text-muted-foreground">{t('clients:conditions.tauxHoraire')}</span>
              <span className="text-right">{renduTauxHoraire(condition, t)}</span>
              <span className="text-muted-foreground">{t('clients:conditions.delaiPaiement')}</span>
              <span className="text-right tabular-nums">
                {texteOuVide(condition.delaiPaiementJours)}
              </span>
              <span className="text-muted-foreground">{t('clients:conditions.plafond')}</span>
              <span className="text-right tabular-nums">
                {condition.plafondCentimes === null
                  ? texteOuVide(null)
                  : formaterMontant(condition.plafondCentimes)}
              </span>
              <span className="text-muted-foreground">{t('clients:conditions.dateEffet')}</span>
              <span className="text-right tabular-nums">
                {formaterDate(condition.valideDuLe)}
                {condition.valideAuLe ? ` – ${formaterDate(condition.valideAuLe)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </EtatSousCollection>
    </div>
  );
}
