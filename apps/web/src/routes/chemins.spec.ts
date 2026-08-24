import { describe, expect, it } from 'vitest';

import { chemins } from './chemins';

describe('chemins.clients', () => {
  it('construit la liste sans site', () => {
    expect(chemins.clients.liste()).toBe('/clients');
  });

  it('conserve le site sélectionné en paramètre de requête', () => {
    expect(chemins.clients.liste('site-lausanne')).toBe('/clients?site=site-lausanne');
  });

  it('construit le chemin de détail avec id', () => {
    expect(chemins.clients.detail('abc-123', 'site-1')).toBe('/clients/abc-123?site=site-1');
  });

  it('construit le chemin de fusion', () => {
    expect(chemins.clients.fusion('abc-123', 'site-1')).toBe('/clients/abc-123/fusion?site=site-1');
  });

  it('construit le chemin des doublons, sans aucun paramètre (RM-05 n’est pas scopé par site)', () => {
    expect(chemins.clients.doublons()).toBe('/clients/doublons');
  });
});

describe('chemins.vehicules', () => {
  it('construit la liste, la création et le détail', () => {
    expect(chemins.vehicules.liste('site-1')).toBe('/vehicules?site=site-1');
    expect(chemins.vehicules.nouveau('site-1')).toBe('/vehicules/nouveau?site=site-1');
    expect(chemins.vehicules.detail('veh-1', 'site-1')).toBe('/vehicules/veh-1?site=site-1');
  });

  it('omet le paramètre de requête quand aucun site n’est fourni', () => {
    expect(chemins.vehicules.detail('veh-1')).toBe('/vehicules/veh-1');
  });
});

describe('chemins.parametrage', () => {
  it('construit le chemin du bloc créancier, singleton par tenant — jamais de `?site=`', () => {
    expect(chemins.parametrage.facturation()).toBe('/parametrage/facturation');
  });

  it('construit le chemin des référentiels (taux horaires, prestations), singleton par tenant', () => {
    expect(chemins.parametrage.referentiels()).toBe('/parametrage/referentiels');
  });

  it('construit le chemin du paramétrage atelier, singleton par tenant', () => {
    expect(chemins.parametrage.atelier()).toBe('/parametrage/atelier');
  });

  it('construit le chemin des sites en conservant le site sélectionné (scopé, à la différence des autres entrées de paramétrage)', () => {
    expect(chemins.parametrage.sites()).toBe('/parametrage/sites');
    expect(chemins.parametrage.sites('site-1')).toBe('/parametrage/sites?site=site-1');
  });

  it('construit le chemin des paliers de relance (scission de l’ancien écran unique), singleton par tenant', () => {
    expect(chemins.parametrage.relances()).toBe('/parametrage/relances');
  });
});

/**
 * Ajouté au Lot D : la facturation n'avait aucun constructeur, la barre latérale pointait
 * `/factures` en chaîne brute et perdait le site courant à chaque clic — l'en-tête retombait alors
 * sur « Tous les sites » sans que l'utilisateur ait changé de site.
 */
describe('chemins.facturation', () => {
  it('conserve le site courant, sans jamais l’inventer', () => {
    expect(chemins.facturation.liste()).toBe('/factures');
    expect(chemins.facturation.liste('site-1')).toBe('/factures?site=site-1');
  });

  it('construit la fiche et l’avoir (dont l’identifiant est la facture d’ORIGINE)', () => {
    expect(chemins.facturation.detail('fac-1')).toBe('/factures/fac-1');
    expect(chemins.facturation.avoir('fac-1', 'site-1')).toBe('/factures/fac-1/avoir?site=site-1');
  });
});

/** La création d'OR est la SEULE route de la ressource hors du préfixe `/ordres-reparation` — sans
 *  constructeur, elle restait le seul écran d'atelier que le modèle de navigation ne savait pas
 *  rattacher à son onglet. */
