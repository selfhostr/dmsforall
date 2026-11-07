import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ResultatRecherche } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChampTelephone } from '@/composants/comptoir/ChampTelephone';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { texteResume } from '@/composants/recherche/resume';
import { useRechercheTypee } from '@/hooks/atelier/useRechercheTypee';

/** Client retenu pour l'OR (existant) — le strict nécessaire à l'affichage. */
export interface ClientChoisi {
  readonly id: string;
  readonly nomAffiche: string;
  readonly telephone: string | null;
}

export function clientDepuisRecherche(resultat: ResultatRecherche): ClientChoisi {
  return {
    id: resultat.id,
    nomAffiche: texteResume(resultat.resume.nom) ?? '',
    telephone: texteResume(resultat.resume.telephone),
  };
}

interface Props {
  readonly choisi: ClientChoisi | null;
  readonly onChoisir: (client: ClientChoisi | null) => void;
  /** Le client vient du détenteur du véhicule reconnu : on le dit. */
  readonly detenteurDuVehicule: boolean;
  readonly nouveau: boolean;
  readonly onNouveau: (nouveau: boolean) => void;
  readonly nom: string;
  readonly telephone: string;
  readonly onNomChange: (valeur: string) => void;
  readonly onTelephoneChange: (valeur: string) => void;
  readonly erreurNom?: string;
  readonly erreurTelephone?: string;
  /** Client déjà créé lors d'un essai précédent. */
  readonly verrouille: boolean;
  /** Le client est imposé par l'URL (arrivée depuis sa fiche) : pas de « Changer ». */
  readonly imposeParUrl: boolean;
}

function ListeClients({
  resultats,
  onChoisir,
}: {
  readonly resultats: readonly ResultatRecherche[];
  readonly onChoisir: (client: ClientChoisi) => void;
}) {
  const { t } = useTranslation('or');
  return (
    <div
      role="radiogroup"
      aria-label={t('nouveau.rapide.client.titre')}
      className="flex flex-col gap-2"
    >
      {resultats.map((resultat) => {
        const client = clientDepuisRecherche(resultat);
        const localite = texteResume(resultat.resume.localite);
        return (
          <button
            key={resultat.id}
            type="button"
            role="radio"
            aria-checked={false}
            onClick={() => onChoisir(client)}
            className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-input p-3 text-left transition-colors hover:bg-muted"
          >
            <span className="texte-corps font-medium text-foreground">{client.nomAffiche}</span>
            {client.telephone ? (
              <span className="texte-libelle tabular-nums text-muted-foreground">
                {client.telephone}
              </span>
            ) : null}
            {localite ? (
              <span className="texte-libelle text-muted-foreground">{localite}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Section 2 — « Pour quel client ? ». Existant (retrouvé par nom, téléphone, n° client) ou NOUVEAU
 * sur place : nom + téléphone seulement, l'adresse se complète plus tard. Quand le nom tapé
 * ressemble à un client existant, on le propose avant de créer un doublon — sans dialogue.
 */
export function SectionClientRapide({
  choisi,
  onChoisir,
  detenteurDuVehicule,
  nouveau,
  onNouveau,
  nom,
  telephone,
  onNomChange,
  onTelephoneChange,
  erreurNom,
  erreurTelephone,
  verrouille,
  imposeParUrl,
}: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const [saisie, setSaisie] = useState('');
  const rechercheExistant = useRechercheTypee(saisie, 'client', 2);
  const similaires = useRechercheTypee(nouveau && !verrouille ? nom : '', 'client', 3);

  if (choisi) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
        <div className="flex min-w-0 flex-col">
          <span className="texte-corps font-medium text-foreground">{choisi.nomAffiche}</span>
          <span className="texte-libelle text-muted-foreground">
            {detenteurDuVehicule
              ? t('or:nouveau.rapide.client.detenteur')
              : (choisi.telephone ?? '')}
          </span>
        </div>
        {imposeParUrl ? null : (
          <Button
            type="button"
            variant="outline"
            disabled={verrouille}
            onClick={() => onChoisir(null)}
          >
            {t('or:nouveau.rapide.changer')}
          </Button>
        )}
      </div>
    );
  }

  if (nouveau) {
    return (
      <div className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="or-client-nom" requis>
            {t('or:nouveau.rapide.client.nom')}
          </Label>
          <Input
            id="or-client-nom"
            value={nom}
            maxLength={120}
            autoComplete="off"
            disabled={verrouille}
            aria-invalid={erreurNom ? true : undefined}
            onChange={(evenement) => onNomChange(evenement.target.value)}
          />
          {erreurNom ? <p className="texte-corps text-destructive">{erreurNom}</p> : null}
        </div>
        <ChampTelephone
          id="or-client-telephone"
          valeur={telephone}
          onChangeValeur={onTelephoneChange}
          label={t('or:nouveau.rapide.client.telephone')}
          obligatoire
          disabled={verrouille}
          erreur={erreurTelephone}
        />
        <p className="texte-libelle text-muted-foreground">
          {t('or:nouveau.rapide.client.adressePlusTard')}
        </p>
        {similaires.resultats.length > 0 && !verrouille ? (
          <div className="flex flex-col gap-2">
            <p className="texte-libelle font-medium text-foreground">
              {t('or:nouveau.rapide.client.similaires')}
            </p>
            <ListeClients
              resultats={similaires.resultats.slice(0, 3)}
              onChoisir={(client) => {
                onNouveau(false);
                onChoisir(client);
              }}
            />
          </div>
        ) : null}
        {verrouille ? null : (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => onNouveau(false)}
          >
            {t('or:nouveau.rapide.client.chercherExistant')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="or-client-recherche">{t('or:nouveau.rapide.client.recherche')}</Label>
        <Input
          id="or-client-recherche"
          value={saisie}
          maxLength={120}
          autoComplete="off"
          onChange={(evenement) => setSaisie(evenement.target.value)}
        />
      </div>
      {rechercheExistant.enChargement && rechercheExistant.resultats.length === 0 ? (
        <EtatChargement lignes={1} />
      ) : null}
      {rechercheExistant.resultats.length > 0 ? (
        <ListeClients resultats={rechercheExistant.resultats} onChoisir={onChoisir} />
      ) : null}
      {rechercheExistant.active &&
      !rechercheExistant.enChargement &&
      rechercheExistant.resultats.length === 0 ? (
        <p className="texte-corps text-muted-foreground" role="status">
          {t('or:nouveau.rapide.client.aucun')}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => {
          onNomChange(nom || saisie);
          onNouveau(true);
        }}
      >
        <UserPlus aria-hidden className="h-4 w-4" />
        {t('or:nouveau.rapide.client.nouveau')}
      </Button>
    </div>
  );
}
