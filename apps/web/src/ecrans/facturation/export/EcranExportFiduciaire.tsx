import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText } from 'lucide-react';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { EtatVide } from '@/composants/commun/EtatVide';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import type {
  LotExportFiduciaire,
  ReponseExportFiduciaire,
} from '@/hooks/facturation/export-fiduciaire.api';
import { useExportFiduciaire } from '@/hooks/facturation/useExportFiduciaire';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterMontant } from '@/lib/formats';

import { peutExporterVersFiduciaire } from './droits';
import {
  periodeMoisPrecedent,
  periodeTrimestrePrecedent,
  validerPeriode,
  type ModePeriode,
} from './periode';
import { telechargerFichier } from './telechargement';

const MODES: readonly ModePeriode[] = ['moisPrecedent', 'trimestrePrecedent', 'personnalisee'];

/** Codes d'erreur qui sont des PRÉREQUIS ou des limites connues, pas des pannes : message dédié. */
const CODES_PREREQUIS = [
  'EXPORT_MAPPING_INCOMPLET',
  'EXPORT_TROU_NUMEROTATION',
  'EXPORT_ECRITURES_DESEQUILIBREES',
  'FONCTION_NON_DISPONIBLE',
] as const;

/**
 * Export fiduciaire — le geste mensuel du patron : choisir la période, télécharger le fichier
 * pour la fiduciaire. L'API n'offre aujourd'hui que `POST /exports-fiduciaires` (WinBIZ, écritures
 * détaillées) : ni aperçu, ni historique des lots, ni autre format. L'écran ne promet que cela.
 * Le fichier n'est PAS conservé côté serveur : le résultat reste affiché ici pour pouvoir le
 * télécharger de nouveau tant que la page est ouverte.
 */
