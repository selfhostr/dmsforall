import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneVehiculeKilometrage } from '../db/schema';

/**
 * `ServiceVehiculeTravailReporte.creerDepuisRefus` — port `CreationTravailReporte` (RM-73), la
 * moitié « côté fournisseur » du geste « un client refuse une ligne d'OR -> le garage garde le
 * travail en mémoire pour le passage suivant ». Le port lui-même sera appelé par
 * `atelier/service-ligne-or.ts::refuserLignes` (hors périmètre de ce lot) une fois câblé — ce
 * fichier prouve ce que `vehicules` livre dès aujourd'hui, sans base réelle (fonctions de requête
 * et transaction MOQUÉES, même doctrine que `service-vehicule-kilometrage.spec.ts` et
 * `service-vehicule-contexte-atelier.spec.ts`).
 */
vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  lireDernierKilometrage: vi.fn(),
  listerTravauxReportes: vi.fn(),
}));

import {
  ServiceVehiculeTravailReporte,
  versReponseTravailReporte,
  type EntreeCreationTravailReporteDepuisRefus,
} from './service-vehicule-travail-reporte';
import * as vehiculeRequetes from './vehicule-requetes';
import type { LigneVehiculeTravailReporte } from '../db/schema';
import type { EntreeModificationTravailReporte } from '@dfa/shared';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const AUTRE_TENANT: ContexteTenant = {
  tenantId: 'tenant-b',
  utilisateurId: 'user-2',
  requeteId: 'req-2',
};
const VEHICULE_ID = 'vehicule-1';
const TRAVAIL_ID = 'travail-1';
const MAINTENANT = new Date('2026-07-30T09:15:00.000Z');

const DERNIER_RELEVE: LigneVehiculeKilometrage = {
  id: 'km-1',
  tenantId: 'tenant-a',
  vehiculeId: VEHICULE_ID,
  valeur: 84_500,
  unite: 'km',
  valeurKm: 84_500,
  releveLe: new Date('2026-07-01T08:00:00.000Z'),
  source: 'reception',
  motifRegression: null,
  ordreReparationId: null,
  saisiParId: null,
  creeLe: new Date('2026-07-01T08:00:00.000Z'),
};

function entreeRefus(
  partiel: Partial<EntreeCreationTravailReporteDepuisRefus> = {},
): EntreeCreationTravailReporteDepuisRefus {
  return {
    vehiculeId: VEHICULE_ID,
    ordreReparationId: 'or-1',
    ligneOrId: 'ligne-1',
    designation: 'Plaquettes de frein avant',
    urgence: 'a_surveiller',
    montantEstimeCentimes: 24_000,
    securite: false,
    motifRefus: 'Client reporte au prochain contrôle.',
    ...partiel,
  };
}

/** Fausse transaction : `select(...).from(...).where(...).limit(...)` (recherche de doublon) puis,
 *  si aucun n'existe, `insert(...).values(...)`. */
function txFactice(existantOuvert: readonly { id: string }[]) {
  const limit = vi.fn(async () => existantOuvert);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  return { tx: { select, insert } as unknown as TransactionDfa, select, insert, values };
}

function accesBaseFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

const TRAVAIL_EXISTANT: LigneVehiculeTravailReporte = {
  id: TRAVAIL_ID,
  tenantId: 'tenant-a',
  vehiculeId: VEHICULE_ID,
  designation: 'Plaquettes de frein avant',
  urgence: 'a_surveiller',
  montantEstimeCentimes: 24_000,
  kmConstat: 84_500,
  dateConstat: '2026-07-01',
  ordreReparationOrigineId: 'or-1',
  ligneOrOrigineId: 'ligne-1',
  securite: false,
  statut: 'ouvert',
  ordreReparationRepriseId: null,
  motifRefus: 'Client reporte au prochain contrôle.',
  motifModification: null,
  creeLe: new Date('2026-07-01T08:00:00.000Z'),
  modifieLe: new Date('2026-07-01T08:00:00.000Z'),
};

/**
 * Fausse transaction de `modifier` : `select(...).from(...).where(...).limit(...)` (chargement du
 * travail existant, pour le `RESSOURCE_INTROUVABLE`) puis `update(...).set(...).where(...)
 * .returning(...)`. `ligneRetournee` par défaut = `TRAVAIL_EXISTANT` fusionné avec ce que le `SET`
 * capturé contiendrait en pratique — mais ce fichier n'a besoin QUE d'espionner l'argument passé à
 * `.set(...)`, jamais de rejouer un vrai moteur SQL : `ligneRetournee` est fournie explicitement
 * par chaque test qui en a besoin.
 */
