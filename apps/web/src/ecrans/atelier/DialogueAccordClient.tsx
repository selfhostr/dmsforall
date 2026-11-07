import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApercuPhotosLignes } from '@/composants/photos/ApercuPhotosLignes';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  MODES_ACCORD_CLIENT,
  useAccordClientLignes,
  type ModeAccordClient,
} from '@/hooks/atelier/useAccordClientLignes';
import { cn } from '@/lib/utils';

import { messagesErreurMutation } from './messages-erreur-mutation';

interface Props {
  readonly orId: string;
  /** Lignes dont le client donne l'accord (statut « Proposée »). */
  readonly ligneIds: readonly string[];
  /** Plafond actuel de l'OR (`0` si aucun ou masqué) : repris tel quel dans le devis. */
  readonly plafondCentimes: number;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** Appelé une fois l'accord enregistré ET les lignes validées par le serveur. */
  readonly onAccorde?: () => void;
}

/**
 * « Accord du client » en un geste : qui a donné l'accord (nom libre) et comment (téléphone / sur
 * place / e-mail), horodaté à l'enregistrement. Derrière : un devis complémentaire créé puis
 * accepté (voir `useAccordClientLignes`) — la trace probante est complète, mais le garagiste ne
 * voit qu'un seul dialogue de deux champs.
 *
 * Aucune perte de saisie : le nom et le mode restent affichés après un échec, le bouton rejoue.
 */
export function DialogueAccordClient({
  orId,
  ligneIds,
  plafondCentimes,
  ouvert,
  onOuvertChange,
  onAccorde,
}: Props) {
  const { t } = useTranslation(['or', 'commun', 'validation']);
  const accord = useAccordClientLignes(orId);
  const [nom, setNom] = useState('');
  const [mode, setMode] = useState<ModeAccordClient>('telephone');
  const [erreurNom, setErreurNom] = useState<string | null>(null);

  function changerOuverture(valeur: boolean) {
    if (!valeur) {
      accord.reset();
      setErreurNom(null);
    }
    onOuvertChange(valeur);
  }

  function enregistrer() {
    if (nom.trim() === '') {
      setErreurNom(t('or:accordClient.nomRequis'));
      return;
    }
    setErreurNom(null);
    accord.mutate(
      { ligneIds, interlocuteurNom: nom, mode, plafondCentimes },
      {
        onSuccess: () => {
          setNom('');
          setMode('telephone');
          onOuvertChange(false);
          onAccorde?.();
        },
      },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={changerOuverture}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('or:accordClient.titre')}</DialogTitle>
          <DialogDescription>
            {t('or:accordClient.description', { count: ligneIds.length })}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(evenement) => {
            evenement.preventDefault();
            enregistrer();
          }}
        >
          <ApercuPhotosLignes orId={orId} ligneIds={ligneIds} />

          <LegendeChampsObligatoires>
            {t('commun:formulaires.champsObligatoiresLegende')}
          </LegendeChampsObligatoires>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-accord-nom" requis>
              {t('or:accordClient.nom')}
            </Label>
            <Input
              id="or-accord-nom"
              value={nom}
              maxLength={200}
              aria-required="true"
              aria-invalid={erreurNom ? true : undefined}
              autoComplete="off"
              onChange={(evenement) => setNom(evenement.target.value)}
            />
            {erreurNom ? <p className="texte-libelle text-destructive">{erreurNom}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="or-accord-mode-libelle">{t('or:accordClient.mode.libelle')}</Label>
            <div
              role="group"
              aria-labelledby="or-accord-mode-libelle"
              className="inline-flex self-start overflow-hidden rounded-md border"
            >
              {MODES_ACCORD_CLIENT.map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  aria-pressed={mode === valeur}
                  onClick={() => setMode(valeur)}
                  className={cn(
                    'h-11 px-4 texte-corps font-medium transition-colors',
                    mode === valeur
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {t(`or:accordClient.mode.${valeur}`)}
                </button>
              ))}
            </div>
          </div>

          <p className="texte-libelle text-muted-foreground">{t('or:accordClient.horodatage')}</p>

          {accord.isError
            ? messagesErreurMutation(accord.error, t).map((message, index) => (
                <p key={index} role="alert" className="texte-libelle text-destructive">
                  {message}
                </p>
              ))
            : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changerOuverture(false)}>
              {t('commun:actions.annuler')}
            </Button>
            <Button type="submit" enChargement={accord.isPending}>
              {t('or:accordClient.enregistrer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
