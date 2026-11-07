import { useTranslation } from 'react-i18next';

import type { ApercuExport } from '@dfa/shared';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { messageErreur } from '@/api/erreurs';
import { formaterMontant } from '@/lib/formats';

import { ListePrerequis } from './ListePrerequis';

interface Props {
  readonly apercu: ApercuExport | undefined;
  readonly enChargement: boolean;
  readonly erreur: unknown;
  readonly onReessayer: () => void;
  readonly onReglerComptes?: () => void;
}

/** Ce que le fichier contiendrait pour la période : lu avant de cliquer sur Télécharger. */
export function ApercuPeriode({
  apercu,
  enChargement,
  erreur,
  onReessayer,
  onReglerComptes,
}: Props) {
  const { t } = useTranslation(['export', 'erreurs']);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('export:apercu.titre')}</CardTitle>
        <CardDescription>{t('export:apercu.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" aria-live="polite">
        {enChargement ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-56" />
          </div>
        ) : erreur ? (
          <Alert variant="destructive">
            <p className="font-medium">{t('export:apercu.erreur')}</p>
            <p>{messageErreur(erreur, t)}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={onReessayer}>
              {t('export:erreur.reessayer')}
            </Button>
          </Alert>
        ) : apercu ? (
          <Contenu apercu={apercu} onReglerComptes={onReglerComptes} />
        ) : (
          <p className="text-muted-foreground">{t('export:apercu.periodeRequise')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Contenu({
  apercu,
  onReglerComptes,
}: {
  apercu: ApercuExport;
  onReglerComptes?: () => void;
}) {
  const { t } = useTranslation(['export']);
  const { documents, encaissements, totaux, plageNumeros } = apercu;
  const plage = (p: { premier: string; dernier: string } | null) =>
    p
      ? t('export:resultat.plage', { premier: p.premier, dernier: p.dernier })
      : t('export:apercu.aucun');

  return (
    <>
      {!apercu.aQuelqueChoseAExporter ? (
        <div className="rounded-md bg-muted p-3">
          <p className="font-medium">{t('export:vide.titre')}</p>
          <p className="text-muted-foreground">{t('export:vide.description')}</p>
        </div>
      ) : null}

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Ligne
          libelle={t('export:apercu.facturesAExporter')}
          valeur={String(documents.nbFactures)}
        />
        <Ligne libelle={t('export:apercu.avoirsAExporter')} valeur={String(documents.nbAvoirs)} />
        <Ligne
          libelle={t('export:apercu.encaissementsAExporter')}
          valeur={String(encaissements.aExporter)}
        />
        <Ligne
          libelle={t('export:apercu.dejaExportes')}
          valeur={t('export:apercu.dejaExportesValeur', {
            documents: documents.dejaExportes,
            encaissements: encaissements.dejaExportes,
          })}
        />
        <Ligne
          libelle={t('export:apercu.totalHt')}
          valeur={`CHF ${formaterMontant(totaux.htCentimes)}`}
        />
        <Ligne
          libelle={t('export:apercu.totalTva')}
          valeur={`CHF ${formaterMontant(totaux.tvaCentimes)}`}
        />
        <Ligne
          libelle={t('export:apercu.totalTtc')}
          valeur={`CHF ${formaterMontant(totaux.ttcCentimes)}`}
        />
        <Ligne
          libelle={t('export:resultat.numerosFactures')}
          valeur={plage(plageNumeros.factures)}
        />
        <Ligne libelle={t('export:resultat.numerosAvoirs')} valeur={plage(plageNumeros.avoirs)} />
      </dl>

      {apercu.prerequis.length > 0 ? (
        <ListePrerequis prerequis={apercu.prerequis} onReglerComptes={onReglerComptes} />
      ) : null}
    </>
  );
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{libelle}</dt>
      <dd className="font-medium">{valeur}</dd>
    </div>
  );
}
