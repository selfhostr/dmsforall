/**
 * Tests unitaires — finding D-01 (audit sécurité) : limitation de débit sur `GET /recherche`, par
 * utilisateur, jamais par IP. Style aligné sur `common/droits/garde-droit.spec.ts` (doublures
 * légères plutôt qu'un module Nest complet).
 *
 * Les seuils (`LIMITE_RECHERCHE_UTILISATEUR`/`LIMITE_RECHERCHE_FENETRE_SECONDES`) viennent
 * désormais du schéma zod de config (`apps/api/src/config/charger-config.ts`), injecté via
 * `JETON_CONFIG` — plus de constante en dur exportée par ce module, d'où la config de test
 * fabriquée ci-dessous plutôt qu'un import de constantes.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';

import type { Config } from '../../config/config.types';
import type { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../contexte/contexte-requete.types';
import { ErreurMetier } from '../erreurs/erreur-metier';
import type { ResultatLimitationDebit, ServiceLimitationDebit } from '../limitation/limitation-debit.types';
import { GardeLimitationRecherche } from './garde-limitation-recherche';

const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 'session-id',
  tenantId: 'tenant-abc',
  utilisateurId: 'utilisateur-xyz',
  role: 'receptionnaire',
  langue: 'fr',
};

/** Seuils de test délibérément différents des valeurs par défaut (40/30) pour prouver que le
 *  garde consomme bien la config injectée plutôt que des constantes figées. */
const LIMITE_RECHERCHE_UTILISATEUR_TEST = 40;
const LIMITE_RECHERCHE_FENETRE_SECONDES_TEST = 30;

function configTest(surcharges: Partial<Config> = {}): Config {
  return {
    LIMITE_RECHERCHE_UTILISATEUR: LIMITE_RECHERCHE_UTILISATEUR_TEST,
    LIMITE_RECHERCHE_FENETRE_SECONDES: LIMITE_RECHERCHE_FENETRE_SECONDES_TEST,
    ...surcharges,
  } as Config;
}

function contexteExecutionTest(): ExecutionContext {
  return {} as unknown as ExecutionContext;
}

function contexteRequeteTest(principal: PrincipalAuthentifie | null): ServiceContexteRequete {
  return {
    exigerPrincipal: vi.fn(() => {
      if (!principal) throw new Error('Aucun principal authentifié dans le contexte de la requête courante.');
      return principal;
    }),
  } as unknown as ServiceContexteRequete;
}

function limiteurTest(resultat: ResultatLimitationDebit): ServiceLimitationDebit & { consommer: ReturnType<typeof vi.fn> } {
  return {
    consommer: vi.fn().mockResolvedValue(resultat),
  } as unknown as ServiceLimitationDebit & { consommer: ReturnType<typeof vi.fn> };
}

describe('GardeLimitationRecherche — autorisé', () => {
  it('laisse passer et consomme le budget de la clé PAR UTILISATEUR (jamais par IP), avec les seuils de la config injectée', async () => {
    const limiteur = limiteurTest({ autorise: true, resteSecondes: 0 });
    const guard = new GardeLimitationRecherche(limiteur, configTest(), contexteRequeteTest(PRINCIPAL));

    await expect(guard.canActivate(contexteExecutionTest())).resolves.toBe(true);

    expect(limiteur.consommer).toHaveBeenCalledWith(
      `recherche:utilisateur:${PRINCIPAL.utilisateurId}`,
      LIMITE_RECHERCHE_UTILISATEUR_TEST,
      LIMITE_RECHERCHE_FENETRE_SECONDES_TEST,
    );
    // La clé ne doit contenir NI l'IP NI le tenant — seulement l'utilisateur (voir le commentaire de
    // tête de garde-limitation-recherche.ts : une limite par IP ou par tenant punirait les collègues
    // d'un même comptoir).
    const [cleUtilisee] = limiteur.consommer.mock.calls[0] as [string, number, number];
    expect(cleUtilisee).not.toContain(PRINCIPAL.tenantId);
  });

  it('deux utilisateurs distincts consomment deux budgets Redis distincts', async () => {
    const limiteur = limiteurTest({ autorise: true, resteSecondes: 0 });
    const autrePrincipal: PrincipalAuthentifie = { ...PRINCIPAL, utilisateurId: 'utilisateur-autre' };

    await new GardeLimitationRecherche(limiteur, configTest(), contexteRequeteTest(PRINCIPAL)).canActivate(
      contexteExecutionTest(),
    );
    await new GardeLimitationRecherche(limiteur, configTest(), contexteRequeteTest(autrePrincipal)).canActivate(
      contexteExecutionTest(),
    );

    const cles = limiteur.consommer.mock.calls.map((appel) => appel[0] as string);
    expect(new Set(cles).size).toBe(2);
  });

  it('utilise les seuils de la config injectée même quand ils diffèrent des valeurs par défaut du dépôt (40/30)', async () => {
    const limiteur = limiteurTest({ autorise: true, resteSecondes: 0 });
    const config = configTest({ LIMITE_RECHERCHE_UTILISATEUR: 5, LIMITE_RECHERCHE_FENETRE_SECONDES: 10 });
    const guard = new GardeLimitationRecherche(limiteur, config, contexteRequeteTest(PRINCIPAL));

    await guard.canActivate(contexteExecutionTest());

    expect(limiteur.consommer).toHaveBeenCalledWith(`recherche:utilisateur:${PRINCIPAL.utilisateurId}`, 5, 10);
  });
});

describe('GardeLimitationRecherche — refusé (429)', () => {
  it('lève ErreurMetier RECHERCHE_TROP_DE_REQUETES (code dédié, PAS AUTH_TROP_DE_TENTATIVES) en 429 avec Retry-After quand le budget est épuisé', async () => {
    const limiteur = limiteurTest({ autorise: false, resteSecondes: 17 });
    const guard = new GardeLimitationRecherche(limiteur, configTest(), contexteRequeteTest(PRINCIPAL));

    expect.assertions(5);
    try {
      await guard.canActivate(contexteExecutionTest());
      expect.fail('devait lever');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      const erreurMetier = erreur as ErreurMetier;
      expect(erreurMetier.code).toBe('RECHERCHE_TROP_DE_REQUETES');
      expect(erreurMetier.code).not.toBe('AUTH_TROP_DE_TENTATIVES');
      expect(erreurMetier.status).toBe(429);
      expect(erreurMetier.enTetes).toEqual({ 'Retry-After': '17' });
    }
  });
});

describe('GardeLimitationRecherche — défense en profondeur', () => {
  it("propage l'erreur si aucun principal n'est attaché (ne devrait jamais arriver, GardeSession tourne avant)", async () => {
    const limiteur = limiteurTest({ autorise: true, resteSecondes: 0 });
    const guard = new GardeLimitationRecherche(limiteur, configTest(), contexteRequeteTest(null));

    await expect(guard.canActivate(contexteExecutionTest())).rejects.toThrow(
      'Aucun principal authentifié dans le contexte de la requête courante.',
    );
    expect(limiteur.consommer).not.toHaveBeenCalled();
  });
});
