import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeConfirmation, EntreeActionArriveeRendezVous } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';

interface Props {
  readonly ouvert: boolean;
  readonly onOpenChange: (ouvert: boolean) => void;
  readonly onConfirmer: (entree: EntreeActionArriveeRendezVous) => void;
  readonly enCours?: boolean;
  readonly erreur?: string | null;
  /** Codes à confirmer explicitement (409 CONFIRMATION_REQUISE, ex. VEHICULE_DEUX_OR_OUVERTS) —
   *  même protocole que `DialogueNouveauRendezVous`/`FormulaireNouvelOrdreReparation` (issue #108 :
   *  sans ce relais, un 409 ici retombait purement et simplement en écran blanc, rien
   *  d'enregistré, aucun message — voir `useArriveeRendezVous`, qui met `erreur` à `null` par
   *  conception dès que cette liste est non vide, EN SUPPOSANT qu'une UI de confirmation prend le
   *  relais). */
  readonly confirmationsRequises?: readonly CodeConfirmation[];
  readonly onConfirmerQuandMeme?: () => void;
}

/**
 * Le véhicule est arrivé — réutilise le geste déjà construit sur l'OR (kilométrage d'entrée,
 * signature différée, `PanneauActionsOr.tsx`) plutôt que de le refaire : « le réceptionniste ne
 * ressaisit rien de ce qu'il a déjà dit au téléphone » (conception, § lien avec l'OR) — ce dialogue
 * ne redemande que ce que le rendez-vous ne connaît pas encore (kilométrage, signature).
 */
export function DialogueArriveeRendezVous({
  ouvert,
  onOpenChange,
  onConfirmer,
  enCours = false,
  erreur = null,
  confirmationsRequises = [],
  onConfirmerQuandMeme,
}: Props) {
  const { t } = useTranslation(['planning', 'or', 'commun']);
  const [kilometrage, setKilometrage] = useState<number | null>(null);
  const [signatureDifferee, setSignatureDifferee] = useState(false);
  const [motifDifferee, setMotifDifferee] = useState('');
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);
  // Même garde-fou que `FormulaireNouvelOrdreReparation` (patron figé aujourd'hui pour l'ouverture
  // d'un OR) : sans ce drapeau, fermer la modale de confirmation par « Annuler » la rouvrirait
  // aussitôt — `confirmationsRequises` reste posé côté hook tant qu'aucun nouvel envoi n'a eu lieu.
  const [confirmationRejetee, setConfirmationRejetee] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setKilometrage(null);
    setSignatureDifferee(false);
    setMotifDifferee('');
    setErreurValidation(null);
    setConfirmationRejetee(false);
  }, [ouvert]);

  function gererConfirmer() {
    if (kilometrage === null) {
      setErreurValidation(t('or:actions.kilometrageEntree'));
      return;
    }
    if (signatureDifferee && motifDifferee.trim() === '') {
      setErreurValidation(t('or:actions.motifSignatureDifferee'));
      return;
    }
    setErreurValidation(null);
    setConfirmationRejetee(false);
    onConfirmer({
      kilometrageEntree: kilometrage,
      unite: 'km',
      signatureDifferee,
      motifDifferee: motifDifferee.trim() === '' ? undefined : motifDifferee.trim(),
    });
  }

  /** Le message serveur générique (`erreur`) est délibérément `null` tant qu'une confirmation
   *  reste à traiter (voir `useArriveeRendezVous`, pour ne pas superposer l'alerte générique ET
   *  cette modale) — la description vient donc du CODE de confirmation, pas de `erreur`. Cas réel
   *  connu (jeu de démo) : un véhicule portant déjà deux OR ouverts. */
  function descriptionConfirmation(): string {
    if (confirmationsRequises.includes('VEHICULE_DEUX_OR_OUVERTS')) {
      return t('planning:dialogueArrivee.confirmationDeuxOrOuverts');
    }
    return t('planning:dialogueArrivee.confirmationGenerique');
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planning:dialogueArrivee.titre')}</DialogTitle>
        </DialogHeader>

        {erreur ? (
          <p role="alert" className="texte-corps text-destructive">
            {erreur}
          </p>
        ) : null}

        <div className="flex flex-col gap-groupe">
          <ChampKilometrage
            valeur={kilometrage}
            onChangeValeur={setKilometrage}
            unite="km"
            label={t('or:actions.kilometrageEntree')}
            obligatoire
          />
          <label
            htmlFor="rdv-arrivee-signature-differee"
            className="flex items-center gap-2 texte-corps"
          >
            <Checkbox
              id="rdv-arrivee-signature-differee"
              checked={signatureDifferee}
              onCheckedChange={(coche) => setSignatureDifferee(coche === true)}
            />
            {t('or:actions.signatureDifferee')}
          </label>
          {signatureDifferee ? (
            <div className="flex flex-col gap-champ">
              <Label htmlFor="rdv-arrivee-motif-differee">
                {t('or:actions.motifSignatureDifferee')}
              </Label>
              <Textarea
                id="rdv-arrivee-motif-differee"
                value={motifDifferee}
                onChange={(evenement) => setMotifDifferee(evenement.target.value)}
              />
            </div>
          ) : null}
          {erreurValidation ? (
            <p className="texte-libelle text-destructive">{erreurValidation}</p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('commun:actions.annuler')}</Button>
          </DialogClose>
          <Button disabled={enCours} onClick={gererConfirmer}>
            {t('planning:dialogueArrivee.confirmer')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {onConfirmerQuandMeme ? (
        <AvertissementConfirmable
          ouvert={confirmationsRequises.length > 0 && !confirmationRejetee}
          onOuvertChange={(ouvertConfirmation) => {
            if (!ouvertConfirmation) setConfirmationRejetee(true);
          }}
          titre={t('planning:dialogueArrivee.titre')}
          description={descriptionConfirmation()}
          libelleConfirmation={t('commun:actions.continuerQuandMeme')}
          onConfirmer={onConfirmerQuandMeme}
          enCours={enCours}
        />
      ) : null}
    </Dialog>
  );
}
