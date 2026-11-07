import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clePhoto, cleVignettePhoto, StockagePhotosDisqueLocal } from './stockage-photos';

let racine: string;
let stockage: StockagePhotosDisqueLocal;

beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), 'photos-or-'));
  stockage = new StockagePhotosDisqueLocal(racine);
});
afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

describe('clés', () => {
  it('chemin par tenant puis par OR, extension tirée du type détecté', () => {
    expect(clePhoto('T', 'O', 'P', 'image/jpeg')).toBe('T/or/O/P.jpg');
    expect(clePhoto('T', 'O', 'P', 'image/png')).toBe('T/or/O/P.png');
    expect(cleVignettePhoto('T', 'O', 'P')).toBe('T/or/O/P.vignette.jpg');
  });
});

describe('StockagePhotosDisqueLocal', () => {
  it('écrit, relit, supprime (idempotent)', async () => {
    const cle = clePhoto('t1', 'o1', 'p1', 'image/jpeg');
    await stockage.ecrire(cle, Buffer.from('abc'));
    expect((await stockage.lire(cle)).toString()).toBe('abc');
    expect((await readFile(join(racine, cle))).length).toBe(3);
    await stockage.supprimer(cle);
    await stockage.supprimer(cle);
    await expect(stockage.lire(cle)).rejects.toThrow();
  });

  it('refuse toute clé qui sort de la racine', async () => {
    await expect(stockage.ecrire('../evasion.jpg', Buffer.from('x'))).rejects.toThrow(
      /hors racine/,
    );
    await expect(stockage.lire('t1/../../etc/passwd')).rejects.toThrow(/hors racine/);
    await expect(stockage.supprimer('')).rejects.toThrow();
  });

  it('purgerTenant efface ce tenant seulement, refuse un tenant vide ou hors racine', async () => {
    await stockage.ecrire(clePhoto('a', 'o', 'p', 'image/jpeg'), Buffer.from('1'));
    await stockage.ecrire(clePhoto('b', 'o', 'p', 'image/jpeg'), Buffer.from('2'));
    await stockage.purgerTenant('a');
    await stockage.purgerTenant('a');
    await expect(stat(join(racine, 'a'))).rejects.toThrow();
    expect((await stat(join(racine, 'b'))).isDirectory()).toBe(true);
    await expect(stockage.purgerTenant('  ')).rejects.toThrow(/vide/);
    await expect(stockage.purgerTenant('..')).rejects.toThrow(/hors racine/);
  });
});
