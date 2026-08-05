import { and, eq } from 'drizzle-orm';
import type {
  EntreeCreationImputation,
  NatureImputation,
  StatutReglementDocument,
} from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { ErreurMetier } from '../../common/erreurs';
import { remonterCausePg } from '../../common/erreurs-pg/remonter-cause-pg';
import {
  documentVente,
  imputationPaiement,
  type LigneDocumentVente,
  type LigneImputationPaiement,
  type LignePaiement,
} from '../../db/schema';

import { verifierArrondiEspeces } from './arrondi-especes';
import { chargerArrondiEspecesActif, chargerDocumentPourEcriture } from './paiement-requetes';

/**
 * Natures d'imputation acceptées par les endpoints GÉNÉRIQUES de lettrage (`POST /paiements` en
 * ligne, `POST /paiements/{id}/imputations`) — PAS les cinq de `NATURES_IMPUTATION` en entier.
 *
 * `escompte` et `perte` sont des DÉCISIONS de comptable sur un document précis, avec correction de
 * TVA proportionnelle (`MD-71`/`MD-72`) — elles vivent derrière leurs propres endpoints dédiés
 * (`POST /documents-vente/{id}/escompte`, `POST /documents-vente/{id}/marquer-irrecouvrable`,
 * `packages/shared/src/contrats/facturation/paiement.ts::schemaAccorderEscompte` /
 * `schemaMarquerIrrecouvrable`) qui ne sont PAS dans le périmètre `facturation/paiements/` de cet
 * agent (périmètre `facturation/documents/`) — voir le rapport de livraison. `compensation` a son
 * propre endpoint dédié ici même (`POST /paiements/{id}/abandonner`, RF-79 issue 3) : l'exposer
 * AUSSI via le lettrage générique permettrait de contourner l'exigence de motif et le choix
 * explicite d'un document de régularisation qu'`abandonner` impose. Signalé, pas improvisé.
 */
const NATURES_LETTRAGE_GENERIQUE: ReadonlySet<NatureImputation> = new Set(['reglement', 'arrondi']);

/** `document_vente.statut_reglement` (MD-16, MD-53) — dérivé et maintenu par LE SERVICE (pas par
 *  trigger, voir le commentaire de `chargerDocumentPourEcriture`). `trop_percu`/`irrecouvrable` ne
 *  sont jamais produits par ce module : le premier est structurellement inatteignable tant que
 *  MD-51.a (Σ imputations ≤ total) est respecté ; le second appartient à l'action dédiée
 *  `marquer-irrecouvrable`, hors périmètre. */
function calculerStatutReglement(
  montantRegleCentimes: bigint,
  totalDocumentCentimes: bigint,
): StatutReglementDocument {
  if (montantRegleCentimes <= 0n) return 'non_regle';
  if (montantRegleCentimes >= totalDocumentCentimes) return 'regle';
  return 'partiel';
}

/**
 * Recalcule `montant_regle_centimes`/`solde_centimes`/`statut_reglement` d'un document APRÈS
 * l'insertion d'imputations qui le concernent — MD-53. `document` doit avoir été chargé `for
 * update` par l'appelant (verrou tenu pour toute la transaction) : cette fonction lit sa valeur en
 * mémoire plutôt que de relire la base, ce qui est sûr précisément PARCE QUE ce verrou est tenu
 * (aucune autre transaction n'a pu le modifier entre-temps).
 */
export async function recalculerDocumentApresImputation(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  document: LigneDocumentVente,
  deltaCentimes: bigint,
): Promise<void> {
  const totalDocument =
    document.totalTtcCentimes < 0n ? -document.totalTtcCentimes : document.totalTtcCentimes;
  const nouveauMontantRegle = document.montantRegleCentimes + deltaCentimes;
  const nouveauSolde = totalDocument - nouveauMontantRegle;

  await tx
    .update(documentVente)
    .set({
      montantRegleCentimes: nouveauMontantRegle,
      soldeCentimes: nouveauSolde > 0n ? nouveauSolde : 0n,
      statutReglement: calculerStatutReglement(nouveauMontantRegle, totalDocument),
    })
    .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, document.id)));
}

