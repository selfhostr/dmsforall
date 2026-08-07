import {
  DEVISES_FACTURATION,
  type DeviseFacturation,
  type IssueAvanceClient,
  type ReponseImputationPaiement,
  type ReponsePaiement,
} from '@dfa/shared';

import { enDate } from '../../db';
import type { LigneImputationPaiement, LignePaiement } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';

import type { ResumeUtilisateurPaiement } from './paiement-requetes';

function estDeviseFacturation(valeur: string): valeur is DeviseFacturation {
  return (DEVISES_FACTURATION as readonly string[]).includes(valeur);
}

/**
 * `paiement.devise` est un `char(3)` en base (`schema/facturation/paiement.ts`), contraint par
 * `paiement_devise_chk check (devise in ('CHF', 'EUR'))` (migration 0010) mais PAS par un enum
 * Postgres — Drizzle ne dérive pas de type littéral depuis une contrainte `CHECK`, donc
 * `LignePaiement['devise']` reste `string` côté TypeScript alors que la base garantit CHF/EUR.
 * Le contrat `ReponsePaiement.devise` (RF-58/MD-58, QR-facture) n'accepte que CHF/EUR : une valeur
 * hors de cet ensemble ici trahirait une contrainte contournée en base ou une régression — dans
 * les deux cas une anomalie à faire remonter bruyamment, jamais une valeur acceptée en silence.
 *
 * Signalé pour le rapport de livraison, PAS corrigé ici (`apps/api/src/db/` a un autre
 * propriétaire) : la correction idéale est côté typage Drizzle, en donnant à la colonne le type
 * littéral que la contrainte garantit déjà —
 * `char('devise', { length: 3 }).notNull().default('CHF').$type<DeviseFacturation>()`
 * dans `schema/facturation/paiement.ts` (et probablement `document-vente.ts`, même colonne, même
 * contrainte). Une fois ce typage posé côté schéma, cette garde devient redondante mais reste une
 * défense en profondeur raisonnable sur une donnée qui alimente un QR-facture.
 *
 * MISE À JOUR : `paiement.devise` porte désormais `.$type<DeviseFacturation>()` côté Drizzle
 * (`schema/facturation/paiement.ts`) — la correction ci-dessus est faite. Cette garde reste donc
 * la SEULE protection sur les lectures SQL brutes (`tx.execute<LignePaiementBrute>()` dans
 * `service-paiement.ts::ligneDepuisBrute`), qui contournent le query-builder Drizzle typé et
 * reçoivent `devise` en `string` non typé du pilote `pg` — exportée pour être réutilisée là plutôt
 * que dupliquée. Elle protège aussi contre l'état réel de la base sur `document_vente.devise`
 * (contrainte `~ '^[A-Z]{3}$'`, forme seulement — n'importe quel ISO 3 lettres passe), si ce
 * module en vient un jour à lire cette colonne.
 */
