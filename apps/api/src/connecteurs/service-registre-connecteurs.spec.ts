import { describe, expect, it, vi } from 'vitest';

import type { ContexteTenant } from '../db';
import type { ServiceJournal } from '../common/journal';

import type { AdaptateurConnecteur } from './adaptateur-connecteur';
import { RegistreConnecteursService } from './service-registre-connecteurs';
import {
  SourceActivationsConnecteurAucune,
  type DescripteurActivationConnecteur,
  type SourceActivationsConnecteur,
} from './source-activations-connecteur';

/**
 * Item A du socle (étape 5) : la résolution d'un connecteur pour un tenant — le cas normal
 * aujourd'hui est « aucun connecteur actif », et ce chemin doit rester propre (pas d'exception,
 * pas de journal d'alerte). Prouve aussi l'isolement tenant et le cas d'une activation sans
 * adaptateur déployé.
 */

const CTX_TENANT_A: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'u1', requeteId: null };
const CTX_TENANT_B: ContexteTenant = { tenantId: 'tenant-b', utilisateurId: 'u2', requeteId: null };

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

function adaptateurFactice(typeConnecteurCode: string): AdaptateurConnecteur {
  return {
    nomInterface: 'ListingPublisher',
    typeConnecteurCode,
    executer: vi.fn(),
  };
}

describe('RegistreConnecteursService', () => {
  it('résout `null` quand aucune activation n’existe pour ce tenant — cas normal, aucune alerte', async () => {
    const journal = journalFactice();
    const registre = new RegistreConnecteursService(
      new SourceActivationsConnecteurAucune(),
      [adaptateurFactice('factice_listing_publisher')],
      journal,
    );

    const resolu = await registre.resoudre(CTX_TENANT_A, 'ListingPublisher');

    expect(resolu).toBeNull();
    expect(journal.warn).not.toHaveBeenCalled();
    expect(journal.error).not.toHaveBeenCalled();
  });

  it('résout `null` pour `NotificationSender` quand aucune activation n’existe — cas normal aujourd’hui, aucun garage n’a de connecteur de messagerie', async () => {
    const journal = journalFactice();
    const registre = new RegistreConnecteursService(
      new SourceActivationsConnecteurAucune(),
      [adaptateurFactice('factice_listing_publisher')],
      journal,
    );

    const resolu = await registre.resoudre(CTX_TENANT_A, 'NotificationSender');

    expect(resolu).toBeNull();
    expect(journal.warn).not.toHaveBeenCalled();
    expect(journal.error).not.toHaveBeenCalled();
  });

  it('résout l’adaptateur dont le code correspond à l’activation active du tenant', async () => {
    const activation: DescripteurActivationConnecteur = {
      id: 'act-1',
      typeConnecteurCode: 'factice_listing_publisher',
      nomInterface: 'ListingPublisher',
      siteId: null,
      politiqueNouvellesTentatives: null,
    };
    const source: SourceActivationsConnecteur = {
      activationActive: vi.fn().mockResolvedValue(activation),
    };
    const adaptateur = adaptateurFactice('factice_listing_publisher');
    const registre = new RegistreConnecteursService(source, [adaptateur], journalFactice());

    const resolu = await registre.resoudre(CTX_TENANT_A, 'ListingPublisher');

    expect(resolu).toEqual({ adaptateur, activation });
  });

  it('rend `null` et journalise un avertissement quand l’activation référence un type sans adaptateur déployé', async () => {
    const activation: DescripteurActivationConnecteur = {
      id: 'act-1',
      typeConnecteurCode: 'type_annonce_par_avance_aucun_adaptateur',
      nomInterface: 'ListingPublisher',
      siteId: null,
      politiqueNouvellesTentatives: null,
    };
    const source: SourceActivationsConnecteur = {
      activationActive: vi.fn().mockResolvedValue(activation),
    };
    const journal = journalFactice();
    const registre = new RegistreConnecteursService(
      source,
      [adaptateurFactice('factice_listing_publisher')],
      journal,
    );

    const resolu = await registre.resoudre(CTX_TENANT_A, 'ListingPublisher');

    expect(resolu).toBeNull();
    expect(journal.warn).toHaveBeenCalledWith(
      'connecteurs.registre.adaptateur_introuvable',
      expect.objectContaining({ typeConnecteurCode: 'type_annonce_par_avance_aucun_adaptateur' }),
    );
  });

  it('isole la résolution par tenant : la source est interrogée avec le contexte exact de chaque appelant', async () => {
    const activationA: DescripteurActivationConnecteur = {
      id: 'act-a',
      typeConnecteurCode: 'factice_listing_publisher',
      nomInterface: 'ListingPublisher',
      siteId: null,
      politiqueNouvellesTentatives: null,
    };
    const source: SourceActivationsConnecteur = {
      activationActive: vi.fn(async (contexte: ContexteTenant) => {
        return contexte.tenantId === CTX_TENANT_A.tenantId ? activationA : null;
      }),
    };
    const adaptateur = adaptateurFactice('factice_listing_publisher');
    const registre = new RegistreConnecteursService(source, [adaptateur], journalFactice());

    const resoluA = await registre.resoudre(CTX_TENANT_A, 'ListingPublisher');
    const resoluB = await registre.resoudre(CTX_TENANT_B, 'ListingPublisher');

    expect(resoluA).toEqual({ adaptateur, activation: activationA });
    expect(resoluB).toBeNull();
    expect(source.activationActive).toHaveBeenNthCalledWith(
      1,
      CTX_TENANT_A,
      'ListingPublisher',
      null,
    );
    expect(source.activationActive).toHaveBeenNthCalledWith(
      2,
      CTX_TENANT_B,
      'ListingPublisher',
      null,
    );
  });
});