/** `ZDFA4` = SQLSTATE personnalisé levé par le trigger `imputation_paiement_verifier_invariants`
 *  (0010_facturation.sql §11, MD-51) quand une imputation ferait dépasser le total du document.
 *  Drizzle enveloppe systématiquement l'erreur `pg` brute dans une `DrizzleQueryError` qui ne porte
 *  `code` que sous `.cause` (jamais en surface) — `remonterCausePg` déballe cette chaîne avant
 *  comparaison. Voir `common/erreurs-pg/remonter-cause-pg.ts` pour le détail du défaut corrigé :
 *  sans ce déballage, ce garde-fou de dernier recours sur l'argent (MD-51) ne se déclenchait
 *  JAMAIS et une sur-imputation fuyait en 500 `ERREUR_INTERNE` au lieu du 409
 *  `IMPUTATION_MONTANT_EXCEDENTAIRE` écrit juste en dessous. */
export function estErreurInvariantImputation(erreur: unknown): boolean {
  return remonterCausePg(erreur)?.code === 'ZDFA4';
}

/**
 * Défaut corrigé (signalé par un agent front qui n'avait pas le droit d'écrire dans
 * `facturation/`, 2026-08-05) : RIEN n'empêchait jusqu'ici d'imputer un paiement sur un document
 * dont la devise diffère — un règlement en CHF sur une facture en EUR s'écrivait avec la même
 * valeur numérique dans la mauvaise devise, une erreur comptable silencieuse. `document_vente` et
 * `paiement` portent chacun leur propre `devise`, bornée à CHF/EUR (`DEVISES_FACTURATION`,
 * migrations 0010/0015) mais jamais comparée entre les deux avant cette fonction.
 *
 * RÈGLE RETENUE (arbitrage de cet agent, à confirmer par expert-api si un tiers en dépend) : la
 * devise du paiement est FOURNIE PAR L'APPELANT (champ `devise` du contrat, déjà obligatoire avec
 * défaut `CHF` pour la compatibilité ascendante — `schemaDeviseFacturation`) et VÉRIFIÉE au moment
 * de l'imputation, jamais devinée depuis le document. Trois options écartées :
 *   - dérivée automatiquement des documents imputés : un paiement peut viser plusieurs documents
 *     dans le même lot (RF-71), potentiellement de devises différentes — aucune valeur unique n'en
 *     sortirait, et écraser silencieusement ce que l'appelant a envoyé serait le même défaut sous
 *     une autre forme (une correction devinée plutôt que vérifiée) ;
 *   - depuis le client payeur ou le tenant : ni l'un ni l'autre ne porte de devise unique — un
 *     client ou un garage suisse facturant en EUR peut très bien avoir des documents dans les deux
 *     devises.
 * Une AVANCE CLIENT (paiement créé sans imputation, RF-65) n'a par construction aucun document à
 * comparer : sa devise reste celle déclarée à la création, non vérifiée tant qu'aucune imputation
 * ne la rattache à un document — le contrôle s'applique alors, via ce même chemin, à la première
 * imputation ou compensation qui la rattache (`ajouterImputation`, `abandonner`).
 */
function verifierCoherenceDevise(
  paiementLigne: Pick<LignePaiement, 'id' | 'devise'>,
  document: Pick<LigneDocumentVente, 'id' | 'devise'>,
): void {
  if (paiementLigne.devise !== document.devise) {
    // `detail` porte le contexte technique, PAS `erreurs` (§3.5 règle 5 du contrat d'erreur : ce
    // champ est réservé à la validation de saisie, jamais à un blocage métier — même patron que
    // `IMPUTATION_MONTANT_EXCEDENTAIRE` un peu plus bas dans ce fichier).
    throw new ErreurMetier(
      'IMPUTATION_DEVISE_INCOHERENTE',
      `Le paiement ${paiementLigne.id} est en ${paiementLigne.devise}, le document ${document.id} ` +
        `en ${document.devise} — imputation refusée (MD-50) : un paiement ne peut pas régler un ` +
        'document dans une autre devise que la sienne.',
      {
        detail: `paiement_id=${paiementLigne.id};paiement_devise=${paiementLigne.devise};document_id=${document.id};document_devise=${document.devise}`,
      },
    );
  }
}

