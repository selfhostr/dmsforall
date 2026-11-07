import { describe, expect, it } from 'vitest';
import { formaterNomClient, formaterNomPersonne } from './nom-affiche';

describe('formaterNomPersonne', () => {
  it('rend « Prénom Nom » sans toucher à la casse', () => {
    expect(formaterNomPersonne({ nom: 'Meier', prenom: 'Urs' })).toBe('Urs Meier');
    expect(formaterNomPersonne({ nom: 'ROSSI', prenom: 'lea' })).toBe('lea ROSSI');
  });
  it('prénom absent, null ou blanc : nom seul', () => {
    expect(formaterNomPersonne({ nom: 'Meier' })).toBe('Meier');
    expect(formaterNomPersonne({ nom: 'Meier', prenom: null })).toBe('Meier');
    expect(formaterNomPersonne({ nom: 'Meier', prenom: '   ' })).toBe('Meier');
  });
  it('trime les parties', () => {
    expect(formaterNomPersonne({ nom: ' Meier ', prenom: ' Urs ' })).toBe('Urs Meier');
  });
});

describe('formaterNomClient', () => {
  it('entreprise : raison sociale inchangée', () => {
    expect(
      formaterNomClient({
        type: 'entreprise',
        raisonSociale: 'Transports Rhône Sàrl',
        nom: 'X',
        prenom: 'Y',
      }),
    ).toBe('Transports Rhône Sàrl');
  });
  it('particulier : Prénom Nom, malgré une raison sociale résiduelle', () => {
    expect(
      formaterNomClient({ type: 'particulier', nom: 'Meier', prenom: 'Urs', raisonSociale: 'Z' }),
    ).toBe('Urs Meier');
  });
});
