import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeModificationTravailReporte,
  ReponseTravailReporte,
  RoleUtilisateur,
  UrgenceTravail,
} from '@dfa/shared';
import { ROLES_SANS_MONTANT } from '../auth/matrice-droits';
import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import { vehiculeTravailReporte, type LigneVehiculeTravailReporte } from '../db/schema';
import { ErreurMetier } from '../common/erreurs';
import type { FiltresTravauxReportes } from './schemas-locales';
import {
  chargerLigneVehicule,
  lireDernierKilometrage,
  listerTravauxReportes,
} from './vehicule-requetes';

/**
 * `montantEstimeCentimes` retiré pour les rôles de `ROLES_SANS_MONTANT` (invariant front n°10) —
 * filtrage SERVEUR, appliqué ici et dans `contexte-atelier` (L1-10), jamais laissé au client.
 *
 * `motifModification` — DÉCISION : jamais filtré par rôle, contrairement à `montantEstimeCentimes`.
 * `ROLES_SANS_MONTANT` (matrice-droits.ts) ne porte que sur les MONTANTS (invariant front n°10) ;
 * rien dans la matrice de droits n'établit de filtrage sur un champ texte de ce module, et
 * `motif_refus` (0021, sur la même table) n'a jamais été soumis à un tel filtrage non plus. Un
 * motif d'abandon peut porter une information commerciale sensible (ex. « parti à la
 * concurrence ») — mais c'est exactement l'information que le réceptionnaire doit relire au
 * retour du véhicule pour ne pas répéter une proposition déjà refusée, et un technicien qui voit
 * déjà la désignation, l'urgence et le statut du travail reporté n'a pas moins besoin de savoir
 * POURQUOI il a été clôturé ou abandonné. Inventer un `ROLES_SANS_MOTIF` sans base dans la
 * matrice de droits existante serait une décision non tranchée par le contrat — signalée en
 * réponse de tâche plutôt qu'inventée en silence.
 */
export function versReponseTravailReporte(
  ligne: LigneVehiculeTravailReporte,
  role: RoleUtilisateur,
): ReponseTravailReporte {
  const base: ReponseTravailReporte = {
    id: ligne.id,
    designation: ligne.designation,
    urgence: ligne.urgence,
    kilometrageAlors: ligne.kmConstat,
    constateLe: ligne.dateConstat,
    securite: ligne.securite,
    statut: ligne.statut,
    ordreReparationOrigineId: ligne.ordreReparationOrigineId,
    ligneOrOrigineId: ligne.ligneOrOrigineId,
    ordreReparationRepriseId: ligne.ordreReparationRepriseId,
    motifModification: ligne.motifModification,
  };
  if (ROLES_SANS_MONTANT.includes(role)) {
    return base;
  }
  return { ...base, montantEstimeCentimes: ligne.montantEstimeCentimes };
}

/* ------------------------------------------------------------------ */
/* Port RM-73 — CÔTÉ FOURNISSEUR (`vehicules`), à consommer par `atelier`                          */
/* ------------------------------------------------------------------ */

