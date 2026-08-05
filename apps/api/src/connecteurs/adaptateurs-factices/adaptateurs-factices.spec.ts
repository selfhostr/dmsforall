import { describe, expect, it, vi } from 'vitest';

import type { ServiceJournal } from '../../common/journal';
import type { RequeteOperationConnecteur } from '../adaptateur-connecteur';

import { AdaptateurAccountingExporterFactice } from './adaptateur-accounting-exporter.factice';
import { AdaptateurListingPublisherFactice } from './adaptateur-listing-publisher.factice';
import { AdaptateurNotificationSenderFactice } from './adaptateur-notification-sender.factice';
import { AdaptateurOrderProviderFactice } from './adaptateur-order-provider.factice';
import { AdaptateurPartsCatalogProviderFactice } from './adaptateur-parts-catalog-provider.factice';
import { AdaptateurVehicleReferenceProviderFactice } from './adaptateur-vehicle-reference-provider.factice';

/**
 * Item B du socle (étape 5) : chaque adaptateur factice journalise au lieu d'appeler quoi que ce
 * soit, ne lève jamais, ne journalise jamais `requete.donnees` (secret potentiel), et porte un
 * `typeConnecteurCode` `factice_*` — jamais un nom de partenaire.
 */

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

const REQUETE_AVEC_SECRET: RequeteOperationConnecteur = {
  operation: 'export',
  nature: 'annonce_vehicule',
  objetId: 'veh-1',
  donnees: { cleApiSecrete: 'NE-DOIT-JAMAIS-APPARAITRE-EN-CLAIR' },
};

const CLASSES_FACTICES = [
  { Classe: AdaptateurPartsCatalogProviderFactice, nomInterface: 'PartsCatalogProvider' },
  { Classe: AdaptateurVehicleReferenceProviderFactice, nomInterface: 'VehicleReferenceProvider' },
  { Classe: AdaptateurOrderProviderFactice, nomInterface: 'OrderProvider' },
  { Classe: AdaptateurListingPublisherFactice, nomInterface: 'ListingPublisher' },
  { Classe: AdaptateurAccountingExporterFactice, nomInterface: 'AccountingExporter' },
  { Classe: AdaptateurNotificationSenderFactice, nomInterface: 'NotificationSender' },
] as const;

describe.each(CLASSES_FACTICES)('$Classe.name', ({ Classe, nomInterface }) => {
  it(`porte l'interface ${nomInterface} et un typeConnecteurCode préfixé "factice_"`, () => {
    const adaptateur = new Classe(journalFactice());
    expect(adaptateur.nomInterface).toBe(nomInterface);
    expect(adaptateur.typeConnecteurCode.startsWith('factice_')).toBe(true);
  });

  it('journalise l’exécution et rend un résultat vide, sans jamais lever', async () => {
    const journal = journalFactice();
    const adaptateur = new Classe(journal);

    const resultat = await adaptateur.executer(REQUETE_AVEC_SECRET);

    expect(resultat).toEqual({
      resume: {
        lignesTotal: 0,
        lignesCreees: 0,
        lignesMajees: 0,
        lignesRejetees: 0,
        lignesIgnorees: 0,
      },
      erreurs: [],
    });
    expect(journal.info).toHaveBeenCalledTimes(1);
  });

  it('ne journalise jamais `requete.donnees` ni un secret qu’il porte', async () => {
    const journal = journalFactice();
    const adaptateur = new Classe(journal);

    await adaptateur.executer(REQUETE_AVEC_SECRET);

    const journalMock = journal as unknown as { info: ReturnType<typeof vi.fn> };
    const appel = JSON.stringify(journalMock.info.mock.calls);
    expect(appel).not.toContain('NE-DOIT-JAMAIS-APPARAITRE-EN-CLAIR');
    expect(appel).not.toContain('cleApiSecrete');
    expect(appel).not.toContain('donnees');
  });
});
