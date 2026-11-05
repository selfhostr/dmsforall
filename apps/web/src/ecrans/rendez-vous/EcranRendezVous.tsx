import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import type { ClientResume, ReponseRendezVous, VehiculeResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Input } from '@/components/ui/input';
import { DialogueArriveeRendezVous } from '@/composants/rendez-vous/DialogueArriveeRendezVous';
import { DialogueNouveauRendezVous } from '@/composants/rendez-vous/DialogueNouveauRendezVous';
import { PanneauDetailRendezVous } from '@/composants/rendez-vous/PanneauDetailRendezVous';
import {
  libelleMotif,
  type JourAgenda,
  type RendezVousCarte,
  type RendezVousDetail,
} from '@/composants/rendez-vous/types';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { useListeClients } from '@/hooks/clients/useListeClients';
import { useAgendaRendezVous } from '@/hooks/rendez-vous/useAgendaRendezVous';
import { useArriveeRendezVous } from '@/hooks/rendez-vous/useArriveeRendezVous';
import { useCapaciteRendezVous } from '@/hooks/rendez-vous/useCapaciteRendezVous';
import { useCreationRendezVous } from '@/hooks/rendez-vous/useCreationRendezVous';
import { useMotifsRendezVous } from '@/hooks/rendez-vous/useMotifsRendezVous';
import {
  useAbsenceRendezVous,
  useAnnulerRendezVous,
} from '@/hooks/rendez-vous/useTransitionsRendezVous';
import { useVueAgendaPreferee, type VueAgenda } from '@/hooks/rendez-vous/useVueAgendaPreferee';
import {
  ajouterJours,
  joursDeLaSemaine,
  versDateIsoLocale,
} from '@/hooks/rendez-vous/periode-agenda';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { formaterDate } from '@/lib/formats';
import { useLangue } from '@/hooks/useLangue';
import { useSession } from '@/hooks/useSession';

import { EcranAgendaRendezVous, type VueAgendaEcran } from './EcranAgendaRendezVous';
import { peutAgirSurRendezVous, peutCreerRendezVous, peutLireRendezVous } from './droits';