/**
 * Entrée du port `CreationTravailReporte` (voir plus bas), tel qu'`atelier/service-ligne-or.ts`
 * (`refuserLignes`, hors périmètre de ce fichier) devra l'appeler pour chaque ligne refusée.
 *
 * Champs volontairement MINIMAUX : tout ce que `vehicules` peut déduire lui-même (kilométrage au
 * constat, date du constat, statut initial `ouvert`) reste calculé ICI, dans
 * `ServiceVehiculeTravailReporte.creerDepuisRefus` — `atelier` n'a pas à connaître le dernier
 * relevé kilométrique du véhicule, c'est un détail du domaine `vehicules`.
 *
 * AMBIGUÏTÉ RÉSOLUE — `vehicule_travail_reporte.motif_refus` (migrations/0021, `db/schema/atelier/
 * vehicule.ts`) existe désormais : `text` nullable, gardé par une contrainte `CHECK` qui refuse la
 * chaîne vide/blanche (`vehicule_travail_reporte_motif_refus_non_vide_chk`). Choix de table
 * ARBITRÉ, PAS À ROUVRIR : le motif vit sur le travail reporté, pas sur `ligne_or` — c'est LE
 * travail reporté qu'on consulte au retour du véhicule, souvent après que l'OR d'origine a été
 * facturé et archivé ; le motif doit vivre là où on le relit. `creerDepuisRefus` PERSISTE
 * désormais `motifRefus`, normalisé pour ne jamais heurter la contrainte `CHECK` (voir le corps de
 * la méthode) — `service-ligne-or.ts::refuserLignes` transmet `entree.motif ?? null`.
 *
 * DETTE COMBLÉE (migrations/0033) : `vehicule_travail_reporte` est désormais auditée
 * (`vehicule_travail_reporte_audit`, `entite_auditee` gagne la valeur du même nom) — toute
 * création/modification/transition/suppression est tracée dans `audit_atelier`, qui/quand/
 * avant/après. `ServiceVehiculeTravailReporte.modifier` écrit en outre désormais `entree.motif`
 * dans une colonne dédiée, `motif_modification` (0033) — DISTINCTE de `motif_refus` ci-dessus :
 * l'un porte la raison du refus INITIAL au devis, l'autre celle d'une correction ou d'un abandon
 * ULTÉRIEUR. Ce défaut (`entree.motif` accepté, validé, jamais écrit) était mesuré en exécution ;
 * voir le corps de `modifier` pour la normalisation défensive appliquée avant écriture.
 */
export interface EntreeCreationTravailReporteDepuisRefus {
  readonly vehiculeId: string;
  readonly ordreReparationId: string;
  readonly ligneOrId: string;
  readonly designation: string;
  /**
   * INTERPRÉTATION RETENUE : `urgence` est nullable sur `ReponseLigneOr` (une ligne saisie sans
   * urgence explicite) mais NOT NULL sur `vehicule_travail_reporte` — faute d'urgence connue,
   * `creerDepuisRefus` retient `'a_faire'` (ni `'urgent'` ni `'a_surveiller'`, les deux extrêmes de
   * `URGENCES_TRAVAIL`) plutôt que d'inventer une urgence. À confirmer avec expert-metier.
   */
  readonly urgence: UrgenceTravail | null;
  readonly montantEstimeCentimes: number | null;
  readonly securite: boolean;
  readonly motifRefus: string | null;
}

/**
 * Port à déclarer par le CONSOMMATEUR (`atelier`), doctrine `atelier.jetons.ts` (« le port est
 * déclaré par le CONSOMMATEUR, jamais par le fournisseur ») — reproduite ici uniquement parce
 * qu'`atelier/` est hors périmètre de cet agent. Voir la réponse de tâche pour le câblage exact
 * attendu côté `atelier` : nom du jeton (`JETON_CREATION_TRAVAIL_REPORTE`), et où
 * `AtelierModule` doit lier ce jeton à `ServiceVehiculeTravailReporte` (`useExisting`, après avoir
 * importé `VehiculesModule` — `ServiceVehiculeTravailReporte` est désormais EXPORTÉ par
 * `vehicules.module.ts` précisément pour cet usage).
 *
 * `tx` en premier paramètre, comme `LecturePointage.pointagesOuvertsPourOr` : la création du
 * travail reporté doit vivre DANS LA MÊME TRANSACTION que le passage de la ligne à `refusee` —
 * sinon un refus pourrait s'écrire sans que le travail reporté associé ne s'écrive (ou l'inverse).
 */
export interface CreationTravailReporte {
  creerDepuisRefus(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: EntreeCreationTravailReporteDepuisRefus,
    maintenant: Date,
  ): Promise<void>;
}

