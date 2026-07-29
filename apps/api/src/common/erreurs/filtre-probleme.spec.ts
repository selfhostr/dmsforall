import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArgumentsHost,
  ForbiddenException,
  HttpException,
  HttpStatus,
  MethodNotAllowedException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ActionProposee, ElementBloquant } from '@dfa/shared';
import { ErreurIdentifiantsInvalides } from '../../auth/erreurs-auth';
import type { PrincipalAuthentifie } from '../contexte/contexte-requete.types';
import type { ServiceContexteRequete } from '../contexte/contexte-requete.service';
import type { ServiceJournal } from '../journal/service-journal';
import { ErreurMetier } from './erreur-metier';
import { FiltreProbleme } from './filtre-probleme';

// `vi.mock` est hoisté par vitest au-dessus des imports statiques ci-dessus : pas besoin d'un
// import dynamique pour que FiltreProbleme reçoive la version mockée de capturerErreurInattendue.
const capturerErreurInattendue = vi.hoisted(() => vi.fn());
vi.mock('../../observabilite', () => ({ capturerErreurInattendue }));

const PRINCIPAL_TEST: PrincipalAuthentifie = {
  sessionId: 'session-id',
  tenantId: 'tenant-id-uuid',
  utilisateurId: 'utilisateur-id',
  role: 'admin',
  langue: 'fr',
};

function serviceContexteTest(principal: PrincipalAuthentifie | null = null): ServiceContexteRequete {
  return {
    actuelOuNull: vi.fn().mockReturnValue({
      requeteId: 'requete-id-1',
      debutLe: new Date(),
      ip: null,
      userAgent: null,
      langue: 'fr',
      principal,
    }),
  } as unknown as ServiceContexteRequete;
}

function serviceJournalTest(): ServiceJournal {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ServiceJournal;
}

/** Requête HTTP simulée — `route.path` est le PATRON (ex. `/clients/:id`), jamais l'URL résolue. */
function requeteTest(options: { method?: string; routePath?: string; url?: string } = {}): Request {
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/api/v1/clients/aa11bb22-vin-plaque',
    route: options.routePath !== undefined ? { path: options.routePath } : undefined,
  } as unknown as Request;
}

