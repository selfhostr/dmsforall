/**
 * Tests de la portée de site d'un compte de service (borne d'atelier).
 *
 * Ce qui est réellement en jeu ici, et qu'aucun test de matrice ne couvre : `MATRICE_DROITS` dit
 * QUOI un rôle peut faire, elle ne dit rien de SUR QUEL SITE. Pour une borne, la réponse est « un
 * seul, celui de son compte » — et elle doit venir de la SESSION, jamais de la requête. Les cas
 * d'attaque couverts :
 *
 *  - une borne du site A demande une action sur le site B (le PIN d'un collègue d'un autre garage
 *    du même prestataire, un pointage imputé au mauvais atelier) → refus 403 ;
 *  - un principal de compte de service dont le site est ABSENT (migration 0037 non appliquée,
 *    fonction d'amorçage périmée, principal fabriqué) → refus, jamais « aucune restriction » ;
 *  - un compte de personne, lui, n'est restreint par aucun site — le comportement du produit ne
 *    change pas d'un pouce pour les huit rôles existants.
 */
import { describe, expect, it } from 'vitest';
import { ROLES_PERSONNE, type RoleUtilisateur } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import {
  SESSION_COMPTE_DE_SERVICE_DUREE_MINUTES,
  SESSION_COMPTE_DE_SERVICE_INACTIVITE_MINUTES,
  dureeSessionMinutes,
  exigerSiteDuCompteDeService,
  inactiviteSessionMinutes,
  siteImposeAuPrincipal,
  verifierSiteAutorise,
} from './comptes-de-service';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';

function principal(role: RoleUtilisateur, siteId?: string | null): PrincipalAuthentifie {
  return {
    sessionId: '33333333-3333-4333-8333-333333333333',
    tenantId: '44444444-4444-4444-8444-444444444444',
    utilisateurId: '55555555-5555-4555-8555-555555555555',
    role,
    langue: 'fr',
    ...(siteId === undefined ? {} : { siteId }),
  };
}

describe('siteImposeAuPrincipal — portée de site résolue depuis la session', () => {
  it('rend null pour chacun des 8 rôles de personne : aucune autorisation du produit n’est scopée par site, le comportement de l’étape 0 est strictement préservé', () => {
    for (const role of ROLES_PERSONNE) {
      expect(siteImposeAuPrincipal(principal(role, null)), role).toBeNull();
    }
  });

  it('rend null pour un compte de personne MÊME si un siteId traîne sur le principal : le site d’une personne ne restreint rien (la contrainte de base l’interdit d’ailleurs), et le lire comme une restriction créerait une règle d’autorisation fantôme', () => {
    expect(siteImposeAuPrincipal(principal('technicien', SITE_A))).toBeNull();
  });

  it('rend le site du compte pour un compte de service', () => {
    expect(siteImposeAuPrincipal(principal('poste_atelier', SITE_A))).toBe(SITE_A);
  });

  it('REFUSE (401 AUTH_SESSION_EXPIREE) un compte de service dont le site est null — fail-closed : un serveur qui ne sait pas à quel site appartient une borne ne doit pas la laisser agir « partout »', () => {
    expect(() => siteImposeAuPrincipal(principal('poste_atelier', null))).toThrowError();
    try {
      siteImposeAuPrincipal(principal('poste_atelier', null));
      expect.unreachable('aurait dû lever');
    } catch (erreur) {
      expect((erreur as { code?: string }).code).toBe('AUTH_SESSION_EXPIREE');
    }
  });

  it('REFUSE de la même façon un compte de service dont le champ siteId est carrément ABSENT (principal construit avant la migration 0037, ou à la main) : l’absence ne doit jamais être lue comme « aucune restriction »', () => {
    expect(() => siteImposeAuPrincipal(principal('poste_atelier', undefined))).toThrowError();
  });
});

