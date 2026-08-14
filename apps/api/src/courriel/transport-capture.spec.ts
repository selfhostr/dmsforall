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

    expect(journal.info).toHaveBeenCalledTimes(1);
    const [, donnees] = (journal.info as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(donnees.sujet).toBe('Rappel expertise');
    expect(donnees.destinataires).toEqual(['client@example.ch']);
    expect(JSON.stringify(donnees)).not.toContain('Contenu confidentiel');
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