function reponseTest(): Response {
  const reponse = {
    status: vi.fn().mockReturnThis(),
    contentType: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return reponse as unknown as Response;
}

function hostTest(requete: Request, reponse: Response): ArgumentsHost {
  return {
    switchToHttp: () => ({ getRequest: () => requete, getResponse: () => reponse }),
  } as unknown as ArgumentsHost;
}

describe('FiltreProbleme — envoi Sentry réservé aux erreurs INATTENDUES', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('capture une ErreurMetier ERREUR_INTERNE, avec un contexte technique uniquement (tenantId, role, patron de route)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(PRINCIPAL_TEST), serviceJournalTest());
    const requete = requeteTest({ method: 'POST', routePath: '/api/v1/clients/:id' });
    const reponse = reponseTest();
    const exception = new ErreurMetier('ERREUR_INTERNE', 'panne interne');

    filtre.catch(exception, hostTest(requete, reponse));

    expect(capturerErreurInattendue).toHaveBeenCalledTimes(1);
    expect(capturerErreurInattendue).toHaveBeenCalledWith(exception, {
      requeteId: 'requete-id-1',
      tenantId: 'tenant-id-uuid',
      role: 'admin',
      endpoint: '/api/v1/clients/:id',
      methode: 'POST',
    });
  });

  it('ne capture PAS une ErreurMetier normale (401 identifiants invalides) — ce n\'est pas un incident', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const exception = new ErreurMetier('AUTH_IDENTIFIANTS_INVALIDES', 'identifiants invalides');

    filtre.catch(exception, hostTest(requeteTest(), reponseTest()));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
  });

  it('ne capture PAS une HttpException déjà porteuse d\'un code métier (ex. ErreurIdentifiantsInvalides du module auth)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const exception = new ErreurIdentifiantsInvalides();

    filtre.catch(exception, hostTest(requeteTest(), reponseTest()));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
  });

  it('une route inexistante (404 NotFoundException générique Nest) reste un 404 — jamais travesti en panne serveur', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const reponse = reponseTest();
    const exception = new NotFoundException('Cannot GET /api/sante');

    filtre.catch(exception, hostTest(requeteTest({ routePath: undefined }), reponse));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
    expect(reponse.status).toHaveBeenCalledWith(404);
    // Même code que la « ressource d'un autre tenant » (voir services métier) : une route qui
    // n'existe pas et une ressource hors périmètre tenant doivent rester indistinguables par le
    // `code` — sans quoi le 404 devient un canal d'énumération inter-tenant.
    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).toMatchObject({ code: 'RESSOURCE_INTROUVABLE', status: 404 });
  });

  it('une méthode HTTP non supportée (405 MethodNotAllowedException générique Nest) reste un 405 — jamais travesti en panne serveur', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const reponse = reponseTest();
    const exception = new MethodNotAllowedException('Cannot DELETE /api/v1/sante');

    filtre.catch(exception, hostTest(requeteTest({ method: 'DELETE' }), reponse));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
    expect(reponse.status).toHaveBeenCalledWith(405);
    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).toMatchObject({ code: 'METHODE_NON_AUTORISEE', status: 405 });
  });

  it('ne capture PAS un 403 générique Nest (ForbiddenException sans code métier)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const exception = new ForbiddenException('interdit');

    filtre.catch(exception, hostTest(requeteTest(), reponseTest()));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
  });

  it('capture une HttpException générique dont le statut D\'ORIGINE est déjà serveur (>= 500) — comportement 5xx inchangé, normalisé en 500', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const reponse = reponseTest();
    const exception = new HttpException('service externe indisponible', HttpStatus.BAD_GATEWAY);

    filtre.catch(exception, hostTest(requeteTest(), reponse));

    expect(capturerErreurInattendue).toHaveBeenCalledTimes(1);
    expect(reponse.status).toHaveBeenCalledWith(500);
  });

  it('un corps JSON malformé reste toujours un 400 VALIDATION_ECHOUEE', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const reponse = reponseTest();
    const exception = new HttpException('JSON malformé', HttpStatus.BAD_REQUEST);

    filtre.catch(exception, hostTest(requeteTest(), reponse));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
    expect(reponse.status).toHaveBeenCalledWith(400);
    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('une exception non typée (erreur de programmation) reste toujours un 500, sans détail interne exposé', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(PRINCIPAL_TEST), serviceJournalTest());
    const reponse = reponseTest();
    const exceptionNonTypee = new TypeError('undefined is not a function — détail interne sensible');

    filtre.catch(exceptionNonTypee, hostTest(requeteTest({ routePath: '/api/v1/atelier/or/:id' }), reponse));

    expect(reponse.status).toHaveBeenCalledWith(500);
    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).toMatchObject({ code: 'ERREUR_INTERNE', status: 500 });
    expect(JSON.stringify(corpsEnvoye)).not.toContain('détail interne sensible');
  });

  it('capture toute exception non typée (erreur de programmation)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(PRINCIPAL_TEST), serviceJournalTest());
    const exception = new TypeError('undefined is not a function');

    filtre.catch(exception, hostTest(requeteTest({ routePath: '/api/v1/atelier/or/:id' }), reponseTest()));

    expect(capturerErreurInattendue).toHaveBeenCalledTimes(1);
    const contexteEnvoye = capturerErreurInattendue.mock.calls[0]?.[1];
    expect(contexteEnvoye.endpoint).toBe('/api/v1/atelier/or/:id');
  });

  it('n\'a jamais l\'URL résolue (avec ses valeurs de paramètre) comme endpoint — seulement le patron de route', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    // route.path absent (peut arriver avant résolution complète du routeur) : endpoint doit
    // rester undefined plutôt que de retomber sur `requete.url`, qui porterait un VIN/plaque/id.
    const requete = requeteTest({ routePath: undefined, url: '/api/v1/vehicules/WVWZZZ1KZAW123456' });

    filtre.catch(new Error('boum'), hostTest(requete, reponseTest()));

    const contexteEnvoye = capturerErreurInattendue.mock.calls[0]?.[1];
    expect(contexteEnvoye.endpoint).toBeUndefined();
  });

  it('n\'envoie jamais tenantId/role si aucun principal n\'est attaché au contexte (route publique)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(null), serviceJournalTest());

    filtre.catch(new Error('boum'), hostTest(requeteTest(), reponseTest()));

    const contexteEnvoye = capturerErreurInattendue.mock.calls[0]?.[1];
    expect(contexteEnvoye.tenantId).toBeUndefined();
    expect(contexteEnvoye.role).toBeUndefined();
  });
});

