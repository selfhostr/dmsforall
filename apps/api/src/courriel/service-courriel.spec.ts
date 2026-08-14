import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config';
import type { ServiceJournal } from '../common/journal';
import { ServiceCourriel } from './service-courriel';
import type { EnveloppeCourriel, TransportCourriel } from './transport-courriel.interface';

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

function transportEspion(): { transport: TransportCourriel; enveloppes: EnveloppeCourriel[] } {
  const enveloppes: EnveloppeCourriel[] = [];
  const transport: TransportCourriel = {
    envoyer: vi.fn(async (enveloppe: EnveloppeCourriel) => {
      enveloppes.push(enveloppe);
      return { succes: true, idMessage: 'msg-1' };
    }),
  };
  return { transport, enveloppes };
}

describe('ServiceCourriel — construction de l’enveloppe', () => {
  it('l’expéditeur est TOUJOURS SMTP_EXPEDITEUR (no-reply@dmsforall.example), jamais l’adresse du garage', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(transport, config, journalFactice());

    await service.envoyer({
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.de).toBe('no-reply@dmsforall.example');
  });

  it('utilise le repli no-reply@dmsforall.example si SMTP_EXPEDITEUR est absente (dev sans .env complet)', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = {} as Config;
    const service = new ServiceCourriel(transport, config, journalFactice());

    await service.envoyer({
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.de).toBe('no-reply@dmsforall.example');
  });

  it('le Reply-To porte l’adresse du garage, jamais l’expéditeur technique', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(transport, config, journalFactice());

    await service.envoyer({
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.repondreA).toBe('contact@garage-martin.ch');
  });

  it('le nom affiché porte le nom du garage, suffixé « via dmsforall »', async () => {
    const { transport, enveloppes } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(transport, config, journalFactice());

    await service.envoyer({
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(enveloppes[0]?.nomExpediteurAffiche).toBe('Garage Martin via dmsforall');
  });

  it('rend le résultat du transport tel quel', async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const service = new ServiceCourriel(transport, config, journalFactice());

    const resultat = await service.envoyer({
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(resultat).toEqual({ succes: true, idMessage: 'msg-1' });
  });
});
