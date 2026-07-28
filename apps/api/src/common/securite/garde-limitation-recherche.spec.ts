/**
 * Tests unitaires — finding D-01 (audit sécurité) : limitation de débit sur `GET /recherche`, par
 * utilisateur, jamais par IP. Style aligné sur `common/droits/garde-droit.spec.ts` (doublures
 * légères plutôt qu'un module Nest complet).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';

import type { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../contexte/contexte-requete.types';
import { ErreurMetier } from '../erreurs/erreur-metier';
import type { ResultatLimitationDebit, ServiceLimitationDebit } from '../limitation/limitation-debit.types';
import {
  GardeLimitationRecherche,
  LIMITE_RECHERCHE_FENETRE_SECONDES,
  LIMITE_RECHERCHE_UTILISATEUR,
} from './garde-limitation-recherche';

const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 'session-id',
  tenantId: 'tenant-abc',
  utilisateurId: 'utilisateur-xyz',
  role: 'receptionnaire',
  langue: 'fr',
};

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
  it('laisse passer et consomme le budget de la clé PAR UTILISATEUR (jamais par IP)', async () => {
    const limiteur = limiteurTest({ autorise: true, resteSecondes: 0 });
    const guard = new GardeLimitationRecherche(limiteur, contexteRequeteTest(PRINCIPAL));

    await expect(guard.canActivate(contexteExecutionTest())).resolves.toBe(true);

    expect(limiteur.consommer).toHaveBeenCalledWith(
      `recherche:utilisateur:${PRINCIPAL.utilisateurId}`,
      LIMITE_RECHERCHE_UTILISATEUR,
      LIMITE_RECHERCHE_FENETRE_SECONDES,
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

    await new GardeLimitationRecherche(limiteur, contexteRequeteTest(PRINCIPAL)).canActivate(contexteExecutionTest());
    await new GardeLimitationRecherche(limiteur, contexteRequeteTest(autrePrincipal)).canActivate(
      contexteExecutionTest(),
    );

    const cles = limiteur.consommer.mock.calls.map((appel) => appel[0] as string);
    expect(new Set(cles).size).toBe(2);
  });
});

describe('GardeLimitationRecherche — refusé (429)', () => {
  it('lève ErreurMetier AUTH_TROP_DE_TENTATIVES (429) avec Retry-After quand le budget est épuisé', async () => {
    const limiteur = limiteurTest({ autorise: false, resteSecondes: 17 });
    const guard = new GardeLimitationRecherche(limiteur, contexteRequeteTest(PRINCIPAL));

    expect.assertions(4);
    try {
      await guard.canActivate(contexteExecutionTest());
      expect.fail('devait lever');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      const erreurMetier = erreur as ErreurMetier;
      expect(erreurMetier.code).toBe('AUTH_TROP_DE_TENTATIVES');
      expect(erreurMetier.status).toBe(429);
      expect(erreurMetier.enTetes).toEqual({ 'Retry-After': '17' });
    }
  });
});

describe('GardeLimitationRecherche — défense en profondeur', () => {
  it("propage l'erreur si aucun principal n'est attaché (ne devrait jamais arriver, GardeSession tourne avant)", async () => {
    const limiteur = limiteurTest({ autorise: true, resteSecondes: 0 });
    const guard = new GardeLimitationRecherche(limiteur, contexteRequeteTest(null));

    await expect(guard.canActivate(contexteExecutionTest())).rejects.toThrow(
      'Aucun principal authentifié dans le contexte de la requête courante.',
    );
    expect(limiteur.consommer).not.toHaveBeenCalled();
  });
});