describe('FiltreProbleme — blocages, confirmationsRequises et actionsProposees (invariant « aucun refus sans chemin de sortie »)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('émet blocages ET actionsProposees dans le corps problem+json d\'un refus complet (409 OR_LIGNES_A_VALIDER)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(PRINCIPAL_TEST), serviceJournalTest());
    const reponse = reponseTest();
    const blocages: readonly ElementBloquant[] = [
      { type: 'ligne_or', id: 'ligne-1', libelle: 'Ligne 1 — remplacement plaquettes' },
      { type: 'technicien', id: 'technicien-1', libelle: 'Pointage encore ouvert' },
    ];
    const actionsProposees: readonly ActionProposee[] = [
      { code: 'VALIDER_LIGNES', methode: 'POST', chemin: '/api/v1/atelier/or/or-1/lignes/valider' },
      { code: 'ARRETER_POINTAGES' },
    ];
    const exception = new ErreurMetier('OR_LIGNES_A_VALIDER', 'des lignes attendent une décision', {
      blocages,
      actionsProposees,
    });

    filtre.catch(exception, hostTest(requeteTest(), reponse));

    expect(reponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'OR_LIGNES_A_VALIDER',
        blocages,
        actionsProposees,
      }),
    );
    // Pas de confirmationsRequises sur ce refus : absent du corps, jamais `undefined` posé.
    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).not.toHaveProperty('confirmationsRequises');
  });

  it('émet confirmationsRequises dans le corps problem+json d\'un 409 CONFIRMATION_REQUISE', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(PRINCIPAL_TEST), serviceJournalTest());
    const reponse = reponseTest();
    const exception = new ErreurMetier('CONFIRMATION_REQUISE', 'confirmation requise', {
      confirmationsRequises: ['CLIENT_BLOQUE'],
      actionsProposees: [{ code: 'REJOUER_AVEC_CONFIRMATION' }],
    });

    filtre.catch(exception, hostTest(requeteTest(), reponse));

    expect(reponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONFIRMATION_REQUISE',
        confirmationsRequises: ['CLIENT_BLOQUE'],
        actionsProposees: [{ code: 'REJOUER_AVEC_CONFIRMATION' }],
      }),
    );
    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).not.toHaveProperty('blocages');
  });

  it("n'émet aucun des trois champs quand l'ErreurMetier ne les porte pas (comportement inchangé)", () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const reponse = reponseTest();
    const exception = new ErreurMetier('RESSOURCE_INTROUVABLE', 'client introuvable');

    filtre.catch(exception, hostTest(requeteTest(), reponse));

    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).not.toHaveProperty('blocages');
    expect(corpsEnvoye).not.toHaveProperty('confirmationsRequises');
    expect(corpsEnvoye).not.toHaveProperty('actionsProposees');
  });

  it("n'envoie jamais blocages/actionsProposees à Sentry — même quand l'ErreurMetier ERREUR_INTERNE les porte (le contexte Sentry reste limité à des identifiants techniques)", () => {
    const filtre = new FiltreProbleme(serviceContexteTest(PRINCIPAL_TEST), serviceJournalTest());
    const requete = requeteTest({ method: 'POST', routePath: '/api/v1/atelier/or/:id/cloturer' });
    const reponse = reponseTest();
    // Un `libelle` porteur d'un nom de technicien : donnée personnelle sous nLPD, jamais
    // acceptable dans le contexte de diagnostic envoyé à Sentry (voir observabilite/nettoyer-evenement.ts).
    const blocages: readonly ElementBloquant[] = [
      { type: 'technicien', id: 'technicien-1', libelle: 'Pointage ouvert — Jean Dupont' },
    ];
    const exception = new ErreurMetier('ERREUR_INTERNE', 'panne interne pendant la clôture', { blocages });

    filtre.catch(exception, hostTest(requete, reponse));

    expect(capturerErreurInattendue).toHaveBeenCalledTimes(1);
    // Assertion stricte (toEqual, pas objectContaining) : le contexte Sentry n'a PAS de clé
    // `blocages` — s'il en gagnait une un jour, cette assertion échouerait avant que la donnée
    // personnelle n'atteigne réellement le réseau.
    expect(capturerErreurInattendue).toHaveBeenCalledWith(exception, {
      requeteId: 'requete-id-1',
      tenantId: 'tenant-id-uuid',
      role: 'admin',
      endpoint: '/api/v1/atelier/or/:id/cloturer',
      methode: 'POST',
    });
    // Le corps HTTP, lui, porte bien blocages — c'est la réponse au client, pas l'envoi Sentry.
    const corpsEnvoye = (reponse.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(corpsEnvoye).toHaveProperty('blocages', blocages);
  });
});