function versCarte(
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

function versDetail(
  rdv: ReponseRendezVous,
  siteNom: string,
  langue: Parameters<typeof libelleMotif>[1],
): RendezVousDetail {
  return {
    ...versCarte(rdv, langue),
    siteNom,
    remarque: rdv.commentaire,
    motifAnnulation: rdv.motifAnnulation,
    // Aucun journal d'audit exposé par `/rendez-vous/{id}` à ce jour (pas d'endpoint dédié, à la
    // différence de `GET /ordres-reparation/{id}/journal`) — vide plutôt qu'un historique inventé
    // avec un auteur qu'on ne connaît pas (`creeParId` est un uuid nu, sans nom résolu ici).
    historique: [],
    ordreReparationId: rdv.ordreReparationId,
  };
}

/**
 * Conteneur réseau de l'agenda de rendez-vous — Écran 1
 * (`docs/conception-rendez-vous-ecrans.md`). Branche `EcranAgendaRendezVous` (présentation pure,
 * déjà testée) sur les hooks réels. Point d'entrée 1 SEULEMENT (depuis l'agenda) : les points
 * d'entrée 2/3 (fiche client/véhicule) restent à câbler par les écrans `ecrans/clients/`/
 * `ecrans/vehicules/`, hors du périmètre d'écriture de cet agent — voir le rapport de livraison.
 */
export function EcranRendezVous() {
  const { t, i18n } = useTranslation(['planning', 'commun', 'erreurs']);
  const { langue } = useLangue();
  const [searchParams] = useSearchParams();
  const siteId = searchParams.get('site') ?? undefined;

  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  const site = siteId ? session?.sites.find((s) => s.id === siteId) : undefined;

  const [vueListe, setVueListe] = useState(false);
  const [vueJourSemaine, setVueJourSemaine] = useVueAgendaPreferee();
  const vue: VueAgendaEcran = vueListe ? 'liste' : vueJourSemaine;

  function onChangerVue(nouvelleVue: VueAgendaEcran) {
    if (nouvelleVue === 'liste') {
      setVueListe(true);
    } else {
      setVueListe(false);
      setVueJourSemaine(nouvelleVue as VueAgenda);
    }
  }

  const [dateReference, setDateReference] = useState(() => new Date());
  const [recherche, setRecherche] = useState('');

  const jours7 = useMemo(() => joursDeLaSemaine(dateReference), [dateReference]);
  const dateRefIso = versDateIsoLocale(dateReference);
  const premierJourSemaine = jours7[0] ?? dateReference;
  const dernierJourSemaine = jours7[6] ?? dateReference;
  const periode =
    vue === 'jour'
      ? { du: dateRefIso, au: dateRefIso }
      : { du: versDateIsoLocale(premierJourSemaine), au: versDateIsoLocale(dernierJourSemaine) };

  const formateurJourComplet = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [i18n.language],
  );
  const periodeLabel =
    vue === 'jour'
      ? formateurJourComplet.format(dateReference)
      : `${formaterDate(periode.du)} – ${formaterDate(periode.au)}`;

  function onPrecedent() {
    setDateReference((d) => ajouterJours(d, vue === 'jour' ? -1 : -7));
  }
  function onSuivant() {
    setDateReference((d) => ajouterJours(d, vue === 'jour' ? 1 : 7));
  }
  function onAujourdhui() {
    setDateReference(new Date());
  }

  const filtresPeriode = site ? { du: periode.du, au: periode.au, siteId: site.id } : undefined;
  const requeteAgenda = useAgendaRendezVous(filtresPeriode);
  const requeteCapacite = useCapaciteRendezVous(filtresPeriode);

  const jours: readonly JourAgenda[] = useMemo(() => {
    const rdvParJour = new Map<string, ReponseRendezVous[]>();
    for (const rdv of requeteAgenda.data?.donnees ?? []) {
      const liste = rdvParJour.get(rdv.dateLe) ?? [];
      liste.push(rdv);
      rdvParJour.set(rdv.dateLe, liste);
    }
    const capaciteParJour = new Map<string, { occupe: number; capacite: number | null }>();
    for (const entree of requeteCapacite.data?.jours ?? []) {
      const courant = capaciteParJour.get(entree.dateLe) ?? { occupe: 0, capacite: null };
      capaciteParJour.set(entree.dateLe, {
        occupe: courant.occupe + entree.minutesOccupees,
        // Simplification assumée du lot 1 (budget JOURNALIER, identique pour tous les moments) :
        // la première capacité non nulle rencontrée pour ce jour suffit.
        capacite: courant.capacite ?? entree.capaciteMinutes,
      });
    }

    const datesAffichees = vue === 'jour' ? [dateReference] : jours7;
    return datesAffichees.map((date) => {
      const dateIso = versDateIsoLocale(date);
      const rdvs = rdvParJour.get(dateIso) ?? [];
      const capacite = capaciteParJour.get(dateIso);
      return {
        dateIso,
        date,
        nombreRendezVous: rdvs.length,
        minutesOccupees: capacite?.occupe ?? 0,
        capaciteMinutes: capacite?.capacite ?? null,
        rendezVous: rdvs.map((rdv) => versCarte(rdv, langue)),
      };
    });
  }, [requeteAgenda.data, requeteCapacite.data, vue, dateReference, jours7, langue]);

  const etat: 'chargement' | 'erreur' | 'contenu' =
    requeteAgenda.isPending || requeteCapacite.isPending
      ? 'chargement'
      : requeteAgenda.isError || requeteCapacite.isError
        ? 'erreur'
        : 'contenu';
  const erreurActive = requeteAgenda.error ?? requeteCapacite.error;

  // --- Écran 2 : nouveau rendez-vous (point d'entrée 1, depuis l'agenda) --------------------------
  const [dialogueOuvert, setDialogueOuvert] = useState(false);
  const [dateCreneauInitiale, setDateCreneauInitiale] = useState<string | undefined>(undefined);
  const [clientCreation, setClientCreation] = useState<ClientResume | null>(null);
  const [vehiculeCreation, setVehiculeCreation] = useState<VehiculeResume | null>(null);
  const [vehiculeIgnore, setVehiculeIgnore] = useState(false);
  const [rechercheClient, setRechercheClient] = useState('');

  const requeteMotifs = useMotifsRendezVous();
  const creation = useCreationRendezVous();
  const [rechercheClientTemporisee] = useValeurDebouncee(rechercheClient);
  const rechercheClientsActive = rechercheClientTemporisee.trim().length >= 2;
  const requeteClients = useListeClients(
    { q: rechercheClientTemporisee },
    { enabled: rechercheClientsActive },
  );
  const requeteVehiculesCreation = useVehiculesClient(
    !vehiculeIgnore ? (clientCreation?.id ?? undefined) : undefined,
  );

  function ouvrirNouveauRendezVous(dateInitiale?: string) {
    setClientCreation(null);
    setVehiculeCreation(null);
    setVehiculeIgnore(false);
    setRechercheClient('');
    setDateCreneauInitiale(dateInitiale);
    setDialogueOuvert(true);
  }

  function onCliquerJour(jour: JourAgenda) {
    setDateReference(jour.date);
    onChangerVue('jour');
  }

  // --- Écran 3 : détail --------------------------------------------------------------------------
  const [rdvSelectionneId, setRdvSelectionneId] = useState<string | null>(null);
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [dialogueArriveeOuvert, setDialogueArriveeOuvert] = useState(false);

  const rdvSelectionne = requeteAgenda.data?.donnees.find((r) => r.id === rdvSelectionneId) ?? null;

  const absence = useAbsenceRendezVous(rdvSelectionneId ?? '');
  const annuler = useAnnulerRendezVous(rdvSelectionneId ?? '');
  const arrivee = useArriveeRendezVous(rdvSelectionneId ?? '');

  function onOuvrirRendezVous(carte: RendezVousCarte) {
    setRdvSelectionneId(carte.id);
    setPanneauOuvert(true);
  }

  const peutLire = peutLireRendezVous(role);
  const peutCreer = peutCreerRendezVous(role);
  const peutAgir = peutAgirSurRendezVous(role);

  if (!peutLire && role !== undefined) {
    // Défensif d'ergonomie seulement — la route est déjà gardée par `ROLES_LECTURE_RENDEZ_VOUS`
    // (`routes/routeur.tsx`), le serveur reste l'arbitre final (même doctrine que
    // `ecrans/atelier/droits.ts`).
    return null;
  }

  return (
    <>
      <EcranAgendaRendezVous
        site={site ? { id: site.id, nom: site.nom } : undefined}
        vue={vue}
        onChangerVue={onChangerVue}
        periodeLabel={periodeLabel}
        onPrecedent={onPrecedent}
        onSuivant={onSuivant}
        onAujourdhui={onAujourdhui}
        recherche={recherche}
        onChangerRecherche={setRecherche}
        onNouveauRendezVous={peutCreer ? () => ouvrirNouveauRendezVous() : undefined}
        etat={etat}
        messageErreur={erreurActive ? messageErreur(erreurActive, t) : undefined}
        onReessayer={() => {
          void requeteAgenda.refetch();
          void requeteCapacite.refetch();
        }}
        jours={jours}
        onCliquerJour={onCliquerJour}
        onOuvrirRendezVous={onOuvrirRendezVous}
      />

      {site ? (
        <DialogueNouveauRendezVous
          ouvert={dialogueOuvert}
          onOpenChange={setDialogueOuvert}
          client={clientCreation}
          vehicule={vehiculeCreation}
          site={site}
          dateInitiale={dateCreneauInitiale}
          motifsDisponibles={requeteMotifs.data ?? []}
          onIgnorerVehicule={!vehiculeIgnore ? () => setVehiculeIgnore(true) : undefined}
          slotSelecteurClient={
            <div className="flex flex-col gap-2">
              <Input
                value={rechercheClient}
                onChange={(evenement) => setRechercheClient(evenement.target.value)}
                placeholder={t('planning:dialogueNouveau.rechercheClientPlaceholder')}
                aria-label={t('planning:champs.client')}
              />
              {rechercheClientsActive ? (
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                  {(requeteClients.data?.pages.flatMap((p) => p.donnees) ?? []).map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => setClientCreation(client)}
                      className="rounded-md border border-input p-2 text-left hover:bg-muted anneau-focus"
                    >
                      <IdentiteClient client={client} />
                    </button>
                  ))}
                  {requeteClients.data?.pages.flatMap((p) => p.donnees).length === 0 ? (
                    <p className="texte-libelle text-muted-foreground">
                      {t('planning:dialogueNouveau.aucunClient')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          }
          slotSelecteurVehicule={
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {(requeteVehiculesCreation.data?.pages.flatMap((p) => p.donnees) ?? []).map(
                (vehicule) => (
                  <button
                    key={vehicule.id}
                    type="button"
                    onClick={() => setVehiculeCreation(vehicule)}
                    className="rounded-md border border-input p-2 text-left hover:bg-muted anneau-focus"
                  >
                    <IdentiteVehicule vehicule={vehicule} />
                  </button>
                ),
              )}
              {requeteVehiculesCreation.data &&
              requeteVehiculesCreation.data.pages.flatMap((p) => p.donnees).length === 0 ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('planning:dialogueNouveau.aucunVehicule')}
                </p>
              ) : null}
            </div>
          }
          onConfirmer={(donnees) =>
            creation.soumettre(donnees, { onSuccess: () => setDialogueOuvert(false) })
          }
          enCours={creation.enCours}
          erreur={creation.erreur ? messageErreur(creation.erreur, t) : null}
          confirmationsRequises={creation.confirmationsRequises}
          onConfirmerQuandMeme={() =>
            creation.confirmerEtResoumettre({ onSuccess: () => setDialogueOuvert(false) })
          }
        />
      ) : null}

      {rdvSelectionne && site ? (
        <PanneauDetailRendezVous
          ouvert={panneauOuvert}
          onOpenChange={setPanneauOuvert}
          rendezVous={versDetail(rdvSelectionne, site.nom, langue)}
          siteUrl={site.id}
          // Le jour J : comparaison sur la DATE seule (pas d'heure de rendez-vous garantie —
          // `heureSouhaitee` optionnel) — le rendez-vous devient actionnable dès le jour même.
          estJourJOuApres={rdvSelectionne.dateLe <= versDateIsoLocale(new Date())}
          // Pas de paramètre de délai de grâce exposé par le contrat à ce jour — simplification
          // assumée : actionnable dès le jour J (signalé dans le rapport de livraison).
          delaiGracePasse={rdvSelectionne.dateLe <= versDateIsoLocale(new Date())}
          peutAgir={peutAgir}
          onVehiculeArrive={() => setDialogueArriveeOuvert(true)}
          onSignalerAbsence={() => absence.mutate({}, { onSuccess: () => setPanneauOuvert(false) })}
          onAnnuler={(motif) =>
            annuler.mutate({ motif }, { onSuccess: () => setPanneauOuvert(false) })
          }
          enCoursAction={absence.isPending || annuler.isPending}
          erreurAction={
            absence.error
              ? messageErreur(absence.error, t)
              : annuler.error
                ? messageErreur(annuler.error, t)
                : null
          }
        />
      ) : null}

      <DialogueArriveeRendezVous
        ouvert={dialogueArriveeOuvert}
        onOpenChange={setDialogueArriveeOuvert}
        onConfirmer={(entree) =>
          // Ferme SEULEMENT le dialogue de saisie — le panneau de détail reste ouvert (issue #108,
          // second volet) : un succès qui referme aussi le panneau ramène le réceptionniste au
          // planning sans qu'il voie le rendez-vous passer à « Arrivé », ce qui a été confondu sur
          // le terrain avec « rien ne s'est passé ». `rdvSelectionne` se met à jour tout seul dès
          // que `requeteAgenda` se rafraîchit (invalidation `['rdv','plage']` dans le hook).
          arrivee.soumettre(entree, {
            onSuccess: () => setDialogueArriveeOuvert(false),
          })
        }
        enCours={arrivee.enCours}
        erreur={arrivee.erreur ? messageErreur(arrivee.erreur, t) : null}
        confirmationsRequises={arrivee.confirmationsRequises}
        onConfirmerQuandMeme={() =>
          arrivee.confirmerEtResoumettre({
            onSuccess: () => setDialogueArriveeOuvert(false),
          })
        }
      />
    </>
  );
}
