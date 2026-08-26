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
import { CarteRendezVous } from '@/composants/rendez-vous/CarteRendezVous';
import { DialogueNouveauRendezVous } from '@/composants/rendez-vous/DialogueNouveauRendezVous';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { libelleMotif, type RendezVousCarte } from '@/composants/rendez-vous/types';
import { useCreationRendezVous } from '@/hooks/rendez-vous/useCreationRendezVous';
import { useMotifsRendezVous } from '@/hooks/rendez-vous/useMotifsRendezVous';
import { useLangue } from '@/hooks/useLangue';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { EtatSousCollection } from './onglets/EtatSousCollection';
import { clesRendezVousAVenirClient, useRendezVousAVenirClient } from './useRendezVousAVenirClient';

interface Props {
  readonly client: ClientResume;
  /** Véhicules DÉJÀ chargés par `EcranFicheClient` (`useVehiculesClient`) — pas de second appel
   *  réseau pour la même donnée. */
  readonly vehiculesClient: readonly VehiculeResume[];
  /** `undefined` = aucun site résolvable pour ce compte (cas limite, tenant mal paramétré) — le
   *  bouton de prise de rendez-vous reste alors masqué, `DialogueNouveauRendezVous.site` est
   *  obligatoire (même garde que `EcranRendezVous.tsx`, point d'entrée 1). */
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
 * « Prendre un rendez-vous » depuis la fiche client (point d'entrée 2, constat de @laupernoe : « seul
 * l'agenda est câblé »). Réutilise `DialogueNouveauRendezVous` (Écran 2, dialogue UNIQUE des trois
 * points d'entrée) plutôt qu'un second formulaire — client déjà renseigné (jamais de sélecteur
 * client ici, il est fixé par la fiche d'origine), véhicule préempli SEULEMENT si le client en a
 * exactement un (RM, arbitrage du chantier : « un rendez-vous sans véhicule connu est légitime, ne
 * force pas le choix » — `ReponseRendezVous.vehicule` peut être `null`).
 */
export function SectionRendezVousClient({ client, vehiculesClient, site }: Props) {
  const { t } = useTranslation(['clients', 'planning', 'commun', 'erreurs']);
  const { langue } = useLangue();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [vehiculeCreation, setVehiculeCreation] = useState<VehiculeResume | null>(null);
  const [vehiculeIgnore, setVehiculeIgnore] = useState(false);
  const [rdvVenantDetreCree, setRdvVenantDetreCree] = useState<ReponseRendezVous | null>(null);

  const requeteRdv = useRendezVousAVenirClient(client.id);
  const requeteMotifs = useMotifsRendezVous();
  const creation = useCreationRendezVous();

  function ouvrirDialogue() {
    setVehiculeIgnore(false);
    setRdvVenantDetreCree(null);
    // Un seul véhicule connu -> préempli directement (pas de choix à faire) ; zéro ou plusieurs ->
    // laissé à `null`, résolu par le sélecteur ci-dessous (ou par un rendez-vous sans véhicule).
    setVehiculeCreation(vehiculesClient.length === 1 ? (vehiculesClient[0] ?? null) : null);
    setDialogueOuvert(true);
  }

  function apresCreation(rdv: ReponseRendezVous) {
    setDialogueOuvert(false);
    setRdvVenantDetreCree(rdv);
    void queryClient.invalidateQueries({ queryKey: clesRendezVousAVenirClient(client.id) });
  }

  function onConfirmer(donnees: EntreeCreationRendezVous) {
    creation.soumettre(donnees, { onSuccess: apresCreation });
  }

  // Sélecteur de véhicule affiché seulement si le client en a plusieurs ET que ni un véhicule ni
  // « sans véhicule » n'a déjà été choisi — sinon `slotSelecteurVehicule` resterait un ReactNode
  // toujours vrai et bloquerait l'étape (piège identifié dans `DialogueNouveauRendezVous`, évité
  // ici en gardant `slotSelecteurVehicule` réellement `undefined` une fois ignoré).
  const afficherSelecteurVehicule = !vehiculeIgnore && vehiculesClient.length > 1;

  const rendezVousAVenir = requeteRdv.data ?? [];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="texte-titre-section font-medium text-foreground">
          {t('clients:fiche.rendezVous.titre')}
        </h2>
        {site ? (
          <Button type="button" variant="outline" size="sm" onClick={ouvrirDialogue}>
            <CalendarPlus aria-hidden className="h-4 w-4" />
            {t('clients:fiche.rendezVous.prendre')}
          </Button>
        ) : null}
      </div>

      {rdvVenantDetreCree ? (
        <Alert>
          <AlertTitle>{t('clients:fiche.rendezVous.creeTitre')}</AlertTitle>
          <AlertDescription>
            {formaterDate(rdvVenantDetreCree.dateLe)} ·{' '}
            {rdvVenantDetreCree.heureSouhaitee
              ? rdvVenantDetreCree.heureSouhaitee.slice(0, 5)
              : t(`planning:moments.${rdvVenantDetreCree.moment}`)}{' '}
            — {libelleMotif(rdvVenantDetreCree.motif, langue)}
          </AlertDescription>
        </Alert>
      ) : null}

      <EtatSousCollection
        enChargement={requeteRdv.isLoading}
        erreur={requeteRdv.error}
        onReessayer={() => void requeteRdv.refetch()}
        vide={rendezVousAVenir.length === 0}
        texteVide={t('clients:fiche.rendezVous.vide')}
      >
        <ul className="space-y-2">
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
      </EtatSousCollection>

      {site ? (
        <DialogueNouveauRendezVous
          ouvert={dialogueOuvert}
          onOpenChange={setDialogueOuvert}
          client={client}
          vehicule={vehiculeCreation}
          slotSelecteurVehicule={
            afficherSelecteurVehicule ? (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {vehiculesClient.map((vehicule) => (
                  // Bordure structurelle : élément interactif (sélection du véhicule pour le
                  // nouveau rendez-vous).
                  <button
                    key={vehicule.id}
                    type="button"
                    onClick={() => setVehiculeCreation(vehicule)}
                    className="rounded-md border border-input p-2 text-left hover:bg-muted anneau-focus"
                  >
                    <IdentiteVehicule vehicule={vehicule} />
                  </button>
                ))}
              </div>
            ) : undefined
          }
          onChangerVehicule={
            vehiculeCreation
              ? () => {
                  setVehiculeCreation(null);
                  setVehiculeIgnore(false);
                }
              : undefined
          }
          onIgnorerVehicule={afficherSelecteurVehicule ? () => setVehiculeIgnore(true) : undefined}
          site={site}
          motifsDisponibles={requeteMotifs.data ?? []}
          onConfirmer={onConfirmer}
          enCours={creation.enCours}
          erreur={creation.erreur ? messageErreur(creation.erreur, t) : null}
          confirmationsRequises={creation.confirmationsRequises}
          onConfirmerQuandMeme={() => creation.confirmerEtResoumettre({ onSuccess: apresCreation })}
        />
      ) : null}
    </section>
  );
}