/** Travaux reportés (RM-73) — MATÉRIALISÉS, éditables, jamais une vue calculée sur `ligne_or`. */
@Injectable()
export class ServiceVehiculeTravailReporte implements CreationTravailReporte {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async lister(
    ctx: ContexteTenant,
    vehiculeId: string,
    filtres: FiltresTravauxReportes,
    role: RoleUtilisateur,
  ): Promise<readonly ReponseTravailReporte[]> {
    return this.acces.enTenant(ctx, async (tx) => {
      await chargerLigneVehicule(tx, ctx, vehiculeId);
      let lignes = await listerTravauxReportes(tx, ctx, vehiculeId);

      if (filtres.statut && filtres.statut.length > 0) {
        const statuts = filtres.statut;
        lignes = lignes.filter((ligne) => statuts.includes(ligne.statut));
      }
      if (filtres.urgence && filtres.urgence.length > 0) {
        const urgences = filtres.urgence;
        lignes = lignes.filter((ligne) => urgences.includes(ligne.urgence));
      }
      if (filtres.tri === 'constateLe:asc') {
        lignes = [...lignes].sort((a, b) => a.dateConstat.localeCompare(b.dateConstat));
      }

      return lignes.map((ligne) => versReponseTravailReporte(ligne, role));
    });
  }

