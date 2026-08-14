/**
 * Rendez-vous d'atelier de démonstration (migrations/0052_rendez_vous_atelier.sql) — complète
 * `seed-dev.ts`/`seed-atelier-demo.ts` avec :
 *   1. le référentiel `motif_rendez_vous` (aucune ligne semée jusqu'ici — la table existe depuis
 *      0005 mais n'avait aucun consommateur avant ce lot) ;
 *   2. six rendez-vous à dates FIXES couvrant les quatre statuts (`confirme`/`honore`/`absent`/
 *      `annule`), les deux origines (`reservation`/`retroactif`), le cas `vehicule_id` NULL, et
 *      deux liens réels vers des OR existants (`ordre_reparation.rendez_vous_id`, FK posée par
 *      0052) ; PLUS quatre rendez-vous à dates DÉRIVÉES de l'exécution du seed (jamais figées) :
 *      deux confirmés du jour courant sur des créneaux différents (parcours nominal « le véhicule
 *      est arrivé »), un honoré plus tôt dans la journée (lié au second OR BMW délibéré, voir
 *      `seed-atelier-demo.ts` § « OR n°5 »), et un confirmé plus tard cette semaine.
 *
 * PAS de `ServiceRendezVous` à câbler ici (à la différence de `seed-atelier-demo.ts` et consorts) :
 * ce lot est le socle DONNÉES seul (`apps/api/src/db/`) — le service applicatif
 * (`apps/api/src/rendezvous/`) est construit par un agent parallèle, absent au moment où ce fichier
 * est écrit. Les écritures ci-dessous passent donc par `AccesBase.enTenant` (RLS, rôle `dfa_app`)
 * avec des INSERT/UPDATE Drizzle bruts — pas une entorse à la doctrine du dossier, une conséquence
 * de son périmètre : dès que `ServiceRendezVous` existe, ce fichier peut être réécrit pour
 * l'emprunter, comme `seed-pneus-demo.ts` emprunte `ServiceDepotPneus`.
 *
 * Idempotent par construction : `motif_rendez_vous` upserté sur (tenant_id, code) — sa clé
 * naturelle — et chaque `rendez_vous` upserté sur son `id` FIXE (uuid v4 littéral, jamais généré) ;
 * un rejeu avec les MÊMES valeurs ne fait donc rien de plus qu'un UPDATE sans effet. Le trigger
 * `rendez_vous_empecher_reouverture` (0052 §3) ne bloque PAS ce rejeu : il ne refuse qu'un
 * changement RÉEL de `statut` depuis un état terminal, jamais une réécriture à l'identique
 * (`new.statut is distinct from old.statut` est FAUX quand la valeur ne change pas).
 */
import 'reflect-metadata';

import { and, eq } from 'drizzle-orm';

import type { ConfigBase, ContexteTenant } from '../index';
import { motifRendezVous, ordreReparation, rendezVous } from '../schema';
import { ServiceAccesBase } from '../acces-base.service';

