import { useTranslation } from 'react-i18next';

import type { DeviseFacturation, DocumentVenteTva } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formaterMontant, formaterMontantAvecDevise, formaterPourmille } from '@/lib/formats';

interface Props {
  readonly ventilationTva: readonly DocumentVenteTva[] | undefined;
  readonly totalTtcCentimes: number | undefined;
  /** Devise du document (`ReponseDocumentVente.devise`, migration `0015`) — toujours fournie par
   *  l'appelant (elle voyage sur CHAQUE document, y compris pour un rôle sans droit aux montants,
   *  contrairement à `ventilationTva`/`totalTtcCentimes`). Affichée UNIQUEMENT sur le total général
   *  ci-dessous : les lignes « Base HT »/« TVA » par taux partagent nécessairement cette même devise,
   *  la répéter sur chacune serait du bruit sans information nouvelle. */
  readonly devise: DeviseFacturation;
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
export function RecapitulatifTVA({ ventilationTva, totalTtcCentimes, devise, className }: Props) {
  const { t } = useTranslation('facturation');

  if (ventilationTva === undefined || totalTtcCentimes === undefined) return null;

  return (
    // DESIGN.md « bordure structurelle uniquement » — l'ancien `rounded-md border p-3` ne
    // délimitait qu'un groupe de contenu (titre + tableau), jamais une zone d'action réelle : `Card`
    // (surface `bg-card`, sans contour ni ombre) reprend le même rôle de séparation par le
    // mécanisme sanctionné par le socle, cohérent avec la Card « Documents liés » juste en dessous
    // dans la même colonne plutôt qu'un habillage ad hoc différent d'elle.
    <Card className={className}>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('facturation:recapTva.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
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
            {formaterMontantAvecDevise(totalTtcCentimes, devise)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
