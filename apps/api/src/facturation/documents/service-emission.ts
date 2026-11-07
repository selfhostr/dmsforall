import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  Avertissement,
  EntreeAnnulerDocument,
  EntreeEmissionDocumentVente,
  EntreeRefuserDocument,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import {
  documentVente,
  documentVenteTva,
  ligneDocument,
  type LigneDocumentVente,
} from '../../db/schema';
import { type Action } from '../../auth/matrice-droits';
import { droitsDuPrincipal } from '../../auth/droits-personne';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { Horloge } from '../../common/horloge/horloge';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../../common/evenements';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../../common/idempotence';
import { JETON_COMPTEURS } from '../../parametrage/compteurs/compteurs.jetons';
import type { ServiceCompteurs } from '../../parametrage/compteurs/compteurs.types';
// Import de CLASSE (jamais `import type`, règle du dépôt — l'injection casse à l'exécution, pas à
// la compilation) : `ServiceVehiculeStock` est exporté par `VentesModule` précisément pour cette
// injection croisée (voir sa docstring, `ventes/service-vehicule-stock.ts::marquerVendu`).
import { ServiceVehiculeStock } from '../../ventes/service-vehicule-stock';

import {
  agregerTvaParTauxRegime,
  calculerLigneDocument,
  calculerTotauxDocument,
  resoudreRemiseGlobaleCentimes,
  ventilerRemiseGlobale,
} from './calcul-document';
import {
  chargerDocumentPourEcriture,
  chargerPlafondAvoirReceptionnaire,
  listerLignesDocumentPourEcriture,
  sommerAvoirsEmisPourFacture,
} from './document-requetes';
import {
  calculerDateEcheance,
  lireDelaiPaiementJoursFige,
  resoudreDelaiPaiementJours,
} from './echeance';
import { traduireErreurDocument } from './erreurs-sql-document';
import { genererNumeroDocument } from './numerotation';
import { construireBlocQrPourEmission, resoudreBlocCreancierPourEmission } from './qr-emission';
import { chargerDelaiPaiementJoursDefautTenant } from './references';
import { adresseDepuisJsonb, ServiceDocumentsVente } from './service-documents';

/**
 * Transitions du document de vente (§7.7-like, `RF-1` → `RF-32`) : émission (le point de
 * non-retour, `RF-10`), et les trois transitions annexes simples (`accepter`, `refuser`,
 * `annuler`). Machine à états EN DONNÉES (`transition_document_autorisee`, migration 0010 §6) —
 * ce service ne réimplémente aucune règle de légalité de transition, il se contente d'écrire le
 * statut et de traduire le `ZDFA1` si la base refuse.
 */
/**
 * Avertissement `FACTURE_SANS_QR` : une facture émise sans bloc QR (bloc créancier incomplet à
 * l'émission). La facture est valide et verrouillée ; seul le bulletin de paiement manque.
 */
export function avertissementsSansQr(documentId: string, sansQr: boolean): Avertissement[] {
  if (!sansQr) return [];
  return [
    {
      code: 'FACTURE_SANS_QR',
      message:
        'Facture émise sans QR-facture : complétez vos coordonnées bancaires (Réglages > Facturation).',
      donnees: { documentId },
    },
  ];
}

