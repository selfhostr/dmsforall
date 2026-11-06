import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `TransportSmtp` construit un `Transporter` nodemailer réel dans son constructeur (voir sa doc
 * d'en-tête) — ce test mocke `nodemailer.createTransport` pour vérifier la TRADUCTION vers l'API
 * nodemailer (notamment `attachments`), sans jamais ouvrir de connexion réseau.
 */
const sendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

import { TransportSmtp } from './transport-smtp';
import type { ConfigSmtpResolue } from './config-courriel';

function configSmtp(): ConfigSmtpResolue {
  return {
    hote: 'smtp.example.org',
    port: 587,
    securise: false,
    utilisateur: 'no-reply@dmsforall.example',
    motDePasse: 'secret',
    expediteur: 'no-reply@dmsforall.example',
  };
}

describe('TransportSmtp — traduction de l’enveloppe vers nodemailer', () => {
  // Vitest 4 : `restoreMocks` ne remet plus à zéro les `vi.fn()` (seulement les spies) ; sans ceci,
  // `mock.calls[0]` désignerait l'appel d'un test précédent.
  beforeEach(() => {
    sendMail.mockReset();
  });

  it('sans pièce jointe : `attachments` est absent (undefined), pas un tableau vide implicite', async () => {
    sendMail.mockResolvedValueOnce({ messageId: 'msg-1' });
    const transport = new TransportSmtp(configSmtp());

    await transport.envoyer({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
      repondreA: 'contact@garage-martin.ch',
      destinataires: ['client@example.ch'],
      sujet: 'Rappel',
    });

    const appel = sendMail.mock.calls[0]?.[0] as { attachments?: unknown };
    expect(appel.attachments).toBeUndefined();
  });

  it('avec pièce jointe : traduite en `attachments` nodemailer (filename/content/contentType)', async () => {
    sendMail.mockResolvedValueOnce({ messageId: 'msg-1' });
    const transport = new TransportSmtp(configSmtp());
    const contenu = Buffer.from('%PDF-1.4 contenu factice');

    await transport.envoyer({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
      repondreA: 'contact@garage-martin.ch',
      destinataires: ['client@example.ch'],
      sujet: 'Facture 2026-00042',
      piecesJointes: [
        { nomFichier: 'Facture-2026-00042.pdf', contenu, typeMime: 'application/pdf' },
      ],
    });

    const appel = sendMail.mock.calls[0]?.[0] as {
      attachments?: readonly { filename: string; content: Buffer; contentType: string }[];
    };
    expect(appel.attachments).toEqual([
      { filename: 'Facture-2026-00042.pdf', content: contenu, contentType: 'application/pdf' },
    ]);
  });

  it('un rejet nodemailer reste capturé en `ResultatEnvoiCourriel.erreur`, pièce jointe ou non', async () => {
    sendMail.mockRejectedValueOnce(new Error('554 message trop volumineux'));
    const transport = new TransportSmtp(configSmtp());

    const resultat = await transport.envoyer({
      de: 'no-reply@dmsforall.example',
      nomExpediteurAffiche: 'Garage Martin via dmsforall',
      repondreA: 'contact@garage-martin.ch',
      destinataires: ['client@example.ch'],
      sujet: 'Facture 2026-00042',
      piecesJointes: [
        {
          nomFichier: 'Facture-2026-00042.pdf',
          contenu: Buffer.alloc(10),
          typeMime: 'application/pdf',
        },
      ],
    });

    expect(resultat).toEqual({ succes: false, erreur: '554 message trop volumineux' });
  });
});
