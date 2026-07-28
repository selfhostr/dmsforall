import { describe, expect, it } from 'vitest';
import type { EntreeModificationParametresAtelier } from '@dfa/shared';
import { verifierChampsActifsParametresAtelier } from './gouvernance-fonctionnalites';

describe('verifierChampsActifsParametresAtelier', () => {
  it('laisse passer un corps vide', () => {
    expect(() => verifierChampsActifsParametresAtelier({})).not.toThrow();
  });

  it('laisse passer les domaines actifs au lot 1 (or, reception hors signature, travaux actifs, vehicule)', () => {
    const entree: EntreeModificationParametresAtelier = {
      or: { prefixe: 'OR', resetAnnuel: false },
      reception: { kmEntreeObligatoire: false, plafondDefautCentimes: 50000 },
      travaux: { uniteTemps: 'unites_constructeur', controleQualite: 'toujours' },
      vehicule: { expertiseAlerteMois: 3 },
      documents: { langue: 'site' },
    };
    expect(() => verifierChampsActifsParametresAtelier(entree)).not.toThrow();
  });

  it.each([
    [{ facturation: { multiPayeursAutorise: true } }, 'facturation.multiPayeursAutorise'],
    [{ facturation: { produitsAtelier: { mode: 'desactive', pourmille: null, plafondCentimes: null } } }, 'facturation.produitsAtelier'],
    [{ planning: { noShowSeuilAlerte: 5 } }, 'planning.noShowSeuilAlerte'],
    [{ planning: { tamponPretMinutes: 15 } }, 'planning.tamponPretMinutes'],
    [{ reception: { signature: 'obligatoire' } }, 'reception.signature'],
    [{ travaux: { arrondiPointage: 'minute' } }, 'travaux.arrondiPointage'],
    [{ travaux: { dureeMaxPointageHeures: 8 } }, 'travaux.dureeMaxPointageHeures'],
  ] as const)('refuse %j avec FONCTION_NON_DISPONIBLE (%s)', (entree, cheminAttendu) => {
    let erreurCapturee: unknown;
    try {
      verifierChampsActifsParametresAtelier(entree as EntreeModificationParametresAtelier);
    } catch (erreur) {
      erreurCapturee = erreur;
    }
    expect(erreurCapturee).toMatchObject({ code: 'FONCTION_NON_DISPONIBLE', detail: cheminAttendu });
  });

  it('refuse tout le corps dès qu\'un seul champ est inerte, même mélangé à des champs actifs', () => {
    const entree: EntreeModificationParametresAtelier = {
      or: { prefixe: 'OR' },
      reception: { kmEntreeObligatoire: true, signature: 'desactivee' },
    };
    expect(() => verifierChampsActifsParametresAtelier(entree)).toThrow(
      expect.objectContaining({ code: 'FONCTION_NON_DISPONIBLE' }),
    );
  });
});
