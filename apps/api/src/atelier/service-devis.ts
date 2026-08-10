import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeCreationDevisComplementaire,
  EntreeReponseDevisComplementaire,
  FiltresDevis,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseDevisComplementaire,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  devisComplementaire,
  devisComplementaireLigne,
  ligneOr,
  type LigneLigneOr,
  type LigneOrdreReparation,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../common/evenements';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';

import { mapperDevis } from './mappeurs';
import {
  chargerDevisPourEcriture,
  chargerLignesPourEcriture,
  chargerOr,
  chargerOrPourEcriture,
  listerDevisOr,
  listerLignesDevis,
} from './or-requetes';
import { chargerResumesUtilisateurs, chargerResumeUtilisateur } from './references';
import { decoderCurseurOffset, encoderCurseurOffset, estOrVerrouille } from './service-or';
import { traduireErreurTransition } from './traducteur-transition';

/**
 * Devis complémentaires (contrats-api-etape-1.md §7.9, RM-79 → RM-84). **Pas de `PATCH`, pas de
 * `DELETE` : un devis répondu est immuable** — gardé ici en plus du trigger
 * `devis_complementaire_verrouiller_apres_reponse` (ceinture et bretelles, même doctrine que
 * `ligne_or_interdire_suppression`), pour rendre `DEVIS_IMMUABLE` (code dédié, §4.3) plutôt que le
 * `LIGNE_TRANSITION_INTERDITE` générique qu'aurait produit le seul trigger.
 *
 * ÉCART DE SCHÉMA SIGNALÉ : `devis_complementaire` ne porte qu'UNE colonne `canal`, alors que le
 * contrat en distingue deux usages — le canal d'ENVOI (`schemaCreationDevisComplementaire.canal`)
 * et le canal de RÉPONSE (`schemaReponseDevisComplementaire.canal`). `repondre()` écrase donc la
 * valeur posée par `creer()`. Signalé pour arbitrage avec expert-database/expert-api plutôt que
 * résolu d'autorité (ajouter une colonne serait une migration hors du périmètre de cette tâche).
 *
 * SIMPLIFICATIONS SIGNALÉES (RM-73, P-24, CT-36) : les lignes refusées n'alimentent pas encore les
 * travaux reportés du véhicule (propriété du module `vehicules/`, hors périmètre de ce fichier), et
 * aucune proposition de ligne de démontage/remontage n'est émise dans `avertissements` — `CODES_AVERTISSEMENT`
 * (gelé, `packages/shared`) ne porte aucun code pour ce cas. `nouveauPlafondCentimes` n'est PAS
 * automatiquement reporté sur `ordre_reparation.plafond_centimes` après acceptation : le contrat
 * disponible ne tranche pas ce point et le modifier resterait un geste distinct
 * (`atelier.or.plafond_modifier`, `PATCH /ordres-reparation/{id}`).
 */
