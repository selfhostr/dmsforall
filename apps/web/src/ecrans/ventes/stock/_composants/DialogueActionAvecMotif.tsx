import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseMutationResult } from '@tanstack/react-query';

import {
  schemaTexteLong,
  type ReponseAvecAvertissements,
  type ReponseVehiculeStock,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface VariablesMotif {
  readonly motif: string;
}

interface Props {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly titre: string;
  readonly description: string;
  readonly libelleConfirmation: string;
  readonly mutation: UseMutationResult<
    ReponseAvecAvertissements<ReponseVehiculeStock>,
    unknown,
    VariablesMotif
  >;
}

/**
 * Action à motif obligatoire, corps `{ motif }` (`schemaTexteLong`, @dfa/shared) — factorise
 * `remettre-disponible` et `marquer-vendu` (`POST .../stock/remettre-disponible|marquer-vendu`) :
 * MÊME contrat de corps, même doctrine de correction exceptionnelle (motif obligatoire pour la
 * traçabilité, `dernier_motif_transition` côté serveur). Même patron que `PanneauActionsOr`
 * (atelier, action `rouvrir`/`annuler`) pour un `Dialog` + `Textarea` + validation manuelle zod à
 * la soumission, plutôt qu'un `AvertissementConfirmable` (qui ne porte pas de champ de saisie).
 */
export function DialogueActionAvecMotif({
  ouvert,
  onOuvertChange,
  titre,
  description,
  libelleConfirmation,
  mutation,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'validation']);
  const [motif, setMotif] = useState('');
  const [erreurValidation, setErreurValidation] = useState(false);

  function fermer(ouvertSuivant: boolean) {
    if (!ouvertSuivant) {
      setMotif('');
      setErreurValidation(false);
      mutation.reset();
    }
    onOuvertChange(ouvertSuivant);
  }

  function confirmer() {
    const resultat = schemaTexteLong.safeParse(motif.trim());
    if (!resultat.success) {
      setErreurValidation(true);
      return;
    }
    setErreurValidation(false);
    mutation.mutate({ motif: resultat.data }, { onSuccess: () => fermer(false) });
  }

  return (
    <Dialog open={ouvert} onOpenChange={fermer}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stock-action-motif">{t('ventes:stock.champs.motif')}</Label>
          <Textarea
            id="stock-action-motif"
            value={motif}
            onChange={(evenement) => setMotif(evenement.target.value)}
            disabled={mutation.isPending}
          />
          {erreurValidation ? (
            <p className="texte-libelle text-destructive">{t('validation:requis')}</p>
          ) : null}
        </div>

        {mutation.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(mutation.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t('commun:actions.annuler')}
            </Button>
          </DialogClose>
          <Button onClick={confirmer} disabled={mutation.isPending}>
            {libelleConfirmation}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
