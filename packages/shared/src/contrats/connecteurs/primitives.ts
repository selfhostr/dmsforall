import { z } from 'zod';

/**
 * Primitives PROPRES au domaine connecteurs. Non réexportées par `connecteurs/index.ts` — même
 * règle que `pieces/primitives.ts`/`facturation/primitives.ts` : les primitives génériques déjà
 * publiques (`schemaIdentifiant`, `schemaHorodatage`, `schemaTexteCourt`, `schemaMotif`…) restent
 * celles de `contrats/atelier/primitives`, réutilisées sans être dupliquées ni réexportées deux
 * fois — un `export *` dupliquerait leur nom dans le barrel `@dfa/shared`.
 */

/**
 * Identifiant de TYPE de connecteur : un slug stable, JAMAIS un nom de partenaire en dur dans ce
 * fichier — c'est une DONNÉE portée par `ReponseTypeConnecteur.code` (`connecteur.ts`), voir
 * l'en-tête de `enums.ts`. Forme `^[a-z][a-z0-9_]*$`, ex. `plateforme-annonces-01` est INVALIDE
 * (tiret refusé), `plateforme_annonces_generique` est valide.
 */
export const schemaCodeConnecteur = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]*$/)
  .min(2)
  .max(60);

/**
 * Empreinte SHA-256 hexadécimale (64 caractères), `RC-64` : idempotence d'ingestion d'un FICHIER
 * complet, au-delà de la transaction individuelle déjà garantie par
 * `paiement.identifiant_transaction_banque` (`UNIQUE` par tenant). Même mécanisme que celui déjà
 * appliqué aux lots d'export comptable (`MD-91`, SHA-256).
 */
export const schemaEmpreinteSha256 = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/);

/**
 * URL de callback d'un abonnement webhook (`webhook.ts`) — HTTPS obligatoire : un webhook porte un
 * `EnveloppeEvenementMetier` signé (`EN_TETE_SIGNATURE_WEBHOOK`,
 * `contrats/atelier/evenement.ts`), jamais envoyé en clair.
 */
export const schemaUrlWebhookHttps = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((valeur) => valeur.startsWith('https://'), { message: 'HTTPS requis' });

/** Compteur de tentative (exécution ou livraison webhook), `RC-04`. Borné large : une boucle de
 *  reprise pathologique doit rester visible dans le champ plutôt que déborder silencieusement. */
export const schemaCompteurTentative = z.number().int().min(0).max(1000);

/** Expression cron, forme libre — la validation de SYNTAXE (5 ou 6 champs, plages valides) est un
 *  détail d'implémentation serveur, pas un format à figer dans ce contrat. */
export const schemaExpressionCron = z.string().trim().min(9).max(100);
