import { z } from 'zod';

import type { ReponseDocumentVente } from './document';
import { schemaConfirmations } from '../atelier/avertissement';
import type { PayeurLigneOr } from '../atelier/enums';
import type { ReponseOrdreReparation } from '../atelier/ordre-reparation';
import { schemaIdentifiant, schemaMotif } from '../atelier/primitives';

/**
 * `POST /ordres-reparation/{orId}/facturer` (`RF-81`) — LE PONT entre l'atelier et la facturation :
 * transforme les lignes `realisee` d'un OR `termine` en un ou plusieurs documents `facture` en
 * BROUILLON, un par groupe payeur choisi (`RF-87`, `MD-62`). L'émission reste un geste séparé
 * (`POST /documents-vente/{id}/emettre`) — cette action ne fait QUE créer (design §3.3 : le bouton
 * dit « Créer », jamais « Émettre »).
 *
 * DÉROGATION DÉLIBÉRÉE à la règle de `facturation/document.ts` (« la facturation ne réexporte ni ne
 * redéfinit les enums de l'OR ») : cette ENTRÉE référence `PayeurLigneOr`, parce que choisir QUOI
 * facturer se dit irréductiblement dans le vocabulaire de l'OR (c'est un groupe de LIGNES D'OR
 * qu'on sélectionne, pas encore un document). La SORTIE, elle, respecte la règle à la lettre :
 * `ReponseDocumentVente` ne référence aucun type d'OR — une fois recopiée, une ligne est figée et
 * indépendante de sa source (`MD-24`). Le sens de dépendance reste celui déjà établi ailleurs dans
 * ce domaine (`document.ts`, `ligne.ts`, `paiement.ts`, `export.ts` importent tous depuis
 * `../atelier/primitives` ou `../atelier/avertissement` — jamais l'inverse) : ce fichier vit dans
 * `facturation/` parce qu'il PRODUIT de la facturation, mais `atelier/` ne l'importe jamais.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * CE QUE CE CONTRAT TRANCHE (questions du brief, formulées ici pour un développeur tiers) :
 *
 * 1. QUELLES LIGNES PARTENT, QUI CHOISIT — par GROUPE PAYEUR, jamais ligne par ligne (`RF-87`,
 *    design §3.3 : case à cocher « Facturer maintenant » par groupe, pas par ligne). Le serveur
 *    recopie TOUTES les lignes `realisee` du groupe choisi ; aucune sélection plus fine n'existe,
 *    parce que l'écran n'en propose pas — retirer une ligne d'un groupe se fait en amont, sur l'OR
 *    (refuser/annuler la ligne), jamais à la facturation (`RF-81` : « ne prend AUCUNE ligne en
 *    entrée », lu ici comme « aucune ligne choisie une par une », cf. avertissement du hook front
 *    provisoire qui avait identifié la même ambiguïté de lecture).
 *
 * 2. FACTURATION PARTIELLE DANS LE TEMPS — OUI, explicitement voulue (`RF-83`, `RF-84`, `MD-65` :
 *    « l'assureur peut mettre six semaines, le client paie en repartant »). Cette action N'EST PAS
 *    UN GESTE UNIQUE par OR : elle reste appelable tant que l'OR est `termine` ET qu'il reste au
 *    moins un groupe `(payeur, payeurClientId)` avec des lignes `realisee` non `facturee`.
 *    `ordre_reparation.statut` ne passe à `'facture'` QUE lorsque l'appel courant traite le DERNIER
 *    groupe encore facturable (`RF-84` : « ne passera pas au statut facture tant que tous les
 *    groupes ne sont pas traités »). Conséquence sur l'idempotence : la clé d'idempotence porte sur
 *    CET APPEL précis (ce sous-ensemble de groupes, ce corps exact) — un second appel plus tard,
 *    avec une NOUVELLE clé, pour facturer le groupe assurance resté en attente, n'est PAS un rejeu,
 *    c'est un nouvel appel légitime qui produit de nouveaux documents.
 *
 * 3. LE LIEN OR ↔ DOCUMENT — 1 OR ↔ N documents. `ReponseDocumentVente.ordreReparationId` (déjà
 *    posé, `document.ts`) référence l'OR ; RIEN n'empêche plusieurs documents de porter le même
 *    `ordreReparationId` — c'est même la norme dès qu'il y a plus d'un groupe payeur, et la norme
 *    aussi dès qu'un OR est facturé en plusieurs appels. L'inverse — un document couvrant PLUSIEURS
 *    OR (flotte facturée mensuellement) — N'EST PAS couvert par cette action : `orId` est singulier
 *    dans la route elle-même. Un besoin réel, mais un mécanisme séparé, non conçu ici.
 *
 * 4. CE QUE DEVIENT UNE LIGNE D'OR FACTURÉE — `ligne_or.statut` passe `realisee` → `facturee`
 *    (`STATUTS_LIGNE_OR`, **GELÉ**, déjà en v1) UNIQUEMENT pour les lignes du/des groupe(s) traités
 *    par CET appel ; `ligne_or.factureId` (déjà posé, `ligne.ts`) pointe vers le document produit.
 *    `facturee` est TERMINAL — aucune transition ne revient en arrière ; une correction passe par
 *    un avoir sur le DOCUMENT (`RF-11`), jamais par une réouverture de la ligne d'OR. Les lignes des
 *    groupes REPORTÉS restent `realisee`, inchangées, jusqu'à un appel ultérieur qui les traite.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * IDEMPOTENCE — `Idempotency-Key` OBLIGATOIRE (`EN_TETE_IDEMPOTENCE`), même patron que toute
 * création de document (`document.ts`) : c'est une création de facture(s). Empreinte = corps
 * canonicalisé, `confirmations` compris. Réponse mémorisée = `ReponseAvecAvertissements<
 * ReponseFacturationOrdreReparation>` (patron `ResultatIdempotent<ReponseMemorisable & { corps:
 * … }>`, `apps/api/src/common/idempotence/`, hors périmètre de ce fichier).
 *
 * STATUT HTTP — `201` (des ressources sont créées ; le pluriel `facturesCreees` peut compter
 * plusieurs documents en une seule requête, un `Location` unique n'aurait pas de sens).
 *
 * DROIT — `facturation.document.creer` (le même que toute création de BROUILLON,
 * `apps/api/src/auth/matrice-droits.ts`, `ECRITURE_BROUILLON`), **PAS**
 * `facturation.document.emettre_facture`. `RF-115` réserve l'ÉMISSION à
 * direction/comptable/vendeur/receptionnaire ; cette action ne fait que créer des brouillons, donc
 * suit la règle de la CRÉATION, qui inclut aussi `chef_atelier` et `magasinier` dans la matrice
 * actuelle (cohérent : la matrice existante accorde déjà `ECRITURE_BROUILLON` à `chef_atelier` sans
 * `EMISSION_FACTURE`— exactement la distinction que `RF-81` demande). `technicien` et `admin`
 * n'ont que `LECTURE_DOCUMENT` : ni l'un ni l'autre ne peut appeler cette action, sans changement de
 * matrice nécessaire.
 *
 * CODES D'ERREUR — AUCUN NOUVEAU CODE. Tous existent déjà, plusieurs posés dès le lot 1 en
 * anticipation explicite de cette action précise :
 *  - `OR_TRANSITION_INTERDITE` (409) — OR pas `termine`, ou déjà `facture` (plus aucun groupe
 *    n'attend) ; même code que toute garde de machine à états de l'OR.
 *  - `FACTURATION_LIGNES_INDECISES` (409) — `RF-85`/`RF-86` : au moins une ligne facturable de l'OR
 *    (tous groupes confondus, pas seulement les groupes choisis dans cet appel — le `RefusBloquant`
 *    du design §3.2 empêche même l'ouverture de l'écran) est encore `proposee`/`a_valider`/
 *    `validee`/`en_cours`. `blocages` liste les lignes concernées.
 *  - `OR_FACTURATION_AUCUNE_LIGNE` (409) — un groupe demandé dans `groupes[]` n'a AUCUNE ligne
 *    `realisee` à facturer (déjà tout facturé, ou payeur jamais présent sur cet OR). Code posé au
 *    lot 1 (`docs/plan-lot1-execution.md` : « déclaré au lot 1 et n'est émis par aucun [endpoint] »)
 *    précisément pour cette action. `blocages` porte le payeur concerné.
 *  - `VALIDATION_ECHOUEE` (400) — corps malformé (groupe dupliqué, `payeurClientId` incohérent
 *    avec `payeur`, groupe à la fois facturé et reporté dans le même appel).
 *  - `CONFIRMATION_REQUISE` (409) / `confirmations` — au moins un `payeurClientId` (ou le client de
 *    l'OR lui-même pour le groupe `'client'`) est `CLIENT_BLOQUE` (RM-08) : même protocole que
 *    `POST /ordres-reparation`, `confirmations` entre dans l'empreinte d'idempotence.
 *  - `IDEMPOTENCE_CONFLIT` (409) — clé déjà vue avec un corps différent, ou exécution en cours.
 *  - `DROIT_INSUFFISANT` (403).
 */

