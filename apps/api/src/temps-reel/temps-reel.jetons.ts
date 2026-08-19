/**
 * Jetons d'injection du module `temps-reel/`. `Symbol.for` (registre global du runtime), même
 * patron que `auth/jetons.ts` / `common/limitation/redis.provider.ts::JETON_REDIS` : un futur
 * module métier (clôture de pointage, facture émise…) peut injecter `ServiceEvenementsTempsReel`
 * en important simplement `TempsReelModule`, sans dépendre de ces symboles.
 *
 * DEUX connexions Redis dédiées, jamais `JETON_REDIS` (`common/limitation/redis.provider.ts`) :
 * une connexion ioredis en mode abonnement (`subscribe`) ne peut plus émettre AUCUNE autre
 * commande tant qu'elle reste abonnée à au moins un canal (comportement documenté d'ioredis/Redis,
 * pas une limitation de ce dépôt) — la partager avec la limitation de débit ou le verrouillage PIN
 * casserait ces deux consommateurs dès le premier abonnement. Une troisième connexion (plutôt que
 * réutiliser l'abonné pour publier) suit le même principe : PUBLISH sur une connexion abonnée reste
 * autorisé par Redis, mais séparer les deux évite tout couplage accidentel futur si ce module
 * gagnait un jour un mode d'abonnement plus complexe (patterns, plusieurs canaux applicatifs).
 */
export const JETON_REDIS_TEMPS_REEL_PUBLIEUR = Symbol.for('DFA_REDIS_TEMPS_REEL_PUBLIEUR');
export const JETON_REDIS_TEMPS_REEL_ABONNE = Symbol.for('DFA_REDIS_TEMPS_REEL_ABONNE');