/**
 * Applique un lot d'imputations `reglement`/`arrondi` sur UN OU PLUSIEURS documents (RF-71 : un
 * paiement peut se répartir sur plusieurs factures), dans la MÊME transaction que la création du
 * paiement ou l'ajout d'imputation. Groupe par document : chaque document n'est chargé et
 * recalculé qu'une fois, même si le lot lui soumet à la fois une ligne `reglement` et une ligne
 * `arrondi` (le cas courant de la clôture en espèces, CF-05).
 *
 * Lettrage EXPLICITE (jamais silencieux, consigne de la tâche) : chaque `documentId` vient du
 * CORPS de la requête, jamais deviné — aucune règle d'auto-imputation « la plus ancienne facture
 * d'abord » n'existe dans ce module.
 */
export async function appliquerImputationsLettrage(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  paiementLigne: LignePaiement,
  imputations: readonly EntreeCreationImputation[],
): Promise<readonly LigneImputationPaiement[]> {
  for (const imp of imputations) {
    if (!NATURES_LETTRAGE_GENERIQUE.has(imp.nature)) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        `Nature d'imputation "${imp.nature}" non autorisée sur ce lettrage générique — réservée à une action dédiée (escompte, irrécouvrable, abandon d'avance).`,
        {
          erreurs: [
            {
              champ: 'nature',
              code: 'nature_non_autorisee',
              message: 'reglement ou arrondi uniquement.',
            },
          ],
        },
      );
    }
    if (imp.montantCentimes === 0) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        "Le montant d'une imputation ne peut pas être nul.",
        {
          erreurs: [
            { champ: 'montantCentimes', code: 'montant_nul', message: 'Montant non nul requis.' },
          ],
        },
      );
    }
  }

  const parDocument = new Map<string, EntreeCreationImputation[]>();
  for (const imp of imputations) {
    const groupe = parDocument.get(imp.documentId) ?? [];
    groupe.push(imp);
    parDocument.set(imp.documentId, groupe);
  }

  let arrondiEspecesActif: boolean | null = null;
  const resultat: LigneImputationPaiement[] = [];

  for (const [documentId, groupe] of parDocument) {
    const document = await chargerDocumentPourEcriture(tx, ctx, documentId);
    verifierCoherenceDevise(paiementLigne, document);
    const totalDocument =
      document.totalTtcCentimes < 0n ? -document.totalTtcCentimes : document.totalTtcCentimes;
    const restantAvant = totalDocument - document.montantRegleCentimes;

    const reglements = groupe.filter((i) => i.nature === 'reglement');
    const arrondis = groupe.filter((i) => i.nature === 'arrondi');

    if (arrondis.length > 1) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        `Un seul ajustement d'arrondi par document et par paiement (RF-50) — document ${documentId}.`,
      );
    }

    const sommeReglement = reglements.reduce((acc, i) => acc + BigInt(i.montantCentimes), 0n);
    if (sommeReglement > restantAvant) {
      throw new ErreurMetier(
        'IMPUTATION_MONTANT_EXCEDENTAIRE',
        `La somme des imputations dépasse le solde restant du document ${documentId} (MD-51.a).`,
        {
          detail: `document_id=${documentId};restant=${restantAvant.toString()};demande=${sommeReglement.toString()}`,
        },
      );
    }

    const arrondi = arrondis[0];
    if (arrondi) {
      arrondiEspecesActif ??= await chargerArrondiEspecesActif(tx, ctx);
      verifierArrondiEspeces({
        moyenPaiement: paiementLigne.moyen,
        arrondiEspecesActif,
        totalDocumentCentimes: totalDocument,
        montantRegleAvantCentimes: document.montantRegleCentimes,
        sommeReglementLotCentimes: sommeReglement,
        arrondiCentimes: BigInt(arrondi.montantCentimes),
      });
    }

    try {
      for (const imp of groupe) {
        const [ligne] = await tx
          .insert(imputationPaiement)
          .values({
            tenantId: ctx.tenantId,
            paiementId: paiementLigne.id,
            documentId,
            montantCentimes: BigInt(imp.montantCentimes),
            nature: imp.nature,
            imputeParId: ctx.utilisateurId,
          })
          .returning();
        if (!ligne)
          throw new ErreurMetier('ERREUR_INTERNE', "Échec de l'écriture d'une imputation.");
        resultat.push(ligne);
      }
    } catch (erreur) {
      // Filet de sécurité : le pré-contrôle ci-dessus rend ce cas normalement inatteignable (le
      // document est verrouillé `for update` depuis `chargerDocumentPourEcriture`), mais le trigger
      // `imputation_paiement_verifier_invariants` (0010_facturation.sql §11) reste l'AUTORITÉ finale
      // — un ZDFA4 qui passerait malgré tout ne doit jamais fuiter en 500 brut.
      if (estErreurInvariantImputation(erreur)) {
        throw new ErreurMetier(
          'IMPUTATION_MONTANT_EXCEDENTAIRE',
          'Invariant de lettrage violé (MD-51).',
          {
            detail: erreur instanceof Error ? erreur.message : undefined,
          },
        );
      }
      throw erreur;
    }

    const montantTotalGroupe = sommeReglement + (arrondi ? BigInt(arrondi.montantCentimes) : 0n);
    await recalculerDocumentApresImputation(tx, ctx, document, montantTotalGroupe);
  }

  return resultat;
}

