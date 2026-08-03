import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  UNITES_DISTANCE,
  MOTIFS_KILOMETRAGE_REGRESSIF,
  SOURCES_KILOMETRAGE,
  type EntreeKilometrageVehicule,
  type MotifKilometrageRegressif,
  type SourceKilometrage,
  type UniteDistance,
} from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { useEnregistrerKilometrage } from '@/hooks/vehicules/useEnregistrerKilometrage';

// Même correspondance code -> clé i18n que `composants/vehicule/FriseKilometrage.tsx` (non
// exportée par ce composant : « n'en réécris aucun » exclut de le modifier pour l'exporter).
const CLES_SOURCE: Record<SourceKilometrage, string> = {
  reception: 'kilometrage.sources.reception',
  ordre_reparation: 'kilometrage.sources.or',
  expertise: 'kilometrage.sources.expertise',
  vente: 'kilometrage.sources.vente',
  declaratif: 'kilometrage.sources.declaratif',
  import: 'kilometrage.sources.import',
};

export interface ProprietesFormulaireKilometrage {
  readonly vehiculeId: string;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
}

/**
 * Relevé de kilométrage (RM-23/24/25) — deux règles métier non négociables :
 *  1. l'unité est TOUJOURS explicite (`ChampKilometrage`), jamais convertie côté client (CT-08) —
 *     un véhicule importé en milles ne doit jamais voir sa saisie réinterprétée silencieusement ;
 *  2. une régression n'est PAS un refus sec : `409 VEHICULE_KILOMETRAGE_REGRESSIF` redemande un
 *     motif (compteur remplacé, erreur de saisie, changement d'unité, correction) puis se
 *     confirme explicitement via `AvertissementConfirmable`, jamais une resoumission silencieuse.
 */
export function FormulaireKilometrage({
  vehiculeId,
  ouvert,
  onOuvertChange,
}: ProprietesFormulaireKilometrage) {
  const { t } = useTranslation(['vehicules', 'commun']);
  const mutation = useEnregistrerKilometrage(vehiculeId);

  const [valeur, setValeur] = useState<number | null>(null);
  const [unite, setUnite] = useState<UniteDistance>('km');
  const [source, setSource] = useState<SourceKilometrage>('reception');
  const [motif, setMotif] = useState<MotifKilometrageRegressif | ''>('');
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const erreurRegression =
    mutation.error instanceof ErreurApi &&
    mutation.error.probleme.code === 'VEHICULE_KILOMETRAGE_REGRESSIF'
      ? mutation.error
      : null;

  function reinitialiser() {
    setValeur(null);
    setUnite('km');
    setSource('reception');
    setMotif('');
    mutation.reset();
  }

  function fermer(ouvertSuivant: boolean) {
    if (!ouvertSuivant) reinitialiser();
    onOuvertChange(ouvertSuivant);
  }

  function envoyer(motifRegression: MotifKilometrageRegressif | null) {
    if (valeur === null) return;
    const entree: EntreeKilometrageVehicule = {
      valeur,
      unite,
      source,
      releveLe: new Date().toISOString(),
      motifRegression,
    };
    mutation.mutate(entree, { onSuccess: () => fermer(false) });
  }

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (valeur === null) return;
    if (erreurRegression) {
      // Motif déjà choisi (le bouton n'est activé que dans ce cas) : la confirmation explicite
      // passe par `AvertissementConfirmable`, jamais une resoumission silencieuse du formulaire.
      setConfirmationOuverte(true);
      return;
    }
    envoyer(null);
  }

  const motifChoisi = motif === '' ? null : motif;
  const pretAConfirmer = erreurRegression !== null && motifChoisi !== null;

  return (
    <>
      <Dialog open={ouvert} onOpenChange={fermer}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('vehicules:kilometrage.relever')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={soumettre} className="flex flex-col gap-4">
            <ChampKilometrage
              valeur={valeur}
              onChangeValeur={setValeur}
              unite={unite}
              label={t('vehicules:kilometrage.valeur')}
              obligatoire
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kilometrage-unite">{t('vehicules:kilometrage.unite')}</Label>
              <Select
                value={unite}
                onValueChange={(valeurChoisie) => setUnite(valeurChoisie as UniteDistance)}
              >
                <SelectTrigger id="kilometrage-unite" aria-label={t('vehicules:kilometrage.unite')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITES_DISTANCE.map((valeurUnite) => (
                    <SelectItem key={valeurUnite} value={valeurUnite}>
                      {t(`vehicules:kilometrage.unites.${valeurUnite}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kilometrage-source">{t('vehicules:kilometrage.source')}</Label>
              <Select
                value={source}
                onValueChange={(valeurSource) => setSource(valeurSource as SourceKilometrage)}
              >
                <SelectTrigger
                  id="kilometrage-source"
                  aria-label={t('vehicules:kilometrage.source')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES_KILOMETRAGE.map((valeurSource) => (
                    <SelectItem key={valeurSource} value={valeurSource}>
                      {t(`vehicules:${CLES_SOURCE[valeurSource]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {erreurRegression ? (
              <div
                role="alert"
                className="flex flex-col gap-3 rounded-md border border-statut-attention/40 bg-statut-attention/10 p-3"
              >
                <p className="texte-corps text-statut-attention">
                  {messageErreur(erreurRegression, t)}
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="kilometrage-motif">{t('vehicules:kilometrage.motif')}</Label>
                  <Select
                    value={motif}
                    onValueChange={(valeurMotif) =>
                      setMotif(valeurMotif as MotifKilometrageRegressif)
                    }
                  >
                    <SelectTrigger
                      id="kilometrage-motif"
                      aria-label={t('vehicules:kilometrage.motif')}
                    >
                      <SelectValue placeholder={t('vehicules:kilometrage.motif')} />
                    </SelectTrigger>
                    <SelectContent>
                      {MOTIFS_KILOMETRAGE_REGRESSIF.map((valeurMotif) => (
                        <SelectItem key={valeurMotif} value={valeurMotif}>
                          {t(`vehicules:kilometrage.motifsRegression.${valeurMotif}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={
                valeur === null ||
                mutation.isPending ||
                (erreurRegression !== null && !pretAConfirmer)
              }
            >
              {erreurRegression
                ? t('commun:actions.continuerQuandMeme')
                : t('vehicules:kilometrage.relever')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AvertissementConfirmable
        ouvert={confirmationOuverte}
        onOuvertChange={setConfirmationOuverte}
        titre={t('vehicules:kilometrage.relever')}
        description={
          erreurRegression && motifChoisi
            ? `${messageErreur(erreurRegression, t)} ${t(`vehicules:kilometrage.motifsRegression.${motifChoisi}`)}`
            : ''
        }
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() => {
          setConfirmationOuverte(false);
          envoyer(motifChoisi);
        }}
        enCours={mutation.isPending}
      />
    </>
  );
}
