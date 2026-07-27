/**
 * Jeton INTERNE à `src/db/` — ne pas réexporter.
 *
 * `JETON_CONFIG` est déclaré par `src/config/` (contrat §2.7) comme `Symbol.for('DFA_CONFIG')`.
 * Comme `Symbol.for` puise dans le registre global du runtime, réécrire la même expression ici
 * produit **strictement le même symbole**, donc le même jeton d'injection NestJS.
 *
 * On évite ainsi une dépendance de compilation entre `src/db/` et `src/config/`, deux
 * répertoires appartenant à deux experts distincts, sans rien changer au câblage : le provider
 * enregistré par `ConfigModule` est bien celui que résout `@Inject(JETON_CONFIG_BASE)`.
 *
 * Le contrat côté type est `ConfigBase` (db.types.ts), sous-ensemble structurel de `Config`.
 */
export const JETON_CONFIG_BASE: symbol = Symbol.for('DFA_CONFIG');
