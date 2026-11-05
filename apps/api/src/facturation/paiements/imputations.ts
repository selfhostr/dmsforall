import { and, eq } from 'drizzle-orm';
import type {
  DetailImputationDeviseIncoherente,
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
 * Formatage suisse d'un montant en centimes : 123456 → "1'234.56" pour la présentation au
 * garagiste dans les messages d'erreur.
 */
function formaterMontantCentimes(centimes: number | bigint): string {
  const num = typeof centimes === 'bigint' ? Number(centimes) : centimes;
  const negatif = num < 0;
  const absolu = Math.abs(num);
  const entiers = Math.floor(absolu / 100);
  const centimesRestants = String(absolu % 100).padStart(2, '0');
  const entiersGroupes = entiers.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${negatif ? '-' : ''}${entiersGroupes}.${centimesRestants}`;
}

/**
 * Natures d'imputation acceptées par les endpoints GÉNÉRIQUES de lettrage (`POST /paiements` en
 * ligne, `POST /paiements/{id}/imputations`) — PAS les cinq de `NATURES_IMPUTATION` en entier.
 *
 * `escompte` et `perte` sont des DÉCISIONS de comptable sur un document précis, avec correction de
 * TVA proportionnelle (`MD-71`/`MD-72`) — elles vivent derrière leurs propres endpoints dédiés
 * (`POST /documents-vente/{id}/escompte`, `POST /documents-vente/{id}/marquer-irrecouvrable`,
 * `packages/shared/src/contrats/facturation/paiement.ts::schemaAccorderEscompte` /
 * `schemaMarquerIrrecouvrable`) qui ne sont PAS dans le périmètre `facturation/paiements/` de cet
 * lot (périmètre `facturation/documents/`) — voir le rapport de livraison. `compensation` a son
 * propre endpoint dédié ici même (`POST /paiements/{id}/abandonner`, RF-79 issue 3) : l'exposer
 * AUSSI via le lettrage générique permettrait de contourner l'exigence de motif et le choix
 * explicite d'un document de régularisation qu'`abandonner` impose. Signalé, pas improvisé.
 */
const NATURES_LETTRAGE_GENERIQUE: ReadonlySet<NatureImputation> = new Set(['reglement', 'arrondi']);

/** `document_vente.statut_reglement` (MD-16, MD-53) — dérivé et maintenu par LE SERVICE (pas par
 *  trigger, voir le commentaire de `chargerDocumentPourEcriture`). `trop_percu`/`irrecouvrable` ne
 *  sont jamais produits par ce module : le premier est structurellement inatteignable tant que
 *  MD-51.a (Σ imputations ≤ total) est respecté ; le second appartient à l'action dédiée
 *  `marquer-irrecouvrable`, hors périmètre.
 *
 *  EXPORTÉE (issue #154) : réutilisée telle quelle par `documents/service-correction.ts` pour
 *  dériver `statut_reglement` de la facture de remplacement après report d'un règlement — même
 *  règle MD-16, un seul endroit qui la calcule. */
export function calculerStatutReglement(
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
 * Défaut corrigé (signalé par un lot front qui n'avait pas le droit d'écrire dans
 * `facturation/`, 2026-08-05) : RIEN n'empêchait jusqu'ici d'imputer un paiement sur un document
 * dont la devise diffère — un règlement en CHF sur une facture en EUR s'écrivait avec la même
 * valeur numérique dans la mauvaise devise, une erreur comptable silencieuse. `document_vente` et
 * `paiement` portent chacun leur propre `devise`, bornée à CHF/EUR (`DEVISES_FACTURATION`,
 * migrations 0010/0015) mais jamais comparée entre les deux avant cette fonction.
 *
 * RÈGLE RETENUE (arbitrage de ce lot, à confirmer par l'équipe API si un tiers en dépend) : la
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
 *
 * `blocages` (issue #15, point 3/3, dernier restant) : même patron que `STOCK_INSUFFISANT`
 * (`pieces/service-mouvement.ts`) et `VEHICULE_PLAQUE_COLLISION` — voir le commentaire de tête de
 * `DetailImputationDeviseIncoherente` (`@dfa/shared`). `champDocumentId` est FOURNI PAR L'APPELANT,
 * jamais deviné ici : le nom du champ fautif diffère selon la route (`'documentId'` pour le
 * lettrage générique, `'documentRegularisationId'` pour l'abandon d'avance), et cette fonction n'a
 * aucun moyen de savoir laquelle des deux l'a appelée.
 */
function verifierCoherenceDevise(
  paiementLigne: Pick<LignePaiement, 'id' | 'devise'>,
  document: Pick<LigneDocumentVente, 'id' | 'devise'>,
  champDocumentId: 'documentId' | 'documentRegularisationId',
): void {
  if (paiementLigne.devise !== document.devise) {
    // `detail` porte le contexte technique, PAS `erreurs` (§3.5 règle 5 du contrat d'erreur : ce
    // champ est réservé à la validation de saisie, jamais à un blocage métier — même patron que
    // `IMPUTATION_MONTANT_EXCEDENTAIRE` un peu plus bas dans ce fichier).
    const message =
      `Le paiement ${paiementLigne.id} est en ${paiementLigne.devise}, le document ${document.id} ` +
      `en ${document.devise} — imputation refusée (MD-50) : un paiement ne peut pas régler un ` +
      'document dans une autre devise que la sienne.';
    throw new ErreurMetier('IMPUTATION_DEVISE_INCOHERENTE', message, {
      detail: `paiement_id=${paiementLigne.id};paiement_devise=${paiementLigne.devise};document_id=${document.id};document_devise=${document.devise}`,
      blocages: [
        {
          type: 'champ',
          id: champDocumentId,
          libelle: message,
          donnees: {
            paiementId: paiementLigne.id,
            paiementDevise: paiementLigne.devise,
            documentId: document.id,
            documentDevise: document.devise,
          } satisfies DetailImputationDeviseIncoherente,
        },
      ],
    });
  }
}

/**
 * BARRIÈRE APPLICATIVE — correctif d'un défaut prouvé de bout en bout par un parcours navigateur
 * (2026-08-10) : une facture créditée en TOTALITÉ par un avoir (`statut = 'annule_par_avoir'`,
 * RF-32) restait imputable pour son montant D'ORIGINE. Séquence reproduite : facture CHF 60.00 →
 * avoir total émis → panneau Encaisser la propose encore « reste dû CHF 60.00 » → `POST /paiements`
 * avec une imputation dessus répondait `201 Created` → la facture portait ensuite
 * `statutReglement: 'partiel'`, un vrai encaissement réconcilié contre une créance déjà éteinte.
 *
 * NI le trigger `imputation_paiement_verifier_invariants` (MD-51, `0010_facturation.sql` §11) NI
 * `statut_reglement` ne fermaient ce trou : le premier ne vérifie QUE des invariants de MONTANT
 * (Σ imputations ≤ total document, Σ imputations 'reglement' ≤ montant paiement), sans jamais lire
 * `statut` ; le second est une colonne DÉLIBÉRÉMENT INDÉPENDANTE de `statut` (RF-68, voir
 * `STATUTS_REGLEMENT_DOCUMENT` dans `packages/shared/src/contrats/facturation/enums.ts`) — RF-32
 * (`service-emission.ts` §6) met à jour `statut`/`annule_par_avoir_id` mais NE TOUCHE JAMAIS
 * `statut_reglement`/`solde_centimes`, qui restent ceux D'AVANT l'annulation. Un document
 * `annule_par_avoir` continue donc de se présenter comme `statut_reglement: 'non_regle'` ou
 * `'partiel'` avec un `solde_centimes` non nul — une créance visuellement ouverte alors qu'elle est
 * comptablement éteinte.
 *
 * DÉCISION DE CONCEPTION (ne PAS re-proposer une correction de `statut_reglement` sur l'avoir/RF-32
 * — déjà tranché ailleurs) : la doctrine du dépôt, déjà appliquée par
 * `relances/regles-planification.ts::factureEligibleRelance` et
 * `facturation/documents/echeance.ts::calculerRetardDocument`, est que `statut` et
 * `statut_reglement` ne sont JAMAIS fusionnés — RF-68 l'interdit explicitement, et les deux colonnes
 * ne partagent jamais le même espace d'affichage (voir le commentaire de `STATUTS_REGLEMENT_
 * DOCUMENT`). C'est donc à CHAQUE CONSOMMATEUR de recombiner les deux, jamais à `statut_reglement`
 * de porter l'information d'annulation. Cette barrière applique ICI, au moment où l'ARGENT bouge
 * réellement, exactement le même principe que ces deux lecteurs appliquent déjà à l'affichage.
 *
 * Seul `statut = 'emis'` reste réglable : `brouillon` n'a même pas de total figé opposable
 * (MD-19/20), et tous les autres statuts de la machine à états (MD-17) — `accepte`/`refuse`/
 * `expire`/`remplace`/`transforme`/`annule`/`annule_par_avoir`/`abandonne` — désignent un document
 * qui n'est plus une créance active.
 */
async function verifierDocumentImputable(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  document: Pick<LigneDocumentVente, 'id' | 'numero' | 'statut' | 'annuleParAvoirId'>,
): Promise<void> {
  if (document.statut === 'emis') return;

  const reference = document.numero ?? document.id;

  if (document.statut === 'annule_par_avoir' && document.annuleParAvoirId) {
    const [avoir] = await tx
      .select({ numero: documentVente.numero })
      .from(documentVente)
      .where(
        and(
          eq(documentVente.tenantId, ctx.tenantId),
          eq(documentVente.id, document.annuleParAvoirId),
        ),
      )
      .limit(1);
    throw new ErreurMetier(
      'IMPUTATION_DOCUMENT_NON_REGLABLE',
      `Le document ${reference} a été annulé par l'avoir ${avoir?.numero ?? document.annuleParAvoirId} ` +
        '— sa dette réelle est nulle, aucun paiement ne peut plus lui être imputé.',
      {
        detail: `document_id=${document.id};statut=annule_par_avoir;avoir_id=${document.annuleParAvoirId}`,
      },
    );
  }

  throw new ErreurMetier(
    'IMPUTATION_DOCUMENT_NON_REGLABLE',
    `Le document ${reference} est au statut "${document.statut}" — seul un document émis ("emis") ` +
      'peut recevoir une imputation.',
    {
      detail: `document_id=${document.id};statut=${document.statut}`,
    },
  );
}

