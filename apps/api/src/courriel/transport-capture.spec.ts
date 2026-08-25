import { describe, expect, it, vi } from 'vitest';

import type { ServiceJournal } from '../common/journal';
import { TransportCapture } from './transport-capture';

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

describe('TransportCapture — aucun envoi réseau, jamais', () => {
  it("journalise l'envoi capturé sans jamais inclure le corps du message", async () => {
    const journal = journalFactice();
    const transport = new TransportCapture(journal);

    await transport.envoyer({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
      repondreA: 'contact@garage-martin.ch',
      destinataires: ['client@example.ch'],
      sujet: 'Rappel expertise',
      corpsTexte: 'Contenu confidentiel, ne doit jamais atterrir tel quel dans un log.',
    });

    expect(JSON.stringify((journal.info as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      'Contenu confidentiel',
    );
    expect(JSON.stringify((journal.debug as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      'Contenu confidentiel',
    );
  });

  it("ne journalise ni l'adresse du destinataire ni le sujet au niveau info — données personnelles, niveau actif par défaut en production", async () => {
    const journal = journalFactice();
    const transport = new TransportCapture(journal);

    await transport.envoyer({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
      repondreA: 'contact@garage-martin.ch',
      destinataires: ['client@example.ch'],
      sujet: 'Rappel expertise',
    });

    expect(journal.info).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.info as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.destinataires).toBeUndefined();
    expect(donnees.sujet).toBeUndefined();
    expect(donnees.repondreA).toBeUndefined();
    expect(donnees.nombreDestinataires).toBe(1);
    expect(JSON.stringify(donnees)).not.toContain('client@example.ch');
    expect(JSON.stringify(donnees)).not.toContain('Rappel expertise');
  });

  it('journalise le détail (destinataires, sujet) au niveau debug — désactivé par défaut en production, pour le diagnostic local', async () => {
    const journal = journalFactice();
    const transport = new TransportCapture(journal);

    await transport.envoyer({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
      repondreA: 'contact@garage-martin.ch',
      destinataires: ['client@example.ch'],
      sujet: 'Rappel expertise',
    });

    expect(journal.debug).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.debug as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.sujet).toBe('Rappel expertise');
    expect(donnees.destinataires).toEqual(['client@example.ch']);
  });

  it('rend toujours un succès, avec un identifiant de message local', async () => {
    const transport = new TransportCapture(journalFactice());
    const resultat = await transport.envoyer({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
      repondreA: 'contact@garage-martin.ch',
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
    });

    expect(resultat.succes).toBe(true);
    expect(resultat.idMessage).toMatch(/^capture-/);
  });
});