function txFactiqueModifier(
  travailExistant: LigneVehiculeTravailReporte | null,
  ligneRetournee: LigneVehiculeTravailReporte,
) {
  const limitSelect = vi.fn(async () => (travailExistant ? [travailExistant] : []));
  const whereSelect = vi.fn(() => ({ limit: limitSelect }));
  const fromSelect = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from: fromSelect }));

  const returning = vi.fn(async () => [ligneRetournee]);
  const whereUpdate = vi.fn(() => ({ returning }));
  // Paramètre TYPÉ (jamais `unknown` implicite) : `set.mock.calls[0]?.[0]` doit rester exploitable
  // par le test « mise à jour PARTIELLE » ci-dessous, qui inspecte directement l'objet passé à
  // `.set(...)` plutôt que de passer par `expect.objectContaining` (voir son commentaire).
  const set = vi.fn((_valeurs: Record<string, unknown>) => ({ where: whereUpdate }));
  const update = vi.fn(() => ({ set }));

  return {
    tx: { select, update } as unknown as TransactionDfa,
    select,
    update,
    set,
    whereUpdate,
    returning,
  };
}

function entreeModification(
  partiel: Partial<EntreeModificationTravailReporte> = {},
): EntreeModificationTravailReporte {
  return { ...partiel };
}

beforeEach(() => {
  vi.mocked(vehiculeRequetes.lireDernierKilometrage).mockResolvedValue(DERNIER_RELEVE);
});

/**
 * `versReponseTravailReporte` — TROU N°2 comblé (motif d'abandon lisible, pas seulement écrit).
 * DÉCISION VÉRIFIÉE ICI, PAS SUPPOSÉE : `motifModification` reste présent quel que soit le rôle,
 * CONTRAIREMENT à `montantEstimeCentimes` (`ROLES_SANS_MONTANT`, invariant front n°10). Voir
 * l'argumentation complète dans le commentaire de tête de `versReponseTravailReporte`.
 */
describe('versReponseTravailReporte — exposition de `motifModification`', () => {
  it('expose `motifModification` pour un rôle qui voit les montants (ex. receptionnaire)', () => {
    const ligne: LigneVehiculeTravailReporte = {
      ...TRAVAIL_EXISTANT,
      motifModification: 'Parti à la concurrence.',
    };
    const reponse = versReponseTravailReporte(ligne, 'receptionnaire');
    expect(reponse.motifModification).toBe('Parti à la concurrence.');
    expect(reponse.montantEstimeCentimes).toBe(24_000);
  });

  it('expose ENCORE `motifModification` pour `technicien` (`ROLES_SANS_MONTANT`) alors que `montantEstimeCentimes` disparaît — les deux filtrages sont INDÉPENDANTS', () => {
    const ligne: LigneVehiculeTravailReporte = {
      ...TRAVAIL_EXISTANT,
      motifModification: 'Parti à la concurrence.',
    };
    const reponse = versReponseTravailReporte(ligne, 'technicien');
    expect(reponse.motifModification).toBe('Parti à la concurrence.');
    expect(reponse).not.toHaveProperty('montantEstimeCentimes');
  });

  it('retourne `null` (jamais `undefined`) quand aucun motif n’a été enregistré', () => {
    const reponse = versReponseTravailReporte(TRAVAIL_EXISTANT, 'receptionnaire');
    expect(reponse.motifModification).toBeNull();
  });
});

