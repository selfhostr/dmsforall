/**
 * Parité web ↔ API des droits. Le web recopie à la main des fragments de `MATRICE_DROITS`
 * (fichiers `droits*.ts`) : ce test charge la vraie matrice de l'API et vérifie, rôle par rôle,
 * que chaque fonction `peutX` rend EXACTEMENT ce que la matrice accorde. Toute évolution de la
 * matrice qui n'est pas répercutée côté web fait rougir ce test (c'est ainsi qu'on a trouvé que
 * `direction` ne pouvait pas réceptionner une commande fournisseur : le bouton était masqué).
 *
 * Import relatif vers `apps/api` : réservé à ce test, jamais au code livré dans le bundle.
 */
import { ROLES_UTILISATEUR } from '@dfa/shared';
import { describe, expect, it } from 'vitest';

import { MATRICE_DROITS, TOUTES_ACTIONS, type Action } from '../../api/src/auth/matrice-droits';

import { ACTIONS_CITEES, type ActionsSession } from './droits';

import * as pieces from './ecrans/pieces/droits';
import * as pneus from './ecrans/pneus/droits';
import * as rendezVous from './ecrans/rendez-vous/droits';
import * as dossiers from './ecrans/ventes/dossiers/droits';
import * as financements from './ecrans/ventes/financements/droits';
import * as reprises from './ecrans/ventes/reprises/droits';
import * as stock from './ecrans/ventes/stock/droits';

type PeutX = (actions: ActionsSession) => boolean;

/** Fonction web → action(s) de la matrice (le rôle doit les détenir TOUTES). */
const PARITE: ReadonlyArray<readonly [string, PeutX, readonly Action[]]> = [
  ['pieces.peutEcrireArticle', pieces.peutEcrireArticle, ['pieces.article.creer']],
  ['pieces.peutEcrireStockSite', pieces.peutEcrireStockSite, ['pieces.stock.modifier']],
  ['pieces.peutCreerMouvement', pieces.peutCreerMouvement, ['pieces.mouvement.creer']],
  [
    'pieces.peutSatisfaireReservation',
    pieces.peutSatisfaireReservation,
    ['pieces.reservation.satisfaire'],
  ],
  ['pieces.peutLibererReservation', pieces.peutLibererReservation, ['pieces.reservation.liberer']],
  ['pieces.peutLireFournisseur', pieces.peutLireFournisseur, ['pieces.fournisseur.lire']],
  ['pieces.peutEcrireFournisseur', pieces.peutEcrireFournisseur, ['pieces.fournisseur.creer']],
  [
    'pieces.peutLireCommandeFournisseur',
    pieces.peutLireCommandeFournisseur,
    ['pieces.commande_fournisseur.lire'],
  ],
  [
    'pieces.peutEcrireCommandeFournisseur',
    pieces.peutEcrireCommandeFournisseur,
    ['pieces.commande_fournisseur.creer'],
  ],
  [
    'pieces.peutReceptionnerCommandeFournisseur',
    pieces.peutReceptionnerCommandeFournisseur,
    ['pieces.commande_fournisseur.reception'],
  ],
  ['pieces.peutRetournerConsigne', pieces.peutRetournerConsigne, ['pieces.consigne.retourner']],
  [
    'pieces.peutModifierParametragePieces',
    pieces.peutModifierParametragePieces,
    ['pieces.parametrage.modifier'],
  ],
  [
    'pieces.peutLireFactureFournisseur',
    pieces.peutLireFactureFournisseur,
    ['pieces.facture_fournisseur.lire'],
  ],
  [
    'pieces.peutDeposerFactureFournisseur',
    pieces.peutDeposerFactureFournisseur,
    ['pieces.facture_fournisseur.deposer'],
  ],
  [
    'pieces.peutDeciderFactureFournisseur',
    pieces.peutDeciderFactureFournisseur,
    ['pieces.facture_fournisseur.valider', 'pieces.facture_fournisseur.rejeter'],
  ],
  ['pneus.peutLireDepotPneus', pneus.peutLireDepotPneus, ['pneus.depot.lire']],
  ['pneus.peutCreerDepotPneus', pneus.peutCreerDepotPneus, ['pneus.depot.creer']],
  [
    'pneus.peutChangerSaisonDepotPneus',
    pneus.peutChangerSaisonDepotPneus,
    ['pneus.depot.changer_saison'],
  ],
  ['pneus.peutSortirDepotPneus', pneus.peutSortirDepotPneus, ['pneus.depot.sortir']],
  ['rendezVous.peutLireRendezVous', rendezVous.peutLireRendezVous, ['rendez_vous.lire']],
  ['rendezVous.peutCreerRendezVous', rendezVous.peutCreerRendezVous, ['rendez_vous.creer']],
  ['dossiers.peutLireDossierVente', dossiers.peutLireDossierVente, ['ventes.dossier.lire']],
  ['dossiers.peutEcrireDossierVente', dossiers.peutEcrireDossierVente, ['ventes.dossier.creer']],
  [
    'financements.peutLireFinancement',
    financements.peutLireFinancement,
    ['ventes.financement.lire'],
  ],
  [
    'financements.peutCreerFinancement',
    financements.peutCreerFinancement,
    ['ventes.financement.creer'],
  ],
  ['reprises.peutLireReprise', reprises.peutLireReprise, ['ventes.reprise.lire']],
  ['reprises.peutRefuserReprise', reprises.peutRefuserReprise, ['ventes.reprise.refuser']],
  ['reprises.peutConfirmerReprise', reprises.peutConfirmerReprise, ['ventes.reprise.confirmer']],
  ['stock.peutEcrireVehiculeStock', stock.peutEcrireVehiculeStock, ['ventes.vehicule_stock.creer']],
  [
    'stock.peutCorrigerVehiculeStock',
    stock.peutCorrigerVehiculeStock,
    ['ventes.vehicule_stock.corriger'],
  ],
];

describe('parité des droits web ↔ MATRICE_DROITS de l’API', () => {
  it.each(PARITE)(
    '%s suit exactement les actions du préréglage, pour les 9 rôles',
    (_nom, peut, actions) => {
      for (const role of ROLES_UTILISATEUR) {
        const attendu = actions.every((a) => MATRICE_DROITS[role].includes(a));
        expect(peut(MATRICE_DROITS[role]), `${_nom} pour ${role}`).toBe(attendu);
      }
    },
  );

  it('une session non chargée (actions indéfinies) n’a jamais aucun droit', () => {
    for (const [, peut] of PARITE) expect(peut(undefined)).toBe(false);
  });

  it('chaque action interrogée par le web existe dans TOUTES_ACTIONS', () => {
    const connues = new Set<string>(TOUTES_ACTIONS);
    for (const action of ACTIONS_CITEES) expect(connues.has(action), action).toBe(true);
  });
});
