import { useTranslation } from 'react-i18next';

import type { RapportImportReprise } from '@dfa/shared';

import { formaterDate, formaterMontant } from '@/lib/formats';

import { cleI18nDomaine } from './libelles-domaine';

interface Props {
  readonly rapport: RapportImportReprise;
}

/**
 * Bilan de la reprise — LA pièce qui rassure le garagiste que rien ne s'est perdu (mission).
 * Réconciliation chiffrée par année : montants en CENTIMES depuis l'API, jamais un flottant
 * (`formaterMontant`, format suisse `1'234.50`). Lisible dès que l'import a démarré, pas
 * seulement une fois terminé — `EtapeImport` le monte pour `en_cours`/`termine`/`echoue`.
 */
export function RapportImport({ rapport }: Props) {
  const { t } = useTranslation('reprise');

  return (
    <div className="flex flex-col gap-groupe">
      <h3 className="texte-titre-section">{t('reprise:rapport.titre')}</h3>

      <div className="grid grid-cols-1 gap-groupe sm:grid-cols-2">
        <div className="rounded-lg border p-carte">
          <p className="mb-2 font-medium">{t('reprise:rapport.insere.titre')}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {rapport.insere.map((entree, index) => (
              <li
                key={`${entree.elementPlanId}-${index}`}
                className="flex justify-between gap-champ"
              >
                <span>{t(cleI18nDomaine(entree.domaine))}</span>
                <span className="tabular-nums">
                  {t('reprise:rapport.insere.compte', { count: entree.nombre })}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border p-carte">
          <p className="mb-2 font-medium">{t('reprise:rapport.ecarte.titre')}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {rapport.ecarte.map((entree, index) => (
              <li
                key={`${entree.elementPlanId}-${entree.motif}-${index}`}
                className="flex justify-between gap-champ"
              >
                <span>
                  {t(cleI18nDomaine(entree.domaine))} —{' '}
                  {t(`reprise:rapport.ecarte.motif.${entree.motif}`)}
                </span>
                <span className="tabular-nums">
                  {t('reprise:rapport.ecarte.compte', { count: entree.nombre })}
                </span>
              </li>
            ))}
          </ul>
          {rapport.anomaliesTronquees ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('reprise:rapport.anomaliesTronquees')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border p-carte">
        <p className="font-medium">{t('reprise:rapport.reconciliation.titre')}</p>
        <p className="mb-2 text-sm text-muted-foreground">
          {t('reprise:rapport.reconciliation.description')}
        </p>
        {rapport.reconciliation.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('reprise:rapport.reconciliation.vide')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-groupe">
                    {t('reprise:rapport.reconciliation.colonneAnnee')}
                  </th>
                  <th scope="col" className="py-1 pr-groupe">
                    {t('reprise:rapport.reconciliation.documentsSource')}
                  </th>
                  <th scope="col" className="py-1 pr-groupe">
                    {t('reprise:rapport.reconciliation.documentsCible')}
                  </th>
                  <th scope="col" className="py-1 pr-groupe">
                    {t('reprise:rapport.reconciliation.totalSource')}
                  </th>
                  <th scope="col" className="py-1 pr-groupe">
                    {t('reprise:rapport.reconciliation.totalCible')}
                  </th>
                  <th scope="col" className="py-1">
                    {t('reprise:rapport.reconciliation.ecart')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rapport.reconciliation.map((ligne) => (
                  <tr key={ligne.annee} className="border-b last:border-0">
                    <th scope="row" className="py-1 pr-groupe text-left font-normal tabular-nums">
                      <span className="sr-only">
                        {t('reprise:rapport.reconciliation.annee', { annee: ligne.annee })}
                      </span>
                      <span aria-hidden="true">{ligne.annee}</span>
                    </th>
                    <td className="py-1 pr-groupe tabular-nums">{ligne.nombreDocumentsSource}</td>
                    <td className="py-1 pr-groupe tabular-nums">{ligne.nombreDocumentsCible}</td>
                    <td className="py-1 pr-groupe tabular-nums">
                      {formaterMontant(ligne.totalCentimesSource)}
                    </td>
                    <td className="py-1 pr-groupe tabular-nums">
                      {formaterMontant(ligne.totalCentimesCible)}
                    </td>
                    <td
                      className={
                        ligne.ecartCentimes === 0
                          ? 'py-1 tabular-nums text-muted-foreground'
                          : 'py-1 tabular-nums font-medium text-destructive'
                      }
                    >
                      {ligne.ecartCentimes === 0
                        ? t('reprise:rapport.reconciliation.ecartNul')
                        : formaterMontant(ligne.ecartCentimes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {t('reprise:rapport.genereLe', { date: formaterDate(rapport.genereLe) })}
      </p>
    </div>
  );
}
