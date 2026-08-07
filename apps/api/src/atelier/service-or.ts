import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, exists, inArray } from 'drizzle-orm';
import type {
  AttentesOr,
  ClientResume,
  EntreeCreationOrdreReparation,
  EntreeDemandeOrdreReparation,
  EntreeModificationOrdreReparation,
  FiltresJournal,
  FiltresOrdresReparation,
  ReponseAvecAvertissements,
  ReponseEntreeJournal,
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
  type LigneLigneOr,
  type LigneOrdreReparation,
} from '../db/schema';
import { MATRICE_DROITS } from '../auth/matrice-droits';
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
import { JETON_COMPTEURS } from '../parametrage/compteurs/compteurs.jetons';
import type { ServiceCompteurs } from '../parametrage/compteurs/compteurs.types';

import { JETON_LECTURE_POINTAGE, type LecturePointage } from './atelier.jetons';
import { verifierConfirmation } from './confirmations';
import { calculerActionsDisponiblesPourRole, calculerEtatAffiche } from './etat-affiche';
import { convertirEnKm } from './kilometrage';
import { mapperDemande, mapperDevis, mapperLigneOr, roleVoitLesMontants } from './mappeurs';
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
  chargerParametresAtelier,
  chargerPlaqueCourante,
  chargerResumeUtilisateur,
  chargerVehiculeLigne,
  construireVehiculeResume,
  versClientResume,
} from './references';
import { ServiceSnapshotOr } from './service-snapshot-or';
import { calculerTotauxParPayeur } from './totaux-payeur';

/** OR encore actif — sert la garde P-29 (deux OR ouverts sur le même véhicule). */
const STATUTS_OR_ACTIFS = ['planifie', 'ouvert', 'en_cours', 'controle'] as const;

/** OR verrouillé (I-15) : plus aucune modification d'en-tête ni de ligne. */
const STATUTS_OR_VERROUILLES = ['facture', 'restitue', 'cloture', 'annule'] as const;

