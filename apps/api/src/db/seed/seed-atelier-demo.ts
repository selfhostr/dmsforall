/**
 * Ordres de réparation de démonstration (lot 1) — complète `seed-dev.ts` (tenant, sites, clients,
 * véhicules, utilisateurs) avec des OR dans des états DIFFÉRENTS, machine à états respectée.
 *
 * Pourquoi ce fichier n'utilise JAMAIS `NestFactory` (voir CONTRIBUTING.md, « Pièges vérifiés ») :
 * `pnpm db:seed` exécute ce script via `tsx` (`apps/api/package.json`), qui transpile avec
 * esbuild — esbuild n'émet PAS `design:paramtypes` (`emitDecoratorMetadata` non supporté), donc
 * le conteneur d'injection de Nest ne peut résoudre AUCUNE dépendance décorée sous `tsx` (même
 * piège que `pnpm api:openapi`, qui compile d'abord avec `nest build` pour cette raison précise).
 *
 * Solution retenue : instancier les VRAIS services de `atelier/` (`ServiceOr`, `ServiceTransitions`,
 * `ServiceLigneOr`) À LA MAIN — `new Service(dep1, dep2, …)` — en leur passant leurs dépendances
 * construites une à une, dans le même ordre que leur constructeur. Les décorateurs
 * `@Injectable()`/`@Inject()` restent inertes (rien ne les lit, on ne passe jamais par
 * `NestFactory`), mais le CODE MÉTIER exécuté est EXACTEMENT celui de la vraie API — pas une copie,
 * pas une réimplémentation en SQL brut. C'est la même doctrine que « ne force pas des statuts en
 * base » demandée pour cette tâche : les OR de démo naissent et transitent par les mêmes méthodes
 * que `POST /ordres-reparation` et `POST .../demarrer`, avec la même machine à états (le trigger
 * `transition_autorisee`, migrations/0003), les mêmes gardes métier, la même numérotation
 * (`ServiceCompteurs`) et le même mécanisme d'idempotence — donc REJOUABLE par construction (voir
 * les clés fixes ci-dessous).
 *
 * `import 'reflect-metadata'` est nécessaire ICI (et nulle part dans `seed-dev.ts`, qui ne touche
 * aucune classe décorée) : `@Injectable()`/`@Inject()` appellent `Reflect.defineMetadata` à la
 * définition de la classe, une méthode que seul le polyfill `reflect-metadata` ajoute à l'objet
 * `Reflect` global — sans lui, le simple `import` d'une classe de service lèverait immédiatement,
 * avant même d'atteindre `semerAtelierDemo`. `main.ts` l'importe pour la même raison, en tête.
 *
 * Connexion : `AccesBase` (donc RLS, rôle `dfa_app`, `config.DATABASE_URL`) — jamais
 * `DATABASE_URL_MIGRATION` : ces services sont ceux de l'application, pas de l'outillage
 * d'exploitation (à la différence de `seed-dev.ts`, qui crée le tenant/les comptes hors RLS).
 */
import 'reflect-metadata';

import type { EntreeCreationLigneOr, EntreeCreationOrdreReparation } from '@dfa/shared';

import { ServiceAuditImpl } from '../../common/audit';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ServiceEvenementsImpl } from '../../common/evenements';
import { Horloge } from '../../common/horloge/horloge';
import { ServiceIdempotenceImpl } from '../../common/idempotence';
import { ServiceCompteursImpl } from '../../parametrage/compteurs/service-compteurs';
import { LecturePointageVide, type CreationTravailReporte } from '../../atelier/atelier.jetons';
import { CalculLigneSimple } from '../../atelier/calcul-ligne';
import { ServiceLigneOr } from '../../atelier/service-ligne-or';
import { ServiceOr } from '../../atelier/service-or';
import { ServiceSnapshotOr } from '../../atelier/service-snapshot-or';
import { ServiceTransitions } from '../../atelier/service-transitions';
import { ServiceConsigne } from '../../pieces/service-consigne';
import { ServiceReservation } from '../../pieces/service-reservation';
import { ServiceAccesBase } from '../acces-base.service';
import type { ConfigBase, ContexteTenant } from '../index';

