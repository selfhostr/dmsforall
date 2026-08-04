import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleePdfDocument, sha256Hex, StockagePdfDisqueLocal } from './stockage-pdf';

describe('StockagePdfDisqueLocal', () => {
  let racine: string;

  beforeEach(async () => {
    racine = await mkdtemp(join(tmpdir(), 'dfa-stockage-pdf-'));
  });

  afterEach(async () => {
    await rm(racine, { recursive: true, force: true });
  });

  it('écrit puis relit exactement les mêmes octets, en créant les répertoires manquants', async () => {
    const stockage = new StockagePdfDisqueLocal(racine);
    const cle = cleePdfDocument(randomUUID(), randomUUID());
    const contenu = Buffer.from('%PDF-1.4 contenu de test\n%%EOF');

    await stockage.ecrire(cle, contenu);
    const relu = await stockage.lire(cle);

    expect(relu.equals(contenu)).toBe(true);
    expect(await readFile(join(racine, cle))).toEqual(contenu);
  });

  it('écrase silencieusement une clé déjà écrite (course bénigne, contenu déterministe)', async () => {
    const stockage = new StockagePdfDisqueLocal(racine);
    const cle = cleePdfDocument(randomUUID(), randomUUID());

    await stockage.ecrire(cle, Buffer.from('premier'));
    await stockage.ecrire(cle, Buffer.from('second'));

    expect((await stockage.lire(cle)).toString()).toBe('second');
  });

  it('lire() sur une clé absente rejette (ENOENT)', async () => {
    const stockage = new StockagePdfDisqueLocal(racine);
    await expect(stockage.lire('inconnu/inconnu.pdf')).rejects.toThrow();
  });
});

describe('cleePdfDocument', () => {
  it('compose tenantId/documentId.pdf', () => {
    expect(cleePdfDocument('t1', 'd1')).toBe('t1/d1.pdf');
  });
});

describe('sha256Hex', () => {
  it('empreinte stable et connue pour un contenu fixe', () => {
    // sha256("dfa") — calculée indépendamment (`printf 'dfa' | shasum -a 256`), valeur figée pour
    // détecter toute régression.
    expect(sha256Hex(Buffer.from('dfa'))).toBe(
      '5dd336c3be7b217f5b6d2daa9dd55963271c1b851bf9d6325bfbc17b109debd5',
    );
  });
});