/**
 * SECONDE BARRIÈRE, du MÊME défaut applicatif que `verifierDocumentImputable` ci-dessus — trouvée
 * par le test d'intégration écrit pour PROUVER le premier correctif (2026-08-10) : celui-ci filtre
 * sur `statut`, et un avoir ÉMIS porte `statut = 'emis'` comme n'importe quelle facture ouverte — il
 * passait donc la première barrière, et rien d'autre ne s'y opposait. `POST /paiements` avec une
 * imputation `reglement` visant un avoir répondait `201 Created`.
 *
 * TRANCHÉ PAR LA DOCTRINE DU DÉPÔT, PAS PAR PRUDENCE (MD-57, `docs/modele-documentaire-facturation.md`
 * §4.3, table des trois issues d'un trop-perçu) : « Ce qu'on ne fait **jamais** : créer un avoir pour
 * matérialiser un trop-perçu. **Un avoir corrige un document, pas un mouvement d'argent.** » Et MD-51
 * qualifie explicitement `reglement`/`arrondi` (le seul lot accepté par le lettrage générique, voir
 * `NATURES_LETTRAGE_GENERIQUE`) comme les DEUX SEULES natures où de l'argent circule RÉELLEMENT —
 * `escompte`/`perte`/`compensation` sont, à l'inverse, « des écarts qui soldent un document sans
 * qu'aucun argent ne circule ». Imputer un `reglement` sur un avoir revient donc à faire *rentrer*
 * un encaissement contre un document qui, par nature, ne peut que *sortir* de l'argent du garage
 * (`total_ttc_centimes <= 0` par construction, migration 0010 §9) — un contresens comptable que MD-57
 * exclut littéralement, pas une prudence ajoutée ici sans fondement.
 *
 * Un avoir N'EST PAS pour autant totalement fermé aux imputations : MD-57 prévoit exactement UNE
 * issue légitime, « abandon en faveur du garage » — la `compensation` d'une avance client contre un
 * « document de régularisation », qui PEUT être un avoir (nette l'avance déjà détenue contre la dette
 * que l'avoir représente, sans qu'aucun argent ne bouge une seconde fois). C'est PRÉCISÉMENT
 * `appliquerCompensationAvance` (`POST /paiements/{id}/abandonner`, RF-79 issue 3, motif + document
 * de régularisation choisis explicitement par l'opérateur) — cette fonction-ci N'EST DONC PAS
 * appelée depuis `appliquerCompensationAvance` : un avoir doit rester une cible VALIDE pour
 * `compensation`, seulement une cible REFUSÉE pour `reglement`/`arrondi`.
 */
