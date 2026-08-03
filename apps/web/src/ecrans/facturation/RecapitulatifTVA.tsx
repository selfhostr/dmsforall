import { useTranslation } from 'react-i18next';

import type { DocumentVenteTva } from '@dfa/shared';

import { formaterMontant, formaterPourmille } from '@/lib/formats';
import { cn } from '@/lib/utils';

interface Props {
  readonly ventilationTva: readonly DocumentVenteTva[] | undefined;
  readonly totalTtcCentimes: number | undefined;
  readonly className?: string;
}

/**
 * `RecapitulatifTVA` — **seul endroit du produit où le HT est affiché en primaire** (§4.1, §6.1,
 * §8 du design). Ne jamais réutiliser ce composant hors d'un pied de facture/avoir : le HT n'existe
 * nulle part ailleurs à l'écran (`RF-6`).
 *
 * Absent en bloc (rendu `null`) pour un rôle sans droit aux montants — `ventilationTva` et
 * `totalTtcCentimes` sont alors tous deux `undefined` côté serveur, jamais substitués par des
 * zéros qui laisseraient croire à un document sans TVA.
 */
export function RecapitulatifTVA({ ventilationTva, totalTtcCentimes, className }: Props) {
  const { t } = useTranslation('facturation');

  if (ventilationTva === undefined || totalTtcCentimes === undefined) return null;

  return (
    <div className={cn('flex flex-col gap-2 rounded-md border p-3', className)}>
      <h2 className="texte-libelle font-medium text-foreground">
        {t('facturation:recapTva.titre')}
      </h2>
      {ventilationTva.length > 0 ? (
        <table className="w-full texte-libelle">
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="text-left font-normal">
                {t('facturation:recapTva.colonnes.taux')}
              </th>
              <th scope="col" className="text-right font-normal">
                {t('facturation:recapTva.colonnes.base')}
              </th>
              <th scope="col" className="text-right font-normal">
                {t('facturation:recapTva.colonnes.tva')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ventilationTva.map((ligne) => (
              <tr key={`${ligne.regimeTva}-${ligne.tauxTvaPourmille}`}>
                <td className="tabular-nums">{formaterPourmille(ligne.tauxTvaPourmille)}</td>
                <td className="text-right tabular-nums">{formaterMontant(ligne.baseCentimes)}</td>
                <td className="text-right tabular-nums">{formaterMontant(ligne.tvaCentimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="flex items-center justify-between border-t pt-2">
        <span className="texte-corps font-semibold text-foreground">
          {t('facturation:recapTva.totalGeneral')}
        </span>
        <span className="tabular-nums texte-corps font-semibold text-foreground">
          {formaterMontant(totalTtcCentimes)}
        </span>
      </div>
    </div>
  );
}