export interface OptionsSeedRendezVous {
  readonly config: ConfigBase;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsClientsParNumero: ReadonlyMap<string, string>;
  readonly idsVehiculesParCle: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  /** `seed-atelier-demo.ts::ResultatSeedAtelier.idsOrdresReparationParCle` — permet de lier des
   *  OR de démo existants à un rendez-vous réel (`ordre_reparation.rendez_vous_id`, FK 0052) :
   *  `golf`/`bmw` pour les deux liens historiques, `bmw-second` pour le rendez-vous honoré du jour
   *  courant (voir `seed-atelier-demo.ts` § « OR n°5 »). */
  readonly idsOrdresReparationParCle: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

/** Référentiel garage suisse — un garage réel a exactement ces catégories au comptoir : entretien
 *  courant, pneus, expertise MFK (obligatoire périodiquement en Suisse), diagnostic, panne, et un
 *  motif générique pour le client qui ne sait pas décrire son problème au téléphone (arbitrage de
 *  @laupernoe : l'obligation de choisir un motif ne doit jamais devenir un piège au comptoir). Durées en
 *  minutes, mêmes ordres de grandeur que `seed-atelier-demo.ts` (temps barémé des lignes d'OR). */
const MOTIFS_RENDEZ_VOUS_DEMO = [
  {
    code: 'SERVICE',
    libelleFr: 'Entretien / service courant',
    libelleDe: 'Service / Wartung',
    libelleIt: 'Tagliando / manutenzione',
    dureeDefautMinutes: 60,
  },
  {
    code: 'PNEUS',
    libelleFr: 'Changement de pneus (jeu complet)',
    libelleDe: 'Reifenwechsel (kompletter Satz)',
    libelleIt: 'Cambio pneumatici (set completo)',
    dureeDefautMinutes: 45,
  },
  {
    code: 'EXPERTISE-MFK',
    libelleFr: 'Passage à l’expertise MFK',
    libelleDe: 'MFK-Vorführung',
    libelleIt: 'Passaggio al collaudo (MFK)',
    dureeDefautMinutes: 90,
  },
  {
    code: 'DIAGNOSTIC',
    libelleFr: 'Diagnostic panne',
    libelleDe: 'Fehlerdiagnose',
    libelleIt: 'Diagnosi guasto',
    dureeDefautMinutes: 30,
  },
  {
    code: 'PANNE',
    libelleFr: 'Panne / dépannage',
    libelleDe: 'Panne / Pannenhilfe',
    libelleIt: 'Guasto / soccorso',
    dureeDefautMinutes: 60,
  },
  {
    // Arbitrage de @laupernoe : catch-all pour le client qui ne sait pas décrire sa panne au téléphone —
    // le motif reste obligatoire, mais ce choix-là ne demande aucune compétence diagnostique.
    code: 'A-DETERMINER',
    libelleFr: 'À déterminer — diagnostic au comptoir',
    libelleDe: 'Noch zu bestimmen — Diagnose am Schalter',
    libelleIt: 'Da determinare — diagnosi al banco',
    dureeDefautMinutes: 30,
  },
] as const;

/** Clés d'upsert FIXES (uuid v4 littéraux, jamais générés à l'exécution) — même doctrine que
 *  `seed-atelier-demo.ts` (clés d'idempotence) : c'est ce qui rend ce script REJOUABLE. */
const ID_RDV_DUPONT_SERVICE = 'b6f3a6d4-7e1e-4b6a-9b0a-1a7f0c9e2a11';
const ID_RDV_MEIER_GOLF_HONORE = 'c1a2e6a0-5b3d-4c8e-8f7a-2d6b1e4c9a22';
const ID_RDV_MEIER_ABSENT = 'd4b7f2c1-9a6e-4d1b-8c3a-3e7c2f5d8b33';
const ID_RDV_DUPONT_ANNULE = 'e7c8a3d2-6f4b-4e2c-9d5a-4f8d3a6e7c44';
const ID_RDV_MEIER_BMW_RETROACTIF = 'f2d9b4e3-8a5c-4f3d-ae6b-5a9e4b7f2d55';
const ID_RDV_RHONE_PNEUS = 'a3e0c5f4-1b6d-4a4e-bf7c-6b0f5c8a3e66';

/** Rendez-vous du jour courant — démontrent le parcours nominal du jour. */
const ID_RDV_AUJOURD_HUI_MATIN = 'c5e1a9f7-2b4d-4f6c-a8d2-8f3e5c7b1a4d';
const ID_RDV_AUJOURD_HUI_APRES = 'd6f2ba08-3c5e-5d7c-b9e3-9e4f6d8c2b5e';
/** Déjà honoré plus tôt dans la journée — voir `seed-atelier-demo.ts` § « OR n°5 — BMW (second) » :
 *  c'est CE rendez-vous qui « explique » le second OR ouvert sur le véhicule BMW de Mme Meier. */
const ID_RDV_AUJOURD_HUI_BMW_HONORE = '5b6ceba3-ed1e-463b-b1e1-aa31e7d1491e';
/** Confirmé, plus tard cette semaine (date dérivée de l'exécution du seed, jamais figée). */
const ID_RDV_SEMAINE_MASTER_SERVICE = '71306309-e26d-4ef2-b9be-475a77e68658';

export async function semerRendezVousDemo(options: OptionsSeedRendezVous): Promise<void> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration rendez-vous est interdit en production : il crée un référentiel de motifs et des rendez-vous factices.`,
    );
  }

  const idSion = options.idsSitesParCode.get('SION');
  const idMartigny = options.idsSitesParCode.get('MARTIGNY');
  const idClientMeier = options.idsClientsParNumero.get('CL-000001');
  const idClientDupont = options.idsClientsParNumero.get('CL-000002');
  const idClientRhone = options.idsClientsParNumero.get('CL-000003');
  const idGolf = options.idsVehiculesParCle.get('WVWZZZ1KZAW123456');
  const idOctavia = options.idsVehiculesParCle.get('TMBJJ7NE1M0123457');
  const idMaster = options.idsVehiculesParCle.get('Renault::Master::Fourgon L2H2');
  const idBmw = options.idsVehiculesParCle.get('WBA8E9106K5E12348');
  const idReceptionnaire = options.idsUtilisateursParRole.get('receptionnaire');
  const idOrGolf = options.idsOrdresReparationParCle.get('golf');
  const idOrBmw = options.idsOrdresReparationParCle.get('bmw');
  const idOrBmwSecond = options.idsOrdresReparationParCle.get('bmw-second');

  if (
    !idSion ||
    !idMartigny ||
    !idClientMeier ||
    !idClientDupont ||
    !idClientRhone ||
    !idGolf ||
    !idOctavia ||
    !idMaster ||
    !idBmw ||
    !idReceptionnaire ||
    !idOrGolf ||
    !idOrBmw ||
    !idOrBmwSecond
  ) {
    throw new Error(
      `seed-rendez-vous-demo : une clé attendue de seed-dev.ts ou seed-atelier-demo.ts est absente ` +
        `(site, client, véhicule, receptionnaire ou OR golf/bmw/bmw-second) — vérifier que ` +
        `seed-atelier-demo.ts tourne bien AVANT seed-rendez-vous-demo.ts dans seed-dev.ts::principal().`,
    );
  }

  const acces = new ServiceAccesBase({
    NODE_ENV: options.config.NODE_ENV,
    DATABASE_URL: options.config.DATABASE_URL,
    DATABASE_POOL_MAX: options.config.DATABASE_POOL_MAX,
    DATABASE_POOL_MIN: options.config.DATABASE_POOL_MIN,
    DATABASE_TIMEOUT_REQUETE_MS: options.config.DATABASE_TIMEOUT_REQUETE_MS,
    DATABASE_TIMEOUT_CONNEXION_MS: options.config.DATABASE_TIMEOUT_CONNEXION_MS,
    DATABASE_TIMEOUT_IDLE_MS: options.config.DATABASE_TIMEOUT_IDLE_MS,
  });

  try {
    const ctx: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idReceptionnaire,
      requeteId: null,
    };

    await acces.enTenant(ctx, async (tx) => {
      // --- Référentiel motif_rendez_vous ---------------------------------------------------------
      const idsMotifsParCode = new Map<string, string>();
      for (const m of MOTIFS_RENDEZ_VOUS_DEMO) {
        const [ligne] = await tx
          .insert(motifRendezVous)
          .values({
            tenantId: options.tenantId,
            code: m.code,
            libelleFr: m.libelleFr,
            libelleDe: m.libelleDe,
            libelleIt: m.libelleIt,
            dureeDefautMinutes: m.dureeDefautMinutes,
            actif: true,
          })
          .onConflictDoUpdate({
            target: [motifRendezVous.tenantId, motifRendezVous.code],
            set: {
              libelleFr: m.libelleFr,
              libelleDe: m.libelleDe,
              libelleIt: m.libelleIt,
              dureeDefautMinutes: m.dureeDefautMinutes,
              actif: true,
            },
          })
          .returning({ id: motifRendezVous.id });
        const idMotif =
          ligne?.id ??
          (
            await tx
              .select({ id: motifRendezVous.id })
              .from(motifRendezVous)
              .where(
                and(
                  eq(motifRendezVous.tenantId, options.tenantId),
                  eq(motifRendezVous.code, m.code),
                ),
              )
          )[0]?.id;
        if (idMotif === undefined) {
          throw new Error(`motif_rendez_vous « ${m.code} » introuvable après upsert.`);
        }
        idsMotifsParCode.set(m.code, idMotif);
      }
      journaliser(`  motifs de rendez-vous : ${String(MOTIFS_RENDEZ_VOUS_DEMO.length)} référencés`);

      const idMotifService = idsMotifsParCode.get('SERVICE');
      const idMotifPneus = idsMotifsParCode.get('PNEUS');
      const idMotifExpertise = idsMotifsParCode.get('EXPERTISE-MFK');
      const idMotifDiagnostic = idsMotifsParCode.get('DIAGNOSTIC');
      const idMotifPanne = idsMotifsParCode.get('PANNE');
      const idMotifADeterminer = idsMotifsParCode.get('A-DETERMINER');
      if (
        !idMotifService ||
        !idMotifPneus ||
        !idMotifExpertise ||
        !idMotifDiagnostic ||
        !idMotifPanne ||
        !idMotifADeterminer
      ) {
        throw new Error(`seed-rendez-vous-demo : un motif attendu est introuvable après upsert.`);
      }

      // --- Rendez-vous ------------------------------------------------------------------------

      // 1. Confirmé, à venir — cas nominal (Dupont/Octavia, MARTIGNY).
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_DUPONT_SERVICE,
          tenantId: options.tenantId,
          siteId: idMartigny,
          clientId: idClientDupont,
          vehiculeId: idOctavia,
          motifId: idMotifService,
          type: 'service',
          date: '2026-08-20',
          moment: 'matin',
          heureSouhaitee: null,
          dureeEstimeeMinutes: 60,
          statut: 'confirme',
          origine: 'reservation',
          confirmeLe: new Date('2026-08-12T09:15:00.000Z'),
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idMartigny,
            clientId: idClientDupont,
            vehiculeId: idOctavia,
            motifId: idMotifService,
            type: 'service',
            date: '2026-08-20',
            moment: 'matin',
            heureSouhaitee: null,
            dureeEstimeeMinutes: 60,
            statut: 'confirme',
            origine: 'reservation',
          },
        });
      journaliser(`  RDV confirmé — Dupont/Octavia, 20.08 matin (service, 60 min)`);

      // 2. Honoré, lié à l'OR Golf/Meier déjà ouvert (seed-atelier-demo.ts) — le motif reprend le
      //    verbatim de la demande de cet OR ("Bruit de freinage à l'avant").
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_MEIER_GOLF_HONORE,
          tenantId: options.tenantId,
          siteId: idSion,
          clientId: idClientMeier,
          vehiculeId: idGolf,
          motifId: idMotifDiagnostic,
          commentaire: "Bruit de freinage à l'avant droit, à contrôler.",
          type: 'diagnostic',
          date: '2026-08-05',
          moment: 'matin',
          heureSouhaitee: '08:00:00',
          dureeEstimeeMinutes: 45,
          statut: 'honore',
          origine: 'reservation',
          confirmeLe: new Date('2026-08-01T10:00:00.000Z'),
          honoreLe: new Date('2026-08-05T08:05:00.000Z'),
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idSion,
            clientId: idClientMeier,
            vehiculeId: idGolf,
            motifId: idMotifDiagnostic,
            commentaire: "Bruit de freinage à l'avant droit, à contrôler.",
            type: 'diagnostic',
            date: '2026-08-05',
            moment: 'matin',
            heureSouhaitee: '08:00:00',
            dureeEstimeeMinutes: 45,
            statut: 'honore',
            origine: 'reservation',
            honoreLe: new Date('2026-08-05T08:05:00.000Z'),
          },
        });
      await tx
        .update(ordreReparation)
        .set({ rendezVousId: ID_RDV_MEIER_GOLF_HONORE })
        .where(
          and(eq(ordreReparation.tenantId, options.tenantId), eq(ordreReparation.id, idOrGolf)),
        );
      journaliser(`  RDV honoré — Meier/Golf, 05.08 08:00 (diagnostic) → lié à l'OR Golf`);

