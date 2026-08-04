import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  type SQL,
} from 'drizzle-orm';
import type {
  EntreeArretPointage,
  EntreeCorrectionPointage,
  EntreeDemarragePointage,
  FiltresPointages,
  MotifAnomaliePointage,
  PageCurseur,
  ReponseAgregatTempsLigne,
  ReponseAvecAvertissements,
  ReponsePointage,
  RoleUtilisateur,
} from '@dfa/shared';
import { estCompteDeService } from '@dfa/shared';

import { MATRICE_DROITS } from '../auth/matrice-droits';
import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  ligneOr,
  ordreReparation,
  pointage,
  type LigneLigneOr,
  type LigneOrdreReparation,
  type LignePointage,
  type NouveauPointage,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { interpreterErreurTransitionInterdite } from '../common/avertissements';
import { CollecteurAvertissements } from '../common/avertissements/collecteur-avertissements';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';

import {
  conditionKeysetPointage,
  decoderCurseurPointages,
  encoderCurseurTrie,
  expressionTriValeurPointage,
  ordreParDebutLe,
  valeurCurseurDepuisTriPointage,
} from './pagination-pointages';
import {
  chargerPointageOuNull,
  chargerPointageOuvertTechnicien,
  chargerPointagePourEcriture,
  chargerPointagesPourAgregatLigne,
} from './pointage-requetes';
import { dureeBruteDepuisPeriode, mapperPointage } from './mappeurs';
import {
  chargerLigneOuNull,
  chargerLignesOrPourAgregat,
  chargerOrOuNull,
  chargerLignePourPointage,
  chargerOrPourPointage,
  chargerParametresPointage,
} from './references';
import {
  calculerAgregatsTempsLigne,
  calculerClotureChevauchement,
  calculerDureeArrondieCentiemes,
  chevauchementDoitProduireAnomalie,
  deriveHorlogeAnormale,
  dureeDepasseLeSeuil,
  estLignePointable,
  estOrPointable,
  ligneDevenueNonPointable,
  ligneDoitPasserEnCours,
  orDevenuNonPointable,
  orDoitPasserEnCours,
  pointageCorrespondEntree,
} from './regles-pointage';
import { traduireErreurTransitionPointage } from './traducteur-transition-pointage';

/** `code` + `constraint` PostgreSQL d'une violation de la PK `pointage_pk` (23505) — MÊME PATRON que
 *  `vehicules/erreurs-contraintes.ts` / `facturation/paiements/service-paiement.ts::estViolationUnicite`. */
function estCollisionIdPointage(erreur: unknown): boolean {
  if (typeof erreur !== 'object' || erreur === null) return false;
  const brute = erreur as { code?: unknown; constraint?: unknown };
  return brute.code === '23505' && brute.constraint === 'pointage_pk';
}

type ResultatEcriture = ResultatIdempotent<
  ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponsePointage> }
>;

/**
 * Rôles qui voient au-delà de leur propre pointage (`atelier.pointage.lire_equipe`, §9 de la spec
 * pointage : « chef d'atelier, direction »). LISTE LOCALE, TOUJOURS NÉCESSAIRE — CORRECTIF d'un
 * commentaire antérieur : le bloc `DROITS_POINTAGE_PAR_ROLE` EXISTE désormais dans
 * `matrice-droits.ts` (vérifié au 2026-08-03, six actions `atelier.pointage.*` posées et câblées par
 * rôle), mais l'action `atelier.pointage.lire_equipe` elle-même en est TOUJOURS délibérément absente
 * (commentaire de tête du bloc : « aucune route livrée ne les consomme encore ») — cette liste
 * locale reste donc la seule source de cette restriction, PAS une lecture de `MATRICE_DROITS`
 * possible en l'état. `admin` inclus par la même doctrine que le reste de la matrice lot 1 (« rôle
 * technique, superset de `direction` »).
 */
const ROLES_AVEC_VUE_EQUIPE_POINTAGE: ReadonlySet<RoleUtilisateur> = new Set([
  'chef_atelier',
  'direction',
  'admin',
]);

/**
 * Cœur du domaine Pointage (RM-87 → RM-99, RM-113 → RM-123) : démarrer/arrêter/corriger, la
 * cascade RM-117 sur `ligne_or`/`ordre_reparation`, la clôture automatique RM-89/90, les anomalies
 * RM-96/RM-119/RM-123, et la lecture (`GET /pointages`, `GET /pointages/{id}`).
 *
 * Le verrouillage de période (RM-95) vit dans `service-verrouillage-periode.ts` (périmètre
 * distinct : agit EN LOT sur tous les pointages d'un site, pas sur un pointage précis) ; la lecture
 * consommée par `atelier` (`LecturePointage`) vit dans `service-lecture-pointage.ts` (port figé,
 * signature imposée par `atelier/atelier.jetons.ts`, sans `ContexteTenant`).
 */
