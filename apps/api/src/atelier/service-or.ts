import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type {
  AttentesOr,
  OrdreReparationResumeListe,
  ClientResume,
  EntreeCreationOrdreReparation,
  EntreeDemandeOrdreReparation,
  EntreeModificationOrdreReparation,
  FiltresJournal,
  FiltresOrdresReparation,
  ReponseAvecAvertissements,
  ReponseEntreeJournal,
  ReponseDevisComplementaire,
  ReponseOrdreReparation,
  ReponseOrdreReparationDemande,
  TotauxPayeurOr,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  client,
  ligneOr,
  ordreReparation,
  ordreReparationDemande,
  vehiculePlaque,
  type LigneLigneOr,
  type LigneOrControleQualite,
  type LigneOrdreReparation,
  type LigneVehicule,
  type LigneVehiculePlaque,
} from '../db/schema';
import { droitsDuPrincipal } from '../auth/droits-personne';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { calculerNomAffiche } from '../common/identite-client';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import { JETON_AUDIT, type EntreeAudit, type ServiceAudit } from '../common/audit';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from '../common/pagination';
import { debutJourneeSuisse, finJourneeSuisse } from '../common/temps';
import { JETON_COMPTEURS } from '../parametrage/compteurs/compteurs.jetons';
import type { ServiceCompteurs } from '../parametrage/compteurs/compteurs.types';

import { JETON_LECTURE_POINTAGE, type LecturePointage } from './atelier.jetons';
import { verifierConfirmation } from './confirmations';
import { calculerActionsDisponiblesPourRole, calculerEtatAffiche } from './etat-affiche';
import { convertirEnKm } from './kilometrage';
import {
  chargerLotListeOr,
  chargerLotResumeListeOr,
  exigerClient,
  exigerClientListe,
  exigerVehicule,
  exigerVehiculeListe,
} from './liste-or-lot';
import { mapperDemande, mapperDevis, mapperLigneOr, roleVoitLesMontants } from './mappeurs';
import { estRestitutionEnRetard } from './restitution-retard';
import {
  chargerControleQualite,
  chargerLigneOrPourEcriture,
  chargerOr,
  chargerOrOuNull,
  chargerOrPourEcriture,
  listerDemandesOr,
  listerDevisOr,
  listerLignesDevis,
  listerLignesOr,
} from './or-requetes';
import {
  chargerClientLigne,
  enregistrerReleveReception,
  chargerParametresAtelier,
  chargerPlaqueCourante,
  chargerResumesUtilisateurs,
  chargerResumeUtilisateur,
  chargerVehiculeLigne,
  construireVehiculeResume,
  versClientResume,
  type ResumeUtilisateur,
} from './references';
import { ServiceSnapshotOr } from './service-snapshot-or';
import { calculerTotauxParPayeur, STATUTS_EXCLUS_DES_TOTAUX } from './totaux-payeur';

/** OR encore actif — sert la garde P-29 (deux OR ouverts sur le même véhicule). */
const STATUTS_OR_ACTIFS = ['planifie', 'ouvert', 'en_cours', 'controle'] as const;

/** OR verrouillé (I-15) : plus aucune modification d'en-tête ni de ligne. */
const STATUTS_OR_VERROUILLES = ['facture', 'restitue', 'cloture', 'annule'] as const;

export function estOrVerrouille(statut: LigneOrdreReparation['statut']): boolean {
  return (STATUTS_OR_VERROUILLES as readonly string[]).includes(statut);
}

/**
 * #82 : borne `ReponseOrdreReparation.designationsApercu` à quelques désignations, jamais la liste
 * entière — l'aperçu sert à dire EN UNE LIGNE ce qui a été fait (fiche véhicule, RM-59 côté lecture
 * comptoir), pas à dupliquer `lignes`/`nombreLignes` qui restent la source complète.
 */
const SEUIL_DESIGNATIONS_APERCU = 3;