export function EcranExportFiduciaire() {
  const { t } = useTranslation(['export', 'commun', 'erreurs']);
  const { data: session, isPending: sessionEnCours } = useSession();
  const peutExporter = peutExporterVersFiduciaire(session?.utilisateur.role);

  const [mode, setMode] = useState<ModePeriode>('moisPrecedent');
  const [maintenant] = useState(() => new Date());
  const [duPerso, setDuPerso] = useState<string | undefined>();
  const [auPerso, setAuPerso] = useState<string | undefined>();
  const [confirmation, setConfirmation] = useState(false);
  const exportation = useExportFiduciaire();

  const periode =
    mode === 'moisPrecedent'
      ? periodeMoisPrecedent(maintenant)
      : mode === 'trimestrePrecedent'
        ? periodeTrimestrePrecedent(maintenant)
        : { du: duPerso, au: auPerso };
  const validation = validerPeriode(periode.du, periode.au);

  function lancer() {
    if (validation !== 'ok' || !periode.du || !periode.au) return;
    setConfirmation(false);
    exportation.mutate(
      { cible: 'winbiz', granularite: 'detaille', periodeDu: periode.du, periodeAu: periode.au },
      {
        onSuccess: (reponse) => {
          const lot = reponse.donnees.lots[0];
          if (lot) telecharger(lot);
        },
      },
    );
  }

  return (
    <GabaritEcran titre={t('export:titre')} sousTitre={t('export:sousTitre')}>
      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('export:format.titre')}</CardTitle>
          <CardDescription>{t('export:format.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-md bg-muted p-3">
            <FileText aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">{t('export:format.winbiz.nom')}</p>
              <p className="text-muted-foreground">{t('export:format.winbiz.phrase')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('export:periode.titre')}</CardTitle>
          <CardDescription>{t('export:periode.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t('export:periode.titre')}</legend>
            {MODES.map((m) => (
              <label
                key={m}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 has-[:checked]:bg-marque-doux has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="mode-periode"
                  className="accent-primary"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {t(`export:periode.modes.${m}`)}
              </label>
            ))}
          </fieldset>

          {mode === 'personnalisee' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="export-du">{t('export:periode.du')}</Label>
                <DateInput id="export-du" value={duPerso} onChange={setDuPerso} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="export-au">{t('export:periode.au')}</Label>
                <DateInput id="export-au" value={auPerso} onChange={setAuPerso} />
              </div>
            </div>
          ) : null}

          {validation === 'ok' && periode.du && periode.au ? (
            <p>
              {t('export:periode.resume', {
                du: formaterDate(periode.du),
                au: formaterDate(periode.au),
              })}
            </p>
          ) : null}
          {mode === 'personnalisee' && validation === 'inversee' ? (
            <p role="alert" className="text-destructive">
              {t('export:periode.inversee')}
            </p>
          ) : null}

          <p className="text-muted-foreground">{t('export:perimetre')}</p>
        </CardContent>
      </Card>

      {sessionEnCours ? (
        <Skeleton className="h-11 w-40" />
      ) : peutExporter ? (
        <div>
          <Button
            type="button"
            disabled={validation !== 'ok' || exportation.isPending}
            onClick={() => setConfirmation(true)}
          >
            <Download aria-hidden className="mr-2 h-4 w-4" />
            {exportation.isPending ? t('export:action.encours') : t('export:action.telecharger')}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">{t('export:droits.refuse')}</p>
      )}

      {exportation.isError ? <BlocErreur erreur={exportation.error} onReessayer={lancer} /> : null}
      {exportation.data ? <BlocResultat reponse={exportation.data} /> : null}

      <Dialog open={confirmation} onOpenChange={setConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('export:confirmation.titre')}</DialogTitle>
            <DialogDescription>
              {validation === 'ok' && periode.du && periode.au
                ? t('export:confirmation.description', {
                    du: formaterDate(periode.du),
                    au: formaterDate(periode.au),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmation(false)}>
              {t('commun:actions.annuler')}
            </Button>
            <Button type="button" onClick={lancer}>
              {t('export:confirmation.valider')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GabaritEcran>
  );
}

function telecharger(lot: LotExportFiduciaire): void {
  telechargerFichier(lot.nomFichier, lot.contenuBase64, 'text/csv;charset=utf-8');
}

function BlocErreur({ erreur, onReessayer }: { erreur: unknown; onReessayer: () => void }) {
  const { t } = useTranslation(['export', 'erreurs']);
  const code = erreur instanceof ErreurApi ? erreur.probleme.code : undefined;
  const prerequis = CODES_PREREQUIS.find((c) => c === code);

  if (prerequis) {
    return (
      <Alert variant="avertissement">
        <p className="font-medium">{t(`export:prerequis.${prerequis}.titre`)}</p>
        <p>{t(`export:prerequis.${prerequis}.description`)}</p>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <p className="font-medium">{t('export:erreur.titre')}</p>
      <p>{messageErreur(erreur, t)}</p>
      <Button type="button" variant="outline" className="mt-3" onClick={onReessayer}>
        {t('export:erreur.reessayer')}
      </Button>
    </Alert>
  );
}

function BlocResultat({ reponse }: { reponse: ReponseExportFiduciaire }) {
  const { t } = useTranslation(['export']);
  const { lots, documentsExportes, paiementsExportes } = reponse.donnees;
  const lot = lots[0];

  if (!lot) {
    return <EtatVide titre={t('export:vide.titre')} description={t('export:vide.description')} />;
  }

  const nbFactures = documentsExportes.filter((d) => d.typeDocument === 'facture').length;
  const nbAvoirs = documentsExportes.filter((d) => d.typeDocument === 'avoir').length;
  const plageFactures = plage(documentsExportes.filter((d) => d.typeDocument === 'facture'));
  const plageAvoirs = plage(documentsExportes.filter((d) => d.typeDocument === 'avoir'));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('export:resultat.titre')}</CardTitle>
        <CardDescription>{t('export:resultat.fichierNonConserve')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Ligne libelle={t('export:resultat.factures')} valeur={String(nbFactures)} />
          <Ligne libelle={t('export:resultat.avoirs')} valeur={String(nbAvoirs)} />
          <Ligne
            libelle={t('export:resultat.encaissements')}
            valeur={String(paiementsExportes.length)}
          />
          <Ligne libelle={t('export:resultat.ecritures')} valeur={String(lot.nbEcritures)} />
          <Ligne
            libelle={t('export:resultat.total')}
            valeur={`CHF ${formaterMontant(Number(lot.totalDebitCentimes))}`}
          />
          {plageFactures ? (
            <Ligne
              libelle={t('export:resultat.numerosFactures')}
              valeur={t('export:resultat.plage', plageFactures)}
            />
          ) : null}
          {plageAvoirs ? (
            <Ligne
              libelle={t('export:resultat.numerosAvoirs')}
              valeur={t('export:resultat.plage', plageAvoirs)}
            />
          ) : null}
        </dl>

        {lot.avertissements.length > 0 ? (
          <Alert variant="avertissement">
            <p className="font-medium">{t('export:resultat.avertissements')}</p>
            <ul className="list-disc pl-5">
              {lot.avertissements.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <Button type="button" variant="outline" onClick={() => telecharger(lot)}>
          <Download aria-hidden className="mr-2 h-4 w-4" />
          {t('export:resultat.retelecharger', { nom: lot.nomFichier })}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Premier et dernier numéro affiché d'une série (numéros à largeur fixe : tri lexicographique). */
function plage(documents: readonly { readonly numero: string }[]) {
  if (documents.length === 0) return undefined;
  const numeros = documents.map((d) => d.numero).sort();
  return { premier: numeros[0], dernier: numeros[numeros.length - 1] };
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{libelle}</dt>
      <dd className="font-medium">{valeur}</dd>
    </div>
  );
}
