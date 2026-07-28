import { describe, expect, it } from 'vitest';
import { CollecteurAvertissements } from './collecteur-avertissements';

describe('CollecteurAvertissements', () => {
  it('est vide à la construction', () => {
    const collecteur = new CollecteurAvertissements();
    expect(collecteur.estVide()).toBe(true);
    expect(collecteur.liste()).toEqual([]);
  });

  it('envelopper() sur un collecteur vide rend avertissements: [] — jamais undefined ni omis', () => {
    const collecteur = new CollecteurAvertissements();
    const enveloppe = collecteur.envelopper({ id: 'x' });
    expect(enveloppe).toEqual({ donnees: { id: 'x' }, avertissements: [] });
    expect(enveloppe.avertissements).not.toBeUndefined();
  });

  it('ajouter() sans donnees produit un avertissement sans la clé donnees', () => {
    const collecteur = new CollecteurAvertissements();
    collecteur.ajouter('CLIENT_DOUBLON_PROBABLE', 'Un client très similaire existe déjà.');
    expect(collecteur.liste()).toEqual([{ code: 'CLIENT_DOUBLON_PROBABLE', message: 'Un client très similaire existe déjà.' }]);
  });

  it('ajouter() avec donnees les porte telles quelles', () => {
    const collecteur = new CollecteurAvertissements();
    collecteur.ajouter('VEHICULE_KILOMETRAGE_ABERRANT', 'Kilométrage très supérieur à la moyenne du modèle.', {
      kilometrageReleve: 999000,
      kilometrageAttenduMax: 300000,
    });
    expect(collecteur.liste()).toEqual([
      {
        code: 'VEHICULE_KILOMETRAGE_ABERRANT',
        message: 'Kilométrage très supérieur à la moyenne du modèle.',
        donnees: { kilometrageReleve: 999000, kilometrageAttenduMax: 300000 },
      },
    ]);
  });

  it('conserve l\'ordre d\'ajout', () => {
    const collecteur = new CollecteurAvertissements();
    collecteur.ajouter('CLIENT_DOUBLON_PROBABLE', 'premier');
    collecteur.ajouter('VEHICULE_VIN_COURT', 'second');
    expect(collecteur.liste().map((a) => a.message)).toEqual(['premier', 'second']);
  });

  it('liste() rend une copie : la muter ne modifie pas le collecteur', () => {
    const collecteur = new CollecteurAvertissements();
    collecteur.ajouter('CLIENT_DOUBLON_PROBABLE', 'x');
    const liste = collecteur.liste() as Array<unknown>;
    liste.push('intrus');
    expect(collecteur.liste()).toHaveLength(1);
  });

  it('envelopper() enveloppe les données fournies sans les altérer', () => {
    const collecteur = new CollecteurAvertissements();
    const donnees = { id: 'abc', numero: 'C-2026-001' };
    collecteur.ajouter('CLIENT_DOUBLON_PROBABLE', 'x');
    expect(collecteur.envelopper(donnees)).toEqual({
      donnees: { id: 'abc', numero: 'C-2026-001' },
      avertissements: [{ code: 'CLIENT_DOUBLON_PROBABLE', message: 'x' }],
    });
  });

  it('estVide() redevient false dès le premier ajout', () => {
    const collecteur = new CollecteurAvertissements();
    collecteur.ajouter('CLIENT_DOUBLON_PROBABLE', 'x');
    expect(collecteur.estVide()).toBe(false);
  });
});