function verifierDocumentPasAvoir(
  document: Pick<LigneDocumentVente, 'id' | 'numero' | 'typeDocument'>,
): void {
  if (document.typeDocument !== 'avoir') return;

  const reference = document.numero ?? document.id;
  throw new ErreurMetier(
    'IMPUTATION_DOCUMENT_NON_REGLABLE',
    `Le document ${reference} est un avoir — une note de crédit, de l'argent que le garage doit au ` +
      "client, pas une créance (MD-57 : « un avoir corrige un document, pas un mouvement d'argent »). " +
      "Aucun encaissement (nature 'reglement'/'arrondi') ne peut lui être imputé. Pour affecter une " +
      'avance client à cet avoir, utiliser POST /paiements/{id}/abandonner (compensation explicite, ' +
      'RF-79).',
    {
      detail: `document_id=${document.id};type_document=avoir`,
    },
  );
}

/**
 * BARRIÈRE 3/3 (issue #9, GitHub — « un paiement négatif crédite une facture ») : dernière ligne de
 * défense APPLICATIVE avant le trigger PostgreSQL `imputation_paiement_verifier_invariants`
 * (MD-51.b, `0010_facturation.sql` §11) — un paiement de montant NÉGATIF OU NUL ne peut RECEVOIR
 * aucune imputation, quelle que soit sa nature.
 *
 * Un paiement négatif est un REMBOURSEMENT/contre-passation (`MD-57`, `contrePasseId`, RF-79
 * issue 1) : une sortie de fonds déjà réglée par sa propre écriture (`ServicePaiement.rembourser`,
 * `service-paiement.ts`), jamais une source à lettrer sur un document — le lettrer reviendrait à
 * créditer une facture avec de l'argent comptablement sorti, exactement le scénario prouvé par
 * l'issue (500 ct imputés sur une facture depuis un paiement de -500 ct).
 *
 * Cette garde comble un trou qui survit même après les barrières 1 et 2 (`service-paiement.ts::creer`,
 * `mappeurs.ts::calculerMontantNonImputeCentimes`) : celles-ci empêchent de CRÉER un paiement
 * négatif par ce chemin, ou de l'AFFICHER comme disponible, mais rien n'empêchait `ajouterImputation`
 * (`POST /paiements/{id}/imputations`) de cibler l'identifiant d'un remboursement déjà existant
 * (créé légitimement par `rembourser()`) et d'y accrocher une imputation `reglement` positive.
 *
 * Le trigger `imputation_paiement_verifier_invariants` — l'AUTORITÉ finale sur MD-51 — NE FERME PAS
 * ce trou lui-même : il compare la somme des imputations `reglement` à `abs(paiement.montant_
 * centimes)`, pas au SIGNE du montant (`0010_facturation.sql` lignes ~1320-1335, hors périmètre
 * `facturation/` de ce lot — signalé, pas corrigé, voir le rapport de livraison). Sans cette
 * garde applicative, une imputation `reglement` de +500 ct passerait donc le trigger contre un
 * paiement de -500 ct (`500 <= abs(-500)`) tout comme elle passait le calcul défectueux de
 * `mappeurs.ts` avant correction — la base n'est le filet que si le filet lui-même n'a pas le même
 * trou, ce qui n'est PAS le cas ici : d'où l'importance de fermer le trou ICI, en amont.
 */
