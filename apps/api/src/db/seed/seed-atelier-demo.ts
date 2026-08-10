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

import type {
  EntreeArretPointage,
  EntreeCreationLigneOr,
  EntreeCreationOrdreReparation,
  EntreeDemarragePointage,
} from '@dfa/shared';

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
// Lot 2 (pointage) — voir la note de tête de la section « OR n°3 — Master » plus bas : c'est ce
// service qui fait passer une ligne `validee -> en_cours` (RM-117), condition désormais réelle
// (donc exigible d'un vrai geste applicatif, plus d'un contournement) pour atteindre `realisee`
// (`ServiceLigneOr.marquerRealisee`, `en_cours -> realisee` uniquement).
import { ServicePointage } from '../../pointage/service-pointage';
import { ServiceAccesBase } from '../acces-base.service';
import type { ConfigBase, ContexteTenant } from '../index';

export interface OptionsSeedAtelier {
  readonly config: ConfigBase;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsClientsParNumero: ReadonlyMap<string, string>;
  readonly idsVehiculesParCle: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  /** Clé = `referencePrincipale` d'article (`seed-pieces-demo.ts::ResultatSeedPieces`) — permet à
   *  l'OR Octavia ci-dessous de poser une VRAIE ligne « pièce » référençant un article catalogué,
   *  et donc d'exercer une réservation réelle (RP-19/RP-20) dès le jeu de démo. `undefined` si
   *  `seed-pieces-demo.ts` n'a pas encore tourné : cette clé reste alors ABSENTE plutôt que
   *  fournie vide, pour que l'erreur explicite ci-dessous (clé attendue manquante) désigne le bon
   *  coupable — un oubli d'ordre dans `seed-dev.ts::principal()` — plutôt qu'un `undefined`
   *  silencieux au milieu d'une ligne d'OR. */
  readonly idsArticlesParReference?: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

/**
 * Clé = identifiant COURT choisi par ce fichier (pas une clé métier de `ordre_reparation`, qui n'a
 * pas de code stable comme un site ou un client) — `'master'` est celle que
 * `seed-facturation-demo.ts` consomme pour retrouver l'OR Master/Transports Rhône et le facturer
 * réellement via `POST /ordres-reparation/{orId}/facturer` (RF-81, `ServiceFacturationOr`) plutôt
 * que de recréer un document de vente sans lien à son OR source (défaut corrigé, voir la section
 * « OR n°3 — Master » plus bas). Les trois autres clés sont exposées pour la même raison —
 * qu'un futur fichier de seed (pointage, par exemple) ait besoin de cibler un OR précis sans
 * dupliquer les VIN/plafonds qui permettent de le retrouver.
 */
export interface ResultatSeedAtelier {
  readonly idsOrdresReparationParCle: ReadonlyMap<string, string>;
}

/**
 * Clés d'idempotence FIXES (uuid v4 littéraux, jamais générés à l'exécution) : c'est ce qui rend
 * ce script REJOUABLE. `ServiceIdempotence` mémorise `(statut, corps)` par
 * `(tenant, méthode, chemin, clé)` — rejouer avec la MÊME clé et le MÊME corps renvoie la réponse
 * déjà mémorisée au lieu de recréer la ressource (voir `common/idempotence/service-idempotence.ts`).
 * Les actions de TRANSITION (`demarrer`, `terminer`…), elles, ne sont pas idempotentes par
 * construction : `semerAtelierDemo` relit le statut RÉEL de l'OR (`serviceOr.obtenirComplet`, pas
 * la réponse mémorisée — qui resterait figée à l'état de la création) avant chaque transition, et
 * ne la rejoue que si l'OR n'a pas encore atteint cet état. `ServicePointage.demarrer`/`arreter`
 * (ci-dessous, OR Master) NE SONT PAS non plus rejouables au-delà de leur propre Idempotency-Key :
 * une fois la ligne `realisee`, ni l'un ni l'autre ne peut être rejoué avec un corps identique
 * (la ligne visée n'est plus `validee`/`en_cours`) — d'où le garde-fou explicite
 * `realiserLigneParPointage` qui relit l'état RÉEL de la ligne avant d'y toucher, au lieu de
 * compter sur la mémorisation d'idempotence.
 */
const CLE_OR_GOLF = '44f4d3fc-24ab-4027-b8db-3e4102d7a320';
const CLE_LIGNE_GOLF_VIDANGE = '4b917b58-c662-4f84-8fc2-c321e3150480';
const CLE_LIGNE_GOLF_FREIN = '79dbf058-7a21-4aeb-b0a5-5cf37e0f9522';
/**
 * RM-65 : la PREMIÈRE ligne de main-d'œuvre du jeu de démonstration. Son absence jusqu'ici est ce
 * qui a laissé passer un défaut BLOQUANT en production locale — `POST .../lignes` avec
 * `type: main_oeuvre_*` répondait 400 `taux_horaire_introuvable` pour tout client sans condition
 * commerciale, et aucune ligne du seed n'empruntait ce chemin (forfait, pièce, constat seulement).
 * Meier est justement un particulier SANS `client_condition` : cette ligne exerce donc le repli sur
 * le taux standard du garage, le cas de très loin le plus fréquent au comptoir.
 */
const CLE_LIGNE_GOLF_MAIN_OEUVRE = 'a558e23e-be64-479d-83c4-86326cb28dd3';

const CLE_OR_OCTAVIA = 'cced12be-f5ff-4352-b851-30b6d901a2ec';
const CLE_LIGNE_OCTAVIA_DIAG = '51f9340d-2f94-420d-825a-8cbf0c6bb75a';
const CLE_LIGNE_OCTAVIA_PNEUS = '683c53a5-4fe5-4410-92fe-9169e4ba73ff';
/** RP-19/RP-20 : troisième ligne de l'OR Octavia, référençant un VRAI article catalogué
 *  (`seed-pieces-demo.ts`) — voir la note de tête d'`OptionsSeedAtelier.idsArticlesParReference`. */
const CLE_LIGNE_OCTAVIA_HUILE = '9e853144-f47e-4d6d-a978-075ef0d062e8';

const CLE_OR_MASTER = '3f8cca0a-ceff-4d43-91ea-b8a2f68769f8';
const CLE_LIGNE_MASTER_EXPERTISE = '5e2d4a1d-12d0-4814-96d1-ded6d9e7552e';
const CLE_LIGNE_MASTER_VIDANGE = '90be54d5-085c-44f9-8d35-1b1581f4e2e9';
/** `id` de ressource `pointage` (pas une Idempotency-Key — voir `schemaDemarragePointage` :
 *  l'identifiant du pointage lui-même fait partie du corps et sert de second niveau d'idempotence,
 *  RM-87). Un par ligne réalisée : le pointage « Préparation MFK » puis celui « Vidange ». */
const ID_POINTAGE_MASTER_EXPERTISE = '9acda099-16ee-4e69-8d9b-522e854dc11c';
const CLE_POINTAGE_MASTER_EXPERTISE_DEMARRER = 'f1457dcc-b364-4da0-a068-006fabca2b85';
const CLE_POINTAGE_MASTER_EXPERTISE_ARRETER = 'c6032ccf-9022-46f3-94f4-7c2c28d9af25';
const ID_POINTAGE_MASTER_VIDANGE = 'a5a3b202-1fdd-446e-b3db-d7ccce9997f5';
const CLE_POINTAGE_MASTER_VIDANGE_DEMARRER = '5d09f515-0f93-40ff-be44-3400a967071f';
const CLE_POINTAGE_MASTER_VIDANGE_ARRETER = 'cffda99b-8aa4-41ff-85ae-45661efc2bf6';

const CLE_OR_BMW = '63ae3c79-46f2-46de-b4b3-7b121157cbac';
const CLE_LIGNE_BMW_FREIN_ARR = '0ae59d2d-f5f0-49c7-89a7-a0a4392b4e85';

export async function semerAtelierDemo(options: OptionsSeedAtelier): Promise<ResultatSeedAtelier> {
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
  const idClientMeier = options.idsClientsParNumero.get('CL-000001');
  const idClientDupont = options.idsClientsParNumero.get('CL-000002');
  const idClientRhone = options.idsClientsParNumero.get('CL-000003');
  const idGolf = options.idsVehiculesParCle.get('WVWZZZ1KZAW123456');
  const idOctavia = options.idsVehiculesParCle.get('TMBJJ7NE1M0123457');
  const idMaster = options.idsVehiculesParCle.get('Renault::Master::Fourgon L2H2');
  const idBmw = options.idsVehiculesParCle.get('WBA8E9106K5E12348');
  const idChefAtelier = options.idsUtilisateursParRole.get('chef_atelier');
  const idTechnicien = options.idsUtilisateursParRole.get('technicien');
  const idArticleHuile = options.idsArticlesParReference?.get('CASTROL-EDGE-5W30-5L');

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
    !idTechnicien ||
    !idArticleHuile
  ) {
    throw new Error(
      `seed-atelier-demo : une clé attendue de seed-dev.ts ou seed-pieces-demo.ts est absente ` +
        `(site, client, véhicule, utilisateur ou article). Les fichiers ont dérivé l'un de l'autre ` +
        `— vérifier que les codes/numéros/VIN/références utilisés ici correspondent encore à ` +
        `SITES_DEMO / CLIENTS_DEMO / VEHICULES_DEMO / UTILISATEURS_DEMO de seed-dev.ts et à ` +
        `ARTICLES_DEMO de seed-pieces-demo.ts, et que seed-pieces-demo.ts tourne bien AVANT ` +
        `seed-atelier-demo.ts dans seed-dev.ts::principal().`,
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
    // Lot 2 : câblage minimal (acces, idempotence, horloge — mêmes trois dépendances que tout
    // service simple de ce fichier). Utilisé UNIQUEMENT pour l'OR Master ci-dessous, seul OR de ce
    // seed dont une ligne doit atteindre `realisee` (condition de `POST .../facturer`, RF-81,
    // exercée par `seed-facturation-demo.ts`) — Golf/Octavia/BMW restent délibérément à des stades
    // antérieurs (voir chacune de leurs sections), aucune n'a besoin de `ServicePointage`.
    const servicePointage = new ServicePointage(acces, idempotence, horloge);

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
    // Principal du TECHNICIEN lui-même (pas le chef d'atelier) pour les pointages ci-dessous : un
    // pointage démarré/arrêté par son propre titulaire n'exige pas `atelier.pointage.pointer_autrui`
    // (`ServicePointage.exigerDroitCiblerAutrui` — self vs autrui, faille corrigée par l'audit
    // sécurité). Utiliser `chefAtelier` ici aurait marché aussi (il détient `pointer_autrui`), mais
    // aurait raconté une histoire fausse : c'est Nicolas Antille qui pointe sur son propre travail.
    const technicienPointeur: PrincipalAuthentifie = {
      sessionId: 'seed-atelier-demo-technicien',
      tenantId: options.tenantId,
      utilisateurId: idTechnicien,
      role: 'technicien',
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

    /** Même geste que `creerLigne`, id de la ligne créée (ou déjà existante, rejeu) en plus —
     *  nécessaire pour la ligne Master ci-dessous, qui doit ensuite être pointée puis marquée
     *  réalisée par SON id, pas par une relecture de la liste. */
    const creerLigneAvecId = async (
      orId: string,
      entree: EntreeCreationLigneOr,
      cle: string,
    ): Promise<string> => {
      const resultat = await serviceLigneOr.creer(ctx, chefAtelier, orId, entree, cle);
      return resultat.reponse.corps.donnees.id;
    };

    /** Lecture FRAÎCHE (jamais la réponse mémorisée par l'idempotence, figée à l'état de création). */
    const statutCourant = async (orId: string): Promise<string> => {
      const document = await serviceOr.obtenirComplet(ctx, chefAtelier, orId);
      return document.statut;
    };

    /**
     * `validee -> en_cours -> realisee`, en empruntant le VRAI chemin applicatif (Lot 2) : un
     * pointage démarré sur la ligne la fait passer `en_cours` PAR CASCADE (RM-117,
     * `ServicePointage.demarrer`, jamais une écriture directe de `ligne_or.statut`), puis
     * `ServiceLigneOr.marquerRealisee` (§7.9) la fait passer `realisee`, puis le pointage est
     * arrêté — sans quoi `ServiceTransitions.terminer` refuserait (I-09, pointage encore ouvert).
     *
     * REJOUABLE mais PAS par idempotence de `demarrer`/`marquerRealisee`/`arreter` eux-mêmes (voir
     * la note de tête sur les clés d'idempotence FIXES) : cette fonction relit l'état RÉEL de la
     * ligne et ne fait RIEN si elle a déjà dépassé `en_cours` — nécessaire dès qu'un second
     * `pnpm db:seed` retrouve une ligne déjà `realisee` (ou même `facturee`, une fois
     * `seed-facturation-demo.ts` passé par `POST .../facturer`, RF-81).
     */
    const realiserLigneParPointage = async (
      orId: string,
      ligneId: string,
      idPointage: string,
      cleDemarrer: string,
      cleArreter: string,
      debutLe: string,
      finLe: string,
    ): Promise<void> => {
      const document = await serviceOr.obtenirComplet(ctx, chefAtelier, orId);
      const ligne = document.lignes.find((l) => l.id === ligneId);
      if (!ligne) {
        throw new Error(
          `seed-atelier-demo : ligne ${ligneId} introuvable sur l'OR ${orId} après création.`,
        );
      }
      if (ligne.statut === 'realisee' || ligne.statut === 'facturee') return;

      const entreeDemarrage: EntreeDemarragePointage = {
        id: idPointage,
        siteId: document.siteId,
        technicienId: idTechnicien,
        nature: 'productif_ligne',
        ordreReparationId: orId,
        ligneOrId: ligneId,
        debutLe,
        source: 'ecran_atelier',
      };
      await servicePointage.demarrer(ctx, technicienPointeur, entreeDemarrage, cleDemarrer);

      await serviceLigneOr.marquerRealisee(ctx, chefAtelier, orId, ligneId, {});

      const entreeArret: EntreeArretPointage = { finLe };
      await servicePointage.arreter(ctx, technicienPointeur, idPointage, entreeArret, cleArreter);
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
    // Main-d'œuvre au temps barémé, taux NON fourni par l'appelant : le serveur le fige lui-même
    // (RM-65). Meier n'a aucune condition commerciale, le repli sur le taux standard du garage
    // (`CODE_TAUX_HORAIRE_DEFAUT`, `taux_horaire` code `ATELIER` = 145.00/h dans `seed-dev.ts`)
    // porte donc seul le montant : 0.80 h × 145.00 = 116.00 HT, 9.40 de TVA (8.1 %), 125.40 TTC.
    await creerLigne(
      orGolfId,
      ligneMainOeuvre("Contrôle du système de freinage avant (main-d'œuvre)", 80, idTechnicien),
      CLE_LIGNE_GOLF_MAIN_OEUVRE,
    );
    journaliser(`  OR Golf/Meier — ouvert, 3 lignes (dont 1 main-d'œuvre au taux standard)`);

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
    // Troisième ligne, RÉFÉRENÇANT un vrai article catalogué (`seed-pieces-demo.ts`) : `type:
    // 'piece'` + `articleId` renseigné + `fournieParClient: false` réserve la pièce EN BASE dans
    // la même transaction que la création de la ligne (RP-19/RP-20,
    // `ServiceLigneOr.reserverPieceSiApplicable`) — c'est ce qui rend les réservations pièces
    // explorables dès `pnpm db:seed`, pas seulement les articles/le stock eux-mêmes. Stock
    // MARTIGNY de cet article largement excédentaire (voir `seed-pieces-demo.ts::ARTICLES_DEMO`) :
    // la réservation réussit, jamais de repli en `blocage: 'pieces'` (RP-24).
    await creerLigne(
      orOctaviaId,
      lignePieceReferencee(
        'Appoint huile moteur 5W30 (1 bidon)',
        idArticleHuile,
        5_900,
        idTechnicien,
      ),
      CLE_LIGNE_OCTAVIA_HUILE,
    );
    if ((await statutCourant(orOctaviaId)) === 'ouvert') {
      await serviceTransitions.demarrer(ctx, chefAtelier, orOctaviaId);
    }
    journaliser(`  OR Octavia/Dupont — en_cours, 3 lignes (dont 1 pièce réservée)`);

    // === OR n°3 — Master / Transports Rhône — état « terminé », 2 lignes réalisées ================
    // JUSQU'ICI SANS LIGNE, DÉLIBÉRÉMENT (historique, corrigé ici) : au lot 1, aucune méthode de
    // service ne faisait jamais passer une ligne au statut `en_cours` (module pointage absent) —
    // seule la transition `en_cours -> realisee` existe (migrations/0003_prealables_etape1.sql,
    // `transition_autorisee`), et une ligne restée `validee` aurait bloqué `terminer()` (garde
    // I-10, `ServiceTransitions.verifierLignesNonRealisees`) sans AUCUN moyen valide de la lever.
    // DÉFAUT CORRIGÉ ICI (constat : `document_vente.ordre_reparation_id` était NULL sur les 5
    // documents du jeu de démo — la section « Devis et facture » de toute fiche d'OR restait donc
    // structurellement vide) : le Lot 2 (pointage) livre désormais un chemin RÉEL, `validee ->
    // en_cours` (RM-117, `realiserLigneParPointage` ci-dessus) — cet OR peut donc porter les DEUX
    // lignes qui justifient thématiquement la « facture Master » de `seed-facturation-demo.ts`
    // depuis l'origine de ce fichier (mêmes désignations, mêmes prix que `PRESTATIONS_DEMO.
    // EXPERTISE-PREP`/`VID-ESS` de `seed-dev.ts`), puis être RÉELLEMENT facturé par
    // `seed-facturation-demo.ts` via `POST /ordres-reparation/{orId}/facturer` (RF-81) — plus une
    // facture recréée à la main, sans lien à son OR source. Golf/Octavia/BMW restent, EUX,
    // délibérément à des stades antérieurs (ouvert / en_cours / en_cours+attente_pieces) : c'est
    // Master, seul OR déjà `terminé` dans ce jeu de démo, qui porte cette démonstration — la
    // toucher aurait changé un état affiché ailleurs sans nécessité.
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
    // Prix unitaires HT (RM-65, `CalculLigneSimple` : TVA 8.1% ajoutée PAR-DESSUS ce prix, jamais
    // TTC — à la différence des lignes de DOCUMENT de `seed-facturation-demo.ts`, ancrées TTC,
    // `MD-08`/§0.2). Mêmes libellés ET mêmes prix catalogue que `PRESTATIONS_DEMO` (`seed-dev.ts` :
    // `EXPERTISE-PREP` 150.00, `VID-ESS` 90.00) — le technicien facture au tarif du garage, pas un
    // montant inventé pour l'occasion.
    const ligneMasterExpertiseId = await creerLigneAvecId(
      orMasterId,
      ligneForfait("Préparation à l'expertise MFK", 120, 15_000),
      CLE_LIGNE_MASTER_EXPERTISE,
    );
    const ligneMasterVidangeId = await creerLigneAvecId(
      orMasterId,
      ligneForfait('Vidange huile + filtre', 80, 9_000),
      CLE_LIGNE_MASTER_VIDANGE,
    );
    // Le premier `demarrer` fait aussi passer l'OR `ouvert -> en_cours` PAR CASCADE (RM-117) : plus
    // besoin d'appeler `serviceTransitions.demarrer` séparément, à la différence d'Octavia/BMW
    // ci-dessus (qui n'ont pas de pointage et gardent donc le déclenchement manuel).
    await realiserLigneParPointage(
      orMasterId,
      ligneMasterExpertiseId,
      ID_POINTAGE_MASTER_EXPERTISE,
      CLE_POINTAGE_MASTER_EXPERTISE_DEMARRER,
      CLE_POINTAGE_MASTER_EXPERTISE_ARRETER,
      '2026-07-04T07:00:00.000Z',
      '2026-07-04T08:30:00.000Z',
    );
    await realiserLigneParPointage(
      orMasterId,
      ligneMasterVidangeId,
      ID_POINTAGE_MASTER_VIDANGE,
      CLE_POINTAGE_MASTER_VIDANGE_DEMARRER,
      CLE_POINTAGE_MASTER_VIDANGE_ARRETER,
      '2026-07-04T08:30:00.000Z',
      '2026-07-04T09:10:00.000Z',
    );
    if ((await statutCourant(orMasterId)) === 'en_cours') {
      await serviceTransitions.terminer(ctx, chefAtelier, orMasterId, {
        kilometrageSortie: 128_500,
        unite: 'km',
      });
    }
    journaliser(
      `  OR Master/Transports Rhône — terminé, 2 lignes réalisées (240.00 CHF HT), prête pour RF-81`,
    );

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

    return {
      idsOrdresReparationParCle: new Map([
        ['golf', orGolfId],
        ['octavia', orOctaviaId],
        ['master', orMasterId],
        ['bmw', orBmwId],
      ]),
    };
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

/**
 * Ligne de main-d'œuvre barémée (RM-65). `prixUnitaireCentimes` reste `null` À DESSEIN : le montant
 * d'une ligne de main-d'œuvre naît du temps ET du taux horaire FIGÉ PAR LE SERVEUR — ni l'écran ni
 * ce seed n'ont le droit de proposer un taux (`ligne.ts` : « le client ne les envoie jamais et ne
 * les recalcule jamais »).
 */
function ligneMainOeuvre(
  designation: string,
  tempsBaremeCentiemes: number,
  technicienId: string,
): EntreeCreationLigneOr {
  return {
    type: 'main_oeuvre_bareme',
    origine: 'commandee',
    designation,
    referenceTexte: null,
    quantiteMillieme: 1_000,
    tempsBaremeCentiemes,
    prixUnitaireCentimes: null,
    rabaisPourmille: 0,
    payeur: 'client',
    technicienId,
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

/** Même patron que `ligneConstatTechnicien`, `articleId` renseigné EN PLUS (RP-19/RP-20) : seule
 *  différence, c'est elle qui fait naître une réservation réelle dans
 *  `ServiceLigneOr.reserverPieceSiApplicable`. */
function lignePieceReferencee(
  designation: string,
  articleId: string,
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
    urgence: null,
    securite: false,
    fournieParClient: false,
    pieceARestituer: false,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    blocage: 'aucun',
    articleId,
  };
}