export function deviseFacturationDepuisBase(valeur: string, contexte: string): DeviseFacturation {
  if (!estDeviseFacturation(valeur)) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Devise inattendue en base pour ${contexte} : "${valeur}" — seules CHF et EUR sont admises (paiement_devise_chk).`,
    );
  }
  return valeur;
}

/**
 * `montantNonImputeCentimes` — verbatim du contrat gelé (`paiement.ts`, `ReponsePaiement`) :
 * `montant − Σ imputations de nature 'reglement'`. Note pour le rapport de livraison : cette
 * formule N'EXCLUT QUE `reglement` — une avance « abandonnée » via `POST /paiements/{id}/abandonner`
 * (nature `compensation`) ne réduit donc PAS cette valeur ni `issuesDisponibles`. Comportement
 * appliqué à la lettre du contrat gelé, signalé comme lacune probable plutôt que corrigé
 * silencieusement (le corriger reviendrait à dévier du contrat sans arbitrage).
 *
 * BARRIÈRE 2/3 (issue #9, GitHub — « un paiement négatif crédite une facture ») : un paiement de
 * montant NÉGATIF OU NUL n'a, par construction, jamais rien de « non imputé » à offrir.
 *  - Négatif = remboursement/contre-passation (`MD-57`, `contrePasseId` non nul, RF-79 issue 1) —
 *    de l'argent qui est SORTI, jamais une avance disponible à lettrer sur un document. C'est
 *    exactement le cas que `versPaiement`/`GET /paiements?nonImputeUniquement=true` doivent JAMAIS
 *    présenter comme un reliquat à affecter.
 *  - Nul est défensivement couvert ici aussi (`ServicePaiement.creer` le refuse déjà à la source,
 *    barrière 1/3 — `service-paiement.ts`), sans qu'aucune imputation ne puisse exister dessus.
 * AVANT correction, cette fonction prenait la valeur ABSOLUE du montant : un remboursement de
 * -500 ct ressortait comme « 500 ct non imputés, disponibles », `issuesDisponibles` proposait même
 * de le rembourser à nouveau — et RIEN n'empêchait ensuite une imputation `reglement` de +500 ct de
 * s'y accrocher, créditant une vraie facture avec de l'argent qui, comptablement, était sorti. C'est
 * le défaut prouvé par l'issue.
 */
export function calculerMontantNonImputeCentimes(
  montantCentimes: bigint,
  imputations: readonly LigneImputationPaiement[],
): bigint {
  if (montantCentimes <= 0n) return 0n;

  const sommeReglement = imputations
    .filter((i) => i.nature === 'reglement')
    .reduce((acc, i) => acc + i.montantCentimes, 0n);
  const nonImpute = montantCentimes - sommeReglement;
  return nonImpute > 0n ? nonImpute : 0n;
}

/** RF-79 : trois issues, jamais automatiques — vide dès que le paiement est intégralement imputé. */
export function calculerIssuesDisponibles(
  montantNonImputeCentimes: bigint,
): readonly IssueAvanceClient[] {
  return montantNonImputeCentimes > 0n ? ['remboursement', 'imputation_future', 'abandon'] : [];
}

export function versImputation(
  ligne: LigneImputationPaiement,
  imputePar: ResumeUtilisateurPaiement | null,
): ReponseImputationPaiement {
  return {
    id: ligne.id,
    paiementId: ligne.paiementId,
    documentId: ligne.documentId,
    montantCentimes: Number(ligne.montantCentimes),
    nature: ligne.nature,
    imputeLe: enDate(ligne.imputeLe).toISOString(),
    imputePar,
  };
}

export function versPaiement(
  ligne: LignePaiement,
  imputations: readonly LigneImputationPaiement[],
  resumes: ReadonlyMap<string, ResumeUtilisateurPaiement>,
): ReponsePaiement {
  const montantNonImpute = calculerMontantNonImputeCentimes(ligne.montantCentimes, imputations);

  return {
    id: ligne.id,
    siteId: ligne.siteId,
    // Colonne `date` Drizzle sans `mode` explicite : rendue en chaîne 'AAAA-MM-JJ' par défaut,
    // déjà au format `schemaDateJour` — pas de `enDate()` ici (réservé aux `timestamptz`).
    dateValeur: ligne.dateValeur,
    moyen: ligne.moyen,
    montantCentimes: Number(ligne.montantCentimes),
    devise: deviseFacturationDepuisBase(ligne.devise, `paiement ${ligne.id}`),
    payeurClientId: ligne.payeurClientId,
    payeurLibelle: ligne.payeurLibelle,
    referenceQr: ligne.referenceQr,
    identifiantTransactionBanque: ligne.identifiantTransactionBanque,
    source: ligne.source,
    contrePasseId: ligne.contrePasseId,
    imputations: imputations.map((i) =>
      versImputation(i, i.imputeParId ? (resumes.get(i.imputeParId) ?? null) : null),
    ),
    montantNonImputeCentimes: Number(montantNonImpute),
    issuesDisponibles: calculerIssuesDisponibles(montantNonImpute),
    creeLe: enDate(ligne.creeLe).toISOString(),
    creePar: ligne.creeParId ? (resumes.get(ligne.creeParId) ?? null) : null,
  };
}
