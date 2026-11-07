import { describe, expect, it } from 'vitest';

import { CODES_ACTION_PROPOSEE, type ElementBloquant } from '@dfa/shared';

import { planifierActionProposee, type ContexteActionProposee } from './actions-proposees';

const BLOCAGES: readonly ElementBloquant[] = [
  { type: 'ligne_or', id: 'l-1', libelle: 'Vidange' },
  { type: 'pointage', id: 'p-1', libelle: 'Marc' },
];

function contexte(surcharges: Partial<ContexteActionProposee> = {}): ContexteActionProposee {
  return {
    blocages: BLOCAGES,
    actionsDisponibles: [],
    confirmationsRequises: [],
    ...surcharges,
  };
}

describe('planifierActionProposee', () => {
  it.each(CODES_ACTION_PROPOSEE)(
    '%s produit toujours un effet — aucune action proposée ne reste sans effet',
    (code) => {
      const effet = planifierActionProposee({ code }, contexte());
      expect(effet).toBeDefined();
      expect(typeof effet.type).toBe('string');
    },
  );

  it('VALIDER_LIGNES et CREER_DEVIS_COMPLEMENTAIRE ouvrent l’accord client sur les lignes listées', () => {
    expect(planifierActionProposee({ code: 'VALIDER_LIGNES' }, contexte())).toEqual({
      type: 'accord_client',
      ligneIds: ['l-1'],
    });
    expect(
      planifierActionProposee(
        { code: 'CREER_DEVIS_COMPLEMENTAIRE', parametres: { ligneIds: ['l-1', 'l-2'] } },
        contexte(),
      ),
    ).toEqual({ type: 'accord_client', ligneIds: ['l-1', 'l-2'] });
  });

  it('ARRETER_POINTAGES cible uniquement les pointages listés', () => {
    expect(planifierActionProposee({ code: 'ARRETER_POINTAGES' }, contexte())).toEqual({
      type: 'arreter_pointages',
      pointageIds: ['p-1'],
    });
  });

  it('RECEPTIONNER_VEHICULE ouvre la réception si le serveur la propose, sinon donne une consigne', () => {
    expect(
      planifierActionProposee(
        { code: 'RECEPTIONNER_VEHICULE' },
        contexte({ actionsDisponibles: ['receptionner'] }),
      ),
    ).toEqual({ type: 'ouvrir_action', action: 'receptionner' });
    expect(planifierActionProposee({ code: 'RECEPTIONNER_VEHICULE' }, contexte())).toEqual({
      type: 'consigne',
      consigne: 'receptionnerIndisponible',
    });
  });

  it('REJOUER_AVEC_CONFIRMATION rejoue avec les confirmations demandées, sinon relit', () => {
    expect(
      planifierActionProposee(
        { code: 'REJOUER_AVEC_CONFIRMATION' },
        contexte({ confirmationsRequises: ['CLIENT_BLOQUE'] }),
      ),
    ).toEqual({ type: 'rejouer_confirme', confirmations: ['CLIENT_BLOQUE'] });
    expect(planifierActionProposee({ code: 'REJOUER_AVEC_CONFIRMATION' }, contexte())).toEqual({
      type: 'rafraichir',
    });
  });
});