@Injectable()
export class ServicePointage {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
  ) {}

  /* ---------------------------------------------------------------------------------------- */
  /* Écriture                                                                                   */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * FAILLE CORRIGÉE (audit sécurité) — garde-fou « soi vs autrui » du pointage. Démarrer ou arrêter
   * le pointage d'un AUTRE technicien que soi exige `atelier.pointage.pointer_autrui` (encadrement :
   * chef d'atelier / direction / admin — correction a posteriori, oubli de pointer). Pointer POUR
   * SOI reste ouvert à tout rôle qui détient déjà `demarrer`/`arreter` (technicien, magasinier…).
   *
   * Avant correction, ni `demarrer` ni `arreter` ne reliaient l'identité de la session à la cible :
   * un technicien pouvait imputer des heures à n'importe quel collègue en fournissant son
   * `technicienId`. C'est ce lien-là que cette garde rétablit.
   *
   * BORNE (`poste_atelier`, compte de service) EXEMPTÉE : `principal.utilisateurId` est le compte de
   * la borne, jamais un technicien — le concept « soi/autrui » n'a pas d'objet pour elle. Elle pointe
   * POUR le technicien identifié par PIN par conception ; cette capacité est portée par
   * `demarrer`/`arreter` + le scoping de site, JAMAIS par ce droit (qu'elle ne détient pas, ce qui
   * garde son périmètre minimal, RM-115/RM-131 — aucun geste sensible depuis un écran mural).
   *
   * `@ExigerDroit` ne peut pas porter ce contrôle (statique par route) : la même route sert le cas
   * « pour soi » (à ouvrir) et « pour autrui » (à restreindre) — seul le service, une fois la cible
   * connue, peut trancher. Même idiome que `ServiceOr.modifier` / `ServiceVehiculeKilometrage.creer`
   * (`MATRICE_DROITS[role] ?? []`, `.includes(action)`), lu ici en LECTURE SEULE (`auth/` hors
   * périmètre d'écriture de ce module).
   */
  private exigerDroitCiblerAutrui(
    principal: PrincipalAuthentifie,
    technicienCibleId: string,
  ): void {
    // Un compte de service (borne) n'est jamais « soi » : self-vs-autrui ne le concerne pas.
    if (estCompteDeService(principal.role)) return;
    if (technicienCibleId === principal.utilisateurId) return;
    const droitsDuRole = MATRICE_DROITS[principal.role] ?? [];
    if (!droitsDuRole.includes('atelier.pointage.pointer_autrui')) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        `Le rôle "${principal.role}" ne peut démarrer ou arrêter que son propre pointage ; ` +
          "pointer au nom d'un autre technicien exige le droit d'encadrement (atelier.pointage.pointer_autrui).",
      );
    }
  }

  /**
   * `POST /pointages` — RM-87 (trois cibles), RM-89/90 (chevauchement), RM-117 (cascade
   * ligne_or/ordre_reparation). Idempotence à DEUX niveaux (voir le commentaire de
   * `schemaDemarragePointage`, `contrats/pointage/pointage.ts`) :
   *  1. `Idempotency-Key` — géré par `ServiceIdempotence.executer` (rejeu exact de LA MÊME requête).
   *  2. `id` du corps — géré ICI, par une lecture préalable (PAS un `catch` de violation de
   *     contrainte après coup : sans SAVEPOINT — absent de ce dépôt à ce jour — un `INSERT` en échec
   *     empoisonnerait le reste de la transaction). Un rejeu légitime avec une Idempotency-Key
   *     DIFFÉRENTE (le cas hors ligne documenté) est ainsi absorbé AVANT toute tentative d'écriture ;
   *     la collision imprévue (course concurrente) reste couverte, en dernier recours, par le
   *     `catch` sur l'insertion elle-même, qui abandonne alors la transaction (comportement correct
   *     pour un cas qui ne devrait statistiquement jamais se produire).
   */
  async demarrer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeDemarragePointage,
    cleIdempotence: string,
  ): Promise<ResultatEcriture> {
    // FAILLE CORRIGÉE : refuser AVANT toute écriture — et avant même d'entrer dans l'idempotence,
    // pour ne rien mémoriser d'une requête non autorisée — un démarrage au nom d'un autre technicien
    // par un rôle non habilité.
    this.exigerDroitCiblerAutrui(principal, entree.technicienId);
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/pointages', cle: cleIdempotence, corps: entree },
      async (tx) => {
        const existant = await chargerPointageOuNull(tx, ctx, entree.id);
        if (existant) {
          if (!pointageCorrespondEntree(existant, entree)) {
            throw new ErreurMetier(
              'CONFLIT',
              `L'identifiant de pointage ${entree.id} est déjà utilisé par un autre événement.`,
            );
          }
          const duree = dureeBruteDepuisPeriode(existant.debutLe, existant.finLe);
          return {
            statutHttp: 200,
            corps: { donnees: mapperPointage(existant, duree), avertissements: [] },
          };
        }

        const debutLe = new Date(entree.debutLe);
        const ordreReparationId = 'ordreReparationId' in entree ? entree.ordreReparationId : null;
        const ligneOrId = 'ligneOrId' in entree ? entree.ligneOrId : null;

        let or: LigneOrdreReparation | null = null;
        let ligne: LigneLigneOr | null = null;

        if (ordreReparationId) {
          or = await chargerOrPourPointage(tx, ctx, ordreReparationId);
          if (or.siteId !== entree.siteId) {
            throw new ErreurMetier(
              'VALIDATION_ECHOUEE',
              "Le site indiqué ne correspond pas au site de l'ordre de réparation ciblé.",
              {
                erreurs: [
                  {
                    champ: 'siteId',
                    code: 'incoherent',
                    message: "Ne correspond pas à l'ordre de réparation.",
                  },
                ],
              },
            );
          }
          if (!estOrPointable(or.statut)) {
            throw new ErreurMetier(
              'POINTAGE_OR_NON_MODIFIABLE',
              `L'ordre de réparation ${or.numero} n'est plus pointable (statut ${or.statut}, RM-92).`,
              {
                blocages: [
                  {
                    type: 'ordre_reparation',
                    id: or.id,
                    libelle: or.numero,
                    donnees: { statutActuel: or.statut },
                  },
                ],
              },
            );
          }
        }
        if (ligneOrId && ordreReparationId) {
          ligne = await chargerLignePourPointage(tx, ctx, ordreReparationId, ligneOrId);
          if (!estLignePointable(ligne.statut)) {
            throw new ErreurMetier(
              'POINTAGE_LIGNE_NON_POINTABLE',
              `Cette ligne n'est plus pointable (statut ${ligne.statut}, RM-93).`,
              {
                blocages: [
                  {
                    type: 'ligne_or',
                    id: ligne.id,
                    libelle: ligne.designation ?? '',
                    donnees: { statutActuel: ligne.statut },
                  },
                ],
                actionsProposees: [{ code: 'RAFRAICHIR' }],
              },
            );
          }
        }

        const collecteur = new CollecteurAvertissements();
        const parametres = await chargerParametresPointage(tx, ctx);

        // RM-89/90 : clôture automatique de l'éventuel pointage encore ouvert du même technicien —
        // contrainte de base (`pointage_technicien_un_seul_en_cours_uk`), voir regles-pointage.ts.
        const ouvert = await chargerPointageOuvertTechnicien(tx, ctx, entree.technicienId);
        if (ouvert) {
          const cloture = calculerClotureChevauchement(ouvert.debutLe, debutLe);
          const dureeBrute = dureeBruteDepuisPeriode(ouvert.debutLe, cloture.finLe) ?? 0;
          const dureeArrondie = calculerDureeArrondieCentiemes(
            dureeBrute,
            parametres.arrondiPointage,
          );
          const doitAnomalie = chevauchementDoitProduireAnomalie(
            cloture.ordreInverse,
            parametres.chevauchementPointageAutorise,
          );

          await this.ecrireFermeture(tx, ctx, ouvert, {
            finLe: cloture.finLe,
            dureeArrondieCentiemes: dureeArrondie,
            clotureAutomatique: true,
            anomalieMotif: doitAnomalie ? 'chevauchement' : ouvert.anomalieMotif,
            anomalieDetecteeLe: doitAnomalie
              ? this.horloge.maintenant()
              : ouvert.anomalieDetecteeLe,
          });
          collecteur.ajouter(
            'POINTAGE_CLOTURE_AUTOMATIQUE',
            `Le pointage précédent de ce technicien (${ouvert.id}) a été clôturé automatiquement (RM-89).`,
            {
              pointageId: ouvert.id,
              finLe: cloture.finLe.toISOString(),
              ordreInverse: cloture.ordreInverse,
            },
          );
        }

        const decalageAnormal = deriveHorlogeAnormale(entree.decalageHorlogeMs);
        const maintenant = this.horloge.maintenant();

        const valeurs: NouveauPointage = {
          id: entree.id,
          tenantId: ctx.tenantId,
          siteId: entree.siteId,
          technicienId: entree.technicienId,
          statut: 'en_cours',
          nature: entree.nature,
          ordreReparationId,
          ligneOrId,
          activiteIndirecte: 'activiteIndirecte' in entree ? entree.activiteIndirecte : null,
          source: entree.source,
          appareilId: entree.appareilId ?? null,
          debutLe,
          finLe: null,
          dureeArrondieCentiemes: null,
          decalageHorlogeMsDebut: entree.decalageHorlogeMs ?? null,
          decalageHorlogeMsFin: null,
          clotureAutomatique: false,
          anomalieMotif: decalageAnormal ? 'derive_horloge' : null,
          anomalieDetecteeLe: decalageAnormal ? maintenant : null,
          anomalieTraiteeLe: null,
          derniereCorrectionMotif: null,
          derniereCorrectionParUtilisateurId: null,
          derniereCorrectionLe: null,
          debutLeOrigine: null,
          finLeOrigine: null,
        };

        let cree: LignePointage | undefined;
        try {
          [cree] = await tx.insert(pointage).values(valeurs).returning();
        } catch (erreur) {
          if (estCollisionIdPointage(erreur)) {
            throw new ErreurMetier(
              'CONFLIT',
              `L'identifiant de pointage ${entree.id} est déjà utilisé (collision concurrente).`,
            );
          }
          throw erreur;
        }
        if (!cree)
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion du pointage n'a rendu aucune ligne.",
          );

        // RM-117 : un seul geste peut produire jusqu'à deux transitions en cascade.
        if (ligne && ligneDoitPasserEnCours(ligne.statut)) {
          await this.transitionnerLigneEnCours(tx, ctx, ligne);
        }
        if (or && orDoitPasserEnCours(or.statut)) {
          await this.transitionnerOrEnCours(tx, ctx, or);
        }

        return { statutHttp: 201, corps: collecteur.envelopper(mapperPointage(cree, null)) };
      },
    );
  }

  /**
   * `POST /pointages/{id}/arreter` — `en_cours -> termine` (RM-116 : c'est aussi le mécanisme d'une
   * pause). RM-118 : ne déclenche RIEN sur `ligne_or` (`marquer_realisee` reste une action séparée).
   */
  async arreter(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    id: string,
    entree: EntreeArretPointage,
    cleIdempotence: string,
  ): Promise<ResultatEcriture> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/pointages/:id/arreter',
        cle: cleIdempotence,
        corps: { id, ...entree },
      },
      async (tx) => {
        const actuel = await chargerPointagePourEcriture(tx, ctx, id);
        // FAILLE CORRIGÉE : arrêter le pointage d'un AUTRE technicien exige l'habilitation
        // d'encadrement. Le corps ne porte que `id` + `finLe` ; la propriété se lit sur la ligne
        // chargée sous verrou. Placé AVANT tout contrôle d'état et toute écriture.
        this.exigerDroitCiblerAutrui(principal, actuel.technicienId);
        if (actuel.statut !== 'en_cours') {
          throw new ErreurMetier(
            'POINTAGE_TRANSITION_INTERDITE',
            `Le pointage ${id} n'est pas en cours (statut actuel : ${actuel.statut}).`,
            {
              blocages: [
                { type: 'pointage', id, libelle: id, donnees: { statutActuel: actuel.statut } },
              ],
              actionsProposees: actuel.statut === 'verrouille' ? [] : [{ code: 'RAFRAICHIR' }],
            },
          );
        }

        const finLe = new Date(entree.finLe);
        if (finLe.getTime() < actuel.debutLe.getTime()) {
          throw new ErreurMetier(
            'POINTAGE_HORODATAGE_INVALIDE',
            'La fin déclarée précède le début du pointage.',
            {
              erreurs: [
                {
                  champ: 'finLe',
                  code: 'anterieur_au_debut',
                  message: 'finLe doit être postérieur ou égal à debutLe.',
                },
              ],
            },
          );
        }

        const parametres = await chargerParametresPointage(tx, ctx);
        const dureeBrute = dureeBruteDepuisPeriode(actuel.debutLe, finLe) ?? 0;
        const dureeArrondie = calculerDureeArrondieCentiemes(
          dureeBrute,
          parametres.arrondiPointage,
        );

        const maintenant = this.horloge.maintenant();
        let anomalieMotif = actuel.anomalieMotif;
        let anomalieDetecteeLe = actuel.anomalieDetecteeLe;

        // RM-123 : détection DIFFÉRÉE — la ligne/l'OR a pu changer d'état PENDANT que ce pointage
        // tournait ; ce n'est constaté qu'au prochain événement le concernant, ici l'arrêt.
        if (anomalieMotif === null) {
          anomalieMotif = await this.detecterAnomalieDifferee(tx, ctx, actuel);
          if (anomalieMotif) anomalieDetecteeLe = maintenant;
        }
        // RM-96 : durée anormalement longue.
        if (
          anomalieMotif === null &&
          dureeDepasseLeSeuil(dureeBrute, parametres.pointageDureeMaxHeures)
        ) {
          anomalieMotif = 'duree_trop';
          anomalieDetecteeLe = maintenant;
        }
        // Dérive d'horloge déclarée à l'arrêt (voir `demarrer` pour la même vérification au début).
        if (anomalieMotif === null && deriveHorlogeAnormale(entree.decalageHorlogeMs)) {
          anomalieMotif = 'derive_horloge';
          anomalieDetecteeLe = maintenant;
        }

        const misAJour = await this.ecrireFermeture(tx, ctx, actuel, {
          finLe,
          dureeArrondieCentiemes: dureeArrondie,
          clotureAutomatique: false,
          decalageHorlogeMsFin: entree.decalageHorlogeMs ?? null,
          anomalieMotif,
          anomalieDetecteeLe,
        });

        return {
          statutHttp: 200,
          corps: { donnees: mapperPointage(misAJour, dureeBrute), avertissements: [] },
        };
      },
    );
  }

  /**
   * `POST /pointages/{id}/corriger` — RM-94 : rôle habilité (vérifié en amont par `@ExigerDroit`,
   * pas ici) + motif conditionnel + valeur d'origine conservée + journalisée (`audit_atelier` via
   * le trigger `pointage_audit`, migration 0030 — pas une écriture applicative supplémentaire).
   * RM-123 : réaffecter la cible ou classer en improductif TRAITE l'anomalie en cours.
   *
   * PROPRIÉTÉ — pas de garde `exigerDroitCiblerAutrui` ici, à la différence de `demarrer`/`arreter` :
   * la route porte le `@ExigerDroit('atelier.pointage.corriger_autrui')` STATIQUE, détenu par le seul
   * encadrement (chef d'atelier / direction / admin) — voir `DROITS_POINTAGE_PAR_ROLE`. Il n'existe
   * AUCUN chemin « corriger son propre pointage » à distinguer (l'action `corriger_soi_meme` de la
   * spec n'est pas livrée) : toute correction est, par construction, un geste d'encadrement sur le
   * pointage d'un membre de l'équipe — un technicien reçoit `403` au garde, jamais ce service. La
   * borne (`poste_atelier`) ne détient pas `corriger_autrui` : elle ne peut pas non plus l'atteindre.
   */
  async corriger(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    id: string,
    entree: EntreeCorrectionPointage,
    cleIdempotence: string,
  ): Promise<ResultatEcriture> {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/pointages/:id/corriger',
        cle: cleIdempotence,
        corps: { id, ...entree },
      },
      async (tx) => {
        const actuel = await chargerPointagePourEcriture(tx, ctx, id);

        if (actuel.statut === 'verrouille') {
          throw new ErreurMetier(
            'POINTAGE_PERIODE_VERROUILLEE',
            `Le pointage ${id} appartient à une période verrouillée (RM-95) : contre-passation requise avant toute correction.`,
            {
              blocages: [{ type: 'pointage', id, libelle: id }],
              actionsProposees: [{ code: 'RAFRAICHIR' }],
            },
          );
        }

        const debutLe = entree.debutLe !== undefined ? new Date(entree.debutLe) : actuel.debutLe;
        const finLe = entree.finLe !== undefined ? new Date(entree.finLe) : actuel.finLe;
        const nature = entree.nature ?? actuel.nature;
        const ordreReparationId =
          entree.ordreReparationId !== undefined
            ? entree.ordreReparationId
            : actuel.ordreReparationId;
        const ligneOrId = entree.ligneOrId !== undefined ? entree.ligneOrId : actuel.ligneOrId;
        const activiteIndirecte =
          entree.activiteIndirecte !== undefined
            ? entree.activiteIndirecte
            : actuel.activiteIndirecte;

        this.validerCoherenceCible(nature, ordreReparationId, ligneOrId, activiteIndirecte);

        if (finLe !== null && finLe.getTime() < debutLe.getTime()) {
          throw new ErreurMetier(
            'POINTAGE_HORODATAGE_INVALIDE',
            'La fin déclarée précède le début du pointage.',
            {
              erreurs: [
                {
                  champ: 'finLe',
                  code: 'anterieur_au_debut',
                  message: 'finLe doit être postérieur ou égal à debutLe.',
                },
              ],
            },
          );
        }
        // `en_cours -> termine` seulement (jamais l'inverse — RM-94 corrige des valeurs, ne rouvre
        // pas un pointage déjà fermé ; effacer `finLe` est structurellement impossible ici, le
        // schéma d'entrée ne permet pas de le mettre à `null`, seulement de le fournir).
        const statutCible =
          actuel.statut === 'en_cours' && finLe !== null ? 'termine' : actuel.statut;

        const rienNeChange =
          debutLe.getTime() === actuel.debutLe.getTime() &&
          (finLe?.getTime() ?? null) === (actuel.finLe?.getTime() ?? null) &&
          nature === actuel.nature &&
          ordreReparationId === actuel.ordreReparationId &&
          ligneOrId === actuel.ligneOrId &&
          activiteIndirecte === actuel.activiteIndirecte;

        if (!rienNeChange && !entree.motif) {
          throw new ErreurMetier(
            'POINTAGE_MOTIF_REQUIS',
            'Un motif est requis dès qu’un champ du pointage change (RM-94).',
            {
              erreurs: [
                {
                  champ: 'motif',
                  code: 'requis',
                  message: 'Motif obligatoire pour cette correction.',
                },
              ],
            },
          );
        }

        if (rienNeChange) {
          const duree = dureeBruteDepuisPeriode(actuel.debutLe, actuel.finLe);
          return {
            statutHttp: 200,
            corps: { donnees: mapperPointage(actuel, duree), avertissements: [] },
          };
        }

        const parametres = await chargerParametresPointage(tx, ctx);
        const dureeBrute = dureeBruteDepuisPeriode(debutLe, finLe);
        const dureeArrondie =
          dureeBrute !== null
            ? calculerDureeArrondieCentiemes(dureeBrute, parametres.arrondiPointage)
            : null;

        let misAJour: LignePointage | undefined;
        try {
          [misAJour] = await tx
            .update(pointage)
            .set({
              debutLe,
              finLe,
              nature,
              ordreReparationId,
              ligneOrId,
              activiteIndirecte,
              statut: statutCible,
              dureeArrondieCentiemes: dureeArrondie,
              derniereCorrectionMotif: entree.motif ?? null,
              derniereCorrectionParUtilisateurId: principal.utilisateurId,
              derniereCorrectionLe: this.horloge.maintenant(),
              debutLeOrigine: actuel.debutLeOrigine ?? actuel.debutLe,
              finLeOrigine: actuel.finLeOrigine ?? actuel.finLe,
              // RM-123 : une correction qui réussit TRAITE l'anomalie en cours, quelle qu'elle soit.
              anomalieTraiteeLe:
                actuel.anomalieMotif !== null
                  ? this.horloge.maintenant()
                  : actuel.anomalieTraiteeLe,
            })
            .where(and(eq(pointage.tenantId, ctx.tenantId), eq(pointage.id, id)))
            .returning();
        } catch (erreur) {
          const traduite = traduireErreurTransitionPointage(erreur, id);
          if (traduite) throw traduite;
          throw erreur;
        }
        if (!misAJour)
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "La correction du pointage n'a rendu aucune ligne.",
          );

        return {
          statutHttp: 200,
          corps: { donnees: mapperPointage(misAJour, dureeBrute), avertissements: [] },
        };
      },
    );
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Lecture                                                                                    */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * `GET /pointages/{id}` — le sien ou celui d'un technicien encadré (RM-99, §9 de la spec pointage).
   *
   * DROIT — `atelier.pointage.lire` est posé et câblé par rôle dans `matrice-droits.ts` (bloc
   * `DROITS_POINTAGE_PAR_ROLE`, vérifié au 2026-08-03 — CORRECTIF d'un commentaire antérieur qui
   * décrivait cette route comme morte, exact au moment où ce fichier a été écrit, plus vrai
   * depuis). La spec propose DEUX droits distincts pour cette seule ressource (`atelier.pointage.
   * lire` = le sien, `atelier.pointage.lire_equipe` = tous) alors que `GardeDroit` n'accepte qu'UN
   * SEUL `@ExigerDroit` statique par route et que le contrat (`contrats/pointage/pointage.ts`,
   * GELÉ) n'expose qu'UNE SEULE route `GET /pointages/{id}` — pas de variante par droit. Ce service
   * applique donc la restriction FINE ici, en app, après le contrôle statique minimal
   * (`atelier.pointage.lire`, posé sur la route) : `ROLES_AVEC_VUE_EQUIPE_POINTAGE` (liste LOCALE,
   * PAS lue depuis `MATRICE_DROITS` — `atelier.pointage.lire_equipe` reste délibérément absente de
   * cette matrice, voir le commentaire de tête du bloc) borne qui voit au-delà de son propre
   * pointage. `RESSOURCE_INTROUVABLE` plutôt que `DROIT_INSUFFISANT` sur le pointage d'autrui : ne
   * pas révéler l'existence d'un pointage qu'on n'a pas le droit de voir.
   */
  async obtenir(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    id: string,
  ): Promise<ReponsePointage> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerPointageOuNull(tx, ctx, id);
      if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Pointage ${id} introuvable.`);
      if (
        ligne.technicienId !== principal.utilisateurId &&
        !ROLES_AVEC_VUE_EQUIPE_POINTAGE.has(principal.role)
      ) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Pointage ${id} introuvable.`);
      }
      return mapperPointage(ligne, dureeBruteDepuisPeriode(ligne.debutLe, ligne.finLe));
    });
  }

  /**
   * `GET /pointages` — pagination par curseur v2 (§6.1), tri `debutLe:asc|desc` seulement
   * (`TRIS_POINTAGES`). Le filtrage par technicien/équipe est un FILTRE (`technicienId`), pas une
   * route distincte — cohérent avec la doctrine déjà posée pour `STATUTS_POINTAGE`.
   *
   * MÊME RESTRICTION QUE `obtenir` (voir son commentaire) : un rôle sans vue équipe qui ne demande
   * pas EXPLICITEMENT son propre `technicienId` voit son filtre FORCÉ dessus, silencieusement —
   * jamais une fuite vers les pointages d'un collègue, jamais une erreur pour une requête par
   * ailleurs légitime (l'écran atelier d'un technicien n'a probablement même pas connaissance du
   * filtre `technicienId`).
   */
  async lister(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    filtres: FiltresPointages,
    limite: number,
    curseur: string | undefined,
  ): Promise<PageCurseur<ReponsePointage>> {
    const sens = filtres.tri === 'debutLe:asc' ? 'asc' : 'desc';
    const curseurDecode = decoderCurseurPointages(curseur, filtres.tri);
    const vueEquipe = ROLES_AVEC_VUE_EQUIPE_POINTAGE.has(principal.role);
    const technicienIdEffectif = vueEquipe ? filtres.technicienId : principal.utilisateurId;

    return this.acces.enTenant(ctx, async (tx) => {
      const clauses: SQL[] = [eq(pointage.tenantId, ctx.tenantId)];
      if (filtres.siteId) clauses.push(eq(pointage.siteId, filtres.siteId));
      if (technicienIdEffectif) clauses.push(eq(pointage.technicienId, technicienIdEffectif));
      if (filtres.ordreReparationId)
        clauses.push(eq(pointage.ordreReparationId, filtres.ordreReparationId));
      if (filtres.ligneOrId) clauses.push(eq(pointage.ligneOrId, filtres.ligneOrId));
      if (filtres.source) clauses.push(eq(pointage.source, filtres.source));
      if (filtres.statut && filtres.statut.length > 0)
        clauses.push(inArray(pointage.statut, filtres.statut));
      if (filtres.nature && filtres.nature.length > 0)
        clauses.push(inArray(pointage.nature, filtres.nature));
      if (filtres.anomalie !== undefined) {
        clauses.push(
          filtres.anomalie ? isNotNull(pointage.anomalieMotif) : isNull(pointage.anomalieMotif),
        );
      }
      if (filtres.debutDu) clauses.push(gte(pointage.debutLe, new Date(filtres.debutDu)));
      if (filtres.debutAu) clauses.push(lte(pointage.debutLe, new Date(filtres.debutAu)));
      if (curseurDecode)
        clauses.push(conditionKeysetPointage(sens, curseurDecode.valeur, curseurDecode.id));

      const colonnes = getTableColumns(pointage);
      const lignes = await tx
        .select({ ...colonnes, triValeur: expressionTriValeurPointage })
        .from(pointage)
        .where(and(...clauses))
        .orderBy(...ordreParDebutLe(sens))
        .limit(limite + 1);

      const aUnePageSuivante = lignes.length > limite;
      const pageLignes = aUnePageSuivante ? lignes.slice(0, limite) : lignes;
      const derniere = pageLignes.at(-1);

      return {
        donnees: pageLignes.map((l) =>
          mapperPointage(l, dureeBruteDepuisPeriode(l.debutLe, l.finLe)),
        ),
        curseurSuivant:
          aUnePageSuivante && derniere
            ? encoderCurseurTrie({
                tri: filtres.tri,
                valeur: valeurCurseurDepuisTriPointage(derniere.triValeur),
                id: derniere.id,
              })
            : null,
        limite,
      };
    });
  }

  /**
   * `GET /pointages/agregats-ligne` — temps réellement passé (pointé) vs temps facturé (barémé)
   * pour chaque ligne pointable de l'OR. Lecture NON verrouillée (rapport de consultation, aucune
   * écriture) ; `RESSOURCE_INTROUVABLE` si l'OR n'existe pas pour ce tenant, même code que le reste
   * des lectures pointage sur une cible absente.
   *
   * PAS de restriction `ROLES_AVEC_VUE_EQUIPE_POINTAGE` ici (voir `obtenir`/`lister`) : cet agrégat
   * ne nomme aucun technicien, seulement des totaux par ligne — voir l'en-tête de
   * `contrats/pointage/agregat-ligne.ts` pour le raisonnement complet.
   */
  async obtenirAgregatsLigne(
    ctx: ContexteTenant,
    ordreReparationId: string,
  ): Promise<ReponseAgregatTempsLigne> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOrOuNull(tx, ctx, ordreReparationId);
      if (!or)
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Ordre de réparation ${ordreReparationId} introuvable.`,
        );

      const [lignes, pointages] = await Promise.all([
        chargerLignesOrPourAgregat(tx, ctx, ordreReparationId),
        chargerPointagesPourAgregatLigne(tx, ctx, ordreReparationId),
      ]);

      return { ordreReparationId, lignes: calculerAgregatsTempsLigne(lignes, pointages) };
    });
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Infrastructure interne                                                                    */
  /* ---------------------------------------------------------------------------------------- */

  /** Écrit `en_cours -> termine` — SEUL point d'écriture de cette transition dans ce service. */
  private async ecrireFermeture(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    actuel: LignePointage,
    champs: {
      readonly finLe: Date;
      readonly dureeArrondieCentiemes: number;
      readonly clotureAutomatique: boolean;
      readonly decalageHorlogeMsFin?: number | null;
      readonly anomalieMotif: MotifAnomaliePointage | null;
      readonly anomalieDetecteeLe: Date | null;
    },
  ): Promise<LignePointage> {
    try {
      const [misAJour] = await tx
        .update(pointage)
        .set({
          statut: 'termine',
          finLe: champs.finLe,
          dureeArrondieCentiemes: champs.dureeArrondieCentiemes,
          clotureAutomatique: champs.clotureAutomatique,
          ...(champs.decalageHorlogeMsFin !== undefined
            ? { decalageHorlogeMsFin: champs.decalageHorlogeMsFin }
            : {}),
          anomalieMotif: champs.anomalieMotif,
          anomalieDetecteeLe: champs.anomalieDetecteeLe,
        })
        .where(and(eq(pointage.tenantId, ctx.tenantId), eq(pointage.id, actuel.id)))
        .returning();
      if (!misAJour)
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "La fermeture du pointage n'a rendu aucune ligne.",
        );
      return misAJour;
    } catch (erreur) {
      if (erreur instanceof ErreurMetier) throw erreur;
      const traduite = traduireErreurTransitionPointage(erreur, actuel.id);
      if (traduite) throw traduite;
      throw erreur;
    }
  }

  /** RM-117 : `ligne_or.validee -> en_cours`. Écriture directe et locale (pas de port vers
   *  `atelier` — voir l'en-tête de `references.ts`) ; transition déjà légale en base depuis la
   *  migration 0003, ce service est celui qui l'emprunte enfin. */
  private async transitionnerLigneEnCours(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneLigneOr,
  ): Promise<void> {
    try {
      await tx
        .update(ligneOr)
        .set({ statut: 'en_cours' })
        .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligne.id)));
    } catch (erreur) {
      const interpretation = interpreterErreurTransitionInterdite(erreur);
      if (interpretation) {
        throw new ErreurMetier(
          interpretation.code,
          `Transition ${interpretation.statutDepuis} → ${interpretation.statutVers} interdite sur la ligne d'OR (RM-117).`,
          {
            blocages: [
              {
                type: 'ligne_or',
                id: ligne.id,
                libelle: ligne.designation ?? '',
                donnees: { statutActuel: interpretation.statutDepuis },
              },
            ],
          },
        );
      }
      throw erreur;
    }
  }

  /** RM-117 / T-04 : `ordre_reparation.ouvert -> en_cours`. */
  private async transitionnerOrEnCours(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    or: { readonly id: string; readonly numero: string },
  ): Promise<void> {
    try {
      await tx
        .update(ordreReparation)
        .set({ statut: 'en_cours' })
        .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.id, or.id)));
    } catch (erreur) {
      const interpretation = interpreterErreurTransitionInterdite(erreur);
      if (interpretation) {
        throw new ErreurMetier(
          interpretation.code,
          `Transition ${interpretation.statutDepuis} → ${interpretation.statutVers} interdite sur l'ordre de réparation (RM-117/T-04).`,
          {
            blocages: [
              {
                type: 'ordre_reparation',
                id: or.id,
                libelle: or.numero,
                donnees: { statutActuel: interpretation.statutDepuis },
              },
            ],
          },
        );
      }
      throw erreur;
    }
  }

  /** RM-123 : anomalie DIFFÉRÉE — la cible a pu changer d'état pendant que le pointage tournait. */
  private async detecterAnomalieDifferee(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    actuel: LignePointage,
  ): Promise<MotifAnomaliePointage | null> {
    if (actuel.ligneOrId) {
      const ligne = await chargerLigneOuNull(tx, ctx, actuel.ligneOrId);
      if (ligne && ligneDevenueNonPointable(ligne.statut)) return 'ligne_non_pointable';
    }
    if (actuel.ordreReparationId) {
      const or = await chargerOrOuNull(tx, ctx, actuel.ordreReparationId);
      if (or && orDevenuNonPointable(or.statut)) return 'or_facture';
    }
    return null;
  }

  /** Miroir applicatif de `pointage_cible_coherente_chk` (RM-87) — refuse AVANT l'écriture avec un
   *  code métier lisible plutôt que de laisser remonter une violation `CHECK` brute. */
  private validerCoherenceCible(
    nature: 'productif_ligne' | 'productif_or' | 'indirect',
    ordreReparationId: string | null,
    ligneOrId: string | null,
    activiteIndirecte: string | null,
  ): void {
    const coherent =
      (nature === 'productif_ligne' &&
        ordreReparationId !== null &&
        ligneOrId !== null &&
        activiteIndirecte === null) ||
      (nature === 'productif_or' &&
        ordreReparationId !== null &&
        ligneOrId === null &&
        activiteIndirecte === null) ||
      (nature === 'indirect' &&
        ordreReparationId === null &&
        ligneOrId === null &&
        activiteIndirecte !== null);
    if (!coherent) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'La cible du pointage est incohérente avec sa nature (RM-87).',
        {
          erreurs: [
            {
              champ: 'nature',
              code: 'cible_incoherente',
              message:
                'Exactement une cible (ligne, OR, ou activité indirecte) doit être renseignée selon la nature.',
            },
          ],
        },
      );
    }
  }
}