export function estOrVerrouille(statut: LigneOrdreReparation['statut']): boolean {
  return (STATUTS_OR_VERROUILLES as readonly string[]).includes(statut);
}

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
      async (tx) => {
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
          await this.evenements.publier(tx, ctx, {
            type: 'ordre_reparation.ouvert',
            versionSchema: 1,
            siteId: entree.siteId,
            ressource: { type: 'ordre_reparation', id: ligne.id, numero },
            donnees: { statut: 'ouvert' },
          });
        }

        const document = await this.assemblerDocument(tx, ctx, principal.role, ligne.id);
        return { statutHttp: 201, corps: { donnees: document, avertissements: [] } };
      },
    );
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
      // (`MATRICE_DROITS[role] ?? []`, `.includes(action)`).
      const modifiePlafond =
        entree.plafondCentimes !== undefined &&
        entree.plafondCentimes !== (ligne.plafondCentimes ?? undefined);
      if (modifiePlafond) {
        const droitsDuRole = MATRICE_DROITS[principal.role] ?? [];
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
      return Promise.all(
        lignes.map(async (l) =>
          mapperDemande(l, await chargerResumeUtilisateur(tx, ctx, l.saisiParId)),
        ),
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
   * propre en-tête, plus chacune de ses lignes et de ses devis. `ServiceAudit.pourEntite` ne sait
   * lire qu'un couple (entité, id) à la fois (port gelé, `common/audit/audit.types.ts`) : ce
   * service agrège donc N+1 lectures, acceptable au volume d'un seul OR (quelques dizaines de
   * lignes au plus au lot 1).
   *
   * SÉRIALISÉ délibérément (pas de `Promise.all`) : chaque appel à `pourEntite` ouvre SA PROPRE
   * transaction (`AccesBase.enTenant`), donc SA PROPRE connexion prise sur le pool partagé — alors
   * que cette méthode tourne déjà À L'INTÉRIEUR d'une transaction (`this.acces.enTenant` ci-
   * dessous) qui en détient une. Paralléliser N lectures d'audit revient à réclamer N connexions
   * SUPPLÉMENTAIRES d'un coup pour une seule requête HTTP (`DATABASE_POOL_MAX=10` en dev, partagé
   * par tout le trafic) : un OR à plusieurs dizaines de lignes peut à lui seul saturer le pool et
   * mettre en attente (voire expirer, `connectionTimeoutMillis=5000`) toute autre requête
   * concurrente. Sérialiser tient ce coût à UNE connexion supplémentaire à la fois, quel que soit
   * le nombre de lignes/devis.
   *
   * NORMALISATION `creeLe` : `ServiceAudit.pourEntite` déclare `EntreeAudit.creeLe: Date`
   * (`common/audit/audit.types.ts`), mais son implémentation (`common/audit/service-audit.ts`)
   * lit `audit_atelier` par SQL brut (`tx.execute<LigneAuditBrute>`), hors du mapping de colonnes
   * Drizzle — vérifié en conditions réelles : la valeur reçue ICI est en fait une `string` Postgres
   * (`"2026-08-04 09:29:38.68287+00"`), pas une instance `Date`. Un tri par `.getTime()` sur cette
   * valeur plantait avec `TypeError: b.creeLe.getTime is not a function` (500 sur CHAQUE appel,
   * quel que soit l'OR — la cause réelle de ce défaut, distincte de l'épuisement du pool ci-
   * dessus, qui restait latent tant que peu de lignes existaient). `normaliserCreeLe` blinde CE
   * point de consommation contre l'écart entre le type déclaré et le type réellement reçu, sans
   * modifier `common/audit/` (hors périmètre de ce module) — une correction du contrat lui-même
   * (faire respecter `Date` à la source) reste préférable et à faire là-bas.
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
        id: string;
      }[] = [
        { entite: 'ordre_reparation', id: orId },
        ...lignes.map((l) => ({ entite: 'ligne_or' as const, id: l.id })),
        ...devisRows.map((d) => ({ entite: 'devis_complementaire' as const, id: d.id })),
      ];

      const brutes: EntreeAudit[] = [];
      for (const { entite, id } of entites) {
        // eslint-disable-next-line no-await-in-loop -- sérialisation délibérée, voir doc ci-dessus.
        const lot = await this.audit.pourEntite(ctx, entite, id);
        for (const entree of lot) {
          brutes.push({ ...entree, creeLe: normaliserCreeLe(entree.creeLe) });
        }
      }

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

      const donnees = await Promise.all(
        page.map(async (entree): Promise<ReponseEntreeJournal> => ({
          id: entree.id,
          entite: entree.entite,
          entiteId: entree.entiteId,
          action: entree.action,
          survenuLe: entree.creeLe.toISOString(),
          auteur: await chargerResumeUtilisateur(tx, ctx, entree.utilisateurId),
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
        })),
      );

      return { donnees, curseurSuivant: suite };
    });
  }

  /**
   * `GET /ordres-reparation` — SOUS-ENSEMBLE des filtres du contrat (§6.2) : `siteId`, `statut`
   * (multi), `clientId`, `vehiculeId`, `technicienId`, tri `ouvertLe:desc` par défaut.
   * SIMPLIFICATION SIGNALÉE : `vue`, `attente`, `localisation`, `q`, les bornes de date et les
   * tris alternatifs ne sont pas câblés dans cette passe — chacun est une combinaison de filtres
   * primitifs déjà exprimable par `statut`/`siteId` pour l'essentiel des vues, et la recherche
   * plein texte (`q`) est le périmètre de `recherche/` (L1-11), pas d'`atelier`.
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
      const conditions = [eq(ordreReparation.tenantId, ctx.tenantId)];
      if (filtres.siteId) conditions.push(eq(ordreReparation.siteId, filtres.siteId));
      if (filtres.clientId) conditions.push(eq(ordreReparation.clientId, filtres.clientId));
      if (filtres.vehiculeId) conditions.push(eq(ordreReparation.vehiculeId, filtres.vehiculeId));
      if (filtres.statut && filtres.statut.length > 0)
        conditions.push(inArray(ordreReparation.statut, filtres.statut));
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

      const decalage = decoderCurseurOffset(curseur);
      const lignes = await tx
        .select()
        .from(ordreReparation)
        .where(and(...conditions))
        .orderBy(desc(ordreReparation.ouvertLe), desc(ordreReparation.creeLe))
        .limit(limite + 1)
        .offset(decalage);

      const page = lignes.slice(0, limite);
      const suite = lignes.length > limite ? encoderCurseurOffset(decalage + limite) : null;

      // `pourListe = true` : voir la note sur `assemblerDocument` ci-dessous — évite d'ouvrir
      // jusqu'à `limite` (max 200) transactions d'audit imbriquées en parallèle sur une seule
      // page (épuisement du pool `pg`, `max 10` par défaut).
      const donnees = await Promise.all(
        page.map((l) => this.assemblerDocument(tx, ctx, principal.role, l.id, true)),
      );
      return { donnees, curseurSuivant: suite };
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
        : this.audit.pourEntite(ctx, 'ordre_reparation', orId),
      // I-09 : `LecturePointage.pointagesOuvertsPourOr` prend `tx` en premier paramètre et lit
      // DANS la transaction courante (doctrine du port, `atelier.jetons.ts`) — pas de transaction
      // imbriquée ici, à la différence de `ServiceAudit.pourEntite` juste au-dessus (hors
      // périmètre de ce correctif, voir `journal()`).
      this.pointage.pointagesOuvertsPourOr(tx, orId),
    ]);

    const demandes = await Promise.all(
      demandesRows.map(async (d) =>
        mapperDemande(d, await chargerResumeUtilisateur(tx, ctx, d.saisiParId)),
      ),
    );
    const devis = await Promise.all(
      devisRows.map(async (d) => {
        const lignesDevis = await listerLignesDevis(tx, ctx, d.id);
        const emetteur = await chargerResumeUtilisateur(tx, ctx, d.emetteurId);
        return mapperDevis(d, lignesDevis, emetteur, role);
      }),
    );

    const lignesTronquees = lignesToutes.length > 200;
    const lignesEmbarquees = lignesTronquees ? lignesToutes.slice(0, 200) : lignesToutes;

    const attentes: AttentesOr = {
      accord: or.attenteAccord,
      pieces: or.attentePieces,
      externe: or.attenteExterne,
    };
    const dernierEvenement = journalOr.at(-1) ?? null;
    const modifiePar = await chargerResumeUtilisateur(
      tx,
      ctx,
      dernierEvenement?.utilisateurId ?? null,
    );
    const voitMontants = roleVoitLesMontants(role);

    // `totauxParPayeur` (MD-62) : résout le destinataire de chaque groupe payeur tiers en UN SEUL
    // aller-retour batché sur `client` (jamais une requête par ligne) — voir
    // `totaux-payeur.ts::ResolveurDestinataireTiers`. Calculé uniquement pour un rôle qui voit les
    // montants (même garde que le reste de ce bloc), le fetch supplémentaire n'a pas de coût pour
    // `technicien`.
    const totauxParPayeur = voitMontants
      ? await this.calculerTotauxAvecDestinataires(tx, ctx, lignesToutes, clientResume)
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
          }
        : {}),
      restitutionPromiseLe: or.restitutionPromiseLe ? or.restitutionPromiseLe.toISOString() : null,
      restitutionInitialeLe: or.restitutionInitialeLe
        ? or.restitutionInitialeLe.toISOString()
        : null,
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
        pointagesOuverts: pointagesOuverts.length,
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

// Réexporté pour les actions de transition (marquage réalisée, etc.) qui doivent charger une
// ligne pour écriture sans dupliquer l'import.
export { chargerLigneOrPourEcriture, chargerOrOuNull };