export interface OptionsSeedAtelier {
  readonly config: ConfigBase;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsClientsParNumero: ReadonlyMap<string, string>;
  readonly idsVehiculesParCle: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

/**
 * Clés d'idempotence FIXES (uuid v4 littéraux, jamais générés à l'exécution) : c'est ce qui rend
 * ce script REJOUABLE. `ServiceIdempotence` mémorise `(statut, corps)` par
 * `(tenant, méthode, chemin, clé)` — rejouer avec la MÊME clé et le MÊME corps renvoie la réponse
 * déjà mémorisée au lieu de recréer la ressource (voir `common/idempotence/service-idempotence.ts`).
 * Les actions de TRANSITION (`demarrer`, `terminer`…), elles, ne sont pas idempotentes par
 * construction : `semerAtelierDemo` relit le statut RÉEL de l'OR (`serviceOr.obtenirComplet`, pas
 * la réponse mémorisée — qui resterait figée à l'état de la création) avant chaque transition, et
 * ne la rejoue que si l'OR n'a pas encore atteint cet état.
 */
const CLE_OR_GOLF = '44f4d3fc-24ab-4027-b8db-3e4102d7a320';
const CLE_LIGNE_GOLF_VIDANGE = '4b917b58-c662-4f84-8fc2-c321e3150480';
const CLE_LIGNE_GOLF_FREIN = '79dbf058-7a21-4aeb-b0a5-5cf37e0f9522';

const CLE_OR_OCTAVIA = 'cced12be-f5ff-4352-b851-30b6d901a2ec';
const CLE_LIGNE_OCTAVIA_DIAG = '51f9340d-2f94-420d-825a-8cbf0c6bb75a';
const CLE_LIGNE_OCTAVIA_PNEUS = '683c53a5-4fe5-4410-92fe-9169e4ba73ff';

const CLE_OR_MASTER = '3f8cca0a-ceff-4d43-91ea-b8a2f68769f8';

const CLE_OR_BMW = '63ae3c79-46f2-46de-b4b3-7b121157cbac';
const CLE_LIGNE_BMW_FREIN_ARR = '0ae59d2d-f5f0-49c7-89a7-a0a4392b4e85';

export async function semerAtelierDemo(options: OptionsSeedAtelier): Promise<void> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  // Même garde-fou que `semerDev` (voir sa tête de fichier) : ce script crée des ordres de
  // réparation factices sous des comptes dont le mot de passe est public.
  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration atelier est interdit en production : il crée des ordres de réparation factices sous des comptes dont le mot de passe est publié dans le dépôt.`,
    );
  }

  const idSion = options.idsSitesParCode.get('SION');
  const idMartigny = options.idsSitesParCode.get('MARTIGNY');
  const idClientMeier = options.idsClientsParNumero.get('CL-0001');
  const idClientDupont = options.idsClientsParNumero.get('CL-0002');
  const idClientRhone = options.idsClientsParNumero.get('CL-0003');
  const idGolf = options.idsVehiculesParCle.get('WVWZZZ1KZAW123456');
  const idOctavia = options.idsVehiculesParCle.get('TMBJJ7NE1M0123457');
  const idMaster = options.idsVehiculesParCle.get('Renault::Master::Fourgon L2H2');
  const idBmw = options.idsVehiculesParCle.get('WBA8E9106K5E12348');
  const idChefAtelier = options.idsUtilisateursParRole.get('chef_atelier');
  const idTechnicien = options.idsUtilisateursParRole.get('technicien');

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
    !idChefAtelier ||
    !idTechnicien
  ) {
    throw new Error(
      `seed-atelier-demo : une clé attendue de seed-dev.ts est absente (site, client, véhicule ou utilisateur). ` +
        `Les deux fichiers ont dérivé l'un de l'autre — vérifier que les codes/numéros/VIN utilisés ici ` +
        `correspondent encore à SITES_DEMO / CLIENTS_DEMO / VEHICULES_DEMO / UTILISATEURS_DEMO de seed-dev.ts.`,
    );
  }

  // --- Câblage manuel des services (voir la note de tête : jamais NestFactory sous tsx) ----------
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
    const horloge = new Horloge();
    const idempotence = new ServiceIdempotenceImpl(acces, horloge);
    const evenements = new ServiceEvenementsImpl(horloge);
    const audit = new ServiceAuditImpl(acces);
    const compteurs = new ServiceCompteursImpl();
    const snapshot = new ServiceSnapshotOr(horloge);
    const pointage = new LecturePointageVide();
    const serviceOr = new ServiceOr(
      acces,
      idempotence,
      evenements,
      audit,
      compteurs,
      pointage,
      snapshot,
      horloge,
    );
    // ServiceReservation instancié avant ServiceTransitions : ce dernier le requiert depuis
    // la correction de l'issue #11. Ce script instancie les services à la main (jamais via
    // NestFactory sous tsx) — chaque nouvelle dépendance du constructeur exige de mettre à
    // jour cette liste, c'est notre contrat de compatibilité avec la vraie API.
    const serviceReservation = new ServiceReservation(acces);
    const serviceTransitions = new ServiceTransitions(
      acces,
      evenements,
      pointage,
      horloge,
      serviceOr,
      serviceReservation,
    );
    const calcul = new CalculLigneSimple();
    // RM-73 : port CreationTravailReporte, sixième argument de ServiceLigneOr depuis son câblage
    // au travail reporté (vehicules/service-vehicule-travail-reporte.ts, ServiceVehiculeTravailReporte
    // en implémentation réelle côté API). Ce script de seed NE FAIT JAMAIS refuser une ligne
    // (aucune des OR de démo ci-dessous n'appelle `refuser-lignes` / EntreeRefusLignes) — vérifié
    // par grep sur ce fichier avant d'écrire ce commentaire, à revérifier si une nouvelle scène de
    // démo l'exerce un jour. Le chemin `creerDepuisRefus` n'est donc JAMAIS exécuté ici : plutôt
    // que de câbler la vraie implémentation (qui vit dans `vehicules/`, hors du périmètre
    // d'assemblage manuel déjà consenti par ce fichier, et sans bénéfice tant qu'aucune scène ne
    // l'exerce), on passe un objet conforme au port qui ne fait rien — explicite, pour ne pas
    // laisser croire que ce seed exerce RM-73.
    const travailReporteInerte: CreationTravailReporte = {
      creerDepuisRefus: () => {
        throw new Error(
          "seed-atelier-demo : creerDepuisRefus ne devrait jamais être appelé — aucune ligne de démo n'est refusée.",
        );
      },
    };
    // RP-21/RP-23/RP-38 : `ServiceConsigne` (`pieces/`), huitième argument de `ServiceLigneOr`
    // depuis composition avec leur variante `*Tx` plutôt que réplication du SQL (dette technique
    // soldée). Instance RÉELLE — mêmes garanties qu'en production, `acces` déjà construit
    // ci-dessus — jamais de doublure inerte comme `travailReporteInerte`.
    // `ServiceReservation` est instancié plus haut (déjà câblée à `ServiceTransitions` depuis
    // l'issue #11).
    const serviceConsigne = new ServiceConsigne(acces);
    const serviceLigneOr = new ServiceLigneOr(
      acces,
      idempotence,
      evenements,
      calcul,
      travailReporteInerte,
      serviceOr,
      serviceReservation,
      serviceConsigne,
    );

    const ctx: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idChefAtelier,
      requeteId: null,
    };
    const chefAtelier: PrincipalAuthentifie = {
      sessionId: 'seed-atelier-demo',
      tenantId: options.tenantId,
      utilisateurId: idChefAtelier,
      role: 'chef_atelier',
      langue: 'fr',
    };

    const creerOr = async (entree: EntreeCreationOrdreReparation, cle: string): Promise<string> => {
      const resultat = await serviceOr.creer(ctx, chefAtelier, entree, cle);
      return resultat.reponse.corps.donnees.id;
    };

    const creerLigne = async (
      orId: string,
      entree: EntreeCreationLigneOr,
      cle: string,
    ): Promise<void> => {
      await serviceLigneOr.creer(ctx, chefAtelier, orId, entree, cle);
    };

    /** Lecture FRAÎCHE (jamais la réponse mémorisée par l'idempotence, figée à l'état de création). */
    const statutCourant = async (orId: string): Promise<string> => {
      const document = await serviceOr.obtenirComplet(ctx, chefAtelier, orId);
      return document.statut;
    };

    // === OR n°1 — Golf / Meier — état « ouvert », deux lignes ======================================
    // Démontre le cas de base : montants réels, masquage par rôle observable dès la lecture.
    const orGolfId = await creerOr(
      {
        siteId: idSion,
        vehiculeId: idGolf,
        clientId: idClientMeier,
        type: 'service',
        kilometrageEntree: 85_200,
        uniteKilometrage: 'km',
        demandes: [{ verbatim: "Bruit de freinage à l'avant, à contrôler." }],
        statutInitial: 'ouvert',
      },
      CLE_OR_GOLF,
    );
    await creerLigne(
      orGolfId,
      ligneForfait('Vidange huile + filtre (essence)', 80, 9_000),
      CLE_LIGNE_GOLF_VIDANGE,
    );
    await creerLigne(
      orGolfId,
      ligneConstatTechnicien(
        'Constat technicien : plaquettes de frein avant fortement usées',
        45_000,
        idTechnicien,
      ),
      CLE_LIGNE_GOLF_FREIN,
    );
    journaliser(`  OR Golf/Meier — ouvert, 2 lignes`);

    // === OR n°2 — Octavia / Dupont — état « en_cours », deux lignes ================================
    const orOctaviaId = await creerOr(
      {
        siteId: idMartigny,
        vehiculeId: idOctavia,
        clientId: idClientDupont,
        type: 'diagnostic',
        kilometrageEntree: 42_000,
        uniteKilometrage: 'km',
        demandes: [{ verbatim: 'Voyant moteur allumé, à diagnostiquer.' }],
        statutInitial: 'ouvert',
      },
      CLE_OR_OCTAVIA,
    );
    await creerLigne(
      orOctaviaId,
      ligneForfait('Diagnostic électronique OBD', 60, 12_000),
      CLE_LIGNE_OCTAVIA_DIAG,
    );
    await creerLigne(
      orOctaviaId,
      ligneForfait('Changement de pneus (4 roues)', 50, 32_000),
      CLE_LIGNE_OCTAVIA_PNEUS,
    );
    if ((await statutCourant(orOctaviaId)) === 'ouvert') {
      await serviceTransitions.demarrer(ctx, chefAtelier, orOctaviaId);
    }
    journaliser(`  OR Octavia/Dupont — en_cours, 2 lignes`);

    // === OR n°3 — Master / Transports Rhône — état « terminé », sans ligne =========================
    // Aucune ligne ici, DÉLIBÉRÉMENT : au lot 1, aucune méthode de service ne fait jamais passer une
    // ligne au statut `en_cours` (module pointage absent, Δ4 du plan d'exécution) — seule la
    // transition `en_cours -> realisee` est admise (migrations/0003_prealables_etape1.sql,
    // `transition_autorisee`). Une ligne restée `validee` bloquerait donc `terminer()` (garde I-10,
    // `ServiceTransitions.verifierLignesNonRealisees`) sans AUCUN moyen valide de la lever au lot 1.
    // Plutôt que de forcer un statut de ligne en base — exactement ce que cette tâche interdit — cet
    // OR de démo reste sans ligne ; les OR Golf/Octavia ci-dessus suffisent déjà à démontrer montants
    // et masquage par rôle.
    const orMasterId = await creerOr(
      {
        siteId: idSion,
        vehiculeId: idMaster,
        clientId: idClientRhone,
        type: 'expertise',
        kilometrageEntree: 128_500,
        uniteKilometrage: 'km',
        demandes: [{ verbatim: "Contrôle général avant passage à l'expertise MFK." }],
        statutInitial: 'ouvert',
      },
      CLE_OR_MASTER,
    );
    if ((await statutCourant(orMasterId)) === 'ouvert') {
      await serviceTransitions.demarrer(ctx, chefAtelier, orMasterId);
    }
    if ((await statutCourant(orMasterId)) === 'en_cours') {
      await serviceTransitions.terminer(ctx, chefAtelier, orMasterId, {
        kilometrageSortie: 128_500,
        unite: 'km',
      });
    }
    journaliser(`  OR Master/Transports Rhône — terminé, sans ligne`);

    // === OR n°4 — BMW / Meier — état « en_cours » + attente de pièce ===============================
    // `blocage: 'pieces'` posé explicitement sur la ligne fait passer `ordre_reparation.attente_pieces`
    // à `true` PAR TRIGGER (`ordre_reparation_recalculer_attentes`, migrations/0008_atelier.sql) —
    // jamais écrit par ce script : c'est le même mécanisme que celui déclenché en production par
    // `POST .../lignes` avec ce champ, observable via `etatAffiche: 'attente_pieces'` du document OR.
    const orBmwId = await creerOr(
      {
        siteId: idSion,
        vehiculeId: idBmw,
        clientId: idClientMeier,
        type: 'reparation',
        kilometrageEntree: 63_500,
        uniteKilometrage: 'km',
        demandes: [{ verbatim: 'Grincement au freinage arrière.' }],
        statutInitial: 'ouvert',
      },
      CLE_OR_BMW,
    );
    if ((await statutCourant(orBmwId)) === 'ouvert') {
      await serviceTransitions.demarrer(ctx, chefAtelier, orBmwId);
    }
    await creerLigne(
      orBmwId,
      {
        type: 'piece',
        origine: 'commandee',
        designation: 'Kit plaquettes + disques de frein arrière (sur commande fournisseur)',
        referenceTexte: null,
        quantiteMillieme: 1_000,
        tempsBaremeCentiemes: null,
        prixUnitaireCentimes: 52_000,
        rabaisPourmille: 0,
        payeur: 'client',
        technicienId: idTechnicien,
        urgence: 'a_faire',
        securite: true,
        fournieParClient: false,
        pieceARestituer: false,
        codeOperation: null,
        codeDefaut: null,
        numeroSinistre: null,
        numeroAccord: null,
        blocage: 'pieces',
      },
      CLE_LIGNE_BMW_FREIN_ARR,
    );
    journaliser(`  OR BMW/Meier — en_cours, attente de pièce`);
  } finally {
    // `ServiceAccesBase` n'ouvre son pool qu'à la construction (pas de conteneur Nest ici pour
    // appeler `onModuleInit`/`onModuleDestroy` automatiquement) : c'est donc à ce script de refermer
    // le pool lui-même, avec la même méthode que celle que Nest appellerait à l'arrêt de l'app.
    await acces.onModuleDestroy();
  }
}

function ligneForfait(
  designation: string,
  tempsBaremeCentiemes: number,
  prixUnitaireCentimes: number,
): EntreeCreationLigneOr {
  return {
    type: 'forfait',
    origine: 'commandee',
    designation,
    referenceTexte: null,
    quantiteMillieme: 1_000,
    tempsBaremeCentiemes,
    prixUnitaireCentimes,
    rabaisPourmille: 0,
    payeur: 'client',
    technicienId: null,
    urgence: null,
    securite: false,
    fournieParClient: false,
    pieceARestituer: false,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    blocage: 'aucun',
  };
}

function ligneConstatTechnicien(
  designation: string,
  prixUnitaireCentimes: number,
  technicienId: string,
): EntreeCreationLigneOr {
  return {
    type: 'piece',
    origine: 'constatee',
    designation,
    referenceTexte: null,
    quantiteMillieme: 1_000,
    tempsBaremeCentiemes: null,
    prixUnitaireCentimes,
    rabaisPourmille: 0,
    payeur: 'client',
    technicienId,
    urgence: 'a_faire',
    securite: true,
    fournieParClient: false,
    pieceARestituer: false,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    blocage: 'aucun',
  };
}
