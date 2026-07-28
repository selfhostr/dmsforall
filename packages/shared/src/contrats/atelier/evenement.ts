/**
 * Journal d'événements métier et webhooks (contrats-api-etape-1.md §10).
 *
 * POURQUOI MAINTENANT, alors qu'aucun connecteur ne consommera ces webhooks en 2026 :
 * **on ne peut pas fabriquer rétroactivement l'historique des événements d'un garage.** Si
 * l'étape 1 n'écrit pas ses événements, l'étape 5 démarrera avec un journal vide et les premiers
 * connecteurs travailleront à l'aveugle sur tous les dossiers antérieurs.
 *
 * L'ÉCRITURE est urgente, la LIVRAISON ne l'est pas : chaque transition écrit une ligne
 * `evenement_metier` dans la MÊME TRANSACTION que le changement d'état (outbox) ; l'émission HTTP
 * peut n'être branchée qu'à l'étape 2. Un événement écrit hors transaction est un événement qui
 * ment.
 */

/**
 * Catalogue COMPLET de l'étape 1. Nom : `<ressource>.<événement au participe passé>`, en
 * snake_case. **Additif : on ajoute des types, on n'en renomme JAMAIS.**
 *
 * Les types des modules non livrés au lot 1 (rendez-vous, pointage) sont déclarés quand même :
 * un type déclaré non émis est sans risque, un type émis non déclaré est un bug de contrat.
 */
export const TYPES_EVENEMENT_METIER = [
  // Ordre de réparation
  'ordre_reparation.ouvert', // T-02 / T-03
  'ordre_reparation.termine', // T-13 / T-14
  'ordre_reparation.restitue', // T-17 / T-18
  'ordre_reparation.cloture', // T-19
  'ordre_reparation.annule', // T-20
  // Lignes
  'ligne_or.constatee', // constat technicien : ligne d'origine `constatee` créée
  // Devis complémentaires
  'devis_complementaire.envoye', // RM-79
  'devis_complementaire.repondu', // RM-81
  // Rendez-vous (lot 4)
  'rendez_vous.honore',
  'rendez_vous.absent',
  'rendez_vous.reporte',
  // Véhicules
  'vehicule.detenteur_change', // RM-20
  'vehicule.kilometrage_releve', // RM-23
  // Pointage (lot 2)
  'pointage.anomalie_detectee', // RM-91, RM-96
  // Clients
  'client.fusionne', // RM-06
  // --- RÉSERVÉS étape 2 : nommés ici pour que personne ne prenne le nom. Jamais émis en v1. ---
  'facture.emise',
  'facture.payee',
  'avoir.emis',
] as const;
export type TypeEvenementMetier = (typeof TYPES_EVENEMENT_METIER)[number];

/**
 * Enveloppe d'un événement livré par webhook (§10.3).
 *
 * `tenantId` APPARAÎT ici — et c'est la SEULE exception à la règle « aucun `tenantId` dans un
 * contrat exposé », parfaitement compatible avec elle : un webhook n'est pas une requête
 * entrante, et le destinataire n'a aucun autre moyen de savoir de quel garage vient l'événement.
 */
export interface EnveloppeEvenementMetier {
  /** Identifiant de LIVRAISON. Le consommateur DÉDUPLIQUE dessus (livraison au moins une fois). */
  readonly id: string;
  readonly type: TypeEvenementMetier;
  /**
   * Version du schéma de `donnees`, PAR TYPE d'événement. Un changement incompatible incrémente
   * la version, et **les deux versions sont émises** pendant la période de transition.
   */
  readonly versionSchema: number;
  readonly survenuLe: string;
  readonly tenantId: string;
  readonly siteId: string | null;
  readonly ressource: {
    readonly type: string;
    readonly id: string;
    /** Numéro métier lisible (n° d'OR, n° de client) quand la ressource en porte un. */
    readonly numero?: string;
  };
  /** Projection stable et additive de la ressource au moment de l'événement. */
  readonly donnees: Readonly<Record<string, unknown>>;
}

/**
 * En-tête de signature : `t=<epoch>,v1=<hex>` où le hex est
 * `HMAC-SHA256(secret, "<t>.<corps brut>")`, comparé à TEMPS CONSTANT.
 *
 * Rejet au-delà de `TOLERANCE_SIGNATURE_WEBHOOK_SECONDES` de dérive (anti-rejeu). Secret par
 * endpoint, rotation supportée par **deux secrets actifs simultanément** — sans quoi toute
 * rotation est une coupure.
 */
export const EN_TETE_SIGNATURE_WEBHOOK = 'X-DFA-Signature';

/** 5 minutes. Au-delà, la signature est refusée même si elle est valide. */
export const TOLERANCE_SIGNATURE_WEBHOOK_SECONDES = 300;

/**
 * Garanties de livraison, à documenter mot pour mot pour un tiers — les supposer inverses est la
 * façon la plus courante de corrompre les données d'un connecteur au premier retry :
 *  - livraison **au moins une fois**, ordre **non garanti** ;
 *  - le consommateur déduplique sur `id` et ignore un `survenuLe` plus ancien que son état ;
 *  - réessais : 5 tentatives, backoff exponentiel de 1 min à 2 h, puis mise en quarantaine de
 *    l'endpoint et alerte.
 */
export const MAX_TENTATIVES_LIVRAISON_WEBHOOK = 5;
