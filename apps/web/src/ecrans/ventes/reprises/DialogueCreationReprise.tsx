import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { schemaCreationReprise, type ReponseReprise, type VehiculeResume } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LegendeChampsObligatoires } from '@/components/ui/label';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { useCreerReprise } from '@/hooks/ventes/reprises/useCreerReprise';

import {
  ChampDetteFinancementReprise,
  VALEURS_DETTE_VIDES,
  versEntreeDette,
  type ValeursDetteFinancement,
} from './ChampDetteFinancementReprise';
import { SelecteurVehiculeRepris } from './SelecteurVehiculeRepris';

interface Props {
  readonly dossierVenteId: string;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  /** Appelé après une création réussie — l'intégrateur (fiche dossier) doit y invalider/recharger
   *  sa propre requête dossier, dont `dossier.reprise` (embarqué) reste sinon périmé (voir
   *  l'en-tête de `hooks/ventes/reprises/useCreerReprise.ts`). */
  readonly onCree: (reprise: ReponseReprise) => void;
}

/**
 * Création de la reprise (§8.1 du design) — au plus une par dossier
 * (`409 VENTE_REPRISE_DEJA_EXISTANTE`, affiché comme `RefusBloquant` dans ce même dialog, jamais
 * après fermeture — §4 du design). Statut initial toujours `estimee`.
 */
export function DialogueCreationReprise({ dossierVenteId, ouvert, onOuvertChange, onCree }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'validation', 'erreurs']);
  const idempotence = useCleIdempotence();
  const creer = useCreerReprise(dossierVenteId);

  const [vehiculeId, setVehiculeId] = useState<string | null>(null);
  const [vehicule, setVehicule] = useState<VehiculeResume | null>(null);
  const [valeurEstimeeCentimes, setValeurEstimeeCentimes] = useState<number | null>(null);
  const [dette, setDette] = useState<ValeursDetteFinancement>(VALEURS_DETTE_VIDES);
  const [erreursChamps, setErreursChamps] = useState<Record<string, string>>({});

  useEffect(() => {
    if (ouvert) {
      setVehiculeId(null);
      setVehicule(null);
      setValeurEstimeeCentimes(null);
      setDette(VALEURS_DETTE_VIDES);
      setErreursChamps({});
      creer.reset();
      idempotence.regenerer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  const erreurActive = creer.error instanceof ErreurApi ? creer.error : null;

  function soumettre() {
    setErreursChamps({});
    const candidat = {
      vehiculeReprisId: vehiculeId ?? '',
      valeurEstimeeCentimes: valeurEstimeeCentimes ?? -1,
      ...versEntreeDette(dette),
    };
    const resultat = schemaCreationReprise.safeParse(candidat);
    if (!resultat.success) {
      const erreurs: Record<string, string> = {};
      for (const probleme of resultat.error.issues) {
        const champ = String(probleme.path[0] ?? '');
        if (champ && !erreurs[champ]) erreurs[champ] = t('validation:requis');
      }
      setErreursChamps(erreurs);
      return;
    }

    creer.mutate(
      { entree: resultat.data, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          onCree(reponse.donnees);
          onOuvertChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ventes:reprise.creation.titre')}</DialogTitle>
          <DialogDescription>{t('ventes:reprise.creation.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <LegendeChampsObligatoires>
            {t('commun:formulaires.champsObligatoiresLegende')}
          </LegendeChampsObligatoires>

          <SelecteurVehiculeRepris
            valeur={vehiculeId}
            onChangeValeur={(id, v) => {
              setVehiculeId(id);
              setVehicule(v);
            }}
            erreur={erreursChamps.vehiculeReprisId}
          />
          {vehicule ? (
            <p className="texte-libelle text-muted-foreground">
              {t('ventes:reprise.creation.vehiculeSelectionne', {
                designation: vehicule.designation,
              })}
            </p>
          ) : null}

          <ChampMontant
            label={t('ventes:reprise.creation.valeurEstimee')}
            obligatoire
            valeurCentimes={valeurEstimeeCentimes}
            onChangeCentimes={setValeurEstimeeCentimes}
            erreur={erreursChamps.valeurEstimeeCentimes}
          />

          <ChampDetteFinancementReprise valeurs={dette} onChange={setDette} />
        </div>

        {erreurActive ? (
          <RefusBloquant
            code={erreurActive.probleme.code}
            blocages={erreurActive.blocages}
            actionsProposees={erreurActive.actionsProposees}
          />
        ) : creer.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(creer.error, t)}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={creer.isPending}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="button" disabled={creer.isPending} onClick={soumettre}>
            {creer.isPending ? t('commun:chargement.enCours') : t('ventes:reprise.actions.creer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