/**
 * = `PAYEURS_LIGNE_OR` sans `'garage'` (`RF-92` : jamais un groupe séparé — ses lignes voyagent
 * automatiquement avec le groupe `'client'`, valorisées à 0.00, `MD-66`/`AC-07`). Tenu à jour
 * manuellement en miroir de `PAYEURS_LIGNE_OR` (`atelier/enums.ts`, **GELÉ**) plutôt que dérivé
 * mécaniquement : un futur payeur ajouté à `PAYEURS_LIGNE_OR` peut avoir sa propre règle de
 * groupement, ce n'est pas automatique.
 */
export const PAYEURS_FACTURATION_SELECTIONNABLES = [
  'client',
  'constructeur',
  'assurance',
  'tiers',
] as const;
export type PayeurFacturationSelectionnable = (typeof PAYEURS_FACTURATION_SELECTIONNABLES)[number];

/**
 * Un groupe payeur `(payeur, payeurClientId)` (`MD-62`) — l'unité de sélection de cette action, PAS
 * une ligne. `payeurClientId` obligatoire et UNIQUEMENT pour un payeur autre que `'client'` (`AC-08`
 * — voir `ReponseLigneOr.payeurClientId` pour la justification complète et son statut d'inférence
 * non encore posée en base).
 */
export const schemaSelecteurGroupePayeurOr = z
  .object({
    payeur: z.enum(PAYEURS_FACTURATION_SELECTIONNABLES),
    payeurClientId: schemaIdentifiant.nullish(),
  })
  .refine((v) => (v.payeur === 'client') === (v.payeurClientId == null), {
    message:
      "`payeurClientId` est obligatoire pour un payeur autre que 'client', et doit être absent pour 'client' (MD-62, AC-08).",
    path: ['payeurClientId'],
  });
