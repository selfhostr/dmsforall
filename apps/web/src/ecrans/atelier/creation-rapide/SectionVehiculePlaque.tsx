import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import type { RechercheTypee } from '@/hooks/atelier/useRechercheTypee';

import type { CandidatVehicule } from './candidats';
import { ChampsMarqueModele } from './ChampsMarqueModele';
import { LigneVehicule, ListeCandidats } from './ListeCandidats';

interface Props {
  readonly plaque: string;
  readonly onPlaqueChange: (valeur: string) => void;
  readonly recherche: RechercheTypee;
  /** Véhicules du client déjà choisi (arrivée depuis sa fiche), proposés tant que la plaque est vide. */
  readonly candidatsClient: readonly CandidatVehicule[];
  readonly candidatsRecherche: readonly CandidatVehicule[];
  readonly choisi: CandidatVehicule | null;
  readonly onChoisir: (candidat: CandidatVehicule | null) => void;
  readonly nouveau: boolean;
  readonly onNouveau: (nouveau: boolean) => void;
  readonly marque: string;
  readonly modele: string;
  readonly onMarqueChange: (valeur: string) => void;
  readonly onModeleChange: (valeur: string) => void;
  readonly erreurMarque?: string;
  readonly erreurModele?: string;
  /** Véhicule déjà créé lors d'un essai précédent : plus modifiable. */
  readonly verrouille: boolean;
  readonly autoFocus: boolean;
}

/**
 * Section 1 — « Quel véhicule ? ». Une plaque tapée suffit : connue, le véhicule (et son
 * détenteur) se retrouve ; inconnue, le même écran demande marque et modèle. Aucun dialogue.
 */
export function SectionVehiculePlaque({
  plaque,
  onPlaqueChange,
  recherche,
  candidatsClient,
  candidatsRecherche,
  choisi,
  onChoisir,
  nouveau,
  onNouveau,
  marque,
  modele,
  onMarqueChange,
  onModeleChange,
  erreurMarque,
  erreurModele,
  verrouille,
  autoFocus,
}: Props) {
  const { t } = useTranslation(['or', 'erreurs']);

  if (choisi) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
        <LigneVehicule vehicule={choisi} />
        <Button
          type="button"
          variant="outline"
          disabled={verrouille}
          onClick={() => onChoisir(null)}
        >
          {t('or:nouveau.rapide.changer')}
        </Button>
      </div>
    );
  }

  const candidats = recherche.active ? candidatsRecherche : candidatsClient;
  const aucunTrouve =
    recherche.active && !recherche.enChargement && candidatsRecherche.length === 0;
  const afficherNouveau = nouveau || aucunTrouve;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="or-plaque">{t('or:nouveau.rapide.plaque')}</Label>
        <Input
          id="or-plaque"
          value={plaque}
          maxLength={20}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoComplete="off"
          disabled={verrouille}
          placeholder={t('or:nouveau.rapide.plaqueExemple')}
          onChange={(evenement) => {
            onPlaqueChange(evenement.target.value);
            onNouveau(false);
          }}
        />
        <p className="texte-libelle text-muted-foreground">{t('or:nouveau.rapide.plaqueAide')}</p>
      </div>

      {recherche.enChargement && recherche.resultats.length === 0 ? (
        <EtatChargement lignes={1} />
      ) : null}

      {recherche.enErreur ? (
        <EtatErreur
          titre={t('or:nouveau.rapide.rechercheErreur')}
          description={messageErreur(recherche.erreur, t)}
          onReessayer={recherche.relancer}
        />
      ) : null}

      {!afficherNouveau && candidats.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="texte-libelle text-muted-foreground">
            {recherche.active
              ? t('or:nouveau.rapide.vehiculesTrouves', { count: candidats.length })
              : t('or:nouveau.rapide.vehiculesDuClient')}
          </p>
          <ListeCandidats
            libelle={t('or:nouveau.vehicule.titre')}
            candidats={candidats}
            onChoisir={onChoisir}
          />
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => onNouveau(true)}
          >
            {t('or:nouveau.rapide.autreVehicule')}
          </Button>
        </div>
      ) : null}

      {afficherNouveau ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
          <p className="texte-corps font-medium text-foreground" role="status">
            {aucunTrouve
              ? t('or:nouveau.rapide.plaqueInconnue')
              : t('or:nouveau.rapide.nouveauVehicule')}
          </p>
          <ChampsMarqueModele
            idPrefixe="or-nouveau"
            marque={marque}
            modele={modele}
            onMarqueChange={onMarqueChange}
            onModeleChange={onModeleChange}
            disabled={verrouille}
            erreurMarque={erreurMarque}
            erreurModele={erreurModele}
          />
          {!aucunTrouve && candidats.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => onNouveau(false)}
            >
              {t('or:nouveau.rapide.retourListe')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