@Injectable()
export class ServiceEmissionDocument {
  private readonly journal = new Logger(ServiceEmissionDocument.name);

  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    @Inject(JETON_COMPTEURS) private readonly compteurs: ServiceCompteurs,
    private readonly horloge: Horloge,
    private readonly documents: ServiceDocumentsVente,
    private readonly vehiculeStock: ServiceVehiculeStock,
  ) {}

  /**
   * `POST /documents-vente/{id}/emettre` — `Idempotency-Key` OBLIGATOIRE (`RF-25`). Tout ce qui
   * peut échouer s'exécute AVANT l'allocation du numéro (`RF-26`) : ventilation de la remise
   * globale, recalcul des lignes, agrégation TVA — la ligne de compteur n'est touchée qu'à la toute
   * fin, dans la même transaction que l'écriture du document (un `ROLLBACK` ne consomme donc
   * jamais de numéro, `RF-23`/`RF-24`).
   *
   * Applicable aux QUATRE types de document (`devis`, `bon_commande`, `facture`, `avoir`) — un
   * seul point d'écriture pour `RF-5`/`MD-18`, cohérent avec `schemaEmissionDocumentVente` qui ne
   * distingue pas le type.
   */
  async emettre(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    cleIdempotence: string,
    // Dernier paramètre, valeur par défaut : ajouté sans casser les appels positionnels existants
    // à 4 arguments (`service-emission*.spec.ts`). `confirmations` (seul champ de
    // `schemaEmissionDocumentVente` aujourd'hui) n'est plié QUE dans l'empreinte d'idempotence
    // ci-dessous — aucune condition confirmable n'existe encore pour l'émission
    // (`CODES_CONFIRMATION`, `@dfa/shared`, ne couvre aucun cas applicable à `emettre`) : le champ
    // est accepté par anticipation d'additivité future, exactement comme `schemaActionDemarrer`
    // côté atelier, jamais exploité pour bloquer quoi que ce soit ici.
    entree: EntreeEmissionDocumentVente = {},
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDocumentVente> }
    >
  > {
    const resultat = await this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/documents-vente/:id/emettre',
        cle: cleIdempotence,
        // `...entree` entre dans l'empreinte SHA-256 (`calculerEmpreinte`, `common/idempotence/
        // empreinte.ts`) : un rejeu avec les MÊMES `confirmations` reste un rejeu, un rejeu avec des
        // `confirmations` DIFFÉRENTS sous la même `Idempotency-Key` devient IDEMPOTENCE_CONFLIT.
        corps: { documentId, ...entree },
      },
      async (tx) => {
        const { document, sansQr } = await this.emettreCoeurDetailleTx(
          tx,
          ctx,
          principal,
          documentId,
        );
        return {
          statutHttp: 200,
          corps: { donnees: document, avertissements: avertissementsSansQr(documentId, sansQr) },
        };
      },
    );

    // RV-37/MD-70 : DÉLIBÉRÉMENT après la fin de la transaction ci-dessus, jamais dedans — voir la
    // docstring de `marquerVehiculeVenduSiApplicable` pour le raisonnement complet. Sur un REJEU
    // (`rejoue: true`), `travail` ne s'est pas ré-exécuté : rien de neuf à marquer, et retenter
    // exposerait sans bénéfice le rôle "véhicule déjà vendu" (CONFLIT) au premier rejeu qui suit un
    // marquage réussi — même doctrine que `evenements.publier`, jamais réémis au rejeu.
    if (resultat.rejoue) return resultat;

    const avertissementsVente = await this.marquerVehiculeVenduSiApplicable(
      ctx,
      principal,
      resultat.reponse.corps.donnees,
    );
    if (avertissementsVente.length === 0) return resultat;

    return {
      ...resultat,
      reponse: {
        ...resultat.reponse,
        corps: {
          ...resultat.reponse.corps,
          avertissements: [...resultat.reponse.corps.avertissements, ...avertissementsVente],
        },
      },
    };
  }

  /**
   * Cœur transactionnel de l'émission (`RF-1`→`RF-32`), extrait de `emettre()` (14.08.2026, blocage
   * n°1 « Corriger cette facture ») pour être réutilisé TEL QUEL par `ServiceCorrectionFacture.
   * corriger()` (RF-12→14) : la correction d'une facture émet un avoir PUIS une facture de
   * remplacement DANS LA MÊME TRANSACTION SQL — chacune des deux émissions doit suivre EXACTEMENT ce
   * chemin (numérotation, TVA, échéance, QR, verrouillage, bascule `annule_par_avoir`) plutôt qu'une
   * copie divergente qui dériverait au premier changement de l'un des deux.
   *
   * Ne gère NI l'idempotence NI l'effet de bord `marquerVehiculeVenduSiApplicable` (délibérément
   * hors transaction, voir sa docstring) — c'est la responsabilité de l'appelant :
   * `emettre()` les porte tous les deux pour l'émission directe ; `ServiceCorrectionFacture.
   * corriger()` porte sa PROPRE enveloppe d'idempotence pour l'opération entière (un avoir + une
   * facture ne sont pas rejouables indépendamment) et n'appelle délibérément PAS le marquage vendu
   * pour la facture de remplacement — le véhicule est déjà `vendu` depuis l'émission ORIGINALE, non
   * affectée par une correction de désignation/adresse.
   */
  async emettreCoeurTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
  ): Promise<ReponseDocumentVente> {
    return (await this.emettreCoeurDetailleTx(tx, ctx, principal, documentId)).document;
  }

  /** Comme `emettreCoeurTx`, et dit si une FACTURE vient d'être émise sans bloc QR. Public pour
   *  `facturer-et-encaisser` (même cœur d'émission, enveloppe d'idempotence propre à l'appelant). */
  async emettreCoeurDetailleTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
  ): Promise<{ readonly document: ReponseDocumentVente; readonly sansQr: boolean }> {
    const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
    if (doc.statut !== 'brouillon') {
      throw new ErreurMetier(
        'DOCUMENT_VERROUILLE',
        `Seul un brouillon peut être émis (statut actuel : ${doc.statut}).`,
        {
          blocages: [
            {
              type: 'document_vente',
              id: documentId,
              libelle: doc.numero ?? documentId,
              donnees: { statutActuel: doc.statut },
            },
          ],
          actionsProposees: [{ code: 'RAFRAICHIR' }],
        },
      );
    }

    this.verifierDroitEmission(doc.typeDocument, principal);

    const lignes = await listerLignesDocumentPourEcriture(tx, ctx, documentId);

    // ISSUE #125 (terrain, testeur novice) : un bon de commande sans AUCUNE ligne pouvait être
    // émis — donc verrouillé définitivement (MD-18/20) — à CHF 0.00 sans le moindre contenu
    // commercial, faute d'écran pour ajouter des lignes ET faute de ce garde-fou serveur. Un
    // contrôle purement côté écran se contourne par un appel direct à cet endpoint : posé ICI,
    // avant TOUTE écriture (recalcul de lignes compris, RF-23/24 — un refus ici ne consomme
    // toujours aucun numéro et ne touche jamais `document_vente`), pour les QUATRE types de
    // document (devis/bon_commande/facture/avoir), même doctrine que `verifierDroitEmission`
    // juste au-dessus : ce service ne fait aucune exception de type pour ses gardes d'émission.
    //
    // Code réutilisé : `VALIDATION_ECHOUEE` — même famille que les gardes de type document sur
    // `accepter`/`refuser`/`annuler` plus bas dans ce fichier (une condition d'applicabilité de
    // l'action à l'état COURANT du document, pas une erreur de forme du corps de requête).
    // AUCUN code dédié n'existe pour ce cas dans `CODES_ERREUR` (`@dfa/shared`, contrat gelé,
    // hors périmètre d'écriture de ce lot) — SIGNALÉ au rapport de livraison : un code
    // `DOCUMENT_AUCUNE_LIGNE` dédié (additif, en fin de liste, même patron que
    // `OR_FACTURATION_AUCUNE_LIGNE`) donnerait un bandeau générique plus précis qu'aujourd'hui.
    // En attendant, le message RÉEL est porté par `erreurs[0].message` (rédigé à la main, en
    // français, par ce service) — jamais par le générique `erreurs:codes.VALIDATION_ECHOUEE` :
    // voir `ecrans/facturation/messages-erreur-mutation.ts` côté front, qui affiche CE message
    // précis dès qu'`erreurs[]` porte au moins une entrée, exactement pour ce cas.
    if (lignes.length === 0) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        `Un document sans aucune ligne ne peut pas être émis (document ${documentId}).`,
        {
          erreurs: [
            {
              champ: 'lignes',
              code: 'aucune_ligne',
              message:
                "Ce document n'a aucune ligne : ajoutez au moins une ligne avant de l'émettre.",
            },
          ],
        },
      );
    }

    // 1. MD-59/60 : résout et ventile la remise globale de pied de document sur les lignes,
    // MAINTENANT — jamais avant (le brouillon peut tout contenir, MD-61).
    const sommeBase = lignes.reduce((s, l) => s + l.baseCentimes, 0);
    const remiseGlobaleCentimes = resoudreRemiseGlobaleCentimes(
      doc.remiseGlobaleSaisieCentimes != null ? Number(doc.remiseGlobaleSaisieCentimes) : null,
      doc.remiseGlobalePourmille,
      sommeBase,
    );
    const parts = ventilerRemiseGlobale(
      lignes.map((l) => ({
        id: l.id,
        numeroOrdre: l.numeroOrdre,
        baseCentimes: l.baseCentimes,
      })),
      remiseGlobaleCentimes,
    );

    // 2. Recalcule chaque ligne avec sa part de remise globale, écrit le résultat figé.
    const lignesRecalculees = lignes.map((ligne) => {
      const remiseGlobaleRepartieCentimes = parts.get(ligne.id) ?? 0;
      const montants = calculerLigneDocument({
        prixUnitaireTtcCentimes: ligne.prixUnitaireCentimes,
        quantiteMillieme: ligne.quantiteMillieme,
        remisePourmille: ligne.remisePourmille,
        remiseMontantCentimes: ligne.remiseMontantCentimes,
        remiseGlobaleRepartieCentimes,
        tauxTvaPourmille: ligne.tauxTvaPourmille,
      });
      return { ...ligne, remiseGlobaleRepartieCentimes, ...montants };
    });

    for (const ligne of lignesRecalculees) {
      await tx
        .update(ligneDocument)
        .set({
          remiseGlobaleRepartieCentimes: ligne.remiseGlobaleRepartieCentimes,
          baseCentimes: ligne.baseCentimes,
          htCentimes: ligne.htCentimes,
          tvaCentimes: ligne.tvaCentimes,
          ttcCentimes: ligne.ttcCentimes,
        })
        .where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.id, ligne.id)));
    }

    // 2.5. RF-54/PF-03/MD-73 : bloc créancier — uniquement une FACTURE doit être payée (devis et
    // bon de commande n'exigent jamais de coordonnées bancaires ; un avoir crédite le client, il
    // ne se paie pas par QR-facture, donc n'en porte jamais). Résolu ICI, avant l'allocation du
    // numéro (RF-26).
    //
    // Un bloc créancier incomplet NE BLOQUE PLUS l'émission : un garage neuf n'a pas encore
    // saisi son IBAN, et une facture réglée au comptoir (espèces, carte) n'a besoin d'aucun QR.
    // La facture est émise SANS QR-facture (`qr_*`/`creancier_*` restent NULL, colonnes nullables) ;
    // `emettre()` le signale par l'avertissement `FACTURE_SANS_QR`. La lecture n'écrit rien avant
    // le refus : l'attraper dans la transaction ne la corrompt pas.
    const resolution =
      doc.typeDocument === 'facture'
        ? await this.resoudreBlocCreancierOuNull(tx, ctx)
        : { bloc: null, incomplet: false };
    const blocCreancier = resolution.bloc;

    // 3. MD-44/45 : agrège la TVA par (régime, taux) depuis les lignes — jamais sur le total.
    const ventilation = agregerTvaParTauxRegime(
      lignesRecalculees.map((l) => ({
        regimeTva: l.regimeTva,
        tauxTvaPourmille: l.tauxTvaPourmille,
        htCentimes: l.htCentimes,
        tvaCentimes: l.tvaCentimes,
      })),
    );
    const totaux = calculerTotauxDocument(lignesRecalculees);

    // 3.5. RF-117 : plafond d'émission d'avoir pour `receptionnaire` seul (direction/comptable
    // ne sont jamais bornés). Ne peut être vérifié qu'ICI — le TTC réel n'existe qu'après
    // ventilation de la remise globale et recalcul des lignes (étapes 1-3 ci-dessus) — jamais
    // avant, et jamais après l'allocation du numéro (étape 4) : un refus ici, comme tout ce qui
    // précède, fait échouer la transaction ENTIÈRE (aucune ligne recalculée ni aucun numéro
    // n'est committé, RF-23/24) — même garantie que `verifierDroitEmission` plus haut, seulement
    // décalée dans le temps parce que la donnée qu'elle contrôle n'existe pas encore à ce
    // moment-là. Même patron que `atelier.or.plafond_modifier` (`atelier/service-or.ts`) :
    // vérification conditionnelle, posée dans le service après chargement de la valeur réelle,
    // pas un `@ExigerDroit` statique qui ne pourrait pas connaître le montant.
    if (doc.typeDocument === 'avoir') {
      await this.verifierPlafondAvoirReceptionnaire(
        tx,
        ctx,
        principal,
        doc,
        totaux.totalTtcCentimes,
      );
    }

    // 4. RF-22/RF-23 : le numéro n'est alloué qu'ICI, tout le reste a déjà pu échouer avant.
    const maintenant = this.horloge.maintenant();
    const dateDocumentReference = doc.dateDocument
      ? new Date(`${doc.dateDocument}T00:00:00.000Z`)
      : maintenant;

    // 3.6. RF-04/PF-04/MD-94 : échéance FIGÉE ICI, comme le numéro et le total — le trigger de
    // verrouillage (MD-20) refuse toute modification ultérieure de `date_echeance` dès que
    // `statut` quitte `brouillon`, exactement comme `total_ttc_centimes` ci-dessous. Uniquement
    // pour une FACTURE : un devis/bon de commande n'est jamais « dû », un avoir crédite le
    // client au lieu de se faire payer (aucun des deux n'a de date d'échéance).
    //
    // ISSUE #17 (migration 0046, DÉCISION ARBITRÉE SANS LE MAINTENEUR — voir l'en-tête de la migration
    // et de `echeance.ts` pour la justification complète) : le délai du CLIENT figé à la
    // création du document (`conditionsPaiementFigees`) l'emporte TOUJOURS quand il existe ;
    // c'est SEULEMENT en son absence totale que le défaut du TENANT
    // (`tenant.delai_paiement_jours_defaut`) prend le relais — jamais un `null` qui rendrait
    // la facture inexigible et invisible aux relances automatiques. `chargerDelaiPaiement
    // JoursDefautTenant` n'est appelée QUE dans ce cas résiduel (client sans délai propre),
    // jamais sur le chemin où le client est déjà correctement paramétré : la requête
    // supplémentaire n'est payée que quand elle sert réellement.
    let dateEcheance: string | null = null;
    if (doc.typeDocument === 'facture') {
      const delaiClientFige = lireDelaiPaiementJoursFige(doc.conditionsPaiementFigees);
      const delaiTenantDefaut =
        delaiClientFige === null ? await chargerDelaiPaiementJoursDefautTenant(tx, ctx) : null;
      dateEcheance = calculerDateEcheance(
        doc.dateDocument ?? dateDocumentReference.toISOString().slice(0, 10),
        resoudreDelaiPaiementJours(delaiClientFige, delaiTenantDefaut),
      );
    }

    // 3.7. BUG CORRIGÉ (MD-53, encours clients du tableau de bord) : `solde_centimes` (défaut
    // 0 en base, migration 0010) n'était JAMAIS initialisé à l'émission — seule une imputation
    // ultérieure l'écrivait (`facturation/paiements/imputations.ts::
    // recalculerDocumentApresImputation`). Une facture émise puis JAMAIS payée restait donc à
    // `solde_centimes = 0`, et `tableau-bord/service-tableau-bord-financier.ts` (qui somme
    // `solde_centimes` des factures `emis` pour `encoursClientsCentimes`) sous-évaluait
    // silencieusement l'encours — précisément sur les créances qu'il existe pour signaler.
    // Posé ICI, dans la MÊME écriture que le passage `statut = 'emis'` (même doctrine que
    // `dateEcheance`/les totaux ci-dessus, MD-20 : verrouillé dès que le statut quitte
    // `brouillon`, donc ce doit être maintenant ou jamais dans ce service).
    //
    // MÊME CONVENTION que `recalculerDocumentApresImputation` (`facturation/paiements/
    // imputations.ts`), pour rester cohérent avec la SEULE autre logique qui écrit cette
    // colonne : `totalDocument = abs(totalTtcCentimes)`, `solde = totalDocument -
    // montantRegleCentimes`. À l'émission, `montantRegleCentimes` vaut encore 0 (colonne par
    // défaut, aucune imputation ne peut précéder l'émission — `chargerDocumentPourEcriture`
    // des paiements exige un document déjà `emis`), donc `solde = totalDocument` exactement.
    // `abs()` couvre l'AVOIR (`total_ttc_centimes <= 0` par construction, migration 0010 §9 —
    // même doctrine que `recalculerDocumentApresImputation` et que `RF-117` plus haut dans ce
    // fichier, qui prennent déjà tous deux `abs(totalTtcCentimes)`) : un avoir émis porte donc
    // un solde POSITIF, qui se
    // lit comme « part du crédit encore à rembourser/compenser », jamais un solde négatif —
    // symétrique du solde d'une facture (« part encore due »). Uniquement pour FACTURE/AVOIR :
    // un devis/bon de commande n'est jamais payable (RF-114/MD-50), son solde reste 0 par
    // défaut, sans signification à lui donner ici.
    //
    // RÉTROACTIVITÉ — les factures déjà émises AVANT ce correctif portent `solde_centimes = 0`
    // en base alors qu'elles ne sont pas soldées : NON corrigé par ce changement, qui n'agit
    // qu'au PROCHAIN passage par `emettre()`. `document_vente` est verrouillée par trigger dès
    // que `statut <> 'brouillon'` (MD-20) — mais `solde_centimes`/`statut_reglement`/
    // `montant_regle_centimes` figurent explicitement dans la liste blanche des colonnes qui
    // RESTENT modifiables après émission (`document_vente_verrouiller_apres_emission`,
    // migration 0010 §7.2, citée en tête de ce service) : un rattrapage des lignes historiques
    // est donc un `UPDATE` ordinaire, PAS une migration de schéma — mais c'est un rattrapage de
    // DONNÉES (un script, pas une migration DDL), hors du périmètre de ce correctif de service.
    // Signalé au rapport de livraison pour arbitrage (script de rattrapage ou action manuelle
    // fiduciaire) plutôt que traité en silence ici.
    const totalTtcCentimesAbs =
      totaux.totalTtcCentimes < 0 ? -totaux.totalTtcCentimes : totaux.totalTtcCentimes;
    const soldeInitialCentimes =
      doc.typeDocument === 'facture' || doc.typeDocument === 'avoir'
        ? BigInt(totalTtcCentimesAbs)
        : undefined;

    const { numero, numeroSequence, exercice } = await genererNumeroDocument(
      tx,
      ctx,
      this.compteurs,
      doc.typeDocument,
      dateDocumentReference,
    );

    // 4.5. Charge utile QR (MD-73→MD-81) — APRÈS le numéro : le message non structuré et, pour
    // un IBAN ordinaire, la référence SCOR en dérivent. Le bloc débiteur vient de l'adresse DÉJÀ
    // figée à la création du document (`adresse_facturation_figee`, MD-24) — jamais recalculée
    // depuis la fiche client courante.
    const adresseDebiteurFigee = adresseDepuisJsonb(doc.adresseFacturationFigee);
    const debiteurQr = adresseDebiteurFigee
      ? { nom: doc.clientDesignationFigee, ...adresseDebiteurFigee }
      : null;
    const blocQr = blocCreancier
      ? await construireBlocQrPourEmission(tx, ctx, this.compteurs, {
          creancier: blocCreancier,
          numero,
          exercice,
          totalTtcCentimes: totaux.totalTtcCentimes,
          devise: doc.devise,
          debiteur: debiteurQr,
        })
      : null;

    try {
      await tx
        .update(documentVente)
        .set({
          statut: 'emis',
          numero,
          numeroSequence,
          exercice,
          emisLe: maintenant,
          dateEcheance,
          totalHtCentimes: BigInt(totaux.totalHtCentimes),
          totalTvaCentimes: BigInt(totaux.totalTvaCentimes),
          totalTtcCentimes: BigInt(totaux.totalTtcCentimes),
          ...(soldeInitialCentimes !== undefined ? { soldeCentimes: soldeInitialCentimes } : {}),
          ...(blocQr
            ? {
                qrIban: blocQr.qrIban,
                creancierNom: blocQr.creancierNom,
                creancierRue: blocQr.creancierRue,
                creancierNumero: blocQr.creancierNumero,
                creancierNpa: blocQr.creancierNpa,
                creancierLocalite: blocQr.creancierLocalite,
                creancierPays: blocQr.creancierPays,
                typeReferenceQr: blocQr.typeReferenceQr,
                qrReference: blocQr.qrReference,
                qrMontantCentimes: BigInt(blocQr.qrMontantCentimes),
                qrDevise: blocQr.qrDevise,
                qrLangue: doc.langueFigee,
                qrDebiteurPresent: blocQr.qrDebiteurPresent,
                qrPayload: blocQr.qrPayload,
                qrPayloadSha256: blocQr.qrPayloadSha256,
              }
            : {}),
        })
        .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId)));
    } catch (erreur) {
      const traduite = traduireErreurDocument(erreur, documentId, doc.numero);
      if (traduite) throw traduite;
      throw erreur;
    }

    // 5. MD-45 : le récapitulatif TVA est figé, append-only, écrit UNE SEULE FOIS ici.
    for (const v of ventilation) {
      await tx.insert(documentVenteTva).values({
        tenantId: ctx.tenantId,
        documentId,
        regimeTva: v.regimeTva as (typeof documentVenteTva.$inferInsert)['regimeTva'],
        tauxTvaPourmille: v.tauxTvaPourmille,
        baseCentimes: v.baseCentimes,
        tvaCentimes: v.tvaCentimes,
      });
    }

    // 6. RF-32 : un avoir 'total' clôt la facture créditée — colonnes de la liste blanche
    // post-émission (`annule_par_avoir_id`, MD-20), écrites ICI plutôt que dans `service-avoir.ts`
    // pour ne mettre à jour la facture qu'au moment où l'avoir devient réellement opposable
    // (émis), jamais sur un avoir encore en brouillon qui pourrait être abandonné.
    if (doc.typeDocument === 'avoir' && doc.porteeAvoir === 'total' && doc.factureAnnuleeId) {
      try {
        await tx
          .update(documentVente)
          .set({ statut: 'annule_par_avoir', annuleParAvoirId: documentId })
          .where(
            and(
              eq(documentVente.tenantId, ctx.tenantId),
              eq(documentVente.id, doc.factureAnnuleeId),
            ),
          );
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, doc.factureAnnuleeId, null);
        if (traduite) throw traduite;
        throw erreur;
      }
    }

    // 7. Événement — catalogue GELÉ (`@dfa/shared`) : seuls `facture.emise`/`avoir.emis` existent,
    // rien pour `devis`/`bon_commande` (réservés étape 2, jamais émis avant). Aucun événement
    // n'est inventé pour les deux autres types.
    if (doc.typeDocument === 'facture') {
      await this.evenements.publier(tx, ctx, {
        type: 'facture.emise',
        versionSchema: 1,
        siteId: doc.siteId,
        ressource: { type: 'document_vente', id: documentId, numero },
        donnees: {
          natureFacture: doc.natureFacture,
          totalTtcCentimes: totaux.totalTtcCentimes,
        },
      });
    } else if (doc.typeDocument === 'avoir') {
      await this.evenements.publier(tx, ctx, {
        type: 'avoir.emis',
        versionSchema: 1,
        siteId: doc.siteId,
        ressource: { type: 'document_vente', id: documentId, numero },
        donnees: {
          factureAnnuleeId: doc.factureAnnuleeId,
          portee: doc.porteeAvoir,
          totalTtcCentimes: totaux.totalTtcCentimes,
        },
      });
    }

    const document = await this.documents.assemblerDocument(tx, ctx, principal.role, documentId);
    return { document, sansQr: resolution.incomplet };
  }

  /**
   * `resoudreBlocCreancierPourEmission` ou `null` si le bloc créancier est absent/incomplet/invalide
   * (`QR_CREANCIER_INCOMPLET`). Toute autre erreur remonte telle quelle.
   */
  private async resoudreBlocCreancierOuNull(
    tx: TransactionDfa,
    ctx: ContexteTenant,
  ): Promise<{
    readonly bloc: Awaited<ReturnType<typeof resoudreBlocCreancierPourEmission>> | null;
    readonly incomplet: boolean;
  }> {
    try {
      return { bloc: await resoudreBlocCreancierPourEmission(tx, ctx), incomplet: false };
    } catch (erreur) {
      if (erreur instanceof ErreurMetier && erreur.code === 'QR_CREANCIER_INCOMPLET') {
        return { bloc: null, incomplet: true };
      }
      throw erreur;
    }
  }

  /**
   * RV-37/MD-70 : une FACTURE rattachée à un dossier de vente (`document_vente.dossier_vente_id`)
   * marque son véhicule `vendu` (`reserve -> vendu`, `ServiceVehiculeStock.marquerVendu`) — un
   * effet de bord PROGRAMMATIQUE explicitement anticipé par la docstring de cette méthode
   * (« USAGE NORMAL : effet de bord... à l'émission de la facture »).
   *
   * PAS DANS LA MÊME TRANSACTION SQL QUE L'ÉMISSION CI-DESSUS — constat technique, pas un choix de
   * confort. `ServiceVehiculeStock.marquerVendu` appelle `AccesBase.enTenant`, qui ouvre sa PROPRE
   * transaction via `NodePgSession.transaction()` (`drizzle-orm/node-postgres/session.js`) :
   * `isPool = this.client instanceof Pool`, TOUJOURS vrai pour `AccesBase` (bindée au `Pool`, jamais
   * à une connexion unique) — donc `await this.client.connect()` PREND UNE CONNEXION NEUVE DU POOL,
   * même appelée depuis l'intérieur du callback `travail(tx)` ci-dessus. Deux `BEGIN`/`COMMIT`
   * indépendants, sur deux connexions différentes : aucun rollback de l'un n'annule l'autre. Seul
   * `NodePgTransaction.transaction()` (appelé SUR un `tx` déjà ouvert, pas sur `AccesBase`) pose un
   * vrai `SAVEPOINT` atomique — `ServiceVehiculeStock` n'expose aujourd'hui aucune méthode qui
   * accepte un `tx` externe pour l'emprunter, et lui en ajouter une sort du périmètre d'écriture de
   * ce lot (`ventes/service-vehicule-stock.ts`, explicitement interdit). SIGNALÉ à
   * le mainteneur, pas tranché seul : la vraie atomicité "même transaction" demandée par la tâche
   * exige une méthode `ventes/` supplémentaire prenant un `TransactionDfa` déjà ouvert.
   *
   * ORDRE choisi EN CONSÉQUENCE, pour ne jamais produire le pire des deux résultats possibles : la
   * facture est déjà COMMISE DURABLEMENT (transaction ci-dessus déjà terminée) avant toute tentative
   * de marquage — donc "véhicule vendu sans facture émise" ne peut PLUS arriver depuis ce chemin. Si
   * le marquage échoue ENSUITE, l'inverse se produit ("facture émise, véhicule pas encore vendu") :
   * état dégradé, mais recouvrable EXPRÈS PAR CONCEPTION (`POST /vehicules/{id}/stock/marquer-vendu`,
   * `ventes.vehicule_stock.corriger`, dont la docstring anticipe littéralement ce cas). Jamais
   * silencieux : journalisé en ERROR ET remonté en avertissement dans LA RÉPONSE DE CETTE REQUÊTE
   * (pas dans le corps mémorisé pour le rejeu idempotent, déjà écrit avant que cette méthode ne
   * s'exécute — un rejeu ultérieur ne reverra donc pas cet avertissement précis, limite acceptée).
   *
   * Rend `[]` si rien à signaler (document pas concerné), le ou les avertissements produits par
   * `ServiceVehiculeStock.marquerVendu` si le marquage réussit — RPP-06 notamment,
   * `VEHICULE_DEPOTS_PNEUS_OUVERTS` : la vente aboutit toujours, ce n'est qu'un signalement — ou
   * `VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE` si le marquage lui-même échoue. Défaut constaté et
   * corrigé : cette méthode jetait auparavant sans condition les avertissements d'un marquage
   * réussi (`return null`), rendant RPP-06 invisible sur le chemin normal d'une vente (facture
   * émise) alors qu'il est bien rendu par `POST /vehicules/{id}/stock/marquer-vendu`.
   */
  private async marquerVehiculeVenduSiApplicable(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    doc: ReponseDocumentVente,
  ): Promise<Avertissement[]> {
    if (doc.typeDocument !== 'facture' || !doc.dossierVenteId) return [];

    const libelle = doc.numero ?? doc.id;

    if (!doc.vehiculeId) {
      this.journal.error(
        `RV-37 : facture ${libelle} rattachée au dossier de vente ${doc.dossierVenteId} sans ` +
          `vehiculeId — marquage vendu impossible.`,
      );
      return [
        {
          code: 'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE',
          message:
            `La facture ${libelle} a été émise, mais aucun véhicule ne lui est associé : le ` +
            `véhicule du dossier de vente ${doc.dossierVenteId} n'a pas pu être marqué vendu ` +
            `(à corriger manuellement, POST /vehicules/{id}/stock/marquer-vendu).`,
          donnees: { documentId: doc.id, dossierVenteId: doc.dossierVenteId },
        },
      ];
    }

    try {
      const { avertissements } = await this.vehiculeStock.marquerVendu(
        ctx,
        principal.role,
        doc.vehiculeId,
        { motif: `Facture ${libelle} émise (RV-37).` },
      );
      return [...avertissements];
    } catch (erreur) {
      const messageErreur = erreur instanceof Error ? erreur.message : String(erreur);
      this.journal.error(
        `RV-37 : marquage vendu du véhicule ${doc.vehiculeId} en échec après émission de la ` +
          `facture ${libelle} (dossier ${doc.dossierVenteId}) : ${messageErreur}`,
      );
      return [
        {
          code: 'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE',
          message:
            `La facture ${libelle} a été émise, mais le véhicule ${doc.vehiculeId} n'a pas pu ` +
            `être marqué vendu automatiquement (à corriger manuellement, ` +
            `POST /vehicules/{id}/stock/marquer-vendu).`,
          donnees: {
            documentId: doc.id,
            dossierVenteId: doc.dossierVenteId,
            vehiculeId: doc.vehiculeId,
            erreur: messageErreur,
          },
        },
      ];
    }
  }

  /** `POST /documents-vente/{id}/accepter` — devis uniquement (`devis.emis → accepte`, terminal). */
  async accepter(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.transitionnerSimple(ctx, principal, documentId, 'accepte', (doc) => {
      if (doc.typeDocument !== 'devis') {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Seul un devis peut être accepté.', {
          erreurs: [
            {
              champ: 'typeDocument',
              code: 'type_invalide',
              message: `« ${doc.typeDocument} » ne peut pas être accepté.`,
            },
          ],
        });
      }
    });
  }

  /** `POST /documents-vente/{id}/refuser` — devis ou bon de commande.
   *  `motif` (optionnel, `schemaRefuserDocument`) : SIGNALÉ — aucune colonne `motif_refus` n'existe
   *  sur `document_vente` (contrairement à `motif_avoir`/`motif_avoir_libre` pour l'avoir, ou
   *  `ordre_reparation.motif_annulation` pour l'OR). Le motif est validé par le schéma d'entrée
   *  mais n'a nulle part où se poser dans ce lot — à signaler à l'équipe base de données. */
  async refuser(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    entree: EntreeRefuserDocument,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    void entree;
    return this.transitionnerSimple(ctx, principal, documentId, 'refuse', (doc) => {
      if (doc.typeDocument !== 'devis' && doc.typeDocument !== 'bon_commande') {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Seuls un devis ou un bon de commande peuvent être refusés.',
          {
            erreurs: [
              {
                champ: 'typeDocument',
                code: 'type_invalide',
                message: `« ${doc.typeDocument} » ne peut pas être refusé.`,
              },
            ],
          },
        );
      }
    });
  }

  /** `POST /documents-vente/{id}/annuler` — bon de commande uniquement, motif obligatoire
   *  (`schemaAnnulerDocument`). Même limitation signalée que `refuser` : pas de colonne de
   *  persistance pour le motif sur `document_vente`. */
  async annuler(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    entree: EntreeAnnulerDocument,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    void entree;
    return this.transitionnerSimple(ctx, principal, documentId, 'annule', (doc) => {
      if (doc.typeDocument !== 'bon_commande') {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Seul un bon de commande peut être annulé.', {
          erreurs: [
            {
              champ: 'typeDocument',
              code: 'type_invalide',
              message: `« ${doc.typeDocument} » ne peut pas être annulé.`,
            },
          ],
        });
      }
    });
  }

  /**
   * `RF-114` distingue trois droits d'émission selon `typeDocument` (voir la note détaillée sur le
   * type `Action`, `auth/matrice-droits.ts`) — `@ExigerDroit('facturation.document.emettre')` posé
   * sur la route n'est que le portillon générique (« au moins un des trois »). Vérification
   * PRÉCISE ici, après chargement du document réel — même patron que
   * `ServiceOr.modifier` pour `atelier.or.plafond_modifier` (`atelier/service-or.ts`).
   */
  private verifierDroitEmission(
    typeDocument: LigneDocumentVente['typeDocument'],
    principal: PrincipalAuthentifie,
  ): void {
    const action: Action =
      typeDocument === 'facture'
        ? 'facturation.document.emettre_facture'
        : typeDocument === 'avoir'
          ? 'facturation.document.emettre_avoir'
          : 'facturation.document.emettre_devis_bc';
    const droitsDuRole = droitsDuPrincipal(principal).actions;
    if (!droitsDuRole.includes(action)) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        `Le rôle "${principal.role}" n'a pas le droit d'émettre un document de type "${typeDocument}" (RF-114).`,
      );
    }
  }

  /**
   * `RF-117` : ferme le dégradé documenté dans `auth/matrice-droits.ts` (§EMISSION_AVOIR,
   * commentaire « RF-117 NON IMPLÉMENTÉ, SIGNALÉ ») — `receptionnaire` détient
   * `facturation.document.emettre_avoir` SANS AUCUNE LIMITE aujourd'hui ; au-delà d'un montant
   * paramétré par tenant, `direction`/`comptable` doivent prendre le relais.
   *
   * `parametre_atelier.plafond_avoir_receptionnaire_centimes` (migration 0018) : NULL = aucun
   * plafond convenu — comportement actuel PRÉSERVÉ à l'identique (non-régression prioritaire,
   * voir l'en-tête de la migration §3). Ne s'applique qu'au rôle `receptionnaire` — le nom de la
   * colonne le dit, `direction`/`comptable`/`admin` ne sont jamais bornés par elle.
   *
   * MONTANT COMPARÉ — décision prise ici, faute de trancher explicite dans la spécification :
   *  - le TTC, pas le HT : un avoir rend de l'argent au client, et les prix sont stockés TVA
   *    comprise (choix produit) — le TTC est ce que le client récupère réellement. Un avoir porte
   *    un total `<= 0` par construction (`document_vente` : `type_document <> 'avoir' or (...
   *    total_ttc_centimes <= 0)`, migration 0010 §9) ; sa valeur absolue est le montant rendu —
   *    même convention que le trigger `imputation_paiement_verifier_invariants` (migration 0010,
   *    MD-51, `abs(d.total_ttc_centimes)`), pas une invention de ce lot.
   *  - CUMUL sur la facture d'origine, pas seulement le montant de CET avoir : `RF-117` ne
   *    précise pas le cas d'un avoir PARTIEL émis après d'autres avoirs déjà émis sur la même
   *    facture. Lecture retenue, la plus prudente (celle qui protège le plus) faute de trancher
   *    explicite : un `receptionnaire` ne doit pas pouvoir contourner le plafond en fractionnant
   *    un gros avoir en plusieurs avoirs partiels, chacun sous le seuil pris isolément — le cumul
   *    de ce que le client a déjà récupéré + ce que CET avoir ajoute est comparé au plafond. Ne
   *    compte que les avoirs déjà ÉMIS (`statut = 'emis'`) sur la même `facture_annulee_id` : un
   *    avoir encore en brouillon n'est pas opposable et peut être abandonné (RF-9), il ne doit pas
   *    gonfler artificiellement le cumul. À SIGNALER à @laupernoe/l'équipe métier pour confirmation — c'est
   *    la lecture la plus protectrice, pas une certitude tirée de la spec.
   *
   * Un avoir sans `factureAnnuleeId` (avoir libre) n'a pas de cumul à calculer : seul son propre
   * montant compte.
   */
  private async verifierPlafondAvoirReceptionnaire(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    doc: LigneDocumentVente,
    totalAvoirTtcCentimes: number,
  ): Promise<void> {
    if (!droitsDuPrincipal(principal).actions.includes('facturation.avoir.plafonne')) return;

    const plafondCentimes = await chargerPlafondAvoirReceptionnaire(tx, ctx);
    if (plafondCentimes === null) return; // NULL = aucun plafond convenu (0018 §3) — inchangé.

    const cumulDejaEmisCentimes = doc.factureAnnuleeId
      ? await sommerAvoirsEmisPourFacture(tx, ctx, doc.factureAnnuleeId)
      : 0;
    const cumulCentimes = Math.abs(totalAvoirTtcCentimes) + cumulDejaEmisCentimes;

    if (cumulCentimes > plafondCentimes) {
      throw new ErreurMetier(
        'AVOIR_PLAFOND_DEPASSE',
        `Le montant de l'avoir (${String(cumulCentimes)} centimes, cumulé sur la facture d'origine) dépasse le plafond de ${String(plafondCentimes)} centimes autorisé au rôle "receptionnaire" seul (RF-117) — direction ou comptable doit émettre cet avoir.`,
        {
          blocages: [
            {
              type: 'document_vente',
              id: doc.id,
              libelle: doc.numero ?? doc.id,
              donnees: { plafondCentimes, cumulCentimes },
            },
          ],
          actionsProposees: [{ code: 'DEMANDER_HABILITATION' }],
        },
      );
    }
  }

  private async transitionnerSimple(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    versStatut: LigneDocumentVente['statut'],
    validerType: (doc: LigneDocumentVente) => void,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      validerType(doc);
      try {
        await tx
          .update(documentVente)
          .set({ statut: versStatut })
          .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId)));
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, documentId, doc.numero);
        if (traduite) throw traduite;
        throw erreur;
      }
      const document = await this.documents.assemblerDocument(tx, ctx, principal.role, documentId);
      return { donnees: document, avertissements: [] };
    });
  }
}