@Injectable()
export class ServiceDevis {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    private readonly horloge: Horloge,
  ) {}

  /** `GET /ordres-reparation/{orId}/devis-complementaires` — même doctrine de pagination
   *  d'offset opaque que `ServiceLigneOr.lister`/`ServiceOr.journal`. */
  async lister(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    filtres: FiltresDevis,
    limite: number,
    curseur: string | undefined,
  ): Promise<PageCurseur<ReponseDevisComplementaire>> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerOr(tx, ctx, orId);
      const toutes = await listerDevisOr(tx, ctx, orId);
      const filtrees = filtres.decision
        ? toutes.filter((d) => d.decision === filtres.decision)
        : [...toutes];
      if (filtres.tri === 'numeroOrdre:desc') filtrees.reverse();

      const decalage = decoderCurseurOffset(curseur);
      const page = filtrees.slice(decalage, decalage + limite);
      const curseurSuivant =
        decalage + limite < filtrees.length ? encoderCurseurOffset(decalage + limite) : null;

      // Correctif N+1 : UNE requête pour tous les émetteurs de la page (dédoublonnée,
      // scope tenant explicite), au lieu d'un `chargerResumeUtilisateur` par devis —
      // voir `chargerResumesUtilisateurs` (`./references`) pour la doctrine.
      const emetteurs = await chargerResumesUtilisateurs(
        tx,
        ctx,
        page.map((d) => d.emetteurId),
      );
      const donnees = await Promise.all(
        page.map(async (d) => {
          const lignesDevis = await listerLignesDevis(tx, ctx, d.id);
          const emetteur = d.emetteurId ? (emetteurs.get(d.emetteurId) ?? null) : null;
          return mapperDevis(d, lignesDevis, emetteur, principal.role);
        }),
      );
      return { donnees, curseurSuivant, limite };
    });
  }

  /**
   * `POST /ordres-reparation/{orId}/devis-complementaires` — `Idempotency-Key` obligatoire (pièce
   * à valeur probante). `montantTtcCentimes` calculé PAR LE SERVEUR depuis les lignes référencées
   * (déjà figées, RM-65) — jamais fourni par le client.
   */
  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeCreationDevisComplementaire,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDevisComplementaire> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/ordres-reparation/:orId/devis-complementaires',
        cle: cleIdempotence,
        corps: { orId, ...entree },
      },
      async (tx) => {
        const or = await chargerOrPourEcriture(tx, ctx, orId);
        this.garantirNonVerrouille(or.statut, orId, or.numero);

        const lignesCiblees = await chargerLignesPourEcriture(tx, ctx, orId, entree.ligneIds);
        const montantTtcCentimes = lignesCiblees.reduce((s, l) => s + l.montantTtcCentimes, 0);

        const existants = await listerDevisOr(tx, ctx, orId);
        const numeroOrdre = (existants.at(-1)?.numeroOrdre ?? 0) + 1;
        const maintenant = this.horloge.maintenant();

        const [devis] = await tx
          .insert(devisComplementaire)
          .values({
            tenantId: ctx.tenantId,
            ordreReparationId: orId,
            numeroOrdre,
            montantTtcCentimes,
            nouveauPlafondCentimes: entree.nouveauPlafondCentimes,
            impactRestitutionLe: entree.impactRestitutionLe
              ? new Date(entree.impactRestitutionLe)
              : null,
            envoyeLe: maintenant,
            canal: entree.canal,
            emetteurId: principal.utilisateurId,
            preuve: entree.destinataireContactId
              ? { destinataireContactId: entree.destinataireContactId }
              : null,
          })
          .returning();
        if (!devis) {
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion du devis complémentaire n'a rendu aucune ligne.",
          );
        }

        for (const ligne of lignesCiblees) {
          await tx.insert(devisComplementaireLigne).values({
            tenantId: ctx.tenantId,
            devisComplementaireId: devis.id,
            ligneOrId: ligne.id,
          });
        }

        await this.evenements.publier(tx, ctx, {
          type: 'devis_complementaire.envoye',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'devis_complementaire', id: devis.id },
          donnees: { ordreReparationId: orId, montantTtcCentimes, canal: entree.canal },
        });

        const lignesDevis = await listerLignesDevis(tx, ctx, devis.id);
        const emetteur = await chargerResumeUtilisateur(tx, ctx, devis.emetteurId);
        return {
          statutHttp: 201,
          corps: {
            donnees: mapperDevis(devis, lignesDevis, emetteur, principal.role),
            avertissements: [],
          },
        };
      },
    );
  }

  /**
   * `POST .../devis-complementaires/{devisId}/repondre` — `Idempotency-Key` obligatoire (une
   * double réponse est un litige, RM-81). `partiel` fait prendre à CHAQUE ligne sa propre décision
   * (CT-33) ; `accepte`/`refuse` s'appliquent uniformément, sans peupler `decision` par ligne
   * (`ReponseDevisLigne.decision` reste `null` hors `partiel`, contrat `devis.ts`).
   */
  async repondre(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    devisId: string,
    entree: EntreeReponseDevisComplementaire,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDevisComplementaire> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/ordres-reparation/:orId/devis-complementaires/:devisId/repondre',
        cle: cleIdempotence,
        corps: { orId, devisId, ...entree },
      },
      async (tx) => {
        const or = await chargerOrPourEcriture(tx, ctx, orId);
        this.garantirNonVerrouille(or.statut, orId, or.numero);

        const devis = await chargerDevisPourEcriture(tx, ctx, orId, devisId);
        if (devis.reponduLe !== null) {
          throw new ErreurMetier(
            'DEVIS_IMMUABLE',
            'Ce devis complémentaire a déjà reçu une réponse (RM-79, CT-35).',
            {
              blocages: [
                {
                  type: 'devis_complementaire',
                  id: devisId,
                  libelle: `Devis n°${String(devis.numeroOrdre)}`,
                },
              ],
              actionsProposees: [{ code: 'RAFRAICHIR' }],
            },
          );
        }

        const lignesDevisRows = await listerLignesDevis(tx, ctx, devisId);
        const ligneOrIds = lignesDevisRows.map((l) => l.ligneOrId);
        const lignesCiblees = await chargerLignesPourEcriture(tx, ctx, orId, ligneOrIds);
        const parId = new Map<string, LigneLigneOr>(lignesCiblees.map((l) => [l.id, l]));

        if (entree.decision === 'partiel') {
          for (const decisionLigne of entree.lignes ?? []) {
            const ligne = parId.get(decisionLigne.ligneId);
            if (!ligne) continue; // id périmé : ignoré, cohérent avec `chargerLignesPourEcriture`
            const nouveauStatut = decisionLigne.decision === 'accepte' ? 'validee' : 'refusee';
            await tx
              .update(devisComplementaireLigne)
              .set({ decision: decisionLigne.decision })
              .where(
                and(
                  eq(devisComplementaireLigne.tenantId, ctx.tenantId),
                  eq(devisComplementaireLigne.devisComplementaireId, devisId),
                  eq(devisComplementaireLigne.ligneOrId, decisionLigne.ligneId),
                ),
              );
            await this.transitionnerLigneSiApplicable(tx, ctx, ligne, nouveauStatut);
          }
        } else {
          const nouveauStatut = entree.decision === 'accepte' ? 'validee' : 'refusee';
          for (const ligne of lignesCiblees) {
            await this.transitionnerLigneSiApplicable(tx, ctx, ligne, nouveauStatut);
          }
        }

        const [misAJour] = await tx
          .update(devisComplementaire)
          .set({
            reponduLe: new Date(entree.repondueLe),
            decision: entree.decision,
            interlocuteurNom: entree.interlocuteurNom,
            retranscription: entree.retranscription ?? null,
            canal: entree.canal,
          })
          .where(
            and(
              eq(devisComplementaire.tenantId, ctx.tenantId),
              eq(devisComplementaire.id, devisId),
            ),
          )
          .returning();
        if (!misAJour) {
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "La mise à jour du devis complémentaire n'a rendu aucune ligne.",
          );
        }

        await this.evenements.publier(tx, ctx, {
          type: 'devis_complementaire.repondu',
          versionSchema: 1,
          siteId: or.siteId,
          ressource: { type: 'devis_complementaire', id: devisId },
          donnees: { ordreReparationId: orId, decision: entree.decision },
        });

        const lignesDevis = await listerLignesDevis(tx, ctx, devisId);
        const emetteur = await chargerResumeUtilisateur(tx, ctx, misAJour.emetteurId);
        return {
          statutHttp: 200,
          corps: {
            donnees: mapperDevis(misAJour, lignesDevis, emetteur, principal.role),
            avertissements: [],
          },
        };
      },
    );
  }

  private garantirNonVerrouille(
    statut: LigneOrdreReparation['statut'],
    orId: string,
    numero: string,
  ): void {
    if (estOrVerrouille(statut)) {
      throw new ErreurMetier(
        'OR_LIGNE_VERROUILLEE',
        `Ordre de réparation verrouillé (statut ${statut}).`,
        {
          blocages: [
            {
              type: 'ordre_reparation',
              id: orId,
              libelle: numero,
              donnees: { statutActuel: statut },
            },
          ],
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        },
      );
    }
  }

  /** N'écrit que si la ligne est encore dans un état où la transition a un sens (`a_valider` en
   *  premier lieu, cas nominal RM-79) — une ligne déjà réglée autrement (annulée entretemps) n'est
   *  pas retentée, cohérent avec « id périmé, distinct d'un statut incompatible » (`or-requetes.ts`). */
  private async transitionnerLigneSiApplicable(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    ligne: LigneLigneOr,
    versStatut: 'validee' | 'refusee',
  ): Promise<void> {
    if (ligne.statut !== 'a_valider' && ligne.statut !== 'proposee') return;
    try {
      await tx
        .update(ligneOr)
        .set({ statut: versStatut })
        .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligne.id)));
    } catch (erreur) {
      const traduite = traduireErreurTransition(erreur, ligne.id, ligne.designation ?? '');
      if (traduite) throw traduite;
      throw erreur;
    }
  }
}
