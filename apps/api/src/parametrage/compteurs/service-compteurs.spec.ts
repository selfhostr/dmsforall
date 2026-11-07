import { describe, expect, it, vi } from 'vitest';
import { StringChunk } from 'drizzle-orm';
import type { TransactionDfa } from '../../db';
import { ServiceCompteursImpl } from './service-compteurs';

const CLEF = { tenantId: 'tid', typeDocument: 'ordre_reparation', annee: 2026, siteId: null };

function txFactice(execute: ReturnType<typeof vi.fn>): TransactionDfa {
  return { execute } as unknown as TransactionDfa;
}

/**
 * `tx.execute` reçoit un objet `SQL` de drizzle-orm (template `sql\`...\``), pas une chaîne :
 * `String(sqlObjet)` rend `'[object Object]'`, et `.toQuery()` exige un dialecte SQL complet
 * (échappement de noms/paramètres) hors de propos dans un test unitaire. On reconstitue ici le
 * texte littéral en ne gardant que les fragments statiques (`StringChunk`) de `queryChunks`,
 * ce qui suffit à distinguer un UPDATE d'un INSERT sans dépendre du driver Postgres.
 */
function texteRequete(appel: unknown): string {
  const chunks = (appel as { queryChunks?: readonly unknown[] }).queryChunks ?? [];
  return chunks
    .filter((chunk): chunk is StringChunk => chunk instanceof StringChunk)
    .map((chunk) => chunk.value.join(''))
    .join('');
}

// Séquence attendue : 1) insert … on conflict do nothing, 2) select … for update, 3) update.
// La preuve de concurrence réelle est dans test/integration/compteurs-concurrence.spec.ts.
describe('ServiceCompteursImpl.prochainNumero', () => {
  it('première émission de la clé : la ligne née à 0 est incrémentée, rend 1', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'cpt-1', valeur: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new ServiceCompteursImpl();

    const numero = await service.prochainNumero(txFactice(execute), CLEF);

    expect(numero).toBe(1);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(texteRequete(execute.mock.calls[0]?.[0])).toMatch(/on conflict[\s\S]*do nothing/);
  });

  it('clé existante : incrémente la ligne verrouillée, rend valeur + 1', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'cpt-1', valeur: 41 }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new ServiceCompteursImpl();

    const numero = await service.prochainNumero(txFactice(execute), CLEF);

    expect(numero).toBe(42);
    expect(texteRequete(execute.mock.calls[1]?.[0])).toMatch(/for update/);
    expect(texteRequete(execute.mock.calls[2]?.[0])).toMatch(/update public\.compteur_document/);
  });

  it('deux clés distinctes (années différentes) : appels indépendants', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'cpt-2026', valeur: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'cpt-2027', valeur: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new ServiceCompteursImpl();
    const tx = txFactice(execute);

    expect(await service.prochainNumero(tx, { ...CLEF, annee: 2026 })).toBe(1);
    expect(await service.prochainNumero(tx, { ...CLEF, annee: 2027 })).toBe(1);
  });

  it('ligne introuvable après insertion (anomalie) : erreur explicite, jamais un numéro inventé', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const service = new ServiceCompteursImpl();

    await expect(service.prochainNumero(txFactice(execute), CLEF)).rejects.toThrow(
      /ServiceCompteurs/,
    );
  });
});