  async modifier(
    ctx: ContexteTenant,
    vehiculeId: string,
    travailId: string,
    entree: EntreeModificationTravailReporte,
    role: RoleUtilisateur,
  ): Promise<ReponseTravailReporte> {
    return this.acces.enTenant(ctx, async (tx) => {
      const lignes = await tx
        .select()
        .from(vehiculeTravailReporte)
        .where(
          and(
            eq(vehiculeTravailReporte.tenantId, ctx.tenantId),
            eq(vehiculeTravailReporte.vehiculeId, vehiculeId),
            eq(vehiculeTravailReporte.id, travailId),
          ),
        )
        .limit(1);
      if (!lignes[0]) {
        throw new ErreurMetier('RESSOURCE_INTROUVABLE', 'Travail reporté introuvable.');
      }

      const misesAJour = await tx
        .update(vehiculeTravailReporte)
        .set({
          designation: entree.designation,
          urgence: entree.urgence,
          montantEstimeCentimes: entree.montantEstimeCentimes,
          statut: entree.statut,
          // CORRECTIF (migrations/0033) : `entree.motif` (schemaModificationTravailReporte,
          // schemaMotif) était accepté et validé mais jamais écrit — perte silencieuse d'une raison
          // de correction/abandon saisie par le réceptionnaire. Écrit ici dans `motif_modification`
          // (0033), colonne DISTINCTE de `motif_refus` (0021, motif du refus INITIAL au devis, un
          // autre moment, potentiellement un autre acteur — voir le commentaire de tête de 0033,
          // arbitrage à ne pas rouvrir).
          //
          // `entree.motif` reste `undefined` quand aucun motif n'est fourni dans ce PATCH (champ
          // optionnel, même sémantique de mise à jour PARTIELLE que `designation`/`urgence`/
          // `montantEstimeCentimes`/`statut` ci-dessus) : dans ce cas la clé garde la valeur
          // `undefined`, que `mapUpdateSet` (drizzle-orm/utils.ts) FILTRE avant de construire le
          // `SET` — la colonne n'est PAS touchée, le motif déjà enregistré reste intact. Une
          // écriture inconditionnelle en `null` ici effacerait silencieusement un motif précédent à
          // chaque correction ultérieure qui n'en fournit pas un nouveau (ex. l'action groupée
          // "reprendre" du panneau front, qui n'envoie que `{ statut: 'repris' }`).
          //
          // NORMALISATION DÉFENSIVE quand `entree.motif` EST fourni — même doctrine que
          // `creerDepuisRefus` pour `motifRefus` (`entree.motifRefus?.trim() || null`) : `schemaMotif`
          // trim déjà et impose `min(3)`, donc `.trim() || null` ne devrait jamais emprunter la
          // branche `null` en pratique — mais cette écriture ne fait pas confiance à l'appelant sur
          // un simple "ne devrait jamais" : la garde est reposée ICI, à la frontière réelle avec
          // `vehicule_travail_reporte_motif_modification_non_vide_chk` (0033).
          motifModification: entree.motif === undefined ? undefined : entree.motif.trim() || null,
        })
        .where(
          and(
            eq(vehiculeTravailReporte.tenantId, ctx.tenantId),
            eq(vehiculeTravailReporte.id, travailId),
          ),
        )
        .returning();
      const mise = misesAJour[0];
      if (!mise) {
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          'La modification du travail reporté n’a rendu aucune ligne.',
        );
      }
      return versReponseTravailReporte(mise, role);
    });
  }

  /**
   * Port `CreationTravailReporte` (RM-73) — appelée par `atelier` DANS la transaction qui refuse la
   * ligne d'origine, jamais dans une transaction séparée (voir le commentaire de l'interface).
   *
   * `tx` fourni par l'appelant : PAS de `this.acces.enTenant(...)` ici, à la différence de
   * `lister`/`modifier` — ouvrir une deuxième transaction romprait l'atomicité avec le refus de
   * ligne qui déclenche cet appel.
   *
   * IDEMPOTENT par construction légère : si un travail reporté `ouvert` existe déjà pour cette
   * `ligneOrOrigineId` (rejeu d'un appel — `POST .../refuser-lignes` ne porte pas d'Idempotency-Key
   * côté atelier, hors périmètre de ce fichier), l'insertion est simplement SAUTÉE plutôt que de
   * dupliquer le travail reporté. Défense en profondeur, pas un substitut à une vraie idempotence
   * côté atelier si le contrat l'exige un jour.
   */
  async creerDepuisRefus(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entree: EntreeCreationTravailReporteDepuisRefus,
    maintenant: Date,
  ): Promise<void> {
    const existants = await tx
      .select({ id: vehiculeTravailReporte.id })
      .from(vehiculeTravailReporte)
      .where(
        and(
          eq(vehiculeTravailReporte.tenantId, ctx.tenantId),
          eq(vehiculeTravailReporte.ligneOrOrigineId, entree.ligneOrId),
          eq(vehiculeTravailReporte.statut, 'ouvert'),
        ),
      )
      .limit(1);
    if (existants[0]) {
      return;
    }

    const dernierKm = await lireDernierKilometrage(tx, ctx, entree.vehiculeId);

    await tx.insert(vehiculeTravailReporte).values({
      tenantId: ctx.tenantId,
      vehiculeId: entree.vehiculeId,
      designation: entree.designation,
      // INTERPRÉTATION RETENUE, voir le commentaire du champ sur `EntreeCreationTravailReporteDepuisRefus.urgence`.
      urgence: entree.urgence ?? 'a_faire',
      montantEstimeCentimes: entree.montantEstimeCentimes,
      kmConstat: dernierKm?.valeurKm ?? null,
      dateConstat: jourIso(maintenant),
      ordreReparationOrigineId: entree.ordreReparationId,
      ligneOrOrigineId: entree.ligneOrId,
      // NORMALISATION DÉFENSIVE : `vehicule_travail_reporte_motif_refus_non_vide_chk` (migrations/0021)
      // refuse une chaîne vide ou blanche — une saisie ' ' insérée telle quelle ferait échouer TOUTE
      // l'action groupée `refuser-lignes` côté atelier pour une raison illisible au comptoir. `schemaMotif`
      // (côté `atelier`, `EntreeRefusLignes.motif`) trim déjà et impose `min(3)`, donc ce cas ne devrait
      // jamais survenir en pratique — mais ce port ne fait pas confiance à l'appelant sur un simple
      // "ne devrait jamais" : la garde est reposée ICI, à la frontière réelle avec la contrainte SQL.
      motifRefus: entree.motifRefus?.trim() || null,
      securite: entree.securite,
      statut: 'ouvert',
    });
  }
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