      // 3. Absent (no-show) — véhicule NON renseigné au téléphone (cas nullable), motif générique.
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_MEIER_ABSENT,
          tenantId: options.tenantId,
          siteId: idSion,
          clientId: idClientMeier,
          vehiculeId: null,
          motifId: idMotifADeterminer,
          commentaire: 'Client dit "ça fait un bruit bizarre", ne sait pas préciser.',
          type: 'diagnostic',
          date: '2026-08-08',
          moment: 'apres_midi',
          heureSouhaitee: null,
          dureeEstimeeMinutes: 30,
          statut: 'absent',
          origine: 'reservation',
          confirmeLe: new Date('2026-08-06T11:00:00.000Z'),
          absentConstateLe: new Date('2026-08-08T14:30:00.000Z'),
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idSion,
            clientId: idClientMeier,
            vehiculeId: null,
            motifId: idMotifADeterminer,
            commentaire: 'Client dit "ça fait un bruit bizarre", ne sait pas préciser.',
            type: 'diagnostic',
            date: '2026-08-08',
            moment: 'apres_midi',
            heureSouhaitee: null,
            dureeEstimeeMinutes: 30,
            statut: 'absent',
            origine: 'reservation',
            absentConstateLe: new Date('2026-08-08T14:30:00.000Z'),
          },
        });
      journaliser(`  RDV absent — Meier, 08.08 après-midi (motif « à déterminer », sans véhicule)`);

      // 4. Annulé — motif d'annulation obligatoire (rendez_vous_annulation_motif_chk).
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_DUPONT_ANNULE,
          tenantId: options.tenantId,
          siteId: idMartigny,
          clientId: idClientDupont,
          vehiculeId: idOctavia,
          motifId: idMotifExpertise,
          type: 'expertise',
          date: '2026-08-10',
          moment: 'toute_journee',
          heureSouhaitee: null,
          dureeEstimeeMinutes: 90,
          statut: 'annule',
          motifAnnulation: 'Client reporte, véhicule pas encore prêt pour le passage MFK.',
          origine: 'reservation',
          confirmeLe: new Date('2026-08-03T09:00:00.000Z'),
          annuleLe: new Date('2026-08-09T16:00:00.000Z'),
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idMartigny,
            clientId: idClientDupont,
            vehiculeId: idOctavia,
            motifId: idMotifExpertise,
            type: 'expertise',
            date: '2026-08-10',
            moment: 'toute_journee',
            heureSouhaitee: null,
            dureeEstimeeMinutes: 90,
            statut: 'annule',
            motifAnnulation: 'Client reporte, véhicule pas encore prêt pour le passage MFK.',
            origine: 'reservation',
            annuleLe: new Date('2026-08-09T16:00:00.000Z'),
          },
        });
      journaliser(`  RDV annulé — Dupont/Octavia, 10.08 (expertise MFK reportée)`);

      // 5. Honoré, ORIGINE rétroactive — walk-in enregistré après coup (parametre_atelier
      //    .rdv_retroactif_auto), lié à l'OR BMW/Meier déjà ouvert.
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_MEIER_BMW_RETROACTIF,
          tenantId: options.tenantId,
          siteId: idSion,
          clientId: idClientMeier,
          vehiculeId: idBmw,
          motifId: idMotifPanne,
          commentaire: 'Grincement au freinage arrière — venu directement au comptoir.',
          type: 'reparation',
          date: '2026-08-11',
          moment: 'matin',
          heureSouhaitee: null,
          dureeEstimeeMinutes: 60,
          statut: 'honore',
          origine: 'retroactif',
          confirmeLe: new Date('2026-08-11T08:00:00.000Z'),
          honoreLe: new Date('2026-08-11T08:00:00.000Z'),
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idSion,
            clientId: idClientMeier,
            vehiculeId: idBmw,
            motifId: idMotifPanne,
            commentaire: 'Grincement au freinage arrière — venu directement au comptoir.',
            type: 'reparation',
            date: '2026-08-11',
            moment: 'matin',
            heureSouhaitee: null,
            dureeEstimeeMinutes: 60,
            statut: 'honore',
            origine: 'retroactif',
            honoreLe: new Date('2026-08-11T08:00:00.000Z'),
          },
        });
      await tx
        .update(ordreReparation)
        .set({ rendezVousId: ID_RDV_MEIER_BMW_RETROACTIF })
        .where(
          and(eq(ordreReparation.tenantId, options.tenantId), eq(ordreReparation.id, idOrBmw)),
        );
      journaliser(`  RDV rétroactif honoré — Meier/BMW, 11.08 (panne, walk-in) → lié à l'OR BMW`);

      // 6. Confirmé, à venir — second site, motif pneus.
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_RHONE_PNEUS,
          tenantId: options.tenantId,
          siteId: idSion,
          clientId: idClientRhone,
          vehiculeId: idMaster,
          motifId: idMotifPneus,
          type: 'pneus',
          date: '2026-08-22',
          moment: 'apres_midi',
          heureSouhaitee: null,
          dureeEstimeeMinutes: 45,
          statut: 'confirme',
          origine: 'reservation',
          confirmeLe: new Date('2026-08-12T10:00:00.000Z'),
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idSion,
            clientId: idClientRhone,
            vehiculeId: idMaster,
            motifId: idMotifPneus,
            type: 'pneus',
            date: '2026-08-22',
            moment: 'apres_midi',
            heureSouhaitee: null,
            dureeEstimeeMinutes: 45,
            statut: 'confirme',
            origine: 'reservation',
          },
        });
      journaliser(`  RDV confirmé — Transports Rhône/Master, 22.08 après-midi (pneus, 45 min)`);

      // --- Rendez-vous du jour courant -------------------------------------------------------
      // Date d'exécution du seed — ces rendez-vous sont créés AUX DATES DU JOUR, pour que le
      // garagiste testant le logiciel le jour du seed voit une journée crédible : des
      // rendez-vous confirmés arrivés ce jour-là (état `confirme`, pas encore honorés ni
      // absents) sur des créneaux différents, un client et un véhicule renseignés, et pas
      // uniquement un bouton rouge « Annuler » (cf. le panneau de détail qui explique l'attente
      // tant que le rendez-vous n'est pas arrivable).
      const maintenant = new Date();
      // `.slice(0, 10)` et JAMAIS `.split('T')[0]` : sous `noUncheckedIndexedAccess` (tsconfig.base
      // .json), l'accès à un élément de tableau par index rend `string | undefined` (TS2769 sur les
      // `.values(...)` Drizzle ci-dessous, qui exigent une colonne `date` définie) — `String.slice`
      // rend directement `string`, sans cette perte de type.
      const jourAujourdHui = maintenant.toISOString().slice(0, 10); // format YYYY-MM-DD
      // Toujours dans le passé par rapport à `maintenant`, quelle que soit l'heure d'exécution du
      // seed (jamais une heure d'horloge murale fixe comme `setHours(7, ...)`, qui pourrait tomber
      // dans le futur si le seed tourne tôt le matin) — sert à `confirmeLe`/`honoreLe` du rendez-vous
      // « déjà arrivé » ci-dessous : sa présence au passé doit rester vraie quelle que soit l'heure.
      const troisHeuresAvantMaintenant = new Date(maintenant.getTime() - 3 * 60 * 60 * 1000);
      const veilleDeMaintenant = new Date(maintenant.getTime() - 24 * 60 * 60 * 1000);
      const dansTroisJours = new Date(maintenant);
      dansTroisJours.setDate(dansTroisJours.getDate() + 3);
      const jourDansTroisJours = dansTroisJours.toISOString().slice(0, 10);

      // 7. Confirmé, prévu ce matin (PAS encore arrivé : statut `confirme`, exerce le parcours
      //    « le véhicule est arrivé ») — Meier/Golf, crénel 08:00.
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_AUJOURD_HUI_MATIN,
          tenantId: options.tenantId,
          siteId: idSion,
          clientId: idClientMeier,
          vehiculeId: idGolf,
          motifId: idMotifService,
          type: 'service',
          date: jourAujourdHui,
          moment: 'matin',
          heureSouhaitee: '08:00:00',
          dureeEstimeeMinutes: 60,
          statut: 'confirme',
          origine: 'reservation',
          confirmeLe: maintenant,
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idSion,
            clientId: idClientMeier,
            vehiculeId: idGolf,
            motifId: idMotifService,
            type: 'service',
            date: jourAujourdHui,
            moment: 'matin',
            heureSouhaitee: '08:00:00',
            dureeEstimeeMinutes: 60,
            statut: 'confirme',
            origine: 'reservation',
          },
        });
      journaliser(`  RDV confirmé du jour — Meier/Golf, ${jourAujourdHui} 08:00 (service, 60 min)`);

      // 8. Confirmé, prévu cet après-midi (PAS encore arrivé) — Dupont/Octavia, crénel 14:00.
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_AUJOURD_HUI_APRES,
          tenantId: options.tenantId,
          siteId: idMartigny,
          clientId: idClientDupont,
          vehiculeId: idOctavia,
          motifId: idMotifDiagnostic,
          type: 'diagnostic',
          date: jourAujourdHui,
          moment: 'apres_midi',
          heureSouhaitee: '14:00:00',
          dureeEstimeeMinutes: 45,
          statut: 'confirme',
          origine: 'reservation',
          confirmeLe: maintenant,
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idMartigny,
            clientId: idClientDupont,
            vehiculeId: idOctavia,
            motifId: idMotifDiagnostic,
            type: 'diagnostic',
            date: jourAujourdHui,
            moment: 'apres_midi',
            heureSouhaitee: '14:00:00',
            dureeEstimeeMinutes: 45,
            statut: 'confirme',
            origine: 'reservation',
          },
        });
      journaliser(
        `  RDV confirmé du jour — Dupont/Octavia (MARTIGNY), ${jourAujourdHui} 14:00 (diagnostic, 45 min)`,
      );

      // 9. Honoré, DÉJÀ arrivé plus tôt dans la journée — BMW/Meier, Sion. Récit : le kit
      //    plaquettes/disques (OR n°4, `bmw`) est en attente fournisseur, rien à faire dessus
      //    aujourd'hui ; Mme Meier revient le jour même pour un problème de démarrage SANS RAPPORT
      //    → second OR actif sur le même véhicule (`bmw-second`, `seed-atelier-demo.ts` § « OR
      //    n°5 »), ouvert avec confirmation explicite de `VEHICULE_DEUX_OR_OUVERTS` (P-29). C'est
      //    ce rendez-vous honoré qui « explique » ce second OR au comptoir.
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_AUJOURD_HUI_BMW_HONORE,
          tenantId: options.tenantId,
          siteId: idSion,
          clientId: idClientMeier,
          vehiculeId: idBmw,
          motifId: idMotifDiagnostic,
          commentaire: 'Problème de démarrage à froid, sans rapport avec les plaquettes en cours.',
          type: 'diagnostic',
          date: jourAujourdHui,
          moment: 'matin',
          heureSouhaitee: '07:30:00',
          dureeEstimeeMinutes: 30,
          statut: 'honore',
          origine: 'reservation',
          confirmeLe: veilleDeMaintenant,
          honoreLe: troisHeuresAvantMaintenant,
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idSion,
            clientId: idClientMeier,
            vehiculeId: idBmw,
            motifId: idMotifDiagnostic,
            commentaire:
              'Problème de démarrage à froid, sans rapport avec les plaquettes en cours.',
            type: 'diagnostic',
            date: jourAujourdHui,
            moment: 'matin',
            heureSouhaitee: '07:30:00',
            dureeEstimeeMinutes: 30,
            statut: 'honore',
            origine: 'reservation',
            honoreLe: troisHeuresAvantMaintenant,
          },
        });
      await tx
        .update(ordreReparation)
        .set({ rendezVousId: ID_RDV_AUJOURD_HUI_BMW_HONORE })
        .where(
          and(
            eq(ordreReparation.tenantId, options.tenantId),
            eq(ordreReparation.id, idOrBmwSecond),
          ),
        );
      journaliser(
        `  RDV honoré du jour — Meier/BMW, ${jourAujourdHui} 07:30 (diagnostic) → lié au second OR BMW`,
      );

      // 10. Confirmé, plus tard cette semaine — Transports Rhône/Master, Sion (journée crédible :
      //     pas seulement aujourd'hui et les dates fixes lointaines du haut de fichier).
      await tx
        .insert(rendezVous)
        .values({
          id: ID_RDV_SEMAINE_MASTER_SERVICE,
          tenantId: options.tenantId,
          siteId: idSion,
          clientId: idClientRhone,
          vehiculeId: idMaster,
          motifId: idMotifService,
          type: 'service',
          date: jourDansTroisJours,
          moment: 'matin',
          heureSouhaitee: '09:00:00',
          dureeEstimeeMinutes: 60,
          statut: 'confirme',
          origine: 'reservation',
          confirmeLe: maintenant,
          creeParId: idReceptionnaire,
        })
        .onConflictDoUpdate({
          target: rendezVous.id,
          set: {
            siteId: idSion,
            clientId: idClientRhone,
            vehiculeId: idMaster,
            motifId: idMotifService,
            type: 'service',
            date: jourDansTroisJours,
            moment: 'matin',
            heureSouhaitee: '09:00:00',
            dureeEstimeeMinutes: 60,
            statut: 'confirme',
            origine: 'reservation',
          },
        });
      journaliser(
        `  RDV confirmé plus tard cette semaine — Transports Rhône/Master, ${jourDansTroisJours} 09:00 (service, 60 min)`,
      );
    });
  } finally {
    await acces.onModuleDestroy();
  }
}