export type SelecteurGroupePayeurOr = z.infer<typeof schemaSelecteurGroupePayeurOr>;

/** Clé texte d'un groupe, usage INTERNE au schéma (unicité) — jamais exposée telle quelle dans un
 *  contrat public : un tiers reconstruit la même paire `(payeur, payeurClientId)`, pas une chaîne
 *  opaque. */
function cleGroupe(g: {
  readonly payeur: string;
  readonly payeurClientId?: string | null;
}): string {
  return `${g.payeur}:${g.payeurClientId ?? ''}`;
}

/**
 * Corps de `POST /ordres-reparation/{orId}/facturer`.
 *
 * Ne porte AUCUNE ligne, AUCUN montant : tout est recopié et figé par le serveur (`RF-81`). Ce que
 * l'appelant choisit, c'est QUOI (quels groupes) et deux options ponctuelles documentées par
 * `RF-90`/`RF-91` (démontage) et le risque n°4 de `docs/design-etape-2-facturation.md` §9 (motif de
 * report). `inclureDemontageRefuse` et `motifsReport` ne portent JAMAIS de montant ni de prix — ce
 * sont des interrupteurs, pas une saisie.
 */
export const schemaFacturationOrdreReparation = z
  .object({
    /** Groupes traités MAINTENANT par cet appel — au moins un (`design §3.2` : le bouton primaire
     *  n'existe pas à zéro groupe coché ; un appel à zéro groupe n'a pas de sens pour cette action,
     *  voir `motifsReport` pour documenter un report SANS rien facturer aujourd'hui). */
    groupes: z.array(schemaSelecteurGroupePayeurOr).min(1).max(20),
    /**
     * Ajoute la ligne de démontage facturable proposée (`RF-90`, `RF-91`, `P-24`) au groupe
     * `'client'` de CET appel. Sans effet (silencieusement ignoré, même convention que les
     * confirmations obsolètes, `probleme.ts`) si `groupes` ne contient pas de sélecteur
     * `payeur = 'client'`, ou si aucun démontage facturable n'existe pour cet OR — jamais une
     * erreur pour une case cochée par défaut dans un état d'écran qui ne s'applique plus.
     */
    inclureDemontageRefuse: z.boolean().optional(),
    /**
     * Raison du report, PAR GROUPE NON traité par cet appel — FACULTATIF (design §3.3 : « décocher
     * un groupe payeur sans obliger de motif »), mais ENREGISTRÉ dès qu'il est fourni (tranché ici,
     * suite à la recommandation du risque n°4, §9 du design : sans trace, un patron qui revient
     * trois semaines plus tard sur un OR à moitié facturé ne saurait pas pourquoi). Persistance
     * envisagée : entrée de journal d'audit (`GET /ordres-reparation/{orId}/journal`, `entite:
     * 'ligne_or'` ou `'ordre_reparation'`), PAS une nouvelle colonne — décision d'implémentation,
     * hors périmètre de ce fichier. Un groupe absent à la fois de `groupes` et de `motifsReport`
     * reste simplement en attente, sans texte associé — c'est la position par défaut, pas une
     * erreur.
     */
    motifsReport: z
      .array(schemaSelecteurGroupePayeurOr.and(z.object({ motif: schemaMotif })))
      .max(20)
      .default([]),
  })
  .extend(schemaConfirmations.shape)
  .refine((v) => new Set(v.groupes.map(cleGroupe)).size === v.groupes.length, {
    message:
      'Un même groupe payeur ne peut être sélectionné qu’une seule fois dans `groupes` (MD-62).',
    path: ['groupes'],
  })
  .refine(
    (v) => {
      const clesFacturees = new Set(v.groupes.map(cleGroupe));
      return v.motifsReport.every((m) => !clesFacturees.has(cleGroupe(m)));
    },
    {
      message:
        'Un groupe ne peut pas être à la fois facturé par cet appel (`groupes`) et reporté (`motifsReport`).',
      path: ['motifsReport'],
    },
  );

