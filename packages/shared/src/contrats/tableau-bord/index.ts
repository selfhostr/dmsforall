/**
 * Contrats du tableau de bord (vue « d'un coup d'œil » du garage).
 *
 * Deux endpoints, DEUX niveaux d'exposition — le point sensible de tout ce domaine (rôles portés
 * par les actions `tableau_bord.activite.lire`/`tableau_bord.financier.lire`, posées dans
 * `apps/api/src/auth/matrice-droits.ts` et appliquées par `@ExigerDroit(...)` + `GardeDroit` dans
 * les contrôleurs `apps/api/src/tableau-bord/*.controller.ts`) :
 *
 *  - `GET /tableau-bord/activite` (`activite.ts`) : atelier + stock, EN QUANTITÉS/COMPTES
 *    seulement, jamais un montant — ouvert à tout rôle de personne.
 *  - `GET /tableau-bord/financier` (`financier.ts`) : chiffre d'affaires, encaissements, encours,
 *    marge, valorisation du stock pièces — réservé `direction`/`comptable` (RF-115 : `admin`
 *    explicitement exclu, aucun droit financier).
 *
 * Ce découpage EST la réponse à l'écueil que ce lot devait éviter : un tableau de bord qui
 * exposerait le chiffre d'affaires à tout rôle authentifié contournerait la séparation des
 * pouvoirs déjà posée par `ROLES_SANS_MONTANT`/`ROLES_SANS_MONTANT_FACTURATION`
 * (`auth/matrice-droits.ts`) — les deux réponses ne partagent délibérément AUCUN champ montant.
 *
 * MARGE (14.08.2026) : seule la marge sur ventes de véhicules (VN/VO) est calculable aujourd'hui —
 * voir l'en-tête de `financier.ts` pour le raisonnement complet, y compris pourquoi pièces et
 * main-d'œuvre restent explicitement `{ disponible: false }`.
 */

export * from './query';
export * from './activite';
export * from './financier';
