import { describe, expect, it } from 'vitest';
import { deciderIdempotence, type LigneCleIdempotenceExistante } from './decision-idempotence';

const EMPREINTE_A = Buffer.from('empreinte-a-32-octets-xxxxxxxxx');
const EMPREINTE_B = Buffer.from('empreinte-b-32-octets-yyyyyyyyy');

function ligne(partiel: Partial<LigneCleIdempotenceExistante>): LigneCleIdempotenceExistante {
  return {
    empreinteRequete: EMPREINTE_A,
    statut: 'termine',
    statutHttp: 201,
    reponse: { id: 'x' },
    ...partiel,
  };
}

describe('deciderIdempotence', () => {
  it('clé neuve (insertion gagnée) -> nouvelle_execution, quelle que soit ligneExistante', () => {
    expect(deciderIdempotence(true, null, EMPREINTE_A)).toEqual({ type: 'nouvelle_execution' });
  });

  it("conflit à l'insertion + même empreinte + statut termine -> rejeu avec le corps mémorisé", () => {
    const decision = deciderIdempotence(
      false,
      ligne({ statut: 'termine', statutHttp: 201, reponse: { id: 'C-2026-001' } }),
      EMPREINTE_A,
    );
    expect(decision).toEqual({ type: 'rejeu', statutHttp: 201, corps: { id: 'C-2026-001' } });
  });

  it("conflit à l'insertion + empreinte DIFFÉRENTE -> conflit_empreinte, quel que soit le statut", () => {
    expect(deciderIdempotence(false, ligne({ statut: 'termine' }), EMPREINTE_B)).toEqual({
      type: 'conflit_empreinte',
    });
    expect(deciderIdempotence(false, ligne({ statut: 'en_cours' }), EMPREINTE_B)).toEqual({
      type: 'conflit_empreinte',
    });
  });

  it("conflit à l'insertion + même empreinte + statut en_cours -> requete_en_cours (requête concurrente)", () => {
    expect(deciderIdempotence(false, ligne({ statut: 'en_cours' }), EMPREINTE_A)).toEqual({
      type: 'requete_en_cours',
    });
  });

  it("conflit à l'insertion + ligne introuvable à la relecture -> anomalie, jamais un retraitement silencieux", () => {
    expect(deciderIdempotence(false, null, EMPREINTE_A)).toEqual({ type: 'anomalie' });
  });

  it('un rejeu sans statutHttp mémorisé (donnée corrompue) retombe sur 500 plutôt que sur undefined', () => {
    const decision = deciderIdempotence(false, ligne({ statutHttp: null }), EMPREINTE_A);
    expect(decision).toMatchObject({ type: 'rejeu', statutHttp: 500 });
  });

  it("l'empreinte est comparée par contenu, pas par référence", () => {
    const copie = Buffer.from(EMPREINTE_A);
    expect(deciderIdempotence(false, ligne({ empreinteRequete: EMPREINTE_A }), copie)).toEqual({
      type: 'rejeu',
      statutHttp: 201,
      corps: { id: 'x' },
    });
  });
});
