/** Jeton d'injection du transport courriel actif (SMTP réel ou capture — voir
 *  `courriel.module.ts` pour la sélection). Même patron que `JETON_CONFIG`/`JETON_REDIS`. */
export const JETON_TRANSPORT_COURRIEL = Symbol.for('DFA_TRANSPORT_COURRIEL');