export type EntreeFacturationOrdreReparation = z.infer<typeof schemaFacturationOrdreReparation>;

/**
 * Réponse de `POST /ordres-reparation/{orId}/facturer` — enveloppée comme toute création
 * (`ReponseAvecAvertissements<ReponseFacturationOrdreReparation>`, `Idempotency-Key`
 * obligatoire, voir l'en-tête de ce fichier).
 */
export interface ReponseFacturationOrdreReparation {
  /**
   * Un brouillon par groupe payeur traité par CET appel, dans l'ordre de `groupes` en entrée —
   * JAMAIS l'historique complet de facturation de l'OR (`RF-83`, `MD-65` : d'autres documents ont
   * pu être créés par un appel antérieur, et d'autres le seront par un appel futur — `GET
   * /documents-vente?ordreReparationId=` reste la source pour l'historique). Chaque élément :
   * `typeDocument: 'facture'`, `natureFacture: 'ordinaire'`, `statut: 'brouillon'`,
   * `ordreReparationId` = cet OR. Chaque ligne recopiée porte `ligneOrId` non nul
   * (`facturation/ligne.ts`) ; les lignes `payeur = 'garage'` du groupe `'client'` portent
   * `montantFacturableCentimes = 0` avec `montantValoriseCentimes` au coût réel (`RF-92`,
   * `MD-66`, `AC-07` — déjà modélisé, aucun champ nouveau requis ici).
   */
  readonly facturesCreees: readonly ReponseDocumentVente[];
  /**
   * L'OR à jour — MÊME PATRON que les actions de §7.7 (`terminer`, `restituer`…) : le client n'a
   * pas à relire séparément après une transition. `statut` peut RESTER `'termine'` si des groupes
   * payeur restent en attente (`RF-84`) ; il ne passe à `'facture'` (avec `factureLe` renseigné)
   * que lorsque cet appel traite le DERNIER groupe encore facturable. Les lignes traitées
   * apparaissent ici `statut: 'facturee'`, `factureId` renseigné (`ligne.ts`).
   */
  readonly ordreReparation: ReponseOrdreReparation;
}

type Affirme<T extends true> = T;
/**
 * Garde de compilation (même patron que `GardePrefixeSocleErreur`, `probleme.ts`) : toute valeur
 * de `PAYEURS_FACTURATION_SELECTIONNABLES` est une valeur valide de `PayeurLigneOr`. Si
 * `PAYEURS_LIGNE_OR` (`atelier/enums.ts`) perd une des quatre valeurs reprises ici, `pnpm
 * typecheck` échoue sur CETTE ligne plutôt qu'à l'exécution.
 */
export type GardeSelectionnablesFacturation = Affirme<
  PayeurFacturationSelectionnable extends PayeurLigneOr ? true : false
>;
