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

describe('ServiceCourriel — journalisation, sans données personnelles au niveau info/warn', () => {
  it("le succès n'écrit ni l'adresse du destinataire ni le sujet au niveau info — seul le compte", async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const journal = journalFactice();
    const service = new ServiceCourriel(transport, config, journal);

    await service.envoyer({
      destinataires: ['client-un@example.ch', 'client-deux@example.ch'],
      sujet: 'Rappel facture 2026-042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(journal.info).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.info as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.destinataires).toBeUndefined();
    expect(donnees.sujet).toBeUndefined();
    expect(donnees.nombreDestinataires).toBe(2);
    expect(JSON.stringify(donnees)).not.toContain('client-un@example.ch');
    expect(JSON.stringify(donnees)).not.toContain('Rappel facture 2026-042');
  });

  it("l'échec n'écrit ni l'adresse du destinataire ni le sujet au niveau warn — seul le compte et l'erreur de transport", async () => {
    const transport: TransportCourriel = {
      envoyer: vi.fn(async () => ({ succes: false, erreur: 'boîte pleine' })),
    };
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const journal = journalFactice();
    const service = new ServiceCourriel(transport, config, journal);

    await service.envoyer({
      destinataires: ['client@example.ch'],
      sujet: 'Rappel facture 2026-042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(journal.warn).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.destinataires).toBeUndefined();
    expect(donnees.sujet).toBeUndefined();
    expect(donnees.nombreDestinataires).toBe(1);
    expect(donnees.erreur).toBe('boîte pleine');
  });

  it('conserve le détail (destinataires, sujet) au niveau debug — désactivé par défaut en production', async () => {
    const { transport } = transportEspion();
    const config = { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
    const journal = journalFactice();
    const service = new ServiceCourriel(transport, config, journal);

    await service.envoyer({
      destinataires: ['client@example.ch'],
      sujet: 'Rappel facture 2026-042',
      nomGarage: 'Garage Martin',
      adresseReponseGarage: 'contact@garage-martin.ch',
    });

    expect(journal.debug).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.debug as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.destinataires).toEqual(['client@example.ch']);
    expect(donnees.sujet).toBe('Rappel facture 2026-042');
  });
});