describe('exigerSiteDuCompteDeService — le site d’une borne, exigé', () => {
  it('rend le site pour un compte de service', () => {
    expect(exigerSiteDuCompteDeService(principal('poste_atelier', SITE_B))).toBe(SITE_B);
  });

  it('refuse un compte de PERSONNE : un geste réservé à la borne (identification par PIN) n’a aucun sens depuis une session nominative, et l’autoriser offrirait un oracle de PIN à tout compte du tenant', () => {
    for (const role of ROLES_PERSONNE) {
      expect(() => exigerSiteDuCompteDeService(principal(role, null)), role).toThrowError();
    }
  });
});

describe('verifierSiteAutorise — accès inter-sites', () => {
  it('laisse passer un compte de personne sur n’importe quel site du tenant (aucune régression sur l’existant)', () => {
    for (const role of ROLES_PERSONNE) {
      expect(() => verifierSiteAutorise(principal(role, null), SITE_A), role).not.toThrow();
      expect(() => verifierSiteAutorise(principal(role, null), SITE_B), role).not.toThrow();
    }
  });

  it('laisse passer une borne sur SON site', () => {
    expect(() => verifierSiteAutorise(principal('poste_atelier', SITE_A), SITE_A)).not.toThrow();
  });

  it('REFUSE une borne sur un AUTRE site du même tenant, avec 403 DROIT_INSUFFISANT — c’est le scénario multi-garages : la borne du garage de Sion ne doit pas pouvoir pointer, ni lire les PIN, sur le garage de Martigny', () => {
    try {
      verifierSiteAutorise(principal('poste_atelier', SITE_A), SITE_B);
      expect.unreachable('aurait dû lever');
    } catch (erreur) {
      expect((erreur as { code?: string }).code).toBe('DROIT_INSUFFISANT');
      expect((erreur as { getStatus?: () => number }).getStatus?.()).toBe(403);
    }
  });

  it('REFUSE une borne sans site plutôt que de la laisser passer partout (fail-closed hérité de siteImposeAuPrincipal)', () => {
    expect(() => verifierSiteAutorise(principal('poste_atelier', null), SITE_A)).toThrowError();
  });
});

describe('durées de session — un compte de service ne se déconnecte pas au milieu d’un service', () => {
  it('applique la durée de configuration aux 8 rôles de personne, sans exception', () => {
    for (const role of ROLES_PERSONNE) {
      expect(dureeSessionMinutes(role, 480), role).toBe(480);
      expect(inactiviteSessionMinutes(role, 120), role).toBe(120);
    }
  });

  it('substitue les durées longues pour un compte de service', () => {
    expect(dureeSessionMinutes('poste_atelier', 480)).toBe(SESSION_COMPTE_DE_SERVICE_DUREE_MINUTES);
    expect(inactiviteSessionMinutes('poste_atelier', 120)).toBe(
      SESSION_COMPTE_DE_SERVICE_INACTIVITE_MINUTES,
    );
  });

  it('garantit que la session d’une borne survit à une journée de travail ET à un week-end — sans quoi RM-129 s’effondre : quelqu’un devrait retaper le mot de passe de la borne devant l’atelier, et les techniciens finiraient par le connaître', () => {
    const MINUTES_PAR_JOUR = 24 * 60;
    expect(SESSION_COMPTE_DE_SERVICE_DUREE_MINUTES).toBeGreaterThan(30 * MINUTES_PAR_JOUR);
    expect(SESSION_COMPTE_DE_SERVICE_INACTIVITE_MINUTES).toBeGreaterThan(3 * MINUTES_PAR_JOUR);
    // …tout en restant BORNÉE : une session de service reste révocable et finit par expirer. Une
    // durée infinie (ou absurdement longue) ferait de la tablette un jeton permanent.
    expect(SESSION_COMPTE_DE_SERVICE_DUREE_MINUTES).toBeLessThanOrEqual(365 * MINUTES_PAR_JOUR);
    // L'inactivité doit rester strictement inférieure à la durée absolue, sinon elle ne joue
    // jamais et la borne n'est plus jamais déconnectée par l'inactivité.
    expect(SESSION_COMPTE_DE_SERVICE_INACTIVITE_MINUTES).toBeLessThan(
      SESSION_COMPTE_DE_SERVICE_DUREE_MINUTES,
    );
  });
});
