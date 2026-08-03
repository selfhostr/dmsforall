import { describe, expect, it } from 'vitest';
import type { AttentesOr } from '@dfa/shared';
import {
  calculerActionsDisponibles,
  calculerActionsDisponiblesPourRole,
  calculerEtatAffiche,
} from './etat-affiche';

const AUCUNE_ATTENTE: AttentesOr = { accord: false, pieces: false, externe: false };

describe('calculerEtatAffiche', () => {
  it("rend le statut tel quel quand aucune attente n'est active", () => {
    expect(calculerEtatAffiche('en_cours', AUCUNE_ATTENTE)).toBe('en_cours');
  });

  it('priorise accord sur pieces et externe', () => {
    const attentes: AttentesOr = { accord: true, pieces: true, externe: true };
    expect(calculerEtatAffiche('ouvert', attentes)).toBe('attente_accord');
  });

  it('priorise pieces sur externe quand accord est levé', () => {
    const attentes: AttentesOr = { accord: false, pieces: true, externe: true };
    expect(calculerEtatAffiche('controle', attentes)).toBe('attente_pieces');
  });

  it('rend externe seul quand ni accord ni pieces ne bloquent', () => {
    const attentes: AttentesOr = { accord: false, pieces: false, externe: true };
    expect(calculerEtatAffiche('en_cours', attentes)).toBe('attente_externe');
  });

  it('ignore les attentes résiduelles sur un statut terminal (cloture)', () => {
    const attentes: AttentesOr = { accord: true, pieces: true, externe: true };
    expect(calculerEtatAffiche('cloture', attentes)).toBe('cloture');
  });

  it('ignore les attentes résiduelles sur planifie (avant réception)', () => {
    const attentes: AttentesOr = { accord: true, pieces: false, externe: false };
    expect(calculerEtatAffiche('planifie', attentes)).toBe('planifie');
  });
});

describe('calculerActionsDisponibles', () => {
  it('planifie : receptionner et annuler seulement, aucune action de ligne', () => {
    expect(calculerActionsDisponibles('planifie')).toEqual(['receptionner', 'annuler']);
  });

  it('cloture et annule : état terminal, aucune action', () => {
    expect(calculerActionsDisponibles('cloture')).toEqual([]);
    expect(calculerActionsDisponibles('annule')).toEqual([]);
  });

  it('en_cours : actions de transition ET actions groupées de ligne', () => {
    const actions = calculerActionsDisponibles('en_cours');
    expect(actions).toContain('passer-en-controle');
    expect(actions).toContain('terminer');
    expect(actions).toContain('valider-lignes');
    expect(actions).toContain('soumettre-lignes-a-devis');
  });

  it('facture : restituer seulement, plus aucune action de ligne (verrouillé I-15)', () => {
    expect(calculerActionsDisponibles('facture')).toEqual(['restituer']);
  });

  it('restitue : cloturer seulement', () => {
    expect(calculerActionsDisponibles('restitue')).toEqual(['cloturer']);
  });
});

describe('calculerActionsDisponiblesPourRole', () => {
  it('un technicien ne voit ni annuler ni terminer sur un OR ouvert (aucun droit atelier.or.*)', () => {
    const actions = calculerActionsDisponiblesPourRole('ouvert', 'technicien');
    expect(actions).not.toContain('annuler');
    expect(actions).not.toContain('terminer');
    expect(actions).toContain('demarrer');
  });

  it('un réceptionnaire voit terminer et annuler sur un OR ouvert', () => {
    const actions = calculerActionsDisponiblesPourRole('ouvert', 'receptionnaire');
    expect(actions).toContain('terminer');
    expect(actions).toContain('annuler');
  });

  it('un comptable (lecture seule atelier) ne voit aucune action sur un OR ouvert', () => {
    expect(calculerActionsDisponiblesPourRole('ouvert', 'comptable')).toEqual([]);
  });
});
