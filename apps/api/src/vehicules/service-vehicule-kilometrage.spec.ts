import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneVehicule, LigneVehiculeKilometrage } from '../db/schema';
import type { Horloge } from '../common/horloge';
import type { ServiceEvenements } from '../common/evenements';

/**
 * Faille É-01 (audit sécurité) : `POST .../kilometrages` n'exposait qu'un `@ExigerDroit` STATIQUE
 * (`vehicule.kilometrage.saisir`), qui ne peut pas distinguer une saisie normale d'une correction
 * régressive (§10 L962, réservée à `chef_atelier`/`direction`) — la même route sert les deux, et le
 * caractère régressif ne se sait qu'après lecture du dernier relevé, en base. Un `technicien` avec
 * un `motifRegression` de complaisance faisait donc redescendre un compteur sans aucun contrôle.
 *
 * Ce fichier prouve, sans base réelle (fonctions de requête et transaction MOQUÉES — voir
 * `service-vehicule-contexte-atelier.spec.ts` pour la même doctrine), que
 * `ServiceVehiculeKilometrage.creer` vérifie désormais explicitement
 * `MATRICE_DROITS[role].includes('vehicule.kilometrage.corriger_regression')` sur la branche
 * régressive, à partir du `role` transmis par l'appelant (jamais déduit ailleurs) — et que le refus
 * n'écrit RIEN (aucun appel à `tx.insert`, aucun événement publié).
 */
vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  lireDernierKilometrage: vi.fn(),
}));

import { ServiceVehiculeKilometrage } from './service-vehicule-kilometrage';
import * as vehiculeRequetes from './vehicule-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const VEHICULE_ID = 'vehicule-1';
const MAINTENANT = new Date('2026-07-28T08:00:00.000Z');

const DERNIER_RELEVE_CONNU = {
  id: 'km-precedent',
  tenantId: 'tenant-a',
  vehiculeId: VEHICULE_ID,
  valeur: 185_000,
  unite: 'km',
  valeurKm: 185_000,
  releveLe: new Date('2026-06-01T09:00:00.000Z'),
  source: 'declaratif',
  motifRegression: null,
  ordreReparationId: null,
  saisiParId: null,
  creeLe: new Date('2026-06-01T09:00:00.000Z'),
} as LigneVehiculeKilometrage;

function horlogeFixe(): Horloge {
  return { maintenant: () => MAINTENANT } as Horloge;
}

/** Fausse transaction : seul `insert(...).values(...).returning()` est exercé par ce service. */
function txFactice(ligneInseree: LigneVehiculeKilometrage) {
  const returning = vi.fn(async () => [ligneInseree]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return { tx: { insert } as unknown as TransactionDfa, insert, values, returning };
}

function accesBaseFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

function evenementsFactices(): ServiceEvenements {
  return { publier: vi.fn(async () => undefined) };
}

const LIGNE_INSEREE = {
  ...DERNIER_RELEVE_CONNU,
  id: 'km-nouveau',
  valeur: 112_000,
  valeurKm: 112_000,
} as LigneVehiculeKilometrage;

beforeEach(() => {
  vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue({} as LigneVehicule);
  vi.mocked(vehiculeRequetes.lireDernierKilometrage).mockResolvedValue(DERNIER_RELEVE_CONNU);
});

describe('ServiceVehiculeKilometrage.creer — correction régressive (É-01)', () => {
  it("un technicien avec motifRegression sur une saisie RÉGRESSIVE est refusé 403 DROIT_INSUFFISANT — le compteur n'est PAS écrit", async () => {
    const { tx, insert } = txFactice(LIGNE_INSEREE);
    const acces = accesBaseFactice(tx);
    const evenements = evenementsFactices();
    const service = new ServiceVehiculeKilometrage(acces as never, evenements, horlogeFixe());

    await expect(
      service.creer(
        CTX,
        VEHICULE_ID,
        {
          valeur: 112_000,
          unite: 'km',
          releveLe: MAINTENANT.toISOString(),
          source: 'declaratif',
          motifRegression: 'erreur_saisie',
        },
        'technicien',
      ),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });

    // Refus = AUCUNE écriture, ni sur `vehicule_kilometrage`, ni d'événement publié — un refus qui
    // écrirait quand même serait le pire des deux mondes.
    expect(insert).not.toHaveBeenCalled();
    expect(evenements.publier).not.toHaveBeenCalled();
  });

  it("un chef d'atelier avec motifRegression sur une saisie RÉGRESSIVE est accepté (201) et le relevé est bien inséré", async () => {
    const { tx, insert, values } = txFactice(LIGNE_INSEREE);
    const acces = accesBaseFactice(tx);
    const evenements = evenementsFactices();
    const service = new ServiceVehiculeKilometrage(acces as never, evenements, horlogeFixe());

    const resultat = await service.creer(
      CTX,
      VEHICULE_ID,
      {
        valeur: 112_000,
        unite: 'km',
        releveLe: MAINTENANT.toISOString(),
        source: 'declaratif',
        motifRegression: 'erreur_saisie',
      },
      'chef_atelier',
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ valeur: 112_000, motifRegression: 'erreur_saisie' }),
    );
    expect(resultat.donnees.valeurKm).toBe(112_000);
  });

  it('un technicien SANS régression (saisie normale, croissante) reste accepté — le droit fort ne bloque que la branche régressive', async () => {
    const { tx, insert } = txFactice({ ...LIGNE_INSEREE, valeur: 186_000, valeurKm: 186_000 });
    const acces = accesBaseFactice(tx);
    const evenements = evenementsFactices();
    const service = new ServiceVehiculeKilometrage(acces as never, evenements, horlogeFixe());

    const resultat = await service.creer(
      CTX,
      VEHICULE_ID,
      { valeur: 186_000, unite: 'km', releveLe: MAINTENANT.toISOString(), source: 'declaratif' },
      'technicien',
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(resultat.donnees.valeurKm).toBe(186_000);
  });

  it('un technicien SANS motifRegression sur une saisie régressive reste refusé 409 VEHICULE_KILOMETRAGE_REGRESSIF (comportement inchangé, pas 403)', async () => {
    const { tx, insert } = txFactice(LIGNE_INSEREE);
    const acces = accesBaseFactice(tx);
    const evenements = evenementsFactices();
    const service = new ServiceVehiculeKilometrage(acces as never, evenements, horlogeFixe());

    await expect(
      service.creer(
        CTX,
        VEHICULE_ID,
        { valeur: 112_000, unite: 'km', releveLe: MAINTENANT.toISOString(), source: 'declaratif' },
        'technicien',
      ),
    ).rejects.toMatchObject({ code: 'VEHICULE_KILOMETRAGE_REGRESSIF' });
    expect(insert).not.toHaveBeenCalled();
  });
});
