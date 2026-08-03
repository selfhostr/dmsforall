import { describe, expect, it } from 'vitest';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { traduireErreurTransition } from './traducteur-transition';

function erreurPg(champs: { table: string; detail: string; hint?: string | null }): unknown {
  return { code: 'ZDFA1', table: champs.table, detail: champs.detail, hint: champs.hint ?? null };
}

describe('traduireErreurTransition', () => {
  it("rend null pour une erreur qui n'est pas un ZDFA1 exploitable", () => {
    expect(traduireErreurTransition(new Error('autre chose'), 'or-1', 'OR 123')).toBeNull();
    expect(traduireErreurTransition({ code: '23505' }, 'or-1', 'OR 123')).toBeNull();
  });

  it('OR_TRANSITION_INTERDITE générique (planifie -> en_cours) : blocages + actionsProposees RAFRAICHIR', () => {
    const erreur = traduireErreurTransition(
      erreurPg({
        table: 'ordre_reparation',
        detail: 'entite=ordre_reparation;depuis=planifie;vers=en_cours',
        hint: 'Depuis « planifie », transitions autorisées : annule, ouvert.',
      }),
      'or-1',
      'OR-2026-0001',
    );

    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect(erreur?.code).toBe('OR_TRANSITION_INTERDITE');
    expect(erreur?.status).toBe(409);
    expect(erreur?.blocages).toEqual([
      {
        type: 'ordre_reparation',
        id: 'or-1',
        libelle: 'OR-2026-0001',
        donnees: { statutActuel: 'planifie', statutDemande: 'en_cours' },
      },
    ]);
    expect(erreur?.actionsProposees).toEqual([{ code: 'RAFRAICHIR' }]);
  });

  it('LIGNE_TRANSITION_INTERDITE : code et type de blocage corrects', () => {
    const erreur = traduireErreurTransition(
      erreurPg({
        table: 'ligne_or',
        detail: 'entite=ligne_or;depuis=refusee;vers=realisee',
        hint: 'Depuis « refusee », transitions autorisées : a_valider.',
      }),
      'ligne-9',
      'Plaquettes avant',
    );
    expect(erreur?.code).toBe('LIGNE_TRANSITION_INTERDITE');
    expect(erreur?.blocages?.[0]?.type).toBe('ligne_or');
  });

  it('état terminal (cloture) : actionsProposees VIDE (§3.5 règle 3, seul cas autorisé)', () => {
    const erreur = traduireErreurTransition(
      erreurPg({
        table: 'ordre_reparation',
        detail: 'entite=ordre_reparation;depuis=cloture;vers=ouvert',
        hint: "« cloture » est un état terminal : aucune transition n'en part.",
      }),
      'or-1',
      'OR-2026-0001',
    );
    expect(erreur?.actionsProposees).toEqual([]);
  });

  it('facture -> en_cours (I-02) : propose CREER_OR_RETOUCHE avec ordreReparationParentId', () => {
    const erreur = traduireErreurTransition(
      erreurPg({
        table: 'ordre_reparation',
        detail: 'entite=ordre_reparation;depuis=facture;vers=en_cours',
        hint: 'Depuis « facture », transitions autorisées : restitue.',
      }),
      'or-42',
      'OR-2026-0042',
    );
    expect(erreur?.actionsProposees).toEqual([
      {
        code: 'CREER_OR_RETOUCHE',
        methode: 'POST',
        parametres: { ordreReparationParentId: 'or-42' },
      },
    ]);
  });

  it('depuis restitue : propose CREER_NOUVEL_OR', () => {
    const erreur = traduireErreurTransition(
      erreurPg({
        table: 'ordre_reparation',
        detail: 'entite=ordre_reparation;depuis=restitue;vers=en_cours',
        hint: 'Depuis « restitue », transitions autorisées : cloture.',
      }),
      'or-7',
      'OR-2026-0007',
    );
    expect(erreur?.actionsProposees).toEqual([{ code: 'CREER_NOUVEL_OR' }]);
  });
});