describe('ServiceVehiculeTravailReporte.creerDepuisRefus (RM-73)', () => {
  it('insère un travail reporté OUVERT avec le lien vers la ligne/OR d’origine, le kilométrage courant et l’urgence de la ligne', async () => {
    const { tx, insert, values } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus(), MAINTENANT);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        vehiculeId: VEHICULE_ID,
        designation: 'Plaquettes de frein avant',
        urgence: 'a_surveiller',
        montantEstimeCentimes: 24_000,
        kmConstat: 84_500,
        dateConstat: '2026-07-30',
        ordreReparationOrigineId: 'or-1',
        ligneOrOrigineId: 'ligne-1',
        securite: false,
        statut: 'ouvert',
      }),
    );
  });

  it('retient l’urgence "a_faire" quand la ligne refusée n’en portait aucune (interprétation signalée)', async () => {
    const { insert, values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ urgence: null }), MAINTENANT);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ urgence: 'a_faire' }));
  });

  it('kmConstat reste `null` quand aucun relevé kilométrique n’existe pour le véhicule', async () => {
    vi.mocked(vehiculeRequetes.lireDernierKilometrage).mockResolvedValueOnce(null);
    const { insert, values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus(), MAINTENANT);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ kmConstat: null }));
  });

  it('PERSISTE `motifRefus` dans la colonne dédiée (migrations/0021, vehicule_travail_reporte.motif_refus)', async () => {
    const { values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);
    const motif = 'Client reporte au prochain contrôle technique.';

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ motifRefus: motif }), MAINTENANT);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ motifRefus: motif }));
  });

  it('normalise `motifRefus` en `null` quand il est vide ou blanc — sinon `vehicule_travail_reporte_motif_refus_non_vide_chk` refuserait l’insertion', async () => {
    const { values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ motifRefus: '   ' }), MAINTENANT);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ motifRefus: null }));
  });

  it('`motifRefus` reste `null` quand aucun motif n’a été fourni au refus (schemaRefusLignes.motif est optionnel)', async () => {
    const { values, tx } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus({ motifRefus: null }), MAINTENANT);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ motifRefus: null }));
  });

  it('est IDEMPOTENT : un travail reporté OUVERT déjà lié à cette ligne d’origine bloque une seconde insertion (rejeu de refuser-lignes)', async () => {
    const { tx, insert, select } = txFactice([{ id: 'travail-existant' }]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(tx, CTX, entreeRefus(), MAINTENANT);

    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it('scope chaque insertion sur le tenant de SON appelant — deux tenants qui refusent la même ligneOrId (falsification) n’écrivent jamais l’un pour l’autre', async () => {
    // Falsification : rejouer la MÊME `EntreeCreationTravailReporteDepuisRefus` (même `ligneOrId`,
    // même `vehiculeId`) sous DEUX tenants différents. Si `tenantId` venait d'ailleurs qu'`ctx`
    // (paramètre client, valeur par défaut, fuite d'un tenant précédent), les deux lignes insérées
    // porteraient le même `tenantId` — exactement la classe de faille que RM-01 (isolation
    // multi-tenant) interdit.
    const { tx: txA, values: valuesA } = txFactice([]);
    const { tx: txB, values: valuesB } = txFactice([]);
    const service = new ServiceVehiculeTravailReporte({} as never);

    await service.creerDepuisRefus(txA, CTX, entreeRefus(), MAINTENANT);
    await service.creerDepuisRefus(txB, AUTRE_TENANT, entreeRefus(), MAINTENANT);

    expect(valuesA).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
    expect(valuesB).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-b' }));
  });
});

/**
 * `ServiceVehiculeTravailReporte.modifier` — défaut mesuré (pas supposé) : `entree.motif`
 * (`schemaModificationTravailReporte.motif`, `schemaMotif`) est accepté et VALIDÉ par le schéma
 * partagé, mais avant migrations/0033 n'était écrit dans AUCUNE colonne — l'API répondait 200 et la
 * raison saisie par le réceptionnaire à la correction/clôture/abandon d'un travail reporté
 * disparaissait silencieusement. Ce fichier PROUVE que `motif_modification` (0033) reçoit
 * désormais cette valeur, avec la même normalisation défensive que `creerDepuisRefus` applique déjà
 * à `motifRefus`, ET que l'absence de motif dans un PATCH partiel (ex. l'action "reprendre" du
 * panneau front, qui n'envoie que `{ statut: 'repris' }`) laisse la colonne INTACTE plutôt que de
 * l'écraser en `null` — la même sémantique de mise à jour partielle que `designation`/`urgence`/
 * `montantEstimeCentimes`/`statut`.
 *
 * FALSIFICATION EXÉCUTÉE (pas seulement affirmée) pour le premier test ci-dessous : la ligne
 * `motifModification: entree.motif === undefined ? undefined : entree.motif.trim() || null,` de
 * `service-vehicule-travail-reporte.ts::modifier` a été temporairement retirée, `pnpm --filter
 * @dfa/api exec vitest run --project unitaire src/vehicules/service-vehicule-travail-reporte.spec.ts`
 * relancé — le test "écrit `entree.motif` dans `motif_modification`" a viré rouge (`motifModification`
 * absent de l'objet passé à `.set(...)`), la ligne remise, le test repasse vert. Voir la réponse de
 * tâche pour la sortie brute des deux exécutions.
 */
describe('ServiceVehiculeTravailReporte.modifier (RM-73, correctif migrations/0033)', () => {
  it('écrit `entree.motif` dans `motif_modification` — plus de perte silencieuse (falsifié, voir en-tête du describe)', async () => {
    const motif = 'Le client a vendu le véhicule avant le prochain passage.';
    const ligneRetournee: LigneVehiculeTravailReporte = {
      ...TRAVAIL_EXISTANT,
      statut: 'abandonne',
      motifModification: motif,
    };
    const { tx, set } = txFactiqueModifier(TRAVAIL_EXISTANT, ligneRetournee);
    const acces = accesBaseFactice(tx);
    const service = new ServiceVehiculeTravailReporte(acces as never);

    await service.modifier(
      CTX,
      VEHICULE_ID,
      TRAVAIL_ID,
      entreeModification({ statut: 'abandonne', motif }),
      'receptionnaire',
    );

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'abandonne', motifModification: motif }),
    );
  });

  it('renvoie `motifModification` dans la RÉPONSE, pas seulement écrit en base — trou n°2 (donnée morte) comblé', async () => {
    const motif = 'Parti à la concurrence.';
    const ligneRetournee: LigneVehiculeTravailReporte = {
      ...TRAVAIL_EXISTANT,
      statut: 'abandonne',
      motifModification: motif,
    };
    const { tx } = txFactiqueModifier(TRAVAIL_EXISTANT, ligneRetournee);
    const acces = accesBaseFactice(tx);
    const service = new ServiceVehiculeTravailReporte(acces as never);

    const reponse = await service.modifier(
      CTX,
      VEHICULE_ID,
      TRAVAIL_ID,
      entreeModification({ statut: 'abandonne', motif }),
      'receptionnaire',
    );

    expect(reponse.motifModification).toBe(motif);
  });

  it('normalise `entree.motif` en `null` quand il est vide/blanc — défense en profondeur, même doctrine que `creerDepuisRefus`/`motifRefus` (0021)', async () => {
    const ligneRetournee: LigneVehiculeTravailReporte = {
      ...TRAVAIL_EXISTANT,
      motifModification: null,
    };
    const { tx, set } = txFactiqueModifier(TRAVAIL_EXISTANT, ligneRetournee);
    const acces = accesBaseFactice(tx);
    const service = new ServiceVehiculeTravailReporte(acces as never);

    // Contourne volontairement `schemaMotif` (qui refuserait ce cas en amont, à la frontière HTTP)
    // pour prouver que le SERVICE lui-même ne fait pas confiance à l'appelant — même raisonnement
    // que le commentaire de `creerDepuisRefus` sur `motifRefus`.
    await service.modifier(
      CTX,
      VEHICULE_ID,
      TRAVAIL_ID,
      entreeModification({ motif: '   ' as never }),
      'receptionnaire',
    );

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ motifModification: null }));
  });

  it('laisse `motif_modification` INTACT (ni écrasé, ni mis à `null`) quand `entree.motif` est absent — mise à jour PARTIELLE', async () => {
    const ligneRetournee: LigneVehiculeTravailReporte = { ...TRAVAIL_EXISTANT, statut: 'repris' };
    const { tx, set } = txFactiqueModifier(TRAVAIL_EXISTANT, ligneRetournee);
    const acces = accesBaseFactice(tx);
    const service = new ServiceVehiculeTravailReporte(acces as never);

    await service.modifier(
      CTX,
      VEHICULE_ID,
      TRAVAIL_ID,
      entreeModification({ statut: 'repris' }),
      'receptionnaire',
    );

    expect(set).toHaveBeenCalledTimes(1);
    const [argumentSet] = set.mock.calls[0]!;
    // PAS `expect.objectContaining` ici : une clé PRÉSENTE avec la valeur `undefined` et une clé
    // ABSENTE sont indistinguables pour `objectContaining`, alors que la distinction EST le point du
    // test — `undefined` est ce que `mapUpdateSet` (drizzle-orm) filtre avant de construire le
    // `SET` SQL, `null` écrirait activement une valeur.
    expect(argumentSet.motifModification).toBeUndefined();
    expect(argumentSet.statut).toBe('repris');
  });

  it('scope la modification sur le tenant de SON appelant — la clause WHERE porte tenantId ET travailId', async () => {
    const ligneRetournee: LigneVehiculeTravailReporte = {
      ...TRAVAIL_EXISTANT,
      designation: 'Corrigé',
    };
    const { tx, whereUpdate } = txFactiqueModifier(TRAVAIL_EXISTANT, ligneRetournee);
    const acces = accesBaseFactice(tx);
    const service = new ServiceVehiculeTravailReporte(acces as never);

    await service.modifier(
      CTX,
      VEHICULE_ID,
      TRAVAIL_ID,
      entreeModification({ designation: 'Corrigé' }),
      'receptionnaire',
    );

    expect(whereUpdate).toHaveBeenCalledTimes(1);
  });

  it('RESSOURCE_INTROUVABLE quand le travail reporté n’existe pas pour ce véhicule/tenant — aucune écriture', async () => {
    const { tx, update } = txFactiqueModifier(null, TRAVAIL_EXISTANT);
    const acces = accesBaseFactice(tx);
    const service = new ServiceVehiculeTravailReporte(acces as never);

    await expect(
      service.modifier(
        CTX,
        VEHICULE_ID,
        TRAVAIL_ID,
        entreeModification({ statut: 'abandonne', motif: 'peu importe' }),
        'receptionnaire',
      ),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });

    expect(update).not.toHaveBeenCalled();
  });
});
