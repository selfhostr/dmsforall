import { useTranslation } from 'react-i18next';

import type { DeviseFacturation, ReponsePaiement } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useListePaiementsDocument } from '@/hooks/facturation/useListePaiementsDocument';
import { formaterDate, formaterMontant } from '@/lib/formats';

interface Props {
  readonly documentId: string;
  readonly montantRegleCentimes: number;
  readonly soldeCentimes: number;
  readonly devise: DeviseFacturation;
}

/** Part de CE paiement qui règle CE document (imputations `reglement`, hors arrondi). Un paiement
 *  remboursé ou contre-passé porte un montant négatif : il apparaît tel quel, en négatif. */
export function montantImputeAuDocument(paiement: ReponsePaiement, documentId: string): number {
  return paiement.imputations
    .filter(
      (imputation) => imputation.documentId === documentId && imputation.nature === 'reglement',
    )
    .reduce((somme, imputation) => somme + imputation.montantCentimes, 0);
}

/**
 * Carte « Paiements » de la fiche facture : payé, solde restant, et chaque paiement imputé (date,
 * moyen, montant). Aucune action d'annulation ici : l'API n'en expose pas (un paiement est
 * immuable, MD-52) — une facture réglée se corrige par un avoir.
 */
export function CartePaiementsFacture({
  documentId,
  montantRegleCentimes,
  soldeCentimes,
  devise,
}: Props) {
  const { t } = useTranslation(['facturation', 'commun']);
  const paiements = useListePaiementsDocument(documentId);
  const formater = (centimes: number) =>
    devise === 'CHF' ? formaterMontant(centimes) : `${formaterMontant(centimes)} ${devise}`;

  return (
    <Card data-testid="carte-paiements-facture">
      <CardHeader>
        <CardTitle className="texte-titre-section">
          {t('facturation:fiche.paiements.titre')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 texte-corps">
          <dt className="text-muted-foreground">{t('facturation:fiche.paiements.paye')}</dt>
          <dd className="text-right texte-montant">{formater(montantRegleCentimes)}</dd>
          <dt className="text-muted-foreground">{t('facturation:fiche.paiements.solde')}</dt>
          <dd className="text-right texte-montant font-medium">{formater(soldeCentimes)}</dd>
        </dl>
        {paiements.isPending ? (
          <p className="texte-libelle text-muted-foreground">{t('commun:chargement.enCours')}</p>
        ) : paiements.isError ? (
          <p role="alert" className="texte-libelle text-destructive">
            {t('facturation:fiche.paiements.erreur')}
          </p>
        ) : paiements.data.length === 0 ? (
          <p className="texte-libelle text-muted-foreground">
            {t('facturation:fiche.paiements.aucun')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {paiements.data.map((paiement) => (
              <li key={paiement.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex flex-col">
                  <span className="texte-corps">
                    {t(`facturation:moyensPaiement.${paiement.moyen}`)}
                  </span>
                  <span className="texte-libelle text-muted-foreground">
                    {formaterDate(paiement.dateValeur)}
                  </span>
                </span>
                <span className="texte-montant texte-corps">
                  {formater(montantImputeAuDocument(paiement, documentId))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="texte-libelle text-muted-foreground">
          {t('facturation:fiche.paiements.correctionParAvoir')}
        </p>
      </CardContent>
    </Card>
  );
}
