import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config';
import type { ServiceJournal } from '../common/journal';
import { providerTransportCourriel } from './provider-transport-courriel';
import { TransportCapture } from './transport-capture';
import { TransportSmtp } from './transport-smtp';

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

/** Config minimale, structurellement suffisante pour la factory (voir `ConfigAvecCourriel`). */
function config(surcharges: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'development',
    COURRIEL_ENVOI_REEL: false,
    SMTP_PORT: 587,
    SMTP_SECURISE: false,
    ...surcharges,
  } as Config;
}

function fabriquer(surcharges: Partial<Config> = {}): unknown {
  const useFactory = (
    providerTransportCourriel as { useFactory: (c: Config, j: ServiceJournal) => unknown }
  ).useFactory;
  return useFactory(config(surcharges), journalFactice());
}

/**
 * LE TEST LE PLUS IMPORTANT de ce module (consigne du chantier) : hors production, le
 * transport SMTP réel n'est JAMAIS instancié, même si l'opérateur active le drapeau par erreur.
 */
describe('providerTransportCourriel — verrou à deux clés (NODE_ENV=production ET COURRIEL_ENVOI_REEL)', () => {
  it('développement, drapeau désactivé (cas par défaut) → capture', () => {
    expect(fabriquer()).toBeInstanceOf(TransportCapture);
  });

  it('développement, drapeau ACTIVÉ par erreur → reste la capture, jamais TransportSmtp', () => {
    const transport = fabriquer({ NODE_ENV: 'development', COURRIEL_ENVOI_REEL: true });
    expect(transport).toBeInstanceOf(TransportCapture);
    expect(transport).not.toBeInstanceOf(TransportSmtp);
  });

  it('test, drapeau ACTIVÉ par erreur → reste la capture, jamais TransportSmtp', () => {
    const transport = fabriquer({ NODE_ENV: 'test', COURRIEL_ENVOI_REEL: true });
    expect(transport).toBeInstanceOf(TransportCapture);
  });

  it('production SANS le drapeau → reste la capture (le drapeau seul ne suffit pas, mais NODE_ENV seul non plus)', () => {
    const transport = fabriquer({ NODE_ENV: 'production', COURRIEL_ENVOI_REEL: false });
    expect(transport).toBeInstanceOf(TransportCapture);
  });

  it('production ET drapeau activé, identifiants complets → transport SMTP réel', () => {
    const transport = fabriquer({
      NODE_ENV: 'production',
      COURRIEL_ENVOI_REEL: true,
      SMTP_HOTE: 'smtp.example.org',
      SMTP_UTILISATEUR: 'no-reply@dmsforall.example',
      SMTP_MOT_DE_PASSE: 'secret',
      SMTP_EXPEDITEUR: 'no-reply@dmsforall.example',
    });
    expect(transport).toBeInstanceOf(TransportSmtp);
  });

  it('production ET drapeau activé, identifiants incomplets → lève plutôt que de démarrer avec un transport à moitié configuré', () => {
    expect(() => fabriquer({ NODE_ENV: 'production', COURRIEL_ENVOI_REEL: true })).toThrow(
      /Invalid SMTP configuration/,
    );
  });
});