@Injectable()
export class ServiceOr {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    @Inject(JETON_AUDIT) private readonly audit: ServiceAudit,
    @Inject(JETON_COMPTEURS) private readonly compteurs: ServiceCompteurs,
    @Inject(JETON_LECTURE_POINTAGE) private readonly pointage: LecturePointage,
    private readonly snapshot: ServiceSnapshotOr,
    private readonly horloge: Horloge,
  ) {}

  /**
   * `POST /ordres-reparation` — RM-49 : un rejeu ne brûle jamais un numéro. Toute la commande
   * (gardes confirmables, snapshot RM-50, numérotation, insertion, demandes, événement) tourne
   * DANS la transaction ouverte par `ServiceIdempotence.executer` — un rollback (échec d'une
   * garde) rend le numéro consommé par `ServiceCompteurs`.
   */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeCreationOrdreReparation,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseOrdreReparation> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/ordres-reparation', cle: cleIdempotence, corps: entree },
      async (tx) => ({
        statutHttp: 201,
        corps: { donnees: await this.creerTx(tx, ctx, principal, entree), avertissements: [] },
      }),
    );
  }

  /**
   * Cœur transactionnel de `creer()` SANS enveloppe d'idempotence — réutilisé par
   * `POST /ordres-reparation/creation-rapide` (client + véhicule + OR dans une seule transaction).
   */
  async creerTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeCreationOrdreReparation,
  ): Promise<ReponseOrdreReparation> {
    const clientLigne = await chargerClientLigne(tx, ctx, entree.clientId);
    if (clientLigne.statut === 'bloque') {
      verifierConfirmation('CLIENT_BLOQUE', principal.role, entree.confirmations);
    }
    await chargerVehiculeLigne(tx, ctx, entree.vehiculeId);

    const parametres = await chargerParametresAtelier(tx, ctx);

    if (parametres.deuxOrMemeVehicule !== 'autoriser') {
      const orsOuverts = await tx
        .select({ id: ordreReparation.id })
        .from(ordreReparation)
        .where(
          and(
            eq(ordreReparation.tenantId, ctx.tenantId),
            eq(ordreReparation.vehiculeId, entree.vehiculeId),
            inArray(ordreReparation.statut, [...STATUTS_OR_ACTIFS]),
          ),
        );
      if (orsOuverts.length > 0) {
        if (parametres.deuxOrMemeVehicule === 'bloquer') {
          throw new ErreurMetier(
            'CONFLIT',
            'Un ordre de réparation est déjà ouvert sur ce véhicule.',
            {
              blocages: orsOuverts.map((o) => ({
                type: 'ordre_reparation' as const,
                id: o.id,
                libelle: 'OR déjà ouvert',
              })),
              actionsProposees: [{ code: 'RAFRAICHIR' }],
            },
          );
        }
        verifierConfirmation('VEHICULE_DEUX_OR_OUVERTS', principal.role, entree.confirmations);
      }
    }

    if (!parametres.orSansRdvAutorise && !entree.rendezVousId) {
      verifierConfirmation('OR_SANS_RDV', principal.role, entree.confirmations);
    }

    if (entree.statutInitial === 'planifie' && !parametres.etatPlanifieActif) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        "L'état « planifié » n'est pas activé pour ce garage (P-22).",
        {
          erreurs: [
            {
              champ: 'statutInitial',
              code: 'etat_planifie_inactif',
              message: 'État planifié désactivé.',
            },
          ],
        },
      );
    }

    const kilometrageEntreeKm =
      entree.kilometrageEntree != null
        ? convertirEnKm(entree.kilometrageEntree, entree.uniteKilometrage)
        : null;

    if (
      entree.statutInitial === 'ouvert' &&
      parametres.kmEntreeObligatoire &&
      kilometrageEntreeKm === null
    ) {
      throw new ErreurMetier(
        'OR_KM_ENTREE_REQUIS',
        "Le kilométrage d'entrée est obligatoire à la réception (RM-51).",
      );
    }

    const maintenant = this.horloge.maintenant();
    const snapshot = await this.snapshot.capturer(
      tx,
      ctx,
      entree.clientId,
      entree.vehiculeId,
      maintenant,
    );
    const numero = await this.genererNumero(tx, ctx, entree.siteId, parametres, maintenant);

    const [ligne] = await tx
      .insert(ordreReparation)
      .values({
        tenantId: ctx.tenantId,
        numero,
        siteId: entree.siteId,
        type: entree.type,
        statut: entree.statutInitial,
        clientId: entree.clientId,
        vehiculeId: entree.vehiculeId,
        clientDesignationFigee: snapshot.clientDesignationFigee,
        adresseFacturationFigee: snapshot.adresseFacturationFigee,
        conditionsFigees: snapshot.conditionsFigees ?? {},
        plaqueFigee: snapshot.plaqueFigee,
        detenteurFigeClientId: snapshot.detenteurFigeClientId,
        conducteurPresentNom: entree.conducteurPresentNom ?? null,
        kmEntree: kilometrageEntreeKm,
        plafondCentimes: entree.plafondCentimes ?? null,
        plafondAutorisePar: entree.plafondAutorisePar ?? null,
        restitutionPromiseLe: entree.restitutionPromiseLe
          ? new Date(entree.restitutionPromiseLe)
          : null,
        restitutionInitialeLe: entree.restitutionPromiseLe
          ? new Date(entree.restitutionPromiseLe)
          : null,
        ordreReparationParentId: entree.ordreReparationParentId ?? null,
        motifLien: entree.motifLien ?? null,
        rendezVousId: entree.rendezVousId ?? null,
        numeroCommandeInterne: entree.numeroCommandeInterne ?? null,
        receptionnaireId: principal.utilisateurId,
        ouvertLe: entree.statutInitial === 'ouvert' ? maintenant : null,
      })
      .returning();
    if (!ligne) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        "L'insertion de l'ordre de réparation n'a rendu aucune ligne.",
      );
    }

    let ordreDemande = 1;
    for (const demande of entree.demandes) {
      // eslint-disable-next-line no-await-in-loop -- append-only, ordre strictement croissant
      await tx.insert(ordreReparationDemande).values({
        tenantId: ctx.tenantId,
        ordreReparationId: ligne.id,
        ordre: ordreDemande++,
        verbatim: demande.verbatim,
        saisiParId: principal.utilisateurId,
      });
    }

    if (ligne.statut === 'ouvert') {
      if (entree.kilometrageEntree != null && kilometrageEntreeKm !== null) {
        await enregistrerReleveReception(tx, ctx, {
          vehiculeId: entree.vehiculeId,
          orId: ligne.id,
          valeur: entree.kilometrageEntree,
          unite: entree.uniteKilometrage,
          valeurKm: kilometrageEntreeKm,
          releveLe: maintenant,
          saisiParId: principal.utilisateurId,
        });
      }
      await this.evenements.publier(tx, ctx, {
        type: 'ordre_reparation.ouvert',
        versionSchema: 1,
        siteId: entree.siteId,
        ressource: { type: 'ordre_reparation', id: ligne.id, numero },
        donnees: { statut: 'ouvert' },
      });
    }

    return this.assemblerDocument(tx, ctx, principal.role, ligne.id);
  }

  async obtenirComplet(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
  ): Promise<ReponseOrdreReparation> {
    return this.acces.enTenant(ctx, (tx) => this.assemblerDocument(tx, ctx, principal.role, orId));
  }

  /**
   * `PATCH /ordres-reparation/{orId}` — `If-Match` obligatoire (§9). Version comparée DANS la
   * transaction pour éviter la course entre la lecture de l'ETag côté client et l'écriture.
   */
  async modifier(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    ifMatch: string | undefined,
    entree: EntreeModificationOrdreReparation,
  ): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
    const versionAttendue = extraireVersionETag(ifMatch);

    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerOrPourEcriture(tx, ctx, orId);

      if (versionAttendue !== ligne.version) {
        throw new ErreurMetier(
          'CONFLIT',
          "La version de l'ordre de réparation a changé depuis la dernière lecture.",
          {
            detail: `version_attendue=${String(versionAttendue)};version_actuelle=${String(ligne.version)}`,
            actionsProposees: [{ code: 'RAFRAICHIR' }],
          },
        );
      }

      if (estOrVerrouille(ligne.statut)) {
        throw new ErreurMetier(
          'OR_LIGNE_VERROUILLEE',
          `Ordre de réparation verrouillé (statut ${ligne.statut}).`,
          {
            blocages: [
              {
                type: 'ordre_reparation',
                id: orId,
                libelle: ligne.numero,
                donnees: { statutActuel: ligne.statut },
              },
            ],
            actionsProposees: [{ code: 'RAFRAICHIR' }],
          },
        );
      }

      const reporteLaRestitution =
        entree.restitutionPromiseLe !== undefined &&
        entree.restitutionPromiseLe !== (ligne.restitutionPromiseLe?.toISOString() ?? null);
      if (reporteLaRestitution && !entree.motifReport) {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Un report de restitution exige un motif (RM-56).',
          {
            erreurs: [{ champ: 'motifReport', code: 'requis', message: 'Motif de report requis.' }],
          },
        );
      }

      // FINDING DE SÉCURITÉ CORRIGÉ — même famille que É-01 (ServiceVehiculeKilometrage.creer,
      // vehicule.kilometrage.corriger_regression) : `PATCH /ordres-reparation/{orId}` sert TOUS
      // les champs libres de l'en-tête sous le SEUL droit `atelier.or.modifier`, alors que
      // `plafondCentimes` (le montant au-delà duquel l'accord du client est requis, RM-54, §10
      // L969) mérite son propre droit `atelier.or.plafond_modifier`, structurellement plus fort.
      // Un `@ExigerDroit` STATIQUE posé sur cette route interdirait AUSSI les modifications
      // ordinaires (localisation, sous-traitant, report de restitution…) à tout rôle qui aurait
      // `atelier.or.modifier` sans `atelier.or.plafond_modifier` — la route est partagée entre les
      // deux usages, et seul le service, après avoir chargé la valeur actuelle sous verrou, sait si
      // CETTE requête précise touche réellement le plafond. Contrôle posé ICI, avant toute
      // écriture, uniquement quand la valeur change effectivement (renvoyer la valeur déjà en
      // place n'est pas une modification) — même idiome que `GardeDroit.canActivate`
      // (`actionsCourantes(role)`, `.includes(action)`).
      const modifiePlafond =
        entree.plafondCentimes !== undefined &&
        entree.plafondCentimes !== (ligne.plafondCentimes ?? undefined);
      if (modifiePlafond) {
        const droitsDuRole = droitsDuPrincipal(principal).actions;
        if (!droitsDuRole.includes('atelier.or.plafond_modifier')) {
          throw new ErreurMetier(
            'DROIT_INSUFFISANT',
            `Le rôle "${principal.role}" n'a pas le droit de modifier le plafond de l'ordre de réparation (§10 L969).`,
          );
        }
      }

      await tx
        .update(ordreReparation)
        .set({
          ...(entree.localisation !== undefined ? { localisation: entree.localisation } : {}),
          ...(entree.sousTraitantNom !== undefined
            ? { sousTraitantNom: entree.sousTraitantNom ?? null }
            : {}),
          ...(entree.restitutionPromiseLe !== undefined
            ? {
                restitutionPromiseLe: entree.restitutionPromiseLe
                  ? new Date(entree.restitutionPromiseLe)
                  : null,
              }
            : {}),
          ...(entree.plafondCentimes !== undefined
            ? { plafondCentimes: entree.plafondCentimes }
            : {}),
          ...(entree.plafondAutorisePar !== undefined
            ? { plafondAutorisePar: entree.plafondAutorisePar ?? null }
            : {}),
          ...(entree.numeroCommandeInterne !== undefined
            ? { numeroCommandeInterne: entree.numeroCommandeInterne ?? null }
            : {}),
          ...(entree.conducteurPresentNom !== undefined
            ? { conducteurPresentNom: entree.conducteurPresentNom ?? null }
            : {}),
        })
        .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.id, orId)));

      const document = await this.assemblerDocument(tx, ctx, principal.role, orId);
      return { donnees: document, avertissements: [] };
    });
  }

  async listerDemandes(
    ctx: ContexteTenant,
    orId: string,
  ): Promise<readonly ReponseOrdreReparationDemande[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerOr(tx, ctx, orId);
      const lignes = await listerDemandesOr(tx, ctx, orId);
      // Correctif N+1 : UNE requête pour tous les auteurs de la page, plutôt qu'un
      // `chargerResumeUtilisateur` par demande — voir `chargerResumesUtilisateurs`.
      const auteurs = await chargerResumesUtilisateurs(
        tx,
        ctx,
        lignes.map((l) => l.saisiParId),
      );
      return lignes.map((l) =>
        mapperDemande(l, l.saisiParId ? (auteurs.get(l.saisiParId) ?? null) : null),
      );
    });
  }

  async ajouterDemande(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeDemandeOrdreReparation,
  ): Promise<ReponseOrdreReparationDemande> {
    return this.acces.enTenant(ctx, async (tx) => {
      const or = await chargerOrPourEcriture(tx, ctx, orId);
      if (estOrVerrouille(or.statut)) {
        throw new ErreurMetier(
          'OR_LIGNE_VERROUILLEE',
          `Ordre de réparation verrouillé (statut ${or.statut}).`,
          {
            blocages: [
              {
                type: 'ordre_reparation',
                id: orId,
                libelle: or.numero,
                donnees: { statutActuel: or.statut },
              },
            ],
            actionsProposees: [{ code: 'RAFRAICHIR' }],
          },
        );
      }
      const existantes = await listerDemandesOr(tx, ctx, orId);
      const prochainOrdre = (existantes.at(-1)?.ordre ?? 0) + 1;
      const [ligne] = await tx
        .insert(ordreReparationDemande)
        .values({
          tenantId: ctx.tenantId,
          ordreReparationId: orId,
          ordre: prochainOrdre,
          verbatim: entree.verbatim,
          saisiParId: principal.utilisateurId,
        })
        .returning();
      if (!ligne) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "L'insertion de la demande n'a rendu aucune ligne.",
        );
      }
      return mapperDemande(ligne, await chargerResumeUtilisateur(tx, ctx, ligne.saisiParId));
    });
  }

  /**
   * `GET /ordres-reparation/{orId}/journal` (RM-59, RM-111) : historique COMPLET de l'OR — son
   * propre en-tête, plus chacune de ses lignes et de ses devis.
   *
   * UN SEUL aller-retour d'audit : `ServiceAudit.pourEntitesTx` (`common/audit/service-audit.ts`)
   * accepte la liste COMPLÈTE des couples (entité, id) à historiser et rend leurs entrées en une
   * seule requête SQL (`unnest` apparié, pas une boucle) — corrige un défaut réel constaté ici :
   * la version précédente bouclait sur `ServiceAudit.pourEntite`, qui ouvre SA PROPRE transaction
   * (`AccesBase.enTenant`) à CHAQUE appel, donc sa propre connexion prise sur le pool partagé
   * (`DATABASE_POOL_MAX=10` en dev), alors que cette méthode tourne déjà À L'INTÉRIEUR d'une
   * transaction (`this.acces.enTenant` ci-dessous) qui en détient une — jusqu'à ~19 connexions
   * imbriquées pour un seul OR (une par ligne/devis), et une lecture non atomique avec le reste de
   * la transaction appelante (le journal pouvait voir un état antérieur ou postérieur au commit).
   * `pourEntitesTx` lit DANS le `tx` fourni : une connexion, un seul aller-retour, atomique.
   *
   * NORMALISATION `creeLe` : `ServiceAudit.pourEntitesTx` déclare `EntreeAudit.creeLe: Date`
   * (`common/audit/audit.types.ts`), mais son implémentation (`common/audit/service-audit.ts`)
   * lit `audit_atelier` par SQL brut (`tx.execute<LigneAuditBrute>`), hors du mapping de colonnes
   * Drizzle — vérifié en conditions réelles : la valeur reçue ICI est en fait une `string` Postgres
   * (`"2026-08-04 09:29:38.68287+00"`), pas une instance `Date`. Un tri par `.getTime()` sur cette
   * valeur plantait avec `TypeError: b.creeLe.getTime is not a function` (500 sur CHAQUE appel,
   * quel que soit l'OR). `normaliserCreeLe` blinde CE point de consommation contre l'écart entre le
   * type déclaré et le type réellement reçu, sans modifier `common/audit/` (hors périmètre de ce
   * module) — une correction du contrat lui-même (faire respecter `Date` à la source) reste
   * préférable et à faire là-bas.
   *
   * Pagination et filtres implémentés en mémoire après fusion/tri — SIMPLIFICATION SIGNALÉE :
   * pas le mécanisme de curseur trié partagé (`common/pagination/curseur.ts`, conçu pour un tri
   * SQL), un curseur d'offset opaque suffit à ce volume et reste conforme au contrat (opaque,
   * `400 VALIDATION_ECHOUEE` sur curseur illisible).
   */
  async journal(
    ctx: ContexteTenant,
    orId: string,
    filtres: FiltresJournal,
    limite: number,
    curseur: string | undefined,
  ): Promise<{ donnees: readonly ReponseEntreeJournal[]; curseurSuivant: string | null }> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerOr(tx, ctx, orId);
      const [lignes, devisRows] = await Promise.all([
        listerLignesOr(tx, ctx, orId),
        listerDevisOr(tx, ctx, orId),
      ]);

      const entites: readonly {
        entite: 'ordre_reparation' | 'ligne_or' | 'devis_complementaire';
        entiteId: string;
      }[] = [
        { entite: 'ordre_reparation', entiteId: orId },
        ...lignes.map((l) => ({ entite: 'ligne_or' as const, entiteId: l.id })),
        ...devisRows.map((d) => ({ entite: 'devis_complementaire' as const, entiteId: d.id })),
      ];

      const lot = await this.audit.pourEntitesTx(tx, ctx, entites);
      const brutes: EntreeAudit[] = lot.map((entree) => ({
        ...entree,
        creeLe: normaliserCreeLe(entree.creeLe),
      }));

      const filtrees = brutes.filter((entree) => {
        if (filtres.entite && entree.entite !== filtres.entite) return false;
        if (filtres.action && entree.action !== filtres.action) return false;
        if (filtres.du && entree.creeLe < new Date(filtres.du)) return false;
        if (filtres.au && entree.creeLe > new Date(filtres.au)) return false;
        return true;
      });

      const croissant = filtres.tri === 'survenuLe:asc';
      filtrees.sort((a, b) =>
        croissant
          ? a.creeLe.getTime() - b.creeLe.getTime()
          : b.creeLe.getTime() - a.creeLe.getTime(),
      );

      const decalage = decoderCurseurOffset(curseur);
      const page = filtrees.slice(decalage, decalage + limite);
      const suite =
        decalage + limite < filtrees.length ? encoderCurseurOffset(decalage + limite) : null;

      // Correctif N+1 : UNE requête pour tous les auteurs de la page, plutôt qu'un
      // `chargerResumeUtilisateur` par entrée de journal — voir `chargerResumesUtilisateurs`.
      // Plus aucun `await` dans la boucle ci-dessous : `page.map` redevient une simple
      // transformation synchrone (le `Promise.all` qui l'entourait n'a plus lieu d'être).
      const auteurs = await chargerResumesUtilisateurs(
        tx,
        ctx,
        page.map((entree) => entree.utilisateurId),
      );
      const donnees = page.map((entree): ReponseEntreeJournal => ({
        id: entree.id,
        entite: entree.entite,
        entiteId: entree.entiteId,
        action: entree.action,
        survenuLe: entree.creeLe.toISOString(),
        auteur: entree.utilisateurId ? (auteurs.get(entree.utilisateurId) ?? null) : null,
        // `champ === null` = snapshot de ligne entière (posé par le trigger générique, migration
        // `0004` §objet) : `avant`/`apres` portent la ligne. `champ` renseigné = INSERT direct
        // d'UN champ précis (ex. `rouvrir`, `service-transitions.ts`) : ce n'est pas un diff de
        // ligne, donc pas de `avant`/`apres` — la valeur va dans `motif` quand `champ === 'motif'`
        // (seul champ narrow connu à ce jour), null sinon plutôt que de deviner.
        avant:
          entree.champ === null
            ? ((entree.valeurAvant as Record<string, unknown> | null) ?? null)
            : null,
        apres:
          entree.champ === null
            ? ((entree.valeurApres as Record<string, unknown> | null) ?? null)
            : null,
        motif:
          entree.champ === 'motif' && typeof entree.valeurApres === 'string'
            ? entree.valeurApres
            : null,
        confirmations: [],
      }));

      return { donnees, curseurSuivant: suite };
    });
  }

  /**
   * `GET /ordres-reparation` — SOUS-ENSEMBLE des filtres du contrat (§6.2) : `siteId`, `statut`
   * (multi), `clientId`, `vehiculeId`, `technicienId`, `localisation` (multi), `attente` (multi),
   * `restitutionPromiseDu`/`Au`, `ouvertDu`/`Au`, tri `ouvertLe:desc` par défaut.
   *
   * CORRECTIF #73 (constat terrain du 12.08.2026, `apps/web/…/CarteRestitutionsJour.tsx`) :
   * `restitutionPromiseDu`/`Au` étaient acceptés par le schéma et TRANSMIS jusqu'ici sans jamais
   * poser de condition SQL — la liste rendait tous les OR actifs quel que soit
   * `restitutionPromiseLe`, `null` compris, sous un appel qui prétendait filtrer « aujourd'hui ».
   * Câblés ci-dessous en bornes SUISSES INCLUSIVES via `debutJourneeSuisse`/`finJourneeSuisse`
   * (`common/temps/fuseau-suisse.ts`) — correcteur de fuseau unique du produit (Europe/Zurich,
   * décision du 14.08.2026). `ouvertDu`/`Au`, MÊME câblage sur `ouvertLe`.
   *
   * DÉCISION explicite sur le troisième état (RESTITUTION_PROMISE_LE NULL) : un OR sans date de
   * restitution promise n'est NI « dans la fenêtre » NI « hors fenêtre » — `gte`/`lte` sur une
   * colonne `NULL` s'évalue à `NULL` en SQL, donc `WHERE` l'exclut naturellement dès qu'UNE des
   * deux bornes est posée (jamais un filtre `IS NOT NULL` explicite à maintenir en double), et il
   * reste visible quand aucune des deux bornes n'est demandée — l'absence de donnée ne partage
   * jamais le rendu d'une valeur (CONTRIBUTING.md). Prouvé par `service-or.spec.ts` (mutation : neutraliser
   * ces conditions fait rougir un test dédié à ce comportement).
   *
   * `localisation`/`attente` (multi) : `localisation` est une colonne enum directe
   * (`inArray`, même patron que `statut`). `attente` est un OU logique entre les drapeaux
   * `attenteAccord`/`attentePieces`/`attenteExterne` demandés (AU MOINS UN vrai) — cohérent avec
   * une sélection multi-valeurs de type « tag » (même sémantique OU que `statut`/`localisation`
   * en `inArray`), pas un ET qui exigerait que l'OR porte SIMULTANÉMENT tous les drapeaux cochés.
   *
   * `tri` (suite du #73, câblage du 12.08.2026) — LES 5 valeurs de `TRIS_ORDRES_REPARATION` sont
   * désormais câblées ci-dessous via `construireOrdreTri` : `ouvertLe:asc/desc`,
   * `restitutionPromiseLe:asc/desc`, `joursAttenteRetrait:desc` (choix produit, voir plus bas).
   * `numeroSequence:asc/desc` a été RETIRÉ du contrat (`packages/shared/.../ordre-reparation.ts`),
   * jamais rendu décoratif — voir le commentaire de tête de `TRIS_ORDRES_REPARATION`.
   *
   * `ouvertLe`/`restitutionPromiseLe` sont NULLABLES (`ouvert_le` : un OR `planifie` jamais réceptionné ;
   * `restitution_promise_le` : aucune promesse posée) — DOCTRINE explicite, la même dans les deux
   * sens : `NULLS LAST` TOUJOURS, quelle que soit la direction demandée (même choix que
   * `vehicules/service-vehicule.ts::construireTriEtSeuil` sur `plaque`/`prochaineExpertiseLe`,
   * sentinelles différentes par sens pour obtenir NULLS LAST des deux côtés). Un OR sans date n'est
   * ni « le plus ancien » ni « le plus récent » — le mélanger au milieu du tri (comportement Postgres
   * par défaut : NULLS LAST en ASC, mais NULLS FIRST en DESC) l'aurait fait apparaître EN TÊTE d'un
   * tri `ouvertLe:desc`/`restitutionPromiseLe:desc`, ce qui est exactement le « mélangé au milieu »
   * à éviter (CONTRIBUTING.md : l'absence de donnée ne partage jamais le rendu d'une valeur). Ce choix
   * CHANGE le tri par défaut réellement servi jusqu'ici : l'ancien `orderBy(desc(ouvertLe),
   * desc(creeLe))` laissait Postgres placer les `planifie` (ouvert_le NULL) EN TÊTE de liste sous
   * NULLS FIRST implicite — un défaut non voulu, jamais un choix arbitré, corrigé au passage plutôt
   * que reconduit à l'identique (câbler `ouvertLe:desc` proprement, y compris comme valeur par
   * défaut, fait partie du périmètre de ce correctif).
   *
   * CURSEUR (keyset, depuis le correctif de performance des listes) : curseur opaque v2
   * (`common/pagination`, `construireConditionKeyset`) qui encode la valeur de la clé de tri ET
   * l'`id` de la dernière ligne — coût constant quelle que soit la profondeur de page, aucune
   * ligne sautée ni répétée si un OR est créé entre deux requêtes. `construireOrderBy` départage
   * par `id` DANS LE SENS du tri (la comparaison ROW du keyset l'exige), clé primaire donc ordre
   * total. Un curseur de l'ancien format (offset), forgé, ou émis pour un autre `tri` rend
   * `400 VALIDATION_ECHOUEE` (`curseur_invalide`), comme tout curseur illisible du dépôt.
   *
   * `joursAttenteRetrait:desc` (choix produit, 12.08.2026) — lecture ATELIER, pas lecture client :
   * « la voiture est prête, elle occupe une place, le client ne vient pas la chercher ». Le décompte
   * part de la FIN DES TRAVAUX, jamais de `restitutionPromiseLe` dépassée (explicitement écarté —
   * ça mélangerait le retard du garage et celui du client, déjà couvert par `restitutionRetard`/
   * `estRestitutionEnRetard`, un concept différent).
   *
   * Colonne retenue : `ordre_reparation.termine_le` — posée à l'entrée en statut `termine`
   * (`service-transitions.ts::terminer`), remise à `null` par `rouvrir` (retour en `en_cours`),
   * PAS retouchée par la facturation (`service-facturation-or.ts::transitionnerVersFacture`, statut
   * `termine -> facture` : `termine_le` reste celui posé à l'entrée en `termine`). Un OR est donc
   * « terminé et en attente de retrait » tant que son statut est `termine` OU `facture` — les deux
   * statuts depuis lesquels `restituer` (T-17/T-18) est valide (voir `service-transitions.ts`).
   *
   * Un OR qui n'est ni `termine` ni `facture` n'attend PAS d'être retiré (encore en travaux, ou déjà
   * restitué/clôturé/annulé) : `construireOrdreTri` le place en fin de liste, NULLS LAST — même
   * doctrine que `ouvertLe`/`restitutionPromiseLe` ci-dessus, un OR qui ne concerne pas ce tri
   * n'est ni « le plus attendu » ni « le moins attendu ». Le tri ne FILTRE jamais de lignes (ça
   * reste le rôle de `?statut=`) — il se contente de reléguer les OR hors-sujet en queue.
   *
   * `vue` : toujours documentée comme SUCRE (équivalence filtres primitifs), mais cette équivalence
   * n'est écrite NULLE PART (ni ici, ni dans les contrats) — vérifié qu'AUCUN consommateur front
   * actuel ne l'utilise sur cette collection (`hooks/atelier/ordres-reparation.api.ts`,
   * `EcranListeOrdresReparation.tsx` : aucune référence à `vue`/`VUES_ORDRE_REPARATION`), donc rien
   * ne casse à le laisser en l'état, mais la câbler à l'aveugle inventerait quand même une sémantique
   * métier non arbitrée.
   *
   * `q` — DÉSORMAIS APPLIQUÉ (#defaut-recherche-or, 14.08.2026 : constat terrain, aucune recherche
   * d'OR ne rendait jamais de résultat — accepté par ce schéma, documenté ICI MÊME comme « jamais
   * appliqué », et en effet totalement inerte). Porte sur le n° d'OR, la plaque COURANTE du
   * véhicule et le nom/raison sociale du client (exactement ce que documente déjà
   * `schemaFiltresOrdresReparation.q`), fragment (pas préfixe), normalisé par
   * `public.normaliser_recherche()` — la MÊME fonction et la MÊME doctrine que
   * `clients/service-client.ts::lister` et `recherche/service-recherche.ts` (jamais une seconde
   * normalisation réimplémentée en TypeScript). Détail complet, y compris la limite de plan
   * `BitmapOr` connue au grand volume, dans le corps de `lister()` au point d'appel.
   *
   * `technicienId` (I-18/#19) : « OR du technicien » = porte AU MOINS UNE ligne (`ligne_or`,
   * tout statut confondu — y compris `annulee`/`realisee` : un OR déjà travaillé par ce
   * technicien reste « le sien » pour la navigation) dont `technicien_id` vaut la valeur
   * demandée. Implémenté en `exists(...)` (corrélé sur `tenant_id` + `ordre_reparation_id`),
   * jamais en jointure : une jointure sur `ligne_or` dupliquerait l'OR par ligne assignée et
   * casserait la pagination par curseur d'offset ci-dessous (le compte de lignes ne correspond
   * plus au compte d'OR). Le pointage sans ligne assignée (technicien qui dépanne une ligne
   * d'un collègue) N'EST PAS inclus : le contrat expose déjà `technicienId` comme un filtre sur
   * l'ASSIGNATION (§6.2, `ligne.ts` `technicienId` porté par la ligne, pas par le pointage), et
   * « Mes OR du jour » doit rester une garantie stricte (aucun OR sans ligne assignée) plutôt
   * qu'une heuristique élargie — un filtre `attentePointage` séparé serait la bonne extension si
   * ce second besoin se confirme, pas une redéfinition silencieuse de celui-ci.
   */
  async lister(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    filtres: FiltresOrdresReparation,
    limite: number,
    curseur: string | undefined,
  ): Promise<{ donnees: readonly ReponseOrdreReparation[]; curseurSuivant: string | null }> {
    return this.acces.enTenant(ctx, async (tx) => {
      const { pageOr, curseurSuivant } = await this.selectionnerPageOr(
        tx,
        ctx,
        filtres,
        limite,
        curseur,
      );
      // Chargement PAR LOT de la page (voir `liste-or-lot.ts`), puis assemblage en mémoire par le
      // même `construireReponse` que la fiche : ~11 requêtes par page, quelle que soit sa taille.
      const donnees = await this.assemblerListe(tx, ctx, principal.role, pageOr);
      return { donnees, curseurSuivant };
    });
  }

  /**
   * `GET /ordres-reparation?forme=resume` — mêmes filtres, mêmes tris, mêmes curseurs que `lister`
   * (la sélection de la page est PARTAGÉE : `selectionnerPageOr`), mais chaque élément est un
   * `OrdreReparationResumeListe` : 4 à 5 requêtes par page (OR, clients, véhicules, agrégat de
   * lignes, techniciens), jamais le document complet.
   */
  async listerResumes(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    filtres: FiltresOrdresReparation,
    limite: number,
    curseur: string | undefined,
  ): Promise<{ donnees: readonly OrdreReparationResumeListe[]; curseurSuivant: string | null }> {
    return this.acces.enTenant(ctx, async (tx) => {
      const { pageOr, curseurSuivant } = await this.selectionnerPageOr(
        tx,
        ctx,
        filtres,
        limite,
        curseur,
      );
      if (pageOr.length === 0) return { donnees: [], curseurSuivant };
      const voitMontants = roleVoitLesMontants(principal.role);
      const lot = await chargerLotResumeListeOr(tx, ctx, pageOr, voitMontants);
      const maintenant = this.horloge.maintenant();
      const donnees = pageOr.map((or): OrdreReparationResumeListe => {
        const agregat = lot.agregats.get(or.id);
        const attentes: AttentesOr = {
          accord: or.attenteAccord,
          pieces: or.attentePieces,
          externe: or.attenteExterne,
        };
        const technicien = agregat?.technicienId
          ? lot.techniciens.get(agregat.technicienId)
          : undefined;
        return {
          id: or.id,
          numero: or.numero,
          siteId: or.siteId,
          type: or.type,
          statut: or.statut,
          etatAffiche: calculerEtatAffiche(or.statut, attentes),
          enRetard: estRestitutionEnRetard(
            { statut: or.statut, restitutionPromiseLe: or.restitutionPromiseLe },
            maintenant,
          ),
          client: exigerClientListe(lot, or.clientId),
          vehicule: exigerVehiculeListe(lot, or.vehiculeId),
          ouvertLe: or.ouvertLe ? or.ouvertLe.toISOString() : null,
          restitutionPromiseLe: or.restitutionPromiseLe
            ? or.restitutionPromiseLe.toISOString()
            : null,
          localisation: or.localisation,
          attentes,
          ...(technicien ? { technicienAssigne: technicien } : {}),
          designationsApercu: agregat?.designationsApercu ?? [],
          nombreLignes: agregat?.nombreLignes ?? 0,
          nombreLignesAssignees: agregat?.nombreLignesAssignees ?? 0,
          ...(voitMontants ? { totalTtcCentimes: agregat?.totalTtcCentimes ?? 0 } : {}),
          version: or.version,
        };
      });
      return { donnees, curseurSuivant };
    });
  }

  /**
   * Sélection de la page d'OR (filtres, `q`, tri, curseur keyset) — partagée par `lister` (document
   * complet) et `listerResumes` : les deux formes ne peuvent pas diverger sur ce qu'une page contient.
   */
  private async selectionnerPageOr(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    filtres: FiltresOrdresReparation,
    limite: number,
    curseur: string | undefined,
  ): Promise<{ pageOr: LigneOrdreReparation[]; curseurSuivant: string | null }> {
    const conditions = [eq(ordreReparation.tenantId, ctx.tenantId)];
    if (filtres.siteId) conditions.push(eq(ordreReparation.siteId, filtres.siteId));
    if (filtres.clientId) conditions.push(eq(ordreReparation.clientId, filtres.clientId));
    if (filtres.vehiculeId) conditions.push(eq(ordreReparation.vehiculeId, filtres.vehiculeId));
    // `q` (#defaut-recherche-or, 14.08.2026) : DÉSORMAIS appliqué — voir la doctrine complète au
    // JSDoc de tête de `lister()`. Comparaison à `undefined`, jamais à la véracité : `q` est déjà
    // `trim().min(1)` côté schéma zod (`schemaFiltresOrdresReparation`), donc une chaîne vide ne
    // peut structurellement pas arriver ici, mais on ne suppose jamais ce qu'un schéma amont a
    // déjà garanti (même garde-fou que `ServiceRecherche.rechercher`).
    if (filtres.q !== undefined && !/[\p{L}\p{N}]/u.test(filtres.q)) {
      // Garde-fou IDENTIQUE à `ServiceRecherche.rechercher` (recherche/service-recherche.ts) : un
      // terme sans AUCUNE lettre ni chiffre (ex. `---`, encore possible après le `trim().min(1)`
      // du schéma) normaliserait vers une chaîne VIDE côté `public.normaliser_recherche()`, et
      // `like '%%'` matcherait ALORS TOUT LE TENANT — l'exact inverse du défaut corrigé ici (un
      // filtre qui, au lieu d'être silencieusement ignoré, deviendrait une fuite totale). On ne
      // devine jamais ce que `normaliser_recherche` va produire pour un cas qu'on peut refuser
      // structurellement : `false` rend explicitement AUCUN résultat, jamais la liste entière.
      conditions.push(sql`false`);
    } else if (filtres.q !== undefined) {
      const motif = `%${filtres.q}%`;
      // Trois branches, une SEULE normalisation (`public.normaliser_recherche()`, migration 0003
      // §2) — jamais réimplémentée en TypeScript (même doctrine que
      // `recherche/utilitaires-recherche.ts`, tête de fichier : deux normalisations divergentes
      // produiraient des résultats manquants indébogables).
      //
      // 1. Numéro d'OR : condition DIRECTE sur `ordre_reparation.numero`, servie par
      //    `ordre_reparation_numero_recherche_idx` (GIN trigram, migration 0013).
      //
      // 2. Plaque : sur la plaque COURANTE (`vehicule_plaque.au is null`) — le CHAMP AFFICHÉ par
      //    cette même liste (`assemblerDocument` → `chargerPlaqueCourante`), jamais une plaque
      //    historique. Une recherche par plaque HISTORIQUE existe déjà par ailleurs
      //    (`recherche/service-recherche.ts::chercherVehicules`, périmètre distinct, hors de
      //    cette collection) — chercher l'historique ICI AUSSI redéfinirait silencieusement ce
      //    que « la plaque » désigne pour cette liste précise, jamais tranché par le contrat.
      //    Écrite en `vehiculeId IN (sous-requête NON CORRÉLÉE)`, PAS en `exists(...)` corrélé
      //    (à la différence de `technicienId` ci-dessus) : la sous-requête ne référence QUE
      //    `vehicule_plaque`, donc `ordre_reparation.vehicule_id = any(...)` reste indexable par
      //    `ordre_reparation_vehicule_idx` (migration 0008) et peut entrer dans un `BitmapOr` aux
      //    côtés de la branche 1 — un `exists(...)` corrélé ne le peut JAMAIS pour un `OR`
      //    multi-tables (raison documentée dans le détail par migration 0013, section « AUTRES
      //    LACUNES »). Servie, côté sous-requête, par `vehicule_plaque_recherche_idx` (GIN
      //    trigram, migration 0007).
      //
      // 3. Nom du client : MÊME expression EXACTE que `clients/service-client.ts::lister`
      //    (`coalesce(raison_sociale, nom || ' ' || coalesce(prenom, ''))`) — same réutilisation
      //    volontaire que la plaque ci-dessus, `clientId IN (sous-requête non corrélée)`, servie
      //    par `client_recherche_idx` (GIN trigram, migration 0006).
      //
      // INDEX : AUCUN nouveau nécessaire — les trois existent déjà (0006/0007/0013), chacun posé
      // pour cette exacte expression. Ce qui reste non résolu, SIGNALÉ plutôt que masqué (rapport
      // de livraison) : combiner les trois branches par `OR` empêche Postgres de fusionner leurs
      // plans en un seul `BitmapOr` sur `ordre_reparation` (les branches 2/3 filtrent d'abord une
      // AUTRE table) — la requête retombe donc en `Seq Scan` sur `ordre_reparation` dès que `q`
      // est fourni, avec deux sous-requêtes indexées (rapides) évaluées par ligne balayée. Correct
      // fonctionnellement, mais PAS optimal au grand volume — même limite, déjà documentée pour
      // les mêmes trois axes, par `migrations/0013…sql` (section « AUTRES LACUNES DU MÊME
      // GENRE ») pour `service-client.ts::lister` et `service-vehicule.ts`. Le correctif réel est
      // une restructuration de requête (candidats par ID, UNION, cf. `recherche/service-recherche.ts`),
      // pas un index — hors périmètre d'une migration seule, donc pas fait ici.
      const conditionRecherche = or(
        sql`public.normaliser_recherche(${ordreReparation.numero}) like public.normaliser_recherche(${motif})`,
        inArray(
          ordreReparation.vehiculeId,
          tx
            .select({ vehiculeId: vehiculePlaque.vehiculeId })
            .from(vehiculePlaque)
            .where(
              and(
                eq(vehiculePlaque.tenantId, ctx.tenantId),
                isNull(vehiculePlaque.au),
                sql`public.normaliser_recherche(${vehiculePlaque.valeur}) like public.normaliser_recherche(${motif})`,
              ),
            ),
        ),
        inArray(
          ordreReparation.clientId,
          tx
            .select({ id: client.id })
            .from(client)
            .where(
              and(
                eq(client.tenantId, ctx.tenantId),
                sql`(public.normaliser_recherche(coalesce(${client.raisonSociale}, ${client.nom} || ' ' || coalesce(${client.prenom}, ''), '')) like public.normaliser_recherche(${motif}) or public.normaliser_recherche(coalesce(${client.raisonSociale}, concat_ws(' ', ${client.prenom}, ${client.nom}), '')) like public.normaliser_recherche(${motif}))`,
              ),
            ),
        ),
      );
      // `or(...)` appelé avec TROIS arguments TOUJOURS présents ci-dessus (jamais un tableau vide
      // comme pour `attente`) : `condition` est donc structurellement toujours défini — le garde
      // suit quand même le même patron que `attente` ci-dessus, par cohérence de style.
      if (conditionRecherche) conditions.push(conditionRecherche);
    }
    if (filtres.statut && filtres.statut.length > 0)
      conditions.push(inArray(ordreReparation.statut, filtres.statut));
    if (filtres.localisation && filtres.localisation.length > 0)
      conditions.push(inArray(ordreReparation.localisation, filtres.localisation));
    if (filtres.attente && filtres.attente.length > 0) {
      const drapeauxParAttente = {
        accord: ordreReparation.attenteAccord,
        pieces: ordreReparation.attentePieces,
        externe: ordreReparation.attenteExterne,
      } as const;
      const drapeaux = filtres.attente.map((a) => eq(drapeauxParAttente[a], true));
      // `or(...)` toujours appelé avec AU MOINS un élément ici (`length > 0` ci-dessus) : jamais
      // le `or()` sans argument (qui produirait une condition vide, silencieusement inerte).
      const condition = or(...drapeaux);
      if (condition) conditions.push(condition);
    }
    if (filtres.restitutionPromiseDu)
      conditions.push(
        gte(ordreReparation.restitutionPromiseLe, debutJourneeSuisse(filtres.restitutionPromiseDu)),
      );
    if (filtres.restitutionPromiseAu)
      conditions.push(
        lte(ordreReparation.restitutionPromiseLe, finJourneeSuisse(filtres.restitutionPromiseAu)),
      );
    if (filtres.ouvertDu)
      conditions.push(gte(ordreReparation.ouvertLe, debutJourneeSuisse(filtres.ouvertDu)));
    if (filtres.ouvertAu)
      conditions.push(lte(ordreReparation.ouvertLe, finJourneeSuisse(filtres.ouvertAu)));
    if (filtres.technicienId) {
      const technicienId = filtres.technicienId;
      conditions.push(
        exists(
          tx
            .select({ id: ligneOr.id })
            .from(ligneOr)
            .where(
              and(
                eq(ligneOr.tenantId, ordreReparation.tenantId),
                eq(ligneOr.ordreReparationId, ordreReparation.id),
                eq(ligneOr.technicienId, technicienId),
              ),
            ),
        ),
      );
    }

    // Pagination KEYSET (curseur v2 opaque `{t, v, i}`, `common/pagination`) : coût constant quelle
    // que soit la profondeur de page, et aucune ligne sautée/répétée si un OR est créé entre deux
    // requêtes. Un curseur de l'ancien format (offset) est refusé en `400 VALIDATION_ECHOUEE`
    // (`curseur_invalide`) — convention du dépôt pour tout curseur illisible, jamais une première
    // page muette.
    const definition = DEFINITIONS_TRI_OR[filtres.tri];
    const idExpr = sql`${ordreReparation.id}`;
    const reprise = decoderCurseurPourTri(curseur, filtres.tri, DEFINITIONS_TRI_OR);
    if (reprise) {
      conditions.push(
        sql`${construireConditionKeyset(definition, idExpr, reprise.valeur, reprise.id)}`,
      );
    }

    const lignes = await tx
      .select({
        ligne: ordreReparation,
        triValeur: sql<string | null>`${expressionTriValeur(definition)}`,
      })
      .from(ordreReparation)
      .where(and(...conditions))
      .orderBy(construireOrderBy(definition, idExpr))
      .limit(limite + 1);

    const pageLignes = lignes.slice(0, limite);
    const derniere = pageLignes.at(-1);
    const suite =
      lignes.length > limite && derniere
        ? encoderCurseurTrie({
            tri: filtres.tri,
            valeur: valeurCurseurDepuisTri(definition, derniere.triValeur),
            id: derniere.ligne.id,
          })
        : null;

    return { pageOr: pageLignes.map((l) => l.ligne), curseurSuivant: suite };
  }

  /**
   * Version PAR LOT de `assemblerDocument(…, pourListe = true)` — mêmes champs, mêmes valeurs,
   * même masquage par rôle (le `construireReponse` est partagé), `modifiePar` à `null` comme en
   * liste unitaire (le journal d'audit n'est pas lu). Ne lit RIEN par OR : tout vient de
   * `chargerLotListeOr` (une requête par table pour la page). L'ordre d'entrée est conservé.
   */
  async assemblerListe(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: PrincipalAuthentifie['role'],
    ors: readonly LigneOrdreReparation[],
  ): Promise<readonly ReponseOrdreReparation[]> {
    if (ors.length === 0) return [];
    const voitMontants = roleVoitLesMontants(role);
    const lot = await chargerLotListeOr(tx, ctx, ors, voitMontants);
    const resumePour = (id: string | null) => (id ? (lot.utilisateurs.get(id) ?? null) : null);

    return ors.map((or) => {
      const clientResume = exigerClient(lot, or.clientId);
      const lignesToutes = lot.lignes.get(or.id) ?? [];
      return this.construireReponse({
        or,
        clientResume,
        vehiculeLigne: exigerVehicule(lot, or.vehiculeId),
        plaque: lot.plaques.get(or.vehiculeId) ?? null,
        demandes: (lot.demandes.get(or.id) ?? []).map((d) =>
          mapperDemande(d, resumePour(d.saisiParId)),
        ),
        devis: (lot.devis.get(or.id) ?? []).map((d) =>
          mapperDevis(d, lot.lignesDevis.get(d.id) ?? [], resumePour(d.emetteurId), role),
        ),
        lignesToutes,
        controle: lot.controles.get(or.id) ?? null,
        nombrePointagesOuverts: lot.pointagesOuverts.get(or.id) ?? 0,
        modifiePar: null,
        totauxParPayeur: voitMontants
          ? calculerTotauxParPayeur(
              lignesToutes,
              { clientId: clientResume.id, nomAffiche: clientResume.nomAffiche },
              (payeurClientId) => lot.destinatairesPayeurs.get(payeurClientId),
            )
          : undefined,
        role,
      });
    });
  }

  // -----------------------------------------------------------------------------------------
  // Assemblage du document complet (§8.3) — appelé par ce service ET par service-transitions /
  // service-ligne-or / service-devis, qui doivent tous renvoyer la même représentation.
  //
  // `pourListe` (déf. `false`) : quand `true` (uniquement depuis `lister()` ci-dessus), saute
  // `this.audit.pourEntite` — lequel ouvre SA PROPRE transaction (`ServiceAuditImpl.pourEntite`,
  // `common/audit/service-audit.ts`, hors périmètre de ce correctif). Appelé une fois par
  // élément dans un `Promise.all` sur toute une page (`limite` max = 200), il peut réclamer
  // ~200 connexions imbriquées d'un coup et épuiser le pool. Le seul champ qui en dépend est
  // `modifiePar` (dernier événement du journal, `dernierEvenement = journalOr.at(-1)`) — un champ
  // de RÉPONSE, jamais consulté ni par le calcul de statut/droits ni par un écran de LISTE
  // (`EcranListeOrdresReparation.tsx` n'affiche pas `modifiePar`, seul l'écran fiche OR
  // (assemblage unitaire, `pourListe` par défaut `false`) l'utilise). Le vider en liste (`null`,
  // valeur déjà couverte par le type `{ ... } | null`) est donc sans perte réelle pour cette
  // route, et supprime intégralement le problème (zéro requête d'audit, pas seulement une
  // sérialisation) plutôt que de le déplacer.
  async assemblerDocument(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    role: PrincipalAuthentifie['role'],
    orId: string,
    pourListe = false,
  ): Promise<ReponseOrdreReparation> {
    const or = await chargerOr(tx, ctx, orId);

    const clientLigne = await chargerClientLigne(tx, ctx, or.clientId);

    const [
      clientResume,
      vehiculeLigne,
      plaque,
      demandesRows,
      lignesToutes,
      devisRows,
      controle,
      journalOr,
      pointagesOuverts,
    ] = await Promise.all([
      versClientResume(tx, ctx, clientLigne),
      chargerVehiculeLigne(tx, ctx, or.vehiculeId),
      chargerPlaqueCourante(tx, ctx, or.vehiculeId),
      listerDemandesOr(tx, ctx, orId),
      listerLignesOr(tx, ctx, orId),
      listerDevisOr(tx, ctx, orId),
      chargerControleQualite(tx, ctx, orId),
      pourListe
        ? Promise.resolve<readonly EntreeAudit[]>([])
        : this.audit.pourEntiteTx(tx, ctx, 'ordre_reparation', orId),
      // I-09 : `LecturePointage.pointagesOuvertsPourOr` prend `tx` en premier paramètre et lit
      // DANS la transaction courante (doctrine du port, `atelier.jetons.ts`) — même patron que
      // `ServiceAudit.pourEntiteTx` juste au-dessus : aucune transaction imbriquée ici non plus
      // (voir `common/audit/service-audit.ts` pour la variante `Tx` de `ServiceAudit.pourEntite`).
      this.pointage.pointagesOuvertsPourOr(tx, orId),
    ]);

    const dernierEvenement = journalOr.at(-1) ?? null;

    // Correctif N+1 : UNE requête pour TOUS les résumés utilisateur dont a besoin ce document
    // (auteurs des demandes + émetteurs des devis + auteur du dernier événement de journal),
    // plutôt qu'un `chargerResumeUtilisateur` par demande/devis/événement — voir
    // `chargerResumesUtilisateurs`. Particulièrement sensible ici : `assemblerDocument` est aussi
    // appelée UNE FOIS PAR OR depuis `lister()` (`pourListe = true`) — sans ce lot, une page de M
    // OR aurait rouvert cette même boucle M fois.
    const resumes = await chargerResumesUtilisateurs(tx, ctx, [
      ...demandesRows.map((d) => d.saisiParId),
      ...devisRows.map((d) => d.emetteurId),
      dernierEvenement?.utilisateurId ?? null,
    ]);
    const resumePour = (id: string | null) => (id ? (resumes.get(id) ?? null) : null);

    const demandes = demandesRows.map((d) => mapperDemande(d, resumePour(d.saisiParId)));
    const devis = await Promise.all(
      devisRows.map(async (d) => {
        const lignesDevis = await listerLignesDevis(tx, ctx, d.id);
        return mapperDevis(d, lignesDevis, resumePour(d.emetteurId), role);
      }),
    );

    const modifiePar = resumePour(dernierEvenement?.utilisateurId ?? null);
    const voitMontants = roleVoitLesMontants(role);

    // `totauxParPayeur` (MD-62) : résout le destinataire de chaque groupe payeur tiers en UN SEUL
    // aller-retour batché sur `client` (jamais une requête par ligne) — voir
    // `totaux-payeur.ts::ResolveurDestinataireTiers`. Calculé uniquement pour un rôle qui voit les
    // montants (même garde que le reste de ce bloc), le fetch supplémentaire n'a pas de coût pour
    // `technicien`.
    const totauxParPayeur = voitMontants
      ? await this.calculerTotauxAvecDestinataires(tx, ctx, lignesToutes, clientResume)
      : undefined;

    return this.construireReponse({
      or,
      clientResume,
      vehiculeLigne,
      plaque,
      demandes,
      devis,
      lignesToutes,
      controle,
      nombrePointagesOuverts: pointagesOuverts.length,
      modifiePar,
      totauxParPayeur,
      role,
    });
  }

  /**
   * Construction PURE (aucun accès base) de la réponse `ReponseOrdreReparation` — unique chemin de
   * vérité partagé par `assemblerDocument` (fiche, un OR) et `assemblerListe` (liste, chargement
   * par lot) : les deux ne peuvent pas diverger sur les champs, le masquage des montants par rôle
   * ou les totaux. `totauxParPayeur` est déjà gaté par le rôle par l'appelant (`undefined` pour
   * un rôle sans droit aux montants).
   */
  private construireReponse(e: EntreeConstructionReponseOr): ReponseOrdreReparation {
    const {
      or,
      clientResume,
      vehiculeLigne,
      plaque,
      demandes,
      devis,
      lignesToutes,
      controle,
      modifiePar,
      totauxParPayeur,
      role,
    } = e;
    const voitMontants = roleVoitLesMontants(role);
    const lignesTronquees = lignesToutes.length > 200;
    const lignesEmbarquees = lignesTronquees ? lignesToutes.slice(0, 200) : lignesToutes;

    // #82 : aperçu borné (`SEUIL_DESIGNATIONS_APERCU`), calculé ICI depuis `lignesToutes` — déjà en
    // main (chargée une seule fois ci-dessus, `listerLignesOr`), JAMAIS une requête par OR affiché.
    // Mêmes lignes exclues que les totaux (`STATUTS_EXCLUS_DES_TOTAUX`) : une ligne annulée n'a
    // jamais eu lieu, une ligne refusée n'a jamais été faite — ni l'une ni l'autre ne répond à
    // « qu'est-ce qui a été fait ». `lignesToutes` est déjà triée par `numeroOrdre` ASC
    // (`or-requetes.ts::listerLignesOr`), donc les 3 premières désignations retenues sont bien les
    // 3 premières lignes de l'OR, jamais un sous-ensemble arbitraire. Jamais gaté par `voitMontants`
    // (une désignation n'est pas un montant) — le serveur le peuple TOUJOURS, tableau vide inclus
    // (un OR sans ligne facturable n'est pas une absence de donnée, c'est un fait : rien à montrer).
    const designationsApercu = lignesToutes
      .filter((l) => !STATUTS_EXCLUS_DES_TOTAUX.has(l.statut))
      .map((l) => l.designation?.trim())
      .filter((d): d is string => !!d)
      .slice(0, SEUIL_DESIGNATIONS_APERCU);

    const attentes: AttentesOr = {
      accord: or.attenteAccord,
      pieces: or.attentePieces,
      externe: or.attenteExterne,
    };

    // #76 : `totalTtcCentimes` — la colonne « Total TTC » de la liste des OR (`ServiceOr.lister`,
    // qui appelle CETTE méthode) était vide car `assemblerDocument` ne le rendait jamais, alors que
    // le front le type déjà (`OrdreReparationResume.totalTtcCentimes`, ajouté avant ce document
    // complet). DÉRIVÉ de `totauxParPayeur` plutôt que recalculé par une seconde boucle sur
    // `lignesToutes` : `totauxParPayeur` applique déjà `STATUTS_EXCLUS_DES_TOTAUX` par groupe payeur
    // (`totaux-payeur.ts`) et couvre TOUTES les lignes de l'OR (garage compris, fusionné dans le
    // groupe `'client'`, RF-92) — en sommer les `montantTtcCentimes` reproduit exactement le calcul
    // déjà en place dans `clients/service-client-ordres-reparation.ts` (somme des lignes non
    // `annulee`/`refusee`), un seul mécanisme, jamais deux qui pourraient diverger. Même garde que
    // `totalValideCentimes` : `undefined` (absent du JSON) pour un rôle sans droit aux montants,
    // JAMAIS `0` qui mentirait sur « aucun montant » là où c'est en fait « pas le droit de voir ».
    const totalTtcCentimes = totauxParPayeur
      ? totauxParPayeur.reduce((somme, t) => somme + t.montantTtcCentimes, 0)
      : undefined;

    return {
      id: or.id,
      numero: or.numero,
      siteId: or.siteId,
      type: or.type,
      statut: or.statut,
      client: clientResume,
      vehicule: construireVehiculeResume(vehiculeLigne, plaque),
      figees: {
        clientDesignation: or.clientDesignationFigee,
        adresseFacturation: (or.adresseFacturationFigee as Record<string, unknown> | null) ?? null,
        ...(voitMontants
          ? { conditions: (or.conditionsFigees as Record<string, unknown> | null) ?? null }
          : {}),
        plaque: or.plaqueFigee,
        detenteurClientId: or.detenteurFigeClientId,
      },
      conducteurPresentNom: or.conducteurPresentNom,
      kilometrageEntree: or.kmEntree,
      kilometrageSortie: or.kmSortie,
      ...(voitMontants
        ? {
            plafondCentimes: or.plafondCentimes ?? undefined,
            plafondAutorisePar: or.plafondAutorisePar,
            totalValideCentimes: or.totalValideCentimes,
            totalTtcCentimes,
          }
        : {}),
      restitutionPromiseLe: or.restitutionPromiseLe ? or.restitutionPromiseLe.toISOString() : null,
      restitutionInitialeLe: or.restitutionInitialeLe
        ? or.restitutionInitialeLe.toISOString()
        : null,
      // Calculé UNE SEULE FOIS ici — voir `restitution-retard.ts` pour la garde complète (une
      // date promise absente n'est jamais un retard, les statuts terminaux ne comptent plus).
      enRetard: estRestitutionEnRetard(
        { statut: or.statut, restitutionPromiseLe: or.restitutionPromiseLe },
        this.horloge.maintenant(),
      ),
      localisation: or.localisation,
      sousTraitantNom: or.sousTraitantNom,
      ordreReparationParentId: or.ordreReparationParentId,
      motifLien: or.motifLien,
      rendezVousId: or.rendezVousId,
      numeroCommandeInterne: or.numeroCommandeInterne,
      receptionnaireId: or.receptionnaireId,
      retentionInvoqueeLe: or.retentionInvoqueeLe ? or.retentionInvoqueeLe.toISOString() : null,
      litigeOuvertLe: or.litigeOuvertLe ? or.litigeOuvertLe.toISOString() : null,
      ouvertLe: or.ouvertLe ? or.ouvertLe.toISOString() : null,
      termineLe: or.termineLe ? or.termineLe.toISOString() : null,
      factureLe: or.factureLe ? or.factureLe.toISOString() : null,
      restitueLe: or.restitueLe ? or.restitueLe.toISOString() : null,
      clotureLe: or.clotureLe ? or.clotureLe.toISOString() : null,
      annuleLe: or.annuleLe ? or.annuleLe.toISOString() : null,
      motifAnnulation: or.motifAnnulation,
      demandes,
      lignes: lignesEmbarquees.map((l) => mapperLigneOr(l, role)),
      nombreLignes: lignesToutes.length,
      lignesTronquees,
      designationsApercu,
      devisComplementaires: devis,
      controleQualite: controle
        ? {
            controleurId: controle.controleurId ?? '',
            controleLe: controle.controleLe.toISOString(),
            conforme: controle.conforme,
            motifNonConformite: controle.motifNonConformite,
            // Aucune colonne dédiée pour le détail des points contrôlés au lot 1
            // (`or_controle_qualite`, migrations/0008_atelier.sql, T-12) — check-lists outillées
            // = P-08 `selon_type`, lot 2. Champ exposé vide plutôt qu'omis (contrat non additif
            // sur ce point : `pointsControles` est requis, non optionnel).
            pointsControles: [],
          }
        : null,
      signatures: [],
      pret: null,
      // `pointagesOuverts` : réel, câblé sur le port FIGÉ `LecturePointage.pointagesOuvertsPourOr`
      // (même appel que la garde I-09), donc sans écart de connexion supplémentaire (§ note
      // ci-dessus). `totalCentiemes`/`parTechnicien` RESTENT à zéro/vide, SIGNALÉ : `LecturePointage`
      // (port déclaré par `atelier`, `atelier.jetons.ts`) n'expose que des pointages OUVERTS et un
      // simple booléen « la ligne a du temps pointé » (`lignesAvecTempsPointe`) — aucune des deux
      // méthodes ne rend un montant ni un temps agrégé. Cette agrégation existe déjà côté
      // `pointage/` (`ServicePointage`, `chargerPointagesPourAgregatLigne`, backing
      // `GET /pointages/agregats-ligne`), mais n'est PAS exposée par le port : il manque une
      // méthode `LecturePointage.cumulsPourOr(tx, orId): Promise<{ totalCentiemes, parTechnicien }>`
      // (ou équivalent), à ajouter au port ET implémenter dans
      // `pointage/service-lecture-pointage.ts` — ce second fichier est hors périmètre de ce
      // correctif (`apps/api/src/pointage/**`). Mettre `0`/`[]` ici reste plus honnête qu'inventer
      // un calcul partiel à partir de données absentes du port.
      cumulsPointage: {
        totalCentiemes: 0,
        parTechnicien: [],
        pointagesOuverts: e.nombrePointagesOuverts,
      },
      ...(voitMontants ? { totauxParPayeur } : {}),
      attentes,
      etatAffiche: calculerEtatAffiche(or.statut, attentes),
      actionsDisponibles: calculerActionsDisponiblesPourRole(or.statut, role),
      version: or.version,
      creeLe: or.creeLe.toISOString(),
      modifieLe: or.modifieLe.toISOString(),
      modifiePar,
    };
  }

  /**
   * `totauxParPayeur` (MD-62) : batch-résout, en UN SEUL `select ... in (...)`, le destinataire de
   * chaque `payeurClientId` distinct présent sur l'OR — jamais une requête par groupe. `RM-01` :
   * `calculerNomAffiche` (`common/identite-client/`) fait autorité sur le `type` du client, jamais
   * sur la présence de `raisonSociale` — même règle que `clients/`/`vehicules/`, appliquée ici pour
   * ne pas réimplémenter une troisième copie divergente (voir l'historique de `nom-affiche.ts`).
   */
  private async calculerTotauxAvecDestinataires(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    lignesToutes: readonly LigneLigneOr[],
    clientResume: ClientResume,
  ): Promise<readonly TotauxPayeurOr[]> {
    const payeurClientIds = [
      ...new Set(
        lignesToutes.map((l) => l.payeurClientId).filter((id): id is string => id !== null),
      ),
    ];

    const destinatairesTiers =
      payeurClientIds.length > 0
        ? await tx
            .select({
              id: client.id,
              type: client.type,
              nom: client.nom,
              prenom: client.prenom,
              raisonSociale: client.raisonSociale,
            })
            .from(client)
            .where(and(eq(client.tenantId, ctx.tenantId), inArray(client.id, payeurClientIds)))
        : [];

    const resolveur = new Map(
      destinatairesTiers.map((c) => [c.id, { clientId: c.id, nomAffiche: calculerNomAffiche(c) }]),
    );

    return calculerTotauxParPayeur(
      lignesToutes,
      { clientId: clientResume.id, nomAffiche: clientResume.nomAffiche },
      (payeurClientId) => resolveur.get(payeurClientId),
    );
  }

  private async genererNumero(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    siteId: string,
    parametres: Awaited<ReturnType<typeof chargerParametresAtelier>>,
    le: Date,
  ): Promise<string> {
    const anneeCompteur = parametres.orResetAnnuel ? le.getFullYear() : 0;
    const siteCompteur = parametres.orPorteeNumerotation === 'site' ? siteId : null;
    const numero = await this.compteurs.prochainNumero(tx, {
      tenantId: ctx.tenantId,
      typeDocument: 'ordre_reparation',
      annee: anneeCompteur,
      siteId: siteCompteur,
    });
    const prefixe = parametres.orPrefixe ?? 'OR';
    return parametres.orResetAnnuel
      ? `${prefixe}-${String(le.getFullYear())}-${String(numero)}`
      : `${prefixe}-${String(numero)}`;
  }
}

