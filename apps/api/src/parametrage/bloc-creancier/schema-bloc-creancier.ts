/**
 * Schéma zod de `PATCH /parametres-facturation/creancier` — RE-EXPORT du contrat gelé de
 * `@dfa/shared` (`packages/shared/src/contrats/facturation/creancier.ts`), désormais la source de
 * vérité UNIQUE de cette forme. Avant ce fichier, l'API et le front dérivaient chacun une copie
 * séparée (écart signalé par l'agent qui a livré l'écran de paramétrage) — refermé ici.
 *
 * Ce fichier ne redéclare plus rien : il existe pour que `bloc-creancier.controller.ts` et
 * `mappeur-bloc-creancier.ts` gardent leur import `./schema-bloc-creancier` inchangé. La
 * validation MÉTIER (modulo 97, cohérence IBAN/QR-IBAN) reste hors de ce schéma, portée par
 * `mappeur-bloc-creancier.ts` via `facturation/qr/iban.ts` — seule la validation de FORME
 * (longueur, non-vide) est déléguée au contrat partagé.
 */
export { schemaModificationBlocCreancier, type EntreeModificationBlocCreancier } from '@dfa/shared';
