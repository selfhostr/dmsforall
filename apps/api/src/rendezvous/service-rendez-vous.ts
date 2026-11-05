import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, gte, lte, sql } from 'drizzle-orm';
import {
  type Avertissement,
  type EntreeActionAnnulerRendezVous,
  type EntreeActionArriveeRendezVous,
  type EntreeCreationRendezVous,
  type EntreeModificationRendezVous,
  type FiltresRendezVous,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseRendezVous,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { rendezVous, type LigneRendezVous } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import { JETON_IDEMPOTENCE, type ServiceIdempotence } from '../common/idempotence';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../common/pagination';
import {
  chargerClientLigne,
  chargerVehiculeLigne,
  chargerVehiculeResume,
  versClientResume,
} from '../atelier/references';
import { calculerRestitutionAmorcee } from '../atelier/restitution-amorcage';
import { ServiceOr } from '../atelier/service-or';
import { ServiceTransitions } from '../atelier/service-transitions';

import { capaciteMinutesDepuisCentiemes, dureeMinutesDepuisMotif } from './calcul-capacite';
import { versDtoMotifRendezVous, versDtoRendezVous } from './mappeurs';
import {
  chargerCapaciteHeuresJourCentiemes,
  chargerMotifLigne,
  chargerOrLieOuNull,
  chargerRendezVous,
  chargerRendezVousPourEcriture,
} from './references';

/** Statuts terminaux (RV-19) : la base les fait tenir (trigger `rendez_vous_empecher_reouverture`),
 *  le service les vérifie AVANT d'écrire pour rendre une erreur métier lisible plutôt qu'une
 *  violation de trigger brute. */
const STATUTS_TERMINAUX = new Set(['honore', 'absent', 'annule']);

@Injectable()
export class ServiceRendezVous {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
    private readonly serviceOr: ServiceOr,
    private readonly serviceTransitions: ServiceTransitions,
  ) {}

  /**
   * `POST /rendez-vous` — `Idempotency-Key` obligatoire (RM-49 : un rejeu ne doit rien créer deux
   * fois). Motif OBLIGATOIRE (choix produit #2) : porte la durée par défaut, figée sur la ligne à
   * la création. Surbooking : jamais bloquant (choix produit #1) — avertit via
   * `PLANNING_CAPACITE_DEPASSEE` si la capacité du jour est déjà atteinte, ne refuse jamais.
   */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    entree: EntreeCreationRendezVous,
    cleIdempotence: string,
  ): Promise<{
    readonly statutHttp: number;
    readonly corps: ReponseAvecAvertissements<ReponseRendezVous>;
  }> {
    const resultat = await this.idempotence.executer(
      ctx,
      { methode: 'POST', chemin: '/rendez-vous', cle: cleIdempotence, corps: entree },
      async (tx) => {
        await chargerClientLigne(tx, ctx, entree.clientId);
        if (entree.vehiculeId) {
          await chargerVehiculeLigne(tx, ctx, entree.vehiculeId);
        }
        const motif = await chargerMotifLigne(tx, ctx, entree.motifId);

        const dureeEstimeeMinutes = entree.dureeEstimeeMinutes ?? dureeMinutesDepuisMotif(motif);
        if (dureeEstimeeMinutes === null) {
          throw new ErreurMetier(
            'VALIDATION_ECHOUEE',
            'Ce motif ne porte aucune durée par défaut : préciser dureeEstimeeMinutes.',
            {
              erreurs: [
                {
                  champ: 'dureeEstimeeMinutes',
                  code: 'requis',
                  message: 'Durée estimée requise (motif sans durée par défaut).',
                },
              ],
            },
          );
        }

        const maintenant = this.horloge.maintenant();
        let ligne: LigneRendezVous;
        try {
          const [inseree] = await tx
            .insert(rendezVous)
            .values({
              tenantId: ctx.tenantId,
              siteId: entree.siteId,
              clientId: entree.clientId,
              vehiculeId: entree.vehiculeId ?? null,
              motifId: entree.motifId,
              commentaire: entree.commentaire ?? null,
              type: entree.type,
              date: entree.dateLe,
              moment: entree.moment,
              heureSouhaitee: entree.heureSouhaitee ?? null,
              dureeEstimeeMinutes,
              statut: 'confirme',
              origine: 'reservation',
              confirmeLe: maintenant,
              creeParId: principal.utilisateurId,
            })
            .returning();
          if (!inseree) {
            throw new ErreurMetier(
              'ERREUR_INTERNE',
              "L'insertion du rendez-vous n'a rendu aucune ligne.",
            );
          }
          ligne = inseree;
        } catch (erreur) {
          throw this.traduireErreurEcriture(erreur, entree.siteId);
        }

        // Calculé DANS la même transaction que l'insertion ci-dessus (jamais via
        // `ServiceCapaciteRendezVous`, qui ouvrirait sa PROPRE connexion : sous read committed,
        // elle ne verrait pas encore la ligne qui vient d'être insérée ici, et sous-compterait
        // l'occupation d'exactement CE rendez-vous — défaut constaté en exécution réelle avant ce
        // correctif). Même requête que `ServiceCapaciteRendezVous.capaciteMoment`, sur `tx`.
        const avertissements: Avertissement[] = [];
        const capaciteMinutes = capaciteMinutesDepuisCentiemes(
          await chargerCapaciteHeuresJourCentiemes(tx, ctx, entree.siteId),
        );
        const lignesOccupation = await tx
          .select({ dureeEstimeeMinutes: rendezVous.dureeEstimeeMinutes })
          .from(rendezVous)
          .where(
            and(
              eq(rendezVous.tenantId, ctx.tenantId),
              eq(rendezVous.siteId, entree.siteId),
              eq(rendezVous.statut, 'confirme'),
              eq(rendezVous.date, entree.dateLe),
              eq(rendezVous.moment, entree.moment),
            ),
          );
        const minutesOccupees = lignesOccupation.reduce((t, l) => t + l.dureeEstimeeMinutes, 0);
        if (capaciteMinutes !== null && minutesOccupees >= capaciteMinutes) {
          avertissements.push({
            code: 'PLANNING_CAPACITE_DEPASSEE',
            message: `Capacité du ${entree.dateLe} (${entree.moment}) déjà atteinte ou dépassée pour ce site — rendez-vous créé quand même.`,
            donnees: {
              minutesOccupees,
              capaciteMinutes,
              dateLe: entree.dateLe,
              moment: entree.moment,
            },
          });
        }

        const donnees = await this.assembler(tx, ctx, ligne);
        return { statutHttp: 201, corps: { donnees, avertissements } };
      },
    );
    return resultat.reponse;
  }

  async obtenir(ctx: ContexteTenant, rdvId: string): Promise<ReponseRendezVous> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRendezVous(tx, ctx, rdvId);
      return this.assembler(tx, ctx, ligne);
    });
  }

  /**
   * `GET /rendez-vous?du=&au=&siteId=` — pagination par curseur (`creeLe`, tri fixe des deux sens
   * proposés par le contrat). PIÈGE CONNU (CONTRIBUTING.md) : `creeLe::text` + `valeurCurseurTimestamptz()`
   * en sortie, jamais un `Date` JS comparé directement — sinon des lignes sautent en silence sous
   * forte cadence d'écriture.
   */
  async lister(
    ctx: ContexteTenant,
    filtres: FiltresRendezVous,
    limite: number,
    curseur: string | undefined,
  ): Promise<PageCurseur<ReponseRendezVous>> {
    const curseurDecode = curseur ? decoderCurseurTrie(curseur, filtres.tri, 'temporel') : null;
    const sens = filtres.tri === 'creeLe:asc' ? 'asc' : 'desc';

    return this.acces.enTenant(ctx, async (tx) => {
      const conditions = [
        eq(rendezVous.tenantId, ctx.tenantId),
        gte(rendezVous.date, filtres.du),
        lte(rendezVous.date, filtres.au),
      ];
      // Filtre appliqué SEULEMENT si fourni — un siteId inexistant doit rendre une liste VIDE
      // (comparaison à `undefined`, jamais un `if (filtres.siteId)` qui écraserait une valeur
      // légitime), jamais silencieusement ignoré (piège récurrent documenté dans CONTRIBUTING.md).
      if (filtres.siteId !== undefined) conditions.push(eq(rendezVous.siteId, filtres.siteId));
      if (filtres.statut !== undefined) conditions.push(eq(rendezVous.statut, filtres.statut));
      if (filtres.clientId !== undefined)
        conditions.push(eq(rendezVous.clientId, filtres.clientId));
      if (filtres.vehiculeId !== undefined)
        conditions.push(eq(rendezVous.vehiculeId, filtres.vehiculeId));

      if (curseurDecode) {
        if (typeof curseurDecode.valeur !== 'string') {
          // `creeLe` est NOT NULL (colonnesHorodatage) : un curseur forgé avec `valeur: null` ne
          // peut correspondre à aucune ligne réelle — jamais une erreur serveur, une page vide.
          conditions.push(sql`false`);
        } else {
          const operateur = sens === 'asc' ? sql`>` : sql`<`;
          conditions.push(
            sql`(${rendezVous.creeLe}, ${rendezVous.id}) ${operateur} (${curseurDecode.valeur}::timestamptz, ${curseurDecode.id})`,
          );
        }
      }

      const lignes = await tx
        .select({
          ...getTableColumns(rendezVous),
          creeLeTexte: sql<string>`${rendezVous.creeLe}::text`,
        })
        .from(rendezVous)
        .where(and(...conditions))
        .orderBy(
          sens === 'asc' ? rendezVous.creeLe : desc(rendezVous.creeLe),
          sens === 'asc' ? rendezVous.id : desc(rendezVous.id),
        )
        .limit(limite + 1);

      const aSuite = lignes.length > limite;
      const page = aSuite ? lignes.slice(0, limite) : lignes;
      const dernier = page[page.length - 1];
      const curseurSuivant =
        aSuite && dernier
          ? encoderCurseurTrie({
              tri: filtres.tri,
              valeur: valeurCurseurTimestamptz(dernier.creeLeTexte),
              id: dernier.id,
            })
          : null;

      const donnees = await Promise.all(page.map((ligne) => this.assembler(tx, ctx, ligne)));
      return { donnees, curseurSuivant, limite };
    });
  }

  /** `PATCH /rendez-vous/{id}` — déplacement/correction. RV-16 : ne change jamais `statut`, audité
   *  automatiquement par le trigger `rendez_vous_audit` (avant/après). */
  async modifier(
    ctx: ContexteTenant,
    rdvId: string,
    entree: EntreeModificationRendezVous,
  ): Promise<ReponseRendezVous> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRendezVousPourEcriture(tx, ctx, rdvId);
      if (STATUTS_TERMINAUX.has(ligne.statut)) {
        throw new ErreurMetier(
          'RDV_TRANSITION_INTERDITE',
          `Rendez-vous déjà "${ligne.statut}" : plus modifiable.`,
          {
            blocages: [
              {
                type: 'ordre_reparation',
                id: rdvId,
                libelle: 'Rendez-vous',
                donnees: { statutActuel: ligne.statut },
              },
            ],
          },
        );
      }
      if (entree.vehiculeId) {
        await chargerVehiculeLigne(tx, ctx, entree.vehiculeId);
      }

      const colonnes: Partial<typeof rendezVous.$inferInsert> = {};
      if (entree.dateLe !== undefined) colonnes.date = entree.dateLe;
      if (entree.moment !== undefined) colonnes.moment = entree.moment;
      if (entree.heureSouhaitee !== undefined) colonnes.heureSouhaitee = entree.heureSouhaitee;
      if (entree.dureeEstimeeMinutes !== undefined)
        colonnes.dureeEstimeeMinutes = entree.dureeEstimeeMinutes;
      if (entree.vehiculeId !== undefined) colonnes.vehiculeId = entree.vehiculeId;
      if (entree.commentaire !== undefined) colonnes.commentaire = entree.commentaire;

      if (Object.keys(colonnes).length === 0) {
        return this.assembler(tx, ctx, ligne);
      }

      const [mise] = await tx
        .update(rendezVous)
        .set(colonnes)
        .where(and(eq(rendezVous.tenantId, ctx.tenantId), eq(rendezVous.id, rdvId)))
        .returning();
      if (!mise) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "La mise à jour du rendez-vous n'a rendu aucune ligne.",
        );
      }
      return this.assembler(tx, ctx, mise);
    });
  }

  /**
   * `POST /rendez-vous/{id}/arrivee` — réutilise ce qui existe déjà côté atelier (T-03, transition
   * `planifie -> ouvert`) plutôt que d'inventer une seconde machine à états. RV-18 : `honore`
   * n'est jamais déclaré manuellement, c'est un effet de bord de la création/réception de l'OR.
   *
   * ÉCART SIGNALÉ (portée lot RDV-1) : le mode « OR anticipé » (RV-10, OR créé `planifie` DÈS la
   * confirmation téléphonique) N'EST PAS câblé à la création du rendez-vous — `ServiceOr.creer`
   * porte sa PROPRE transaction idempotente (`ServiceIdempotence.executer`), l'appeler depuis
   * l'intérieur de la transaction de création du rendez-vous aurait ouvert une SECONDE transaction
   * imbriquée sur une connexion distincte (deux `acces.enTenant` empilés), cassant l'atomicité
   * entre l'insertion du rendez-vous et celle de l'OR. Cette méthode crée donc TOUJOURS l'OR au
   * moment de l'arrivée (comportement RV-11 dans les deux configurations de `etatPlanifieActif`),
   * sauf si un OR est déjà lié (rejeu, ou lien posé par un autre chemin — ex. seed) : dans ce cas,
   * si l'OR lié est encore `planifie`, la transition existante `receptionner` (T-03) est réutilisée
   * telle quelle. Amorce `restitutionPromiseLe` dans les deux branches (le cœur du chantier).
   */
  async arrivee(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    rdvId: string,
    entree: EntreeActionArriveeRendezVous,
    cleIdempotence: string,
  ): Promise<ReponseAvecAvertissements<ReponseRendezVous>> {
    const rdv = await this.acces.enTenant(ctx, (tx) => chargerRendezVous(tx, ctx, rdvId));

    if (STATUTS_TERMINAUX.has(rdv.statut)) {
      throw new ErreurMetier(
        'RDV_TRANSITION_INTERDITE',
        `Rendez-vous déjà "${rdv.statut}" : arrivée impossible.`,
        {
          blocages: [
            {
              type: 'ordre_reparation',
              id: rdvId,
              libelle: 'Rendez-vous',
              donnees: { statutActuel: rdv.statut },
            },
          ],
        },
      );
    }

    const vehiculeId = entree.vehiculeId ?? rdv.vehiculeId;
    if (!vehiculeId) {
      throw new ErreurMetier(
        'RDV_IDENTIFICATION_INCOMPLETE',
        'Aucun véhicule connu pour ce rendez-vous : le préciser pour créer l’ordre de réparation.',
        {
          erreurs: [
            { champ: 'vehiculeId', code: 'requis', message: 'Véhicule requis pour la réception.' },
          ],
        },
      );
    }

    const restitutionPromiseLe = calculerRestitutionAmorcee({
      dateLe: rdv.date,
      moment: rdv.moment,
      heureSouhaitee: rdv.heureSouhaitee,
      dureeEstimeeMinutes: rdv.dureeEstimeeMinutes,
    }).toISOString();

    const orLie = await this.acces.enTenant(ctx, (tx) => chargerOrLieOuNull(tx, ctx, rdvId));

    let avertissements: readonly Avertissement[] = [];
    if (orLie && orLie.statut === 'planifie') {
      await this.serviceTransitions.receptionner(ctx, principal, orLie.id, {
        kilometrageEntree: entree.kilometrageEntree,
        unite: entree.unite,
        signatureDifferee: entree.signatureDifferee,
        motifDifferee: entree.motifDifferee,
      });
    } else if (!orLie) {
      const resultat = await this.serviceOr.creer(
        ctx,
        principal,
        {
          siteId: rdv.siteId,
          vehiculeId,
          clientId: rdv.clientId,
          type: rdv.type,
          rendezVousId: rdv.id,
          kilometrageEntree: entree.kilometrageEntree,
          uniteKilometrage: entree.unite,
          demandes: rdv.commentaire ? [{ verbatim: rdv.commentaire }] : [],
          restitutionPromiseLe,
          conducteurPresentNom: entree.conducteurPresentNom ?? undefined,
          statutInitial: 'ouvert',
          // Protocole de confirmation (§4.4) : une condition confirmable côté création d'OR
          // (ex. VEHICULE_DEUX_OR_OUVERTS) doit pouvoir être rejouée depuis CET appel — sans ce
          // transfert, le rejeu avec `confirmations` échouerait indéfiniment de la même façon.
          confirmations: entree.confirmations,
        },
        cleIdempotence,
      );
      avertissements = resultat.reponse.corps.avertissements;
    }
    // else : OR déjà lié et déjà ouvert/au-delà — rejeu de l'arrivée, rien à recréer.

    const maintenant = this.horloge.maintenant();
    const rdvHonore = await this.acces.enTenant(ctx, async (tx) => {
      const ligneEcriture = await chargerRendezVousPourEcriture(tx, ctx, rdvId);
      if (STATUTS_TERMINAUX.has(ligneEcriture.statut)) {
        return ligneEcriture;
      }
      const [mise] = await tx
        .update(rendezVous)
        .set({ statut: 'honore', honoreLe: maintenant })
        .where(and(eq(rendezVous.tenantId, ctx.tenantId), eq(rendezVous.id, rdvId)))
        .returning();
      return mise ?? ligneEcriture;
    });

    const donnees = await this.acces.enTenant(ctx, (tx) => this.assembler(tx, ctx, rdvHonore));
    return { donnees, avertissements };
  }

  /** `POST /rendez-vous/{id}/absence` — RV-24, constat manuel. */
  async absence(ctx: ContexteTenant, rdvId: string): Promise<ReponseRendezVous> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRendezVousPourEcriture(tx, ctx, rdvId);
      if (STATUTS_TERMINAUX.has(ligne.statut)) {
        throw new ErreurMetier('RDV_TRANSITION_INTERDITE', `Rendez-vous déjà "${ligne.statut}".`, {
          blocages: [
            {
              type: 'ordre_reparation',
              id: rdvId,
              libelle: 'Rendez-vous',
              donnees: { statutActuel: ligne.statut },
            },
          ],
        });
      }
      const [mise] = await tx
        .update(rendezVous)
        .set({ statut: 'absent', absentConstateLe: this.horloge.maintenant() })
        .where(and(eq(rendezVous.tenantId, ctx.tenantId), eq(rendezVous.id, rdvId)))
        .returning();
      if (!mise)
        throw new ErreurMetier('ERREUR_INTERNE', 'Mise à jour du rendez-vous sans retour.');
      return this.assembler(tx, ctx, mise);
    });
  }

  /** `POST /rendez-vous/{id}/annuler` — motif obligatoire, jamais silencieux. */
  async annuler(
    ctx: ContexteTenant,
    rdvId: string,
    entree: EntreeActionAnnulerRendezVous,
  ): Promise<ReponseRendezVous> {
    return this.acces.enTenant(ctx, async (tx) => {
      const ligne = await chargerRendezVousPourEcriture(tx, ctx, rdvId);
      if (STATUTS_TERMINAUX.has(ligne.statut)) {
        throw new ErreurMetier(
          'RDV_ANNULATION_IMPOSSIBLE',
          `Rendez-vous déjà "${ligne.statut}" : annulation impossible.`,
          {
            blocages: [
              {
                type: 'ordre_reparation',
                id: rdvId,
                libelle: 'Rendez-vous',
                donnees: { statutActuel: ligne.statut },
              },
            ],
          },
        );
      }
      const [mise] = await tx
        .update(rendezVous)
        .set({
          statut: 'annule',
          annuleLe: this.horloge.maintenant(),
          motifAnnulation: entree.motif,
        })
        .where(and(eq(rendezVous.tenantId, ctx.tenantId), eq(rendezVous.id, rdvId)))
        .returning();
      if (!mise)
        throw new ErreurMetier('ERREUR_INTERNE', 'Mise à jour du rendez-vous sans retour.');
      return this.assembler(tx, ctx, mise);
    });
  }

  /** Assemble le document complet — client/véhicule/motif résolus, OR lié résolu par requête
   *  inverse (§0 conception données : le sens de la relation est OR -> RDV, jamais l'inverse). */
  private async assembler(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneRendezVous,
  ): Promise<ReponseRendezVous> {
    const [clientLigne, motifLigne, orLie] = await Promise.all([
      chargerClientLigne(tx, ctx, ligne.clientId),
      chargerMotifLigne(tx, ctx, ligne.motifId),
      chargerOrLieOuNull(tx, ctx, ligne.id),
    ]);
    const [client, vehicule] = await Promise.all([
      versClientResume(tx, ctx, clientLigne),
      ligne.vehiculeId ? chargerVehiculeResume(tx, ctx, ligne.vehiculeId) : Promise.resolve(null),
    ]);
    return versDtoRendezVous(
      ligne,
      client,
      vehicule,
      versDtoMotifRendezVous(motifLigne),
      orLie?.id ?? null,
    );
  }

  private traduireErreurEcriture(erreur: unknown, siteId: string): Error {
    const brute = erreur as { code?: unknown; constraint_name?: unknown } | null;
    // 23503 = foreign_key_violation (Postgres SQLSTATE) : siteId/clientId/vehiculeId/motifId
    // inconnu du tenant plutôt qu'une panne serveur.
    if (brute && typeof brute === 'object' && brute.code === '23503') {
      return new ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        `Référence invalide pour ce tenant (site ${siteId} ou une autre entité citée).`,
      );
    }
    return erreur instanceof Error
      ? erreur
      : new ErreurMetier('ERREUR_INTERNE', 'Erreur inattendue à la création du rendez-vous.');
  }
}
