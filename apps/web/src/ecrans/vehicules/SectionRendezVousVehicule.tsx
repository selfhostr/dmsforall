import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import type {
  ClientResume,
  EntreeCreationRendezVous,
  ReponseRendezVous,
  SiteResume,
  VehiculeResume,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { CarteRendezVous } from '@/composants/rendez-vous/CarteRendezVous';
import { DialogueNouveauRendezVous } from '@/composants/rendez-vous/DialogueNouveauRendezVous';
import { libelleMotif, type RendezVousCarte } from '@/composants/rendez-vous/types';
import { useClient } from '@/hooks/clients/useClient';
import { useCreationRendezVous } from '@/hooks/rendez-vous/useCreationRendezVous';
import { useMotifsRendezVous } from '@/hooks/rendez-vous/useMotifsRendezVous';
import { useLangue } from '@/hooks/useLangue';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { SelecteurClientVehicule } from './SelecteurClientVehicule';
import {
  clesRendezVousAVenirVehicule,
  useRendezVousAVenirVehicule,
} from './useRendezVousAVenirVehicule';

/** Détenteur courant minimal — même forme que `DetenteurActuelVehicule`
 *  (`DialogueRattacherClient.tsx`, hors périmètre d'écriture ici) : c'est tout ce que
 *  `ReponseVehiculeDetention.client` porte, jamais un `ClientResume` complet. */
export interface DetenteurCourantVehicule {
  readonly id: string;
  readonly numeroClient: string;
  readonly nomAffiche: string;
}

interface Props {
  readonly vehicule: VehiculeResume;
  /** `null` = aucun détenteur courant (RM-20/21) — l'action reste possible mais demande le client,
   *  JAMAIS deviné (voir le rapport de livraison). */
  readonly detenteur: DetenteurCourantVehicule | null;
  readonly site: SiteResume | undefined;
}

function versCarteRendezVous(
  rdv: ReponseRendezVous,
  langue: Parameters<typeof libelleMotif>[1],
): RendezVousCarte {
  return {
    id: rdv.id,
    dateLe: rdv.dateLe,
    moment: rdv.moment,
    heureSouhaitee: rdv.heureSouhaitee,
    dureeEstimeeMinutes: rdv.dureeEstimeeMinutes,
    clientNom: rdv.client.nomAffiche,
    vehiculePlaque: rdv.vehicule?.plaque ?? null,
    vehiculeCanton: rdv.vehicule?.canton ?? null,
    vehiculeDesignation: rdv.vehicule?.designation ?? null,
    motifLibelle: libelleMotif(rdv.motif, langue),
    statut: rdv.statut,
  };
}

/**
 * « Prendre un rendez-vous » depuis la fiche véhicule (point d'entrée 3, constat de @laupernoe : « seul
 * l'agenda est câblé »). Réutilise `DialogueNouveauRendezVous` (Écran 2, dialogue UNIQUE des trois
 * points d'entrée) — véhicule TOUJOURS renseigné ici (c'est la fiche de CE véhicule, jamais un
 * second à choisir, contrairement au point d'entrée 2 côté client) ; client préempli avec le
 * détenteur courant s'il existe, sinon laissé à choisir (`SelecteurClientVehicule`, déjà utilisé
 * par `DialogueRattacherClient` pour le même besoin) — jamais deviné.
 */
export function SectionRendezVousVehicule({ vehicule, detenteur, site }: Props) {
  const { t } = useTranslation(['vehicules', 'planning', 'commun', 'erreurs']);
  const { langue } = useLangue();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [clientCreation, setClientCreation] = useState<ClientResume | null>(null);
  const [rdvVenantDetreCree, setRdvVenantDetreCree] = useState<ReponseRendezVous | null>(null);

  // Fiche complète du détenteur — `ReponseVehiculeDetention.client` (minimal, voir
  // `DetenteurCourantVehicule` ci-dessus) ne porte pas `statut`/`type`/`langueCorrespondance` que
  // `DialogueNouveauRendezVous` affiche via `IdentiteClient` ; même projection neutre que
  // `EcranFicheClient.tsx` (`clientPourIdentite`) pour les agrégats qu'`IdentiteClient` ne lit de
  // toute façon pas (`localite`/`nombreVehicules`).
  const requeteDetenteurComplet = useClient(detenteur?.id);

  const requeteRdv = useRendezVousAVenirVehicule(vehicule.id, detenteur?.id);
  const requeteMotifs = useMotifsRendezVous();
  const creation = useCreationRendezVous();

  function ouvrirDialogue() {
    const d = requeteDetenteurComplet.data;
    setClientCreation(
      d
        ? {
            id: d.id,
            numeroClient: d.numeroClient,
            nomAffiche: d.nomAffiche,
            type: d.type,
            statut: d.statut,
            langueCorrespondance: d.langueCorrespondance,
            poObligatoire: d.poObligatoire,
            telephone: d.telephone,
            localite: null,
            nombreVehicules: 0,
            dernierPassageLe: d.dernierPassageLe,
          }
        : null,
    );
    setRdvVenantDetreCree(null);
    setDialogueOuvert(true);
  }

  function apresCreation(rdv: ReponseRendezVous) {
    setDialogueOuvert(false);
    setRdvVenantDetreCree(rdv);
    void queryClient.invalidateQueries({ queryKey: clesRendezVousAVenirVehicule(vehicule.id) });
  }

  function onConfirmer(donnees: EntreeCreationRendezVous) {
    creation.soumettre(donnees, { onSuccess: apresCreation });
  }

  const rendezVousAVenir = requeteRdv.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="texte-titre-section">
          {t('vehicules:fiche.rendezVous.titre')}
        </CardTitle>
        {site ? (
          <Button type="button" variant="outline" size="sm" onClick={ouvrirDialogue}>
            <CalendarPlus aria-hidden className="h-4 w-4" />
            {t('vehicules:fiche.rendezVous.prendre')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rdvVenantDetreCree ? (
          <Alert>
            <AlertTitle>{t('vehicules:fiche.rendezVous.creeTitre')}</AlertTitle>
            <AlertDescription>
              {formaterDate(rdvVenantDetreCree.dateLe)} ·{' '}
              {rdvVenantDetreCree.heureSouhaitee
                ? rdvVenantDetreCree.heureSouhaitee.slice(0, 5)
                : t(`planning:moments.${rdvVenantDetreCree.moment}`)}{' '}
              — {libelleMotif(rdvVenantDetreCree.motif, langue)}
            </AlertDescription>
          </Alert>
        ) : null}

        {!detenteur ? (
          <p className="texte-corps text-muted-foreground">
            {t('vehicules:fiche.rendezVous.detenteurInconnu')}
          </p>
        ) : requeteRdv.isLoading ? (
          <EtatChargement lignes={2} />
        ) : requeteRdv.isError ? (
          <EtatErreur
            titre={t('vehicules:fiche.erreurSection.titre')}
            description={messageErreur(requeteRdv.error, t)}
            onReessayer={() => void requeteRdv.refetch()}
          />
        ) : rendezVousAVenir.length === 0 ? (
          <EtatVide
            titre={t('vehicules:fiche.rendezVous.titre')}
            description={t('vehicules:fiche.rendezVous.vide')}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rendezVousAVenir.map((rdv) => (
              <li key={rdv.id}>
                <CarteRendezVous
                  rendezVous={versCarteRendezVous(rdv, langue)}
                  onOuvrir={() => navigate(chemins.atelier.rendezVous.agenda(site?.id))}
                  dense
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {site ? (
        <DialogueNouveauRendezVous
          ouvert={dialogueOuvert}
          onOpenChange={setDialogueOuvert}
          client={clientCreation}
          vehicule={vehicule}
          slotSelecteurClient={
            <SelecteurClientVehicule
              valeur={clientCreation?.id ?? null}
              libelle={t('planning:champs.client')}
              onChangeValeur={(_id, client) => setClientCreation(client)}
            />
          }
          onChangerClient={clientCreation ? () => setClientCreation(null) : undefined}
          site={site}
          motifsDisponibles={requeteMotifs.data ?? []}
          onConfirmer={onConfirmer}
          enCours={creation.enCours}
          erreur={creation.erreur ? messageErreur(creation.erreur, t) : null}
          confirmationsRequises={creation.confirmationsRequises}
          onConfirmerQuandMeme={() => creation.confirmerEtResoumettre({ onSuccess: apresCreation })}
        />
      ) : null}
    </Card>
  );
}
