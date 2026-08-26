import { describe, expect, it, vi } from 'vitest';

import {
  creerCompteurProgresEcriture,
  SEUIL_LOT_PROGRESSION_REPRISE,
} from './progression-ecriture-reprise';

describe('creerCompteurProgresEcriture', () => {
  it("ne déclenche AUCUN appel avant d'atteindre le seuil", async () => {
    const onProgres = vi.fn(async () => undefined);
    const compteur = creerCompteurProgresEcriture(onProgres);

    for (let i = 0; i < SEUIL_LOT_PROGRESSION_REPRISE - 1; i++) {
      await compteur.incrementer();
    }

    expect(onProgres).not.toHaveBeenCalled();
  });

  it('déclenche exactement au seuil, avec le delta correspondant', async () => {
    const onProgres = vi.fn(async () => undefined);
    const compteur = creerCompteurProgresEcriture(onProgres);

    for (let i = 0; i < SEUIL_LOT_PROGRESSION_REPRISE; i++) {
      await compteur.incrementer();
    }

    expect(onProgres).toHaveBeenCalledTimes(1);
    expect(onProgres).toHaveBeenCalledWith(SEUIL_LOT_PROGRESSION_REPRISE);
  });

  it('remet le compteur à zéro après chaque flush — un second seuil déclenche un second appel, jamais un total cumulé', async () => {
    const onProgres = vi.fn(async () => undefined);
    const compteur = creerCompteurProgresEcriture(onProgres);

    for (let i = 0; i < SEUIL_LOT_PROGRESSION_REPRISE * 2; i++) {
      await compteur.incrementer();
    }

    expect(onProgres).toHaveBeenCalledTimes(2);
    expect(onProgres).toHaveBeenNthCalledWith(1, SEUIL_LOT_PROGRESSION_REPRISE);
    expect(onProgres).toHaveBeenNthCalledWith(2, SEUIL_LOT_PROGRESSION_REPRISE);
  });

  it('sans callback fourni, ne fait rien (jamais une exception faute de destinataire)', async () => {
    const compteur = creerCompteurProgresEcriture(undefined);
    for (let i = 0; i < SEUIL_LOT_PROGRESSION_REPRISE * 3; i++) {
      await expect(compteur.incrementer()).resolves.toBeUndefined();
    }
  });

  it('un lot partiel (sous le seuil) reste NON signalé — comptabilité laissée au reste final côté appelant, jamais deviné ici', async () => {
    const onProgres = vi.fn(async () => undefined);
    const compteur = creerCompteurProgresEcriture(onProgres);

    for (let i = 0; i < SEUIL_LOT_PROGRESSION_REPRISE + 137; i++) {
      await compteur.incrementer();
    }

    // Un seul flush (au seuil) ; les 137 lignes du lot partiel restent NON signalées par ce
    // compteur — c'est à l'appelant orchestrateur de les couvrir via le "reste" final.
    expect(onProgres).toHaveBeenCalledTimes(1);
    expect(onProgres).toHaveBeenCalledWith(SEUIL_LOT_PROGRESSION_REPRISE);
  });
});
