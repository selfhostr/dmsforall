import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOTIFS_FIN_DETENTION, type ClientResume, type MotifFinDetention } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';

import { SelecteurClientVehicule } from './SelecteurClientVehicule';
import { useChangerDetenteurVehicule } from './useChangerDetenteurVehicule';

/** Détenteur courant minimal requis par ce dialogue — sous-ensemble de `ReponseVehiculeDetention`
 *  (`@dfa/shared`), tel qu'exposé par `proprietaireActuel.client` dans `EcranFicheVehicule.tsx`. */
export interface DetenteurActuelVehicule {
  readonly id: string;
  readonly numeroClient: string;
  readonly nomAffiche: string;
}

export interface ProprietesDialogueRattacherClient {
  readonly vehiculeId: string;
  /** `null` = aucun détenteur courant : le dialogue devient « Rattacher à un client » et masque
   *  le motif de fin (RM-20/21 — un motif de fin de détention n'a pas de sens quand il n'y a rien
   *  à clore ; le serveur l'ignore aussi dans ce cas, voir `service-vehicule-detention.ts`). */
  readonly detenteurActuel: DetenteurActuelVehicule | null;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
}

function aujourdhuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `POST /vehicules/{id}/changer-detenteur` (RM-20/21, CT-47) — LE geste métier normal pour relier
 * un véhicule à un client, dans les DEUX cas qu'il couvre sans écran distinct :
 *  1. aucun détenteur courant (véhicule fraîchement créé sans propriétaire, ou fiche jamais
 *     complétée) : « Rattacher à un client » — un seul appel, `motifFin` par défaut jamais montré
 *     à l'écran (le serveur ne le persiste que pour clôturer une détention EXISTANTE).
 *  2. un détenteur courant existe (occasion revendue) : « Changer de détenteur » — le motif de fin
 *     devient un champ visible, obligatoire (traçabilité RM-20/21).
 * Les deux cas partagent CE dialogue plutôt que deux écrans, exactement parce que le serveur les
 * traite déjà comme UN seul geste atomique (voir le commentaire de tête de
 * `service-vehicule-detention.ts` : la version en deux appels laisserait un véhicule sans
 * détenteur ou avec deux, l'invariant protégé par la contrainte d'exclusion en base).
 */
export function DialogueRattacherClient({
  vehiculeId,
  detenteurActuel,
  ouvert,
  onOuvertChange,
}: ProprietesDialogueRattacherClient) {
  const { t } = useTranslation(['vehicules', 'commun', 'erreurs']);
  const mutation = useChangerDetenteurVehicule(vehiculeId);

  const [clientId, setClientId] = useState<string | null>(null);
  const [client, setClient] = useState<ClientResume | null>(null);
  const [changementLe, setChangementLe] = useState<string | undefined>(aujourdhuiIso());
  const [motifFin, setMotifFin] = useState<MotifFinDetention | ''>('');

  function reinitialiser() {
    setClientId(null);
    setClient(null);
    setChangementLe(aujourdhuiIso());
    setMotifFin('');
    mutation.reset();
  }

  function fermer(ouvertSuivant: boolean) {
    if (!ouvertSuivant) reinitialiser();
    onOuvertChange(ouvertSuivant);
  }

  const motifRequis = detenteurActuel !== null;
  const pretASoumettre =
    clientId !== null && changementLe !== undefined && (!motifRequis || motifFin !== '');

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (!pretASoumettre || clientId === null || changementLe === undefined) return;
    mutation.mutate(
      {
        nouveauClientId: clientId,
        changementLe,
        // Ignoré par le serveur tant qu'aucune détention courante n'est clôturée (voir
        // `service-vehicule-detention.ts`, `changerDetenteur`) — valeur neutre non montrée à
        // l'écran dans le cas « rattacher », requise par le schéma (`schemaChangementDetenteur`)
        // même si elle ne sera jamais persistée.
        motifFin: motifRequis ? (motifFin as MotifFinDetention) : 'correction',
      },
      { onSuccess: () => fermer(false) },
    );
  }

  const estErreurReseau = mutation.error instanceof ErreurReseau;

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={fermer}
      titre={t(
        detenteurActuel
          ? 'vehicules:detentions.dialogue.titreChanger'
          : 'vehicules:detentions.dialogue.titreRattacher',
      )}
      pied={
        <>
          <Button type="button" variant="outline" onClick={() => fermer(false)}>
            {t('commun:actions.annuler')}
          </Button>
          <Button
            type="submit"
            form="formulaire-rattacher-client"
            disabled={!pretASoumettre || mutation.isPending}
          >
            {t(detenteurActuel ? 'vehicules:detentions.changer' : 'vehicules:detentions.rattacher')}
          </Button>
        </>
      }
    >
      <form id="formulaire-rattacher-client" onSubmit={soumettre} className="flex flex-col gap-4">
        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        {detenteurActuel ? (
          <div className="flex flex-col gap-1.5">
            <Label>{t('vehicules:detentions.dialogue.detenteurActuelLabel')}</Label>
            <p className="texte-corps text-muted-foreground">
              {detenteurActuel.nomAffiche} · {detenteurActuel.numeroClient}
            </p>
          </div>
        ) : null}

        {mutation.error ? (
          <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
            <AlertTitle>
              {t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
            </AlertTitle>
            <AlertDescription>{messageErreur(mutation.error, t)}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label requis>{t('vehicules:detentions.dialogue.clientLabel')}</Label>
          {client ? (
            // Bordure structurelle : bloc qui porte la sélection courante ET l'action de la
            // retirer (« modifier la sélection » ci-dessous), pas un simple groupe de contenu.
            <div className="flex items-center justify-between gap-3 rounded-md border border-primary bg-primary/5 p-3">
              <IdentiteClient client={client} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClientId(null);
                  setClient(null);
                }}
              >
                {t('vehicules:detentions.dialogue.modifierSelection')}
              </Button>
            </div>
          ) : (
            <SelecteurClientVehicule
              valeur={clientId}
              libelle={t('vehicules:detentions.dialogue.clientLabel')}
              requis
              onChangeValeur={(idChoisi, clientChoisi) => {
                setClientId(idChoisi);
                setClient(clientChoisi);
              }}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rattacher-date" requis>
            {t('vehicules:detentions.dialogue.dateLabel')}
          </Label>
          <DateInput
            id="rattacher-date"
            required
            className="max-w-[200px]"
            value={changementLe ?? null}
            onChange={setChangementLe}
          />
        </div>

        {motifRequis ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rattacher-motif" requis>
              {t('vehicules:detentions.dialogue.motifLabel')}
            </Label>
            <Select
              value={motifFin}
              onValueChange={(valeurMotif) => setMotifFin(valeurMotif as MotifFinDetention)}
            >
              <SelectTrigger
                id="rattacher-motif"
                aria-label={t('vehicules:detentions.dialogue.motifLabel')}
                aria-required="true"
              >
                <SelectValue placeholder={t('vehicules:detentions.dialogue.motifLabel')} />
              </SelectTrigger>
              <SelectContent>
                {MOTIFS_FIN_DETENTION.map((valeurMotif) => (
                  <SelectItem key={valeurMotif} value={valeurMotif}>
                    {t(`vehicules:detentions.motifs.${valeurMotif}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
