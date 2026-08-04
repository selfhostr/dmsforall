/**
 * Contrats du tableau de bord (vue « d'un coup d'œil » du garage).
 *
 * Deux endpoints, DEUX niveaux d'exposition — le point sensible de tout ce domaine (voir
 * `apps/api/src/tableau-bord/droits-provisoires.ts` pour le détail des rôles et l'état d'
 * avancement de l'action de droit dédiée, pas encore posée dans `auth/matrice-droits.ts`) :
 *
 *  - `GET /tableau-bord/activite` (`activite.ts`) : atelier + stock, EN QUANTITÉS/COMPTES
 *    seulement, jamais un montant — ouvert à tout rôle de personne.
 *  - `GET /tableau-bord/financier` (`financier.ts`) : chiffre d'affaires, encaissements, encours —
 *    réservé `direction`/`comptable` (RF-115 : `admin` explicitement exclu, aucun droit financier).
 *
 * Ce découpage EST la réponse à l'écueil que ce lot devait éviter : un tableau de bord qui
 * exposerait le chiffre d'affaires à tout rôle authentifié contournerait la séparation des
 * pouvoirs déjà posée par `ROLES_SANS_MONTANT`/`ROLES_SANS_MONTANT_FACTURATION`
 * (`auth/matrice-droits.ts`) — les deux réponses ne partagent délibérément AUCUN champ montant.
 *
 * Aucune notion de MARGE dans ce lot — voir l'en-tête de `financier.ts` pour le raisonnement
 * complet (base de coût absente ou non normée aujourd'hui).
 */

export * from './query';
export * from './activite';
export * from './financier';