/** `W/"<version>"` -> entier. `undefined`/format invalide -> `400 VALIDATION_ECHOUEE` (§9). */
function extraireVersionETag(ifMatch: string | undefined): number {
  const correspondance = ifMatch ? /^W\/"(\d+)"$/.exec(ifMatch.trim()) : null;
  if (!correspondance?.[1]) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      'En-tête If-Match requis et doit porter la forme W/"<version>".',
      {
        erreurs: [
          { champ: 'If-Match', code: 'requis', message: 'En-tête If-Match manquant ou invalide.' },
        ],
      },
    );
  }
  return Number(correspondance[1]);
}

/**
 * Réexportés : `service-ligne-or.ts` et `service-devis.ts` paginent leurs sous-collections
 * (`GET .../lignes`, `GET .../devis-complementaires`) avec le MÊME curseur d'offset opaque que
 * `journal()` ci-dessus, pour la même raison (volume d'un seul OR, quelques dizaines d'éléments
 * au plus au lot 1) — un seul mécanisme plutôt que trois copies incohérentes.
 */
export function encoderCurseurOffset(decalage: number): string {
  return Buffer.from(String(decalage), 'utf8').toString('base64url');
}

/**
 * `EntreeAudit.creeLe` est TYPÉ `Date` (`common/audit/audit.types.ts`) mais son implémentation
 * lit `audit_atelier` par SQL brut, hors mapping de colonnes Drizzle — la valeur REÇUE ici est en
 * réalité une chaîne Postgres (`"2026-08-04 09:29:38.68287+00"`), vérifié en conditions réelles.
 * Blinde ce point de consommation : accepte une vraie `Date` telle quelle, convertit toute autre
 * valeur. Voir la note détaillée sur `ServiceOr.journal` ci-dessus.
 */
