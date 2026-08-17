import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientMoteurOcrHttp, ErreurMoteurOcr } from './client-moteur-ocr';
import type { ConfigOcrPermis } from './config-ocr';

const CONFIG: ConfigOcrPermis = {
  OCR_SERVICE_URL: 'http://ocr-permis:8090',
  OCR_SERVICE_TIMEOUT_MS: 5000,
  LIMITE_OCR_PERMIS_UTILISATEUR: 15,
  LIMITE_OCR_PERMIS_FENETRE_SECONDES: 300,
};

function reponseFactice(statut: number, corps: unknown): Response {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: () => Promise.resolve(corps),
  } as unknown as Response;
}

describe('ClientMoteurOcrHttp.scanner', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('réponse 200 -> rend le corps JSON tel quel', async () => {
    const corpsAttendu = { champs: {}, avertissements: [], dureeMs: 1234 };
    const fetchFactice = vi.fn().mockResolvedValue(reponseFactice(200, corpsAttendu));
    vi.stubGlobal('fetch', fetchFactice);

    const client = new ClientMoteurOcrHttp(CONFIG);
    const resultat = await client.scanner(Buffer.from('image'));

    expect(resultat).toEqual(corpsAttendu);
    expect(fetchFactice).toHaveBeenCalledWith(
      'http://ocr-permis:8090/scan-permis',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('échec réseau (fetch qui rejette) -> ErreurMoteurOcr MOTEUR_INDISPONIBLE, jamais une exception brute propagée', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const client = new ClientMoteurOcrHttp(CONFIG);
    await expect(client.scanner(Buffer.from('image'))).rejects.toMatchObject({
      code: 'MOTEUR_INDISPONIBLE',
    });
  });

  it('422 (décodage échoué côté conteneur) -> ErreurMoteurOcr FORMAT_NON_SUPPORTE', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reponseFactice(422, { erreur: 'FORMAT_NON_SUPPORTE', detail: 'HEIC corrompu' }),
        ),
    );

    const client = new ClientMoteurOcrHttp(CONFIG);
    const erreur = (await client
      .scanner(Buffer.from('image'))
      .catch((e: unknown) => e)) as ErreurMoteurOcr;

    expect(erreur).toBeInstanceOf(ErreurMoteurOcr);
    expect(erreur.code).toBe('FORMAT_NON_SUPPORTE');
    expect(erreur.message).toBe('HEIC corrompu');
  });

  it('503 (file du conteneur saturée) -> ErreurMoteurOcr MOTEUR_INDISPONIBLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseFactice(503, {})));

    const client = new ClientMoteurOcrHttp(CONFIG);
    await expect(client.scanner(Buffer.from('image'))).rejects.toMatchObject({
      code: 'MOTEUR_INDISPONIBLE',
    });
  });

  it('autre statut non 2xx (ex. 500 imprévu) -> ErreurMoteurOcr ERREUR_INTERNE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseFactice(500, {})));

    const client = new ClientMoteurOcrHttp(CONFIG);
    await expect(client.scanner(Buffer.from('image'))).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
  });
});
