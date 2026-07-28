import { useTranslation } from 'react-i18next';

import { useConditionsClient } from '@/hooks/clients/useConditionsClient';
import { formaterDate, formaterMontant, formaterPourmille } from '@/lib/formats';

import { texteOuVide } from '../utils';
import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
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
      <h3 className="texte-titre-section font-medium text-foreground">{t('clients:conditions.titre')}</h3>
      <EtatSousCollection
        enChargement={requete.isLoading}
        erreur={requete.error}
        onReessayer={() => void requete.refetch()}
        vide={lignes.length === 0}
        texteVide={t('clients:conditions.vide')}
      >
        <ul className="space-y-2">
          {lignes.map((condition) => (
            <li key={condition.id} className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 texte-corps">
              <span className="text-muted-foreground">{t('clients:conditions.rabaisMo')}</span>
              <span className="text-right tabular-nums">{formaterPourmille(condition.rabaisMoPourmille)}</span>
              <span className="text-muted-foreground">{t('clients:conditions.rabaisPieces')}</span>
              <span className="text-right tabular-nums">{formaterPourmille(condition.rabaisPiecesPourmille)}</span>
              <span className="text-muted-foreground">{t('clients:conditions.rabaisPneus')}</span>
              <span className="text-right tabular-nums">{formaterPourmille(condition.rabaisPneusPourmille)}</span>
              <span className="text-muted-foreground">{t('clients:conditions.tauxHoraire')}</span>
              <span className="text-right">{texteOuVide(condition.tauxHoraireCode)}</span>
              <span className="text-muted-foreground">{t('clients:conditions.delaiPaiement')}</span>
              <span className="text-right tabular-nums">{texteOuVide(condition.delaiPaiementJours)}</span>
              <span className="text-muted-foreground">{t('clients:conditions.plafond')}</span>
              <span className="text-right tabular-nums">
                {condition.plafondCentimes === null ? texteOuVide(null) : formaterMontant(condition.plafondCentimes)}
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