describe('chemins.atelier.ordresReparation', () => {
  it('construit la création avec ses deux paramètres de requête, jamais de paramètre de chemin', () => {
    expect(chemins.atelier.ordresReparation.nouveau()).toBe('/atelier/ordres-reparation/nouveau');
    expect(chemins.atelier.ordresReparation.nouveau('site-1', 'client-9')).toBe(
      '/atelier/ordres-reparation/nouveau?site=site-1&clientId=client-9',
    );
  });

  it('construit la passerelle de facturation d’un OR', () => {
    expect(chemins.atelier.ordresReparation.facturer('or-1')).toBe(
      '/ordres-reparation/or-1/facturer',
    );
  });
});

describe('chemins.pieces', () => {
  it('construit la recherche comptoir, scopée par site', () => {
    expect(chemins.pieces.rechercheComptoir()).toBe('/pieces/recherche-comptoir');
    expect(chemins.pieces.rechercheComptoir('site-1')).toBe(
      '/pieces/recherche-comptoir?site=site-1',
    );
  });

  it('construit la liste et le détail d’un article', () => {
    expect(chemins.pieces.articles('site-1')).toBe('/pieces/articles?site=site-1');
    expect(chemins.pieces.articleDetail('art-1', 'site-1')).toBe(
      '/pieces/articles/art-1?site=site-1',
    );
    expect(chemins.pieces.articleDetail('art-1')).toBe('/pieces/articles/art-1');
  });

  it('construit les réservations et le réapprovisionnement', () => {
    expect(chemins.pieces.reservations('site-1')).toBe('/pieces/reservations?site=site-1');
    expect(chemins.pieces.reapprovisionnement('site-1')).toBe(
      '/pieces/reapprovisionnement?site=site-1',
    );
  });
});

/**
 * Module pointage (lot 2, fusion Lot D) — `cloture()` construit toujours `/pointage/cloture`,
 * INCHANGÉ malgré la fusion des écrans dans `EcranPointage` (voir `routeur.tsx` : la route rend
 * désormais cet écran fusionné, et `composants/layout/navigation-modele.ts`, hors périmètre de
 * `routes/`, dépend encore de ce constructeur pour sa vue « Clôture »). Ce test verrouille cette
 * décision dans le sens inverse : il rougit si quelqu'un retire `cloture()` en croyant achever la
 * fusion sans vérifier ses appelants hors `routes/`.
 */
describe('chemins.pointage', () => {
  it('construit jour, équipe et clôture, conservés tels quels malgré la fusion des écrans', () => {
    expect(chemins.pointage.jour('site-1')).toBe('/pointage/jour?site=site-1');
    expect(chemins.pointage.equipe('site-1')).toBe('/pointage/equipe?site=site-1');
    expect(chemins.pointage.cloture('site-1')).toBe('/pointage/cloture?site=site-1');
  });
});

/**
 * Hangar à pneus (Lot B, fusion Lot D) — `aRelancer` a changé de FORME au Lot D : l'ancien écran
 * séparé (`EcranJeuxARelancer`) est supprimé, fusionné dans `EcranHangarPneus` comme onglet lu
 * depuis `?onglet=`. Ce test verrouille la nouvelle forme, celle que lit réellement
 * `EcranHangarPneus.tsx` (`searchParams.get('onglet')`) — pas l'ancienne route `/pneus/a-relancer`,
 * retirée de `routeur.tsx` faute d'écran à monter.
 */
describe('chemins.pneus', () => {
  it('construit le plan du hangar', () => {
    expect(chemins.pneus.hangar()).toBe('/pneus');
    expect(chemins.pneus.hangar('site-1')).toBe('/pneus?site=site-1');
  });

  it('construit « à relancer » comme un onglet de /pneus, jamais comme une route séparée', () => {
    expect(chemins.pneus.aRelancer()).toBe('/pneus?onglet=a_relancer');
    expect(chemins.pneus.aRelancer('site-1')).toBe('/pneus?onglet=a_relancer&site=site-1');
  });
});
