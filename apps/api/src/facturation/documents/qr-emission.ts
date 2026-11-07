import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DeviseFacturation } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { tenantBlocCreancier } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import type { ServiceCompteurs } from '../../parametrage/compteurs/compteurs.types';
import {
  ErreurQrFacture,
  adresseCreancierDepuisLigne,
  construireReferenceQrr,
  construireReferenceScor,
  encoderChargeUtileQr,
  estQrIban,
  evaluerCompletudeCreancier,
  validerIbanCreancier,
  type AdresseStructuree,
} from '../qr';

/**
 * Recopie du bloc créancier à l'émission d'une FACTURE (RF-54, PF-03, MD-73) — le seul type de
 * document qui « doit être payé » (voir la tâche : devis/bon de commande n'ont jamais besoin d'un
 * bloc créancier ; un avoir crédite le client, il ne se paie pas par QR-facture, donc il n'en
 * porte jamais). `emettre()` (`service-emission.ts`) est le SEUL appelant : ce module ne connaît
 * aucune règle de transition, il fournit deux primitives — valider, puis construire — utilisées
 * dans la même transaction que l'allocation du numéro.
 *
 * `apps/api/src/facturation/qr/` (17 fichiers, livré et testé) fait tout le travail
 * d'arithmétique et de validation de bas niveau ; ce module ne fait QUE la jonction avec
 * `tenant_bloc_creancier` et `document_vente` — il ne réimplémente rien de l'encodeur.
 */

/** `CF-15` : code de série à 2 chiffres de la facture dans la composition de la référence QRR
 *  dédiée. Seul `facture` produit une QR-facture (voir l'en-tête de ce fichier) — aucun autre
 *  code n'est donc nécessaire ici. */
const CODE_SERIE_QR_FACTURE = '10';

/**
 * `MD-75` : la référence QR est allouée sur un compteur DÉDIÉ qui « ne se remet jamais à zéro »,
 * documenté avec la clé `(type_document = 'reference_qr', annee = 0)`. La contrainte réelle en
 * base, `compteur_document_annee_chk check (annee between 2000 and 2100)` (migration 0005, hors
 * du périmètre d'écriture de cette tâche), REJETTE `0`. `2000` — la borne basse admise — sert de
 * partition FIXE, jamais recalculée depuis une date réelle : le compteur reste unique, dédié à
 * cette seule clé, et ne se remet jamais à zéro d'une année sur l'autre — c'est la substance de
 * `MD-75`, seule la valeur littérale de la sentinelle diffère de l'exemple du modèle
 * documentaire (qui écrit `0`). SIGNALÉ à l'équipe base de données/@laupernoe : desserrer
 * `compteur_document_annee_chk` pour admettre `0` rapprocherait le code de la lettre du modèle
 * documentaire, mais n'est pas nécessaire à la correction — une sentinelle fixe et jamais réutilisée
 * satisfait déjà l'invariant (unicité perpétuelle, `MD-76`).
 */
const ANNEE_SENTINELLE_COMPTEUR_REFERENCE_QR = 2000;

export interface BlocCreancierResolu {
  readonly ibanValide: string;
  readonly adresse: AdresseStructuree;
}

/**
 * Charge `tenant_bloc_creancier` et vérifie qu'il permet d'émettre une QR-facture : adresse
 * complète (`CHAMPS_REQUIS_BLOC_CREANCIER`) ET au moins un IBAN (`qr_iban` ou `iban`) dont la clé
 * de contrôle modulo 97 est juste.
 *
 * **Refuse plutôt que d'émettre une facture impayable** (consigne de la tâche) : table absente de
 * ligne, ligne incomplète, ou IBAN dont la clé est fausse produisent tous `QR_CREANCIER_INCOMPLET`
 * — jamais un `500`, jamais un QR bancal. Appelé AVANT l'allocation du numéro (RF-26 : tout ce qui
 * peut échouer s'exécute avant).
 */
export async function resoudreBlocCreancierPourEmission(
  tx: TransactionDfa,
  ctx: ContexteTenant,
): Promise<BlocCreancierResolu> {
  const [ligne] = await tx
    .select()
    .from(tenantBlocCreancier)
    .where(eq(tenantBlocCreancier.tenantId, ctx.tenantId))
    .limit(1);

  const adresse: AdresseStructuree = adresseCreancierDepuisLigne(ligne);
  const completude = evaluerCompletudeCreancier(ligne);
  // QRR si `qr_iban` est renseigné, sinon SCOR via `iban` — décision applicative (migration 0014
  // §arbitrage 2) : le QR-IBAN gouverne quand il existe, l'IBAN ordinaire sert de repli.
  const ibanBrut = ligne?.qrIban || ligne?.iban || null;

  if (!completude.complete || !ibanBrut) {
    const champsManquants = [...completude.champsManquants, ...(ibanBrut ? [] : ['iban'])];
    throw new ErreurMetier(
      'QR_CREANCIER_INCOMPLET',
      'Coordonnées bancaires du garage non renseignées : impossible d’émettre une facture sans ' +
        `bloc créancier complet. Champ(s) manquant(s) dans le paramétrage : ${champsManquants.join(', ')}.`,
      {
        erreurs: champsManquants.map((champ) => ({
          champ: `tenantBlocCreancier.${champ}`,
          code: 'champ_requis',
          message: `« ${champ} » est requis pour émettre une QR-facture (RF-54, PF-03).`,
        })),
      },
    );
  }

  try {
    return { ibanValide: validerIbanCreancier(ibanBrut), adresse };
  } catch (erreur) {
    if (erreur instanceof ErreurQrFacture) {
      // La CHECK de `tenant_bloc_creancier` (migration 0014) vérifie forme/pays/longueur mais PAS
      // la clé modulo 97 (déléguée à l'applicatif, justification dans la migration) : une ligne
      // écrite hors service (script, seed manuel) pourrait donc porter un IBAN dont la clé est
      // fausse. Même code que le reste de cette fonction — c'est la même famille de refus.
      throw new ErreurMetier(
        'QR_CREANCIER_INCOMPLET',
        `IBAN du garage invalide : ${erreur.message}`,
        { detail: erreur.code },
      );
    }
    throw erreur;
  }
}