function normaliserCreeLe(valeur: Date | string): Date {
  return valeur instanceof Date ? valeur : new Date(valeur);
}

export function decoderCurseurOffset(curseur: string | undefined): number {
  if (!curseur) return 0;
  const brut = Number(Buffer.from(curseur, 'base64url').toString('utf8'));
  if (!Number.isInteger(brut) || brut < 0) {
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return brut;
}

/**
 * Définitions de tri keyset de `ServiceOr.lister`, une par valeur de `TRIS_ORDRES_REPARATION`
 * (`Record` exhaustif : toute valeur ajoutée au contrat sans être traitée ICI casse la compilation
 * plutôt que de retomber en silence sur le tri par défaut). Doctrine inchangée : colonnes
 * nullables, `NULLS LAST` dans les deux sens (un OR sans date n'est ni « le plus ancien » ni « le
 * plus récent »). Les expressions sont des CONSTANTES du code (`common/pagination/keyset.ts`).
 *
 * Le départage final par `id` suit désormais le SENS du tri (comparaison ROW du keyset) : seuls
 * deux OR de timestamp strictement identique (à la microseconde) sont concernés, leur ordre
 * relatif n'ayant jamais été défini métier.
 *
 * `joursAttenteRetrait:desc` : « jours d'attente de retrait » = maintenant - `termine_le`, pour un
 * OR encore `termine` ou `facture` seulement ; le trier DESC équivaut à trier `termine_le` ASC
 * parmi ces deux statuts (le `case` sans `else` rend NULL pour les autres, relégués en fin).
 */
const DEFINITIONS_TRI_OR: Readonly<Record<FiltresOrdresReparation['tri'], DefinitionTri>> = {
  'ouvertLe:desc': {
    expression: sql`${ordreReparation.ouvertLe}`,
    sens: 'desc',
    nullable: true,
    temporel: true,
  },
  'ouvertLe:asc': {
    expression: sql`${ordreReparation.ouvertLe}`,
    sens: 'asc',
    nullable: true,
    temporel: true,
  },
  'restitutionPromiseLe:asc': {
    expression: sql`${ordreReparation.restitutionPromiseLe}`,
    sens: 'asc',
    nullable: true,
    temporel: true,
  },
  'restitutionPromiseLe:desc': {
    expression: sql`${ordreReparation.restitutionPromiseLe}`,
    sens: 'desc',
    nullable: true,
    temporel: true,
  },
  'joursAttenteRetrait:desc': {
    expression: sql`(case when ${ordreReparation.statut} in ('termine', 'facture') then ${ordreReparation.termineLe} end)`,
    sens: 'asc',
    nullable: true,
    temporel: true,
  },
};

interface EntreeConstructionReponseOr {
  readonly or: LigneOrdreReparation;
  readonly clientResume: ClientResume;
  readonly vehiculeLigne: LigneVehicule;
  readonly plaque: LigneVehiculePlaque | null;
  readonly demandes: readonly ReponseOrdreReparationDemande[];
  readonly devis: readonly ReponseDevisComplementaire[];
  readonly lignesToutes: readonly LigneLigneOr[];
  readonly controle: LigneOrControleQualite | null;
  readonly nombrePointagesOuverts: number;
  readonly modifiePar: ResumeUtilisateur | null;
  readonly totauxParPayeur: readonly TotauxPayeurOr[] | undefined;
  readonly role: PrincipalAuthentifie['role'];
}

// Réexporté pour les actions de transition (marquage réalisée, etc.) qui doivent charger une
// ligne pour écriture sans dupliquer l'import.
export { chargerLigneOrPourEcriture, chargerOrOuNull };
