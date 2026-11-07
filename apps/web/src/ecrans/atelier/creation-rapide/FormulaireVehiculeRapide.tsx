import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { schemaCreationVehicule, type ReponseVehicule, type VehiculeResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreerVehicule } from '@/hooks/vehicules/useCreerVehicule';

import { ChampsMarqueModele } from './ChampsMarqueModele';

interface Props {
  readonly clientId: string;
  readonly plaqueInitiale?: string;
  readonly onCree: (vehicule: VehiculeResume) => void;
  readonly onAnnuler?: () => void;
}

/** `POST /vehicules` répond la fiche complète ; les sélecteurs d'OR consomment la projection. */
export function versVehiculeResume(vehicule: ReponseVehicule): VehiculeResume {
  return {
    id: vehicule.id,
    plaque: vehicule.plaque,
    canton: vehicule.canton,
    designation: vehicule.designation,
    vin: vehicule.vin,
    premiereMiseEnCirculationLe: vehicule.premiereMiseEnCirculationLe,
    identificationIncomplete: vehicule.identificationIncomplete,
    emplacementLibre: vehicule.emplacementLibre,
  };
}

/**
 * Ajout d'un véhicule au client choisi, SUR PLACE (plaque + marque + modèle, le minimum du
 * contrat) : le client sans véhicule n'est plus un cul-de-sac. Pas de dialogue — le formulaire
 * s'ouvre dans le flux de l'écran « Nouvel OR » et rattache d'emblée le véhicule au client
 * (`detenteurId`).
 */
export function FormulaireVehiculeRapide({ clientId, plaqueInitiale, onCree, onAnnuler }: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs', 'validation']);
  const creer = useCreerVehicule();
  const idempotence = useCleIdempotence();
  const [plaque, setPlaque] = useState(plaqueInitiale ?? '');
  const [marque, setMarque] = useState('');
  const [modele, setModele] = useState('');
  const [invalide, setInvalide] = useState<{ marque?: string; modele?: string; autre?: string }>(
    {},
  );

  function soumettre() {
    const resultat = schemaCreationVehicule.safeParse({
      marque,
      modele,
      plaque: plaque.trim() === '' ? undefined : plaque.trim(),
      detenteurId: clientId,
    });
    if (!resultat.success) {
      const champs = new Set(resultat.error.issues.map((p) => p.path[0]));
      setInvalide({
        marque: champs.has('marque') ? t('validation:requis') : undefined,
        modele: champs.has('modele') ? t('validation:requis') : undefined,
        // Tout autre refus du contrat (plaque trop longue…) est dit, jamais avalé en silence.
        autre:
          champs.has('marque') || champs.has('modele')
            ? undefined
            : t('or:nouveau.rapide.invalide'),
      });
      return;
    }
    setInvalide({});
    creer.mutate(
      { entree: resultat.data, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          idempotence.regenerer();
          onCree(versVehiculeResume(reponse.donnees));
        },
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md bg-muted/40 p-3"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        soumettre();
      }}
    >
      <p className="texte-corps font-medium text-foreground">
        {t('or:nouveau.vehicule.ajouter.titre')}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vehicule-rapide-plaque">{t('or:nouveau.rapide.plaque')}</Label>
        <Input
          id="vehicule-rapide-plaque"
          value={plaque}
          maxLength={20}
          autoCapitalize="characters"
          disabled={creer.isPending}
          placeholder={t('or:nouveau.rapide.plaqueExemple')}
          onChange={(evenement) => setPlaque(evenement.target.value)}
        />
      </div>
      <ChampsMarqueModele
        idPrefixe="vehicule-rapide"
        marque={marque}
        modele={modele}
        onMarqueChange={setMarque}
        onModeleChange={setModele}
        disabled={creer.isPending}
        erreurMarque={invalide.marque}
        erreurModele={invalide.modele}
      />
      {invalide.autre ? (
        <Alert variant="destructive">
          <AlertDescription>{invalide.autre}</AlertDescription>
        </Alert>
      ) : null}
      {creer.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{messageErreur(creer.error, t)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onAnnuler ? (
          <Button type="button" variant="outline" onClick={onAnnuler} disabled={creer.isPending}>
            {t('commun:actions.annuler')}
          </Button>
        ) : null}
        <Button type="submit" disabled={creer.isPending}>
          {creer.isPending
            ? t('or:nouveau.vehicule.ajouter.enCours')
            : t('or:nouveau.vehicule.ajouter.valider')}
        </Button>
      </div>
    </form>
  );
}
