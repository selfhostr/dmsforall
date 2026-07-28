import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentsHost, ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
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

  it('ne capture PAS une route inexistante (404 NotFoundException générique Nest) — trafic routinier, pas un incident', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const reponse = reponseTest();
    const exception = new NotFoundException('Cannot GET /api/sante');

    filtre.catch(exception, hostTest(requeteTest({ routePath: undefined }), reponse));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
    // Le corps répond quand même en problem+json (contrat conservé), même si le statut retombe
    // sur ERREUR_INTERNE/500 par normalisation existante — seul le NON-ENVOI à Sentry change ici.
    expect(reponse.status).toHaveBeenCalledWith(500);
  });

  it('ne capture PAS un 403 générique Nest (ForbiddenException sans code métier)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const exception = new ForbiddenException('interdit');

    filtre.catch(exception, hostTest(requeteTest(), reponseTest()));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
  });

  it('capture une HttpException générique dont le statut D\'ORIGINE est déjà serveur (>= 500)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const exception = new HttpException('service externe indisponible', HttpStatus.BAD_GATEWAY);

    filtre.catch(exception, hostTest(requeteTest(), reponseTest()));

    expect(capturerErreurInattendue).toHaveBeenCalledTimes(1);
  });

  it('ne capture PAS un 400 générique (corps JSON malformé, VALIDATION_ECHOUEE)', () => {
    const filtre = new FiltreProbleme(serviceContexteTest(), serviceJournalTest());
    const exception = new HttpException('JSON malformé', HttpStatus.BAD_REQUEST);

    filtre.catch(exception, hostTest(requeteTest(), reponseTest()));

    expect(capturerErreurInattendue).not.toHaveBeenCalled();
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
