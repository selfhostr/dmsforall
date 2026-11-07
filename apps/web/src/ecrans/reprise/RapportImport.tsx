import { useTranslation } from 'react-i18next';

import type { RapportImportReprise } from '@dfa/shared';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">
                  {t('reprise:rapport.reconciliation.colonneAnnee')}
                </TableHead>
                <TableHead scope="col">
                  {t('reprise:rapport.reconciliation.documentsSource')}
                </TableHead>
                <TableHead scope="col">
                  {t('reprise:rapport.reconciliation.documentsCible')}
                </TableHead>
                <TableHead scope="col">{t('reprise:rapport.reconciliation.totalSource')}</TableHead>
                <TableHead scope="col">{t('reprise:rapport.reconciliation.totalCible')}</TableHead>
                <TableHead scope="col">{t('reprise:rapport.reconciliation.ecart')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rapport.reconciliation.map((ligne) => (
                <TableRow key={ligne.annee}>
                  <TableHead scope="row" className="font-normal tabular-nums">
                    <span className="sr-only">
                      {t('reprise:rapport.reconciliation.annee', { annee: ligne.annee })}
                    </span>
                    <span aria-hidden="true">{ligne.annee}</span>
                  </TableHead>
                  <TableCell className="tabular-nums">{ligne.nombreDocumentsSource}</TableCell>
                  <TableCell className="tabular-nums">{ligne.nombreDocumentsCible}</TableCell>
                  <TableCell className="tabular-nums">
                    {formaterMontant(ligne.totalCentimesSource)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formaterMontant(ligne.totalCentimesCible)}
                  </TableCell>
                  <TableCell
                    className={
                      ligne.ecartCentimes === 0
                        ? 'tabular-nums text-muted-foreground'
                        : 'tabular-nums font-medium text-destructive'
                    }
                  >
                    {ligne.ecartCentimes === 0
                      ? t('reprise:rapport.reconciliation.ecartNul')
                      : formaterMontant(ligne.ecartCentimes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {t('reprise:rapport.genereLe', { date: formaterDate(rapport.genereLe) })}
      </p>
    </div>
  );
}