/**
 * `POST /paiements/{id}/abandonner` (RF-79, issue 3) — imputation de nature `compensation` sur un
 * document de RÉGULARISATION choisi explicitement par l'opérateur, rattachée au paiement d'AVANCE
 * (`paiementLigne`). Chemin séparé de `appliquerImputationsLettrage` : `compensation` n'est jamais
 * acceptée sur le lettrage générique (voir `NATURES_LETTRAGE_GENERIQUE`), et cette action n'a pas
 * la contrainte « doit solder exactement » de l'arrondi — un abandon partiel est légitime.
 */
export async function appliquerCompensationAvance(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  paiementAvance: LignePaiement,
  documentRegularisationId: string,
  montantCentimes: number,
): Promise<LigneImputationPaiement> {
  const document = await chargerDocumentPourEcriture(tx, ctx, documentRegularisationId);
  verifierCoherenceDevise(paiementAvance, document);
  const totalDocument =
    document.totalTtcCentimes < 0n ? -document.totalTtcCentimes : document.totalTtcCentimes;
  const restantAvant = totalDocument - document.montantRegleCentimes;

  if (BigInt(montantCentimes) > restantAvant) {
    throw new ErreurMetier(
      'IMPUTATION_MONTANT_EXCEDENTAIRE',
      `La compensation demandée dépasse le solde restant du document de régularisation ${documentRegularisationId} (MD-51.a).`,
      {
        detail: `document_id=${documentRegularisationId};restant=${restantAvant.toString()};demande=${montantCentimes}`,
      },
    );
  }

  let ligne: LigneImputationPaiement | undefined;
  try {
    [ligne] = await tx
      .insert(imputationPaiement)
      .values({
        tenantId: ctx.tenantId,
        paiementId: paiementAvance.id,
        documentId: documentRegularisationId,
        montantCentimes: BigInt(montantCentimes),
        nature: 'compensation',
        imputeParId: ctx.utilisateurId,
      })
      .returning();
  } catch (erreur) {
    if (estErreurInvariantImputation(erreur)) {
      throw new ErreurMetier(
        'IMPUTATION_MONTANT_EXCEDENTAIRE',
        'Invariant de lettrage violé (MD-51).',
        {
          detail: erreur instanceof Error ? erreur.message : undefined,
        },
      );
    }
    throw erreur;
  }
  if (!ligne) throw new ErreurMetier('ERREUR_INTERNE', "Échec de l'écriture de la compensation.");

  await recalculerDocumentApresImputation(tx, ctx, document, BigInt(montantCentimes));

  return ligne;
}
