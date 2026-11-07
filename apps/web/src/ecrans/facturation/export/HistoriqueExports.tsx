import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import type { ExportHistorique } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { EtatVide } from '@/composants/commun/EtatVide';
import {
  useHistoriqueExports,
  useTelechargerFichierConserve,
} from '@/hooks/facturation/export-fiduciaire.hooks';
import { formaterDateHeure, formaterDate, formaterMontant } from '@/lib/formats';

import { enregistrerBlob } from './telechargement';

/** Les lots déjà générés : le fichier d'un lot récent est conservé et se re-télécharge. */
export function HistoriqueExports({ peutTelecharger }: { peutTelecharger: boolean }) {
  const { t } = useTranslation(['export', 'erreurs']);
  const liste = useHistoriqueExports();
  const fichier = useTelechargerFichierConserve();
  const [enCours, setEnCours] = useState<string | undefined>();
  const { resultat, elements } = liste;

  function retelecharger(lot: ExportHistorique) {
    setEnCours(lot.id);
    fichier.mutate(lot.id, {
      onSuccess: (blob) => enregistrerBlob(lot.nomFichier ?? `export-${lot.id}`, blob),
      onSettled: () => setEnCours(undefined),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('export:historique.titre')}</CardTitle>
        <CardDescription>{t('export:historique.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {resultat.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : resultat.isError ? (
          <Alert variant="destructive">
            <p className="font-medium">{t('export:historique.erreur')}</p>
            <p>{messageErreur(resultat.error, t)}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => void resultat.refetch()}
            >
              {t('export:erreur.reessayer')}
            </Button>
          </Alert>
        ) : elements.length === 0 ? (
          <EtatVide
            titre={t('export:historique.vide.titre')}
            description={t('export:historique.vide.description')}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('export:historique.colonnes.genereLe')}</TableHead>
                  <TableHead>{t('export:historique.colonnes.periode')}</TableHead>
                  <TableHead>{t('export:historique.colonnes.format')}</TableHead>
                  <TableHead className="text-right">
                    {t('export:historique.colonnes.ecritures')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('export:historique.colonnes.total')}
                  </TableHead>
                  <TableHead>{t('export:historique.colonnes.numeros')}</TableHead>
                  <TableHead>{t('export:historique.colonnes.auteur')}</TableHead>
                  <TableHead>{t('export:historique.colonnes.fichier')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {elements.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell>{formaterDateHeure(lot.genereLe)}</TableCell>
                    <TableCell>
                      {t('export:historique.periode', {
                        du: formaterDate(lot.periodeDu),
                        au: formaterDate(lot.periodeAu),
                      })}
                    </TableCell>
                    <TableCell>
                      {t(`export:format.${lot.cible}.nom`, { defaultValue: lot.cible })}
                    </TableCell>
                    <TableCell className="text-right">{lot.nbEcritures}</TableCell>
                    <TableCell className="text-right">
                      {lot.totalTtcCentimes === null
                        ? `CHF ${formaterMontant(lot.totalDebitCentimes)}`
                        : `CHF ${formaterMontant(lot.totalTtcCentimes)}`}
                    </TableCell>
                    <TableCell>
                      <Plages lot={lot} />
                    </TableCell>
                    <TableCell>
                      {lot.genereParNom ?? t('export:historique.auteurInconnu')}
                    </TableCell>
                    <TableCell>
                      {lot.fichierDisponible && peutTelecharger ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={enCours === lot.id}
                          onClick={() => retelecharger(lot)}
                        >
                          <Download aria-hidden className="mr-2 h-4 w-4" />
                          {t('export:historique.retelecharger')}
                        </Button>
                      ) : lot.fichierDisponible ? null : (
                        <span className="text-muted-foreground">
                          {t('export:historique.nonConserve')}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {fichier.isError ? (
              <Alert variant="destructive" role="alert">
                <p className="font-medium">{t('export:historique.erreurFichier')}</p>
                <p>{messageErreur(fichier.error, t)}</p>
              </Alert>
            ) : null}
            <BoutonChargerPlus
              aChargerPlus={resultat.hasNextPage}
              enChargement={resultat.isFetchingNextPage}
              onChargerPlus={() => void resultat.fetchNextPage()}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Plages({ lot }: { lot: ExportHistorique }) {
  const { t } = useTranslation(['export']);
  const { factures, avoirs } = lot.plageNumeros;
  if (!factures && !avoirs) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      {factures ? (
        <div>
          {t('export:resultat.plage', { premier: factures.premier, dernier: factures.dernier })}
        </div>
      ) : null}
      {avoirs ? (
        <div>
          {t('export:resultat.plage', { premier: avoirs.premier, dernier: avoirs.dernier })}
        </div>
      ) : null}
    </div>
  );
}