function verifierPaiementImputable(
  paiementLigne: Pick<LignePaiement, 'id' | 'montantCentimes'>,
): void {
  if (paiementLigne.montantCentimes <= 0n) {
    throw new ErreurMetier(
      'IMPUTATION_MONTANT_EXCEDENTAIRE',
      `Le paiement ${paiementLigne.id} a un montant non positif (CHF ${formaterMontantCentimes(paiementLigne.montantCentimes)}) — c'est un remboursement ou une écriture nulle, aucune imputation n'est possible.`,
      {
        detail: `paiement_id=${paiementLigne.id};montant_centimes=${paiementLigne.montantCentimes.toString()}`,
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
  verifierPaiementImputable(paiementLigne);

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
    await verifierDocumentImputable(tx, ctx, document);
    verifierDocumentPasAvoir(document);
    verifierCoherenceDevise(paiementLigne, document, 'documentId');
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
        `La somme des imputations (CHF ${formaterMontantCentimes(sommeReglement)}) dépasse le solde restant du document (CHF ${formaterMontantCentimes(restantAvant)}).`,
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
  verifierPaiementImputable(paiementAvance);

  const document = await chargerDocumentPourEcriture(tx, ctx, documentRegularisationId);
  await verifierDocumentImputable(tx, ctx, document);
  verifierCoherenceDevise(paiementAvance, document, 'documentRegularisationId');
  const totalDocument =
    document.totalTtcCentimes < 0n ? -document.totalTtcCentimes : document.totalTtcCentimes;
  const restantAvant = totalDocument - document.montantRegleCentimes;

  if (BigInt(montantCentimes) > restantAvant) {
    throw new ErreurMetier(
      'IMPUTATION_MONTANT_EXCEDENTAIRE',
      `La compensation demandée (CHF ${formaterMontantCentimes(montantCentimes)}) dépasse le solde restant du document (CHF ${formaterMontantCentimes(restantAvant)}).`,
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
