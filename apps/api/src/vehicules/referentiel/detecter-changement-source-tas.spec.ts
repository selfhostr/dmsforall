import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  calculerEmpreinteContenu,
  construireSignatureDepuisEntetes,
  detecterSignatureSourcesTas,
  ErreurControleSourceTas,
  type FetchInjectable,
  type SourceAControler,
} from './detecter-changement-source-tas';

function entetes(valeurs: Record<string, string | undefined>): {
  get: (nom: string) => string | null;
} {
  return { get: (nom) => valeurs[nom] ?? null };
}

describe('construireSignatureDepuisEntetes', () => {
  it('ETag présent -> priorité absolue, même si Last-Modified/Content-Length diffèrent aussi', () => {
    expect(
      construireSignatureDepuisEntetes(
        entetes({ etag: '"abc123"', 'last-modified': 'Thu, 30 Jul 2026 06:55:20 GMT' }),
      ),
    ).toBe('etag:"abc123"');
  });

  it('ETag absent, Last-Modified + Content-Length présents -> les deux combinés', () => {
    expect(
      construireSignatureDepuisEntetes(
        entetes({ 'last-modified': 'Thu, 30 Jul 2026 06:55:20 GMT', 'content-length': '6549934' }),
      ),
    ).toBe('lm:Thu, 30 Jul 2026 06:55:20 GMT|len:6549934');
  });

  it('seul Content-Length présent -> encore exploitable (Last-Modified vide dans la signature)', () => {
    expect(construireSignatureDepuisEntetes(entetes({ 'content-length': '42' }))).toBe(
      'lm:|len:42',
    );
  });

  it('aucun en-tête exploitable -> null (force le repli par empreinte de contenu)', () => {
    expect(construireSignatureDepuisEntetes(entetes({}))).toBeNull();
  });
});

describe('calculerEmpreinteContenu', () => {
  it('SHA-256 du contenu réellement téléchargé, déterministe', async () => {
    const contenu = Buffer.from('chTypeApprovalNumber;makeName\n1AA101;ALFA ROMEO\n', 'utf8');
    const attendu = `sha256:${createHash('sha256').update(contenu).digest('hex')}`;

    const fetchImpl: FetchInjectable = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: entetes({}),
      body: new ReadableStream<Uint8Array>({
        start(controleur) {
          controleur.enqueue(contenu);
          controleur.close();
        },
      }),
    }));

    await expect(calculerEmpreinteContenu('https://exemple.test/x.csv', fetchImpl)).resolves.toBe(
      attendu,
    );
  });

  it('HTTP non 2xx -> lève', async () => {
    const fetchImpl: FetchInjectable = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: entetes({}),
    }));
    await expect(calculerEmpreinteContenu('https://exemple.test/x.csv', fetchImpl)).rejects.toThrow(
      'HTTP 500',
    );
  });
});

describe('detecterSignatureSourcesTas', () => {
  const sources: readonly SourceAControler[] = [
    { fichier: 'a.csv', url: 'https://exemple.test/a.csv' },
    { fichier: 'b.csv', url: 'https://exemple.test/b.csv' },
  ];

  it('concatène les signatures des sources DANS L’ORDRE, séparateur stable', async () => {
    const fetchImpl: FetchInjectable = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      headers: entetes({ etag: url.includes('a.csv') ? '"etag-a"' : '"etag-b"' }),
    }));

    await expect(detecterSignatureSourcesTas(sources, fetchImpl)).resolves.toBe(
      'etag:"etag-a"||etag:"etag-b"',
    );
  });

  it('une seule source dont l’ETag change -> signature globale différente (piège : ne pas moyenner/ignorer)', async () => {
    const fetchImplV1: FetchInjectable = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: entetes({ etag: '"v1"' }),
    }));
    const fetchImplV2: FetchInjectable = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      headers: entetes({ etag: url.includes('a.csv') ? '"v2"' : '"v1"' }),
    }));

    const sig1 = await detecterSignatureSourcesTas(sources, fetchImplV1);
    const sig2 = await detecterSignatureSourcesTas(sources, fetchImplV2);
    expect(sig1).not.toBe(sig2);
  });

  it('HEAD en échec HTTP (ex. 503) -> ErreurControleSourceTas, jamais une signature partielle', async () => {
    const fetchImpl: FetchInjectable = vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: entetes({}),
    }));
    await expect(detecterSignatureSourcesTas(sources, fetchImpl)).rejects.toThrow(
      ErreurControleSourceTas,
    );
  });

  it('erreur réseau (fetch qui rejette) -> ErreurControleSourceTas nommant le fichier fautif', async () => {
    const fetchImpl: FetchInjectable = vi.fn(async (url) => {
      if (url.includes('a.csv')) throw new Error('ECONNRESET');
      return { ok: true, status: 200, headers: entetes({ etag: '"b"' }) };
    });
    await expect(detecterSignatureSourcesTas(sources, fetchImpl)).rejects.toMatchObject({
      fichier: 'a.csv',
    });
  });

  it("s'arrête à la PREMIÈRE source en échec, ne contrôle pas les suivantes (pas de coût réseau superflu)", async () => {
    const fetchImpl: FetchInjectable = vi.fn(async (url) => {
      if (url.includes('a.csv')) throw new Error('ECONNRESET');
      return { ok: true, status: 200, headers: entetes({ etag: '"b"' }) };
    });
    await expect(detecterSignatureSourcesTas(sources, fetchImpl)).rejects.toBeInstanceOf(
      ErreurControleSourceTas,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