export interface DebiteurQr {
  readonly nom: string;
  readonly rue: string;
  readonly numero: string | null;
  readonly npa: string;
  readonly localite: string;
  readonly pays: string;
}

export interface BlocQrConstruit {
  readonly qrIban: string;
  readonly creancierNom: string;
  readonly creancierRue: string | null;
  readonly creancierNumero: string | null;
  readonly creancierNpa: string | null;
  readonly creancierLocalite: string | null;
  readonly creancierPays: string;
  readonly typeReferenceQr: 'qrr' | 'scor' | 'non';
  readonly qrReference: string | null;
  readonly qrMontantCentimes: number;
  readonly qrDevise: DeviseFacturation;
  readonly qrDebiteurPresent: boolean;
  readonly qrPayload: string;
  readonly qrPayloadSha256: string;
}

/**
 * Construit la charge utile QR d'une facture et tout ce qui doit être figé avec elle
 * (`creancier_*`, `qr_iban`, `qr_reference`…). Appelé APRÈS l'allocation du numéro (le message non
 * structuré et — pour un IBAN ordinaire — la référence SCOR en dérivent), mais dans la MÊME
 * transaction, comme demandé.
 *
 * @throws ErreurMetier `QR_CREANCIER_INCOMPLET` si l'encodeur refuse malgré la validation
 *         préalable (`resoudreBlocCreancierPourEmission`) — défense en profondeur, ne devrait
 *         jamais survenir en pratique.
 */
export async function construireBlocQrPourEmission(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  compteurs: ServiceCompteurs,
  parametres: {
    readonly creancier: BlocCreancierResolu;
    readonly numero: string;
    readonly exercice: number;
    readonly totalTtcCentimes: number;
    readonly devise: DeviseFacturation;
    readonly debiteur: DebiteurQr | null;
  },
): Promise<BlocQrConstruit> {
  const { creancier, numero, exercice, totalTtcCentimes, devise, debiteur } = parametres;

  const reference = estQrIban(creancier.ibanValide)
    ? construireReferenceQrr(await construireBaseReferenceQrr(tx, ctx, compteurs, exercice))
    : construireReferenceScor(numero.replace(/-/g, ''));

  let resultat;
  try {
    resultat = encoderChargeUtileQr({
      ibanCreancier: creancier.ibanValide,
      creancier: creancier.adresse,
      montantCentimes: totalTtcCentimes,
      devise,
      debiteur,
      reference,
      messageNonStructure: `Facture ${numero}`,
    });
  } catch (erreur) {
    if (erreur instanceof ErreurQrFacture) {
      throw new ErreurMetier(
        'QR_CREANCIER_INCOMPLET',
        `QR-facture impossible à produire (${erreur.code}) : ${erreur.message}`,
        { detail: erreur.code },
      );
    }
    throw erreur;
  }

  return {
    qrIban: creancier.ibanValide,
    creancierNom: creancier.adresse.nom,
    creancierRue: creancier.adresse.rue ?? null,
    creancierNumero: creancier.adresse.numero ?? null,
    creancierNpa: creancier.adresse.npa ?? null,
    creancierLocalite: creancier.adresse.localite ?? null,
    creancierPays: (creancier.adresse.pays ?? 'CH').toUpperCase(),
    typeReferenceQr: resultat.typeReference.toLowerCase() as 'qrr' | 'scor' | 'non',
    qrReference: resultat.reference.length > 0 ? resultat.reference : null,
    qrMontantCentimes: totalTtcCentimes,
    qrDevise: resultat.devise,
    qrDebiteurPresent: resultat.blocDebiteurEmis,
    qrPayload: resultat.payload,
    qrPayloadSha256: createHash('sha256').update(resultat.payload, 'utf8').digest('hex'),
  };
}

async function construireBaseReferenceQrr(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  compteurs: ServiceCompteurs,
  exercice: number,
): Promise<string> {
  const compteurQr = await compteurs.prochainNumero(tx, {
    tenantId: ctx.tenantId,
    typeDocument: 'reference_qr',
    annee: ANNEE_SENTINELLE_COMPTEUR_REFERENCE_QR,
    siteId: null,
  });
  // CF-15 : [10 zéros de remplissage][4 exercice][2 type de série][10 compteur dédié] = 26
  // chiffres, avant chiffre de contrôle — `construireReferenceQrr` complète à gauche si besoin
  // (no-op ici, la base fait déjà 26) et ajoute le 27e chiffre.
  return `0000000000${String(exercice).padStart(4, '0')}${CODE_SERIE_QR_FACTURE}${String(compteurQr).padStart(10, '0')}`;
}
