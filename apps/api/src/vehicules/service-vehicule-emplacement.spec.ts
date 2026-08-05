import { describe, expect, it, vi } from 'vitest';
import { schemaModificationVehicule } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneVehicule } from '../db/schema';
import type { Horloge } from '../common/horloge';
import { versReponseVehicule, versVehiculeResume } from './vehicule.mappers';

/**
 * Emplacement libre du véhicule (migration 0044, RM/CT du plan du parc, Lot C simplifié) —
 * `emplacementLibre` (texte libre, aide-mémoire) et `emplacementMajLe` (horodatage APPLICATIF,
 * jamais un trigger générique sur `modifie_le`).
 *
 * Deux volets couverts ici, séparément :
 *  1. mappers (`versReponseVehicule`/`versVehiculeResume`) — rendu correct présent/absent, sans
 *     dépendance à une transaction ;
 *  2. `ServiceVehicule.modifierDansTransaction` — le point CRITIQUE : `emplacementMajLe` n'avance
 *     QUE quand `emplacementLibre` figure dans le corps de la requête PATCH, jamais sur un autre
 *     champ. `chargerLigneVehicule`/`construireReponseVehicule` (`./vehicule-requetes`) sont
 *     MOQUÉS — même doctrine que `service-vehicule-contexte-atelier.spec.ts` et
 *     `service-vehicule-kilometrage.spec.ts` — pour isoler exactement ce que ce service envoie à
 *     `tx.update(vehicule).set(...)`, sans reconstruire toute la chaîne Drizzle de lecture.
 */
vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  construireReponseVehicule: vi.fn(),
}));

import { ServiceVehicule } from './service-vehicule';
import * as vehiculeRequetes from './vehicule-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const VEHICULE_ID = 'vehicule-1';
const MAINTENANT = new Date('2026-08-05T09:15:00.000Z');

function horlogeFixe(): Horloge {
  return { maintenant: () => MAINTENANT } as Horloge;
}

function ligneVehicule(champs: Partial<LigneVehicule> = {}): LigneVehicule {
  return {
    id: VEHICULE_ID,
    tenantId: 'tenant-a',
    vin: 'WVGZZZ1TZJW123456',
    marque: 'VW',
    modele: 'Touran',
    version: '2.0 TDI',
    finition: null,
    codeTypeCh: '1ZM431',
    date1reCirculation: '2018-03-01',
    carburant: null,
    cylindreeCm3: null,
    puissanceKw: null,
    boite: null,
    transmission: null,
    normeEmission: null,
    couleur: null,
    codeCouleur: null,
    poidsVideKg: null,
    poidsTotalKg: null,
    places: null,
    pneusEte: null,
    pneusHiver: null,
    pressionPneus: null,
    huileType: null,
    huileQuantiteDl: null,
    batterie: null,
    codeRadio: null,
    codeCle: null,
    intervalleEntretienKm: null,
    intervalleEntretienMois: null,
    importe: false,
    paysOrigine: null,
    dateImportation: null,
    garantieDebut: null,
    garantieMois: null,
    garantieKm: null,
    proprietaireEconomiqueClientId: null,
    conducteurHabituel: null,
    identificationIncomplete: false,
    statut: 'actif',
    motifArchivage: null,
    fusionneVersVehiculeId: null,
    vehiculeStockId: null,
    emplacementLibre: null,
    emplacementMajLe: null,
    creeLe: new Date('2018-03-01T00:00:00.000Z'),
    modifieLe: new Date('2018-03-01T00:00:00.000Z'),
    ...champs,
  } as LigneVehicule;
}

/** Fausse transaction : seul `update(vehicule).set(...).where(...)` est exercé par
 *  `modifierDansTransaction` — la lecture passe par les fonctions moquées de `vehicule-requetes`. */
function txFactice() {
  const setArgs: unknown[] = [];
  const update = vi.fn(() => ({
    set: (vals: unknown) => {
      setArgs.push(vals);
      return { where: () => Promise.resolve(undefined) };
    },
  }));
  return { tx: { update } as unknown as TransactionDfa, update, setArgs };
}

function accesBaseFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('mappers — emplacementLibre / emplacementMajLe', () => {
  it('versReponseVehicule rend emplacementLibre et emplacementMajLe (ISO) quand renseignés', () => {
    const ligne = ligneVehicule({
      emplacementLibre: 'Devant, place 3',
      emplacementMajLe: new Date('2026-08-05T09:15:00.000Z'),
    });

    const reponse = versReponseVehicule(ligne, null, null);

    expect(reponse.emplacementLibre).toBe('Devant, place 3');
    expect(reponse.emplacementMajLe).toBe('2026-08-05T09:15:00.000Z');
  });

  it('versReponseVehicule rend emplacementLibre et emplacementMajLe à null quand jamais posés (cas normal, RM/CT du champ)', () => {
    const ligne = ligneVehicule({ emplacementLibre: null, emplacementMajLe: null });

    const reponse = versReponseVehicule(ligne, null, null);

    expect(reponse.emplacementLibre).toBeNull();
    expect(reponse.emplacementMajLe).toBeNull();
  });

  it('versVehiculeResume expose emplacementLibre dans la projection de liste (arbitrage : présent en liste, contrairement à creeLe/modifieLe)', () => {
    const ligne = ligneVehicule({ emplacementLibre: 'Atelier, pont 2' });

    const resume = versVehiculeResume(ligne, null);

    expect(resume.emplacementLibre).toBe('Atelier, pont 2');
    expect(resume).not.toHaveProperty('emplacementMajLe');
  });
});

describe('ServiceVehicule.modifierDansTransaction — emplacementMajLe suit UNIQUEMENT emplacementLibre', () => {
  it('PATCH { emplacementLibre } pose la valeur ET avance emplacementMajLe à l’instant courant', async () => {
    const { tx, setArgs } = txFactice();
    vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue(ligneVehicule());
    vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(
      versReponseVehicule(
        ligneVehicule({ emplacementLibre: 'Devant, place 3', emplacementMajLe: MAINTENANT }),
        null,
        null,
      ),
    );
    const service = new ServiceVehicule(accesBaseFactice(tx) as never, horlogeFixe());

    const resultat = await service.modifier(CTX, VEHICULE_ID, {
      emplacementLibre: 'Devant, place 3',
    });

    expect(setArgs).toHaveLength(1);
    expect(setArgs[0]).toMatchObject({
      emplacementLibre: 'Devant, place 3',
      emplacementMajLe: MAINTENANT,
    });
    expect(resultat.donnees.emplacementLibre).toBe('Devant, place 3');
    expect(resultat.donnees.emplacementMajLe).toBe(MAINTENANT.toISOString());
  });

  it(
    "PATCH d'un AUTRE champ seul (couleur) ne touche PAS emplacementMajLe — c'est le test qui " +
      'échouerait si un trigger générique/`modifieLe` était utilisé à la place de la mise à jour ' +
      'ciblée par ce service (colonne omise du UPDATE, `undefined` en `.set()`)',
    async () => {
      const { tx, setArgs } = txFactice();
      vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue(ligneVehicule());
      vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(
        versReponseVehicule(ligneVehicule({ couleur: 'rouge' }), null, null),
      );
      const service = new ServiceVehicule(accesBaseFactice(tx) as never, horlogeFixe());

      await service.modifier(CTX, VEHICULE_ID, { couleur: 'rouge' });

      expect(setArgs).toHaveLength(1);
      const set = setArgs[0] as Record<string, unknown>;
      expect(set.couleur).toBe('rouge');
      // Colonnes omises (`undefined`) du UPDATE — pas d'écriture, donc pas de valeur en base.
      expect(set.emplacementLibre).toBeUndefined();
      expect(set.emplacementMajLe).toBeUndefined();
    },
  );

  it('PATCH { emplacementLibre: null } efface la valeur ET pose quand même emplacementMajLe (poser/effacer compte pareil comme y toucher)', async () => {
    const { tx, setArgs } = txFactice();
    vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue(
      ligneVehicule({ emplacementLibre: 'Devant, place 3' }),
    );
    vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(
      versReponseVehicule(
        ligneVehicule({ emplacementLibre: null, emplacementMajLe: MAINTENANT }),
        null,
        null,
      ),
    );
    const service = new ServiceVehicule(accesBaseFactice(tx) as never, horlogeFixe());

    await service.modifier(CTX, VEHICULE_ID, { emplacementLibre: null });

    expect(setArgs).toHaveLength(1);
    expect(setArgs[0]).toMatchObject({ emplacementLibre: null, emplacementMajLe: MAINTENANT });
  });
});

describe('schemaModificationVehicule — borne applicative de emplacementLibre (RM du champ : texte libre, PAS de format imposé)', () => {
  it('accepte une valeur de 60 caractères (borne incluse)', () => {
    const resultat = schemaModificationVehicule.safeParse({ emplacementLibre: 'x'.repeat(60) });
    expect(resultat.success).toBe(true);
  });

  it('rejette une valeur de 61 caractères (au-delà de la borne)', () => {
    const resultat = schemaModificationVehicule.safeParse({ emplacementLibre: 'x'.repeat(61) });
    expect(resultat.success).toBe(false);
  });

  it('accepte null (effacement) et undefined (champ non touché)', () => {
    expect(schemaModificationVehicule.safeParse({ emplacementLibre: null }).success).toBe(true);
    expect(schemaModificationVehicule.safeParse({}).success).toBe(true);
  });
});
