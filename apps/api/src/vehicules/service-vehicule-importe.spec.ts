import { describe, expect, it, vi } from 'vitest';
import { schemaModificationVehicule } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneVehicule } from '../db/schema';
import type { Horloge } from '../common/horloge';
import { versReponseVehicule } from './vehicule.mappers';

/**
 * F-01-bis appliqué à `vehicule.importe` (corruption silencieuse, gravité haute — voir
 * `common/validation/champs-envoyes.ts`) : `schemaModificationVehicule` naît de
 * `schemaCreationVehicule.omit({...}).partial()`, et `importe` y porte `.default(false)` sur le
 * schéma de BASE. `.partial()` rend la clé optionnelle, il n'annule PAS le `.default(...)` posé
 * dessus : un corps qui ne mentionne jamais `importe` (ex. `PATCH { couleur: 'rouge' }`) ressort
 * malgré tout du `.parse()` avec `importe: false`. Sans garde sur le corps BRUT, ce `false`
 * fantôme écrasait le statut « importé » d'un véhicule à chaque modification qui ne le touchait
 * pas — un véhicule importé a un historique administratif différent, cette information n'est pas
 * cosmétique.
 *
 * Même doctrine de test que `service-vehicule-emplacement.spec.ts` : `chargerLigneVehicule`/
 * `construireReponseVehicule` (`./vehicule-requetes`) sont MOQUÉS pour isoler exactement ce que
 * `ServiceVehicule.modifier` envoie à `tx.update(vehicule).set(...)`, sans reconstruire toute la
 * chaîne Drizzle de lecture.
 */
vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  construireReponseVehicule: vi.fn(),
}));

import { ServiceVehicule } from './service-vehicule';
import * as vehiculeRequetes from './vehicule-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const VEHICULE_ID = 'vehicule-1';
const MAINTENANT = new Date('2026-08-10T09:15:00.000Z');

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
    version: null,
    finition: null,
    codeTypeCh: null,
    date1reCirculation: null,
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
    importe: true,
    paysOrigine: 'FR',
    dateImportation: '2020-05-01',
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

describe('schemaModificationVehicule — le `.default(false)` de `importe` survit à `.partial()` (documente la cause racine)', () => {
  it('un corps qui ne mentionne jamais importe ressort du parse avec importe: false malgré tout', () => {
    const parse = schemaModificationVehicule.parse({ couleur: 'rouge' });
    expect(parse.importe).toBe(false);
  });
});

describe('ServiceVehicule.modifier — importe ne doit JAMAIS être écrasé par un PATCH qui ne le mentionne pas (F-01-bis)', () => {
  it(
    'RÉGRESSION : un véhicule importé (importe: true en base) PATCH { couleur } (importe absent ' +
      'du corps BRUT envoyé par le client) ne doit PAS écrire importe — la colonne doit être ' +
      'omise du UPDATE (undefined), jamais réécrite à false. Le corps BRUT `{ couleur: "rouge" }` ' +
      'est ce que le client envoie réellement — la ligne suivante simule fidèlement ce que fait ' +
      "aujourd'hui `@CorpsZod` côté contrôleur (`PipeZod.transform`, donc `schema.safeParse`) " +
      'avant d’appeler le service : c’est CE parse qui injecte `importe: false`, pas un objet ' +
      "construit à la main qui l'omettrait par accident.",
    async () => {
      const { tx, setArgs } = txFactice();
      vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue(
        ligneVehicule({ importe: true }),
      );
      vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(
        versReponseVehicule(ligneVehicule({ importe: true, couleur: 'rouge' }), null, null),
      );
      const service = new ServiceVehicule(accesBaseFactice(tx) as never, horlogeFixe());

      const corpsBrut = { couleur: 'rouge' };
      const resultat = await service.modifier(CTX, VEHICULE_ID, corpsBrut);

      expect(setArgs).toHaveLength(1);
      const set = setArgs[0] as Record<string, unknown>;
      expect(set.couleur).toBe('rouge');
      // Le cœur de la preuve : `importe` doit être ABSENT (undefined) du UPDATE, jamais `false`.
      expect(set.importe).toBeUndefined();
      expect(resultat.donnees.importe.estImporte).toBe(true);
    },
  );

  it('PATCH { importe: false } explicite continue de fonctionner — le cas symétrique à ne pas casser', async () => {
    const { tx, setArgs } = txFactice();
    vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue(
      ligneVehicule({ importe: true }),
    );
    vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(
      versReponseVehicule(ligneVehicule({ importe: false }), null, null),
    );
    const service = new ServiceVehicule(accesBaseFactice(tx) as never, horlogeFixe());

    await service.modifier(CTX, VEHICULE_ID, { importe: false });

    expect(setArgs).toHaveLength(1);
    const set = setArgs[0] as Record<string, unknown>;
    expect(set.importe).toBe(false);
  });

  it('PATCH { importe: true } explicite continue de fonctionner', async () => {
    const { tx, setArgs } = txFactice();
    vi.mocked(vehiculeRequetes.chargerLigneVehicule).mockResolvedValue(
      ligneVehicule({ importe: false }),
    );
    vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(
      versReponseVehicule(ligneVehicule({ importe: true }), null, null),
    );
    const service = new ServiceVehicule(accesBaseFactice(tx) as never, horlogeFixe());

    await service.modifier(CTX, VEHICULE_ID, { importe: true });

    expect(setArgs).toHaveLength(1);
    const set = setArgs[0] as Record<string, unknown>;
    expect(set.importe).toBe(true);
  });
});
