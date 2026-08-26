/**
 * Compte de démonstration seedé par `pnpm db:seed` (voir CONTRIBUTING.md « Commandes »). Rôle
 * `direction` — pas `admin` (compte d'administration technique, aucun droit métier, jamais
 * utilisé pour tester atelier/facturation/ventes — CONTRIBUTING.md).
 */
export const IDENTIFIANTS_DEMO = {
  email: 'direction@garage-martin.ch',
  motDePasse: 'Demo1234!Garage',
} as const;
