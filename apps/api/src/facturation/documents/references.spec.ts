import { describe, expect, it } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import type { LigneClientCondition } from '../../db/schema';

import { chargerConditionsPaiementEnVigueur } from './references';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function conditionFactice(champs: Partial<LigneClientCondition>): LigneClientCondition {
  return {
    id: 'cond-x',
    tenantId: 'tid-1',
    clientId: 'client-1',
    rabaisMoPourmille: null,
    rabaisPiecesPourmille: null,
    rabaisPneusPourmille: null,
    tauxHoraireCode: null,
    delaiPaiementJours: null,
    modePaiement: null,
    plafondCentimes: null,
    valideDu: '2026-01-01',
    valideAu: null,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-01-01T00:00:00.000Z'),
    ...champs,
  } as unknown as LigneClientCondition;
}

/** `tx.select().from(clientCondition).where(...)` rend `lignes`, DANS L'ORDRE FOURNI — pas de
 *  `.limit()`/`.for()` ici, contrairement à `chargerDocumentPourEcriture` : c'est exactement le
 *  chaînage réel de `chargerConditionsPaiementEnVigueur`. */
function txFactice(lignes: readonly LigneClientCondition[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(lignes),
      }),
    }),
  } as unknown as TransactionDfa;
}

/**
 * Défaut EXACTEMENT DUPLIQUÉ de celui corrigé dans `atelier/references.ts::
 * chargerConditionsEnVigueur` (RM-65, commit « Taux horaire : la borne de validite ne tire plus au
 * sort le tarif facture ») — signalé par le lot atelier comme un doublon, corrigé ici avec la même
 * preuve : la contrainte réelle `EXCLUDE ... daterange(valide_du, valide_au, '[)')`
 * (`0006_clients.sql`) a une borne haute EXCLUSIVE. Une lecture `valideAu >= dateJour` (inclusive)
 * désaccorde donc le code de la base le jour même d'une bascule « ancien jusqu'au 10 inclus,
 * nouveau dès le 10 » : LES DEUX lignes remontent comme « en vigueur » ce jour-là, et sans
 * `ORDER BY`/tri explicite, laquelle des deux gagne dépend d'un ordre de résultat NON GARANTI —
 * PostgreSQL ne promet aucun ordre sans clause de tri. Ce test rejoue la bascule sur les DEUX ordres
 * de tableau possibles : c'est précisément ce qui démontre le tirage au sort (un seul ordre passait
 * par hasard avec l'ancien code).
 */
describe('chargerConditionsPaiementEnVigueur — bascule de conditions le jour même (borne haute EXCLUSIVE, RM-07/RM-50)', () => {
  const ancienne = conditionFactice({
    id: 'cond-ancienne',
    valideDu: '2026-01-01',
    valideAu: '2026-08-10', // « jusqu'au 10 inclus » en base = EXCLUEE à partir du 10 (daterange '[)')
    delaiPaiementJours: 10,
    modePaiement: 'facture_mensuelle',
  });
  const nouvelle = conditionFactice({
    id: 'cond-nouvelle',
    valideDu: '2026-08-10', // « dès le 10 »
    valideAu: null,
    delaiPaiementJours: 30,
    modePaiement: 'comptant',
  });
  const dateBascule = new Date('2026-08-10T00:00:00.000Z');

  it('ordre [ancienne, nouvelle] : retient la NOUVELLE condition (delaiPaiementJours: 30)', async () => {
    const tx = txFactice([ancienne, nouvelle]);

    const resultat = await chargerConditionsPaiementEnVigueur(tx, CTX, 'client-1', dateBascule);

    expect(resultat.delaiPaiementJours).toBe(30);
    expect(resultat.modePaiement).toBe('comptant');
  });

  it('ordre [nouvelle, ancienne] (permutation inverse) : converge sur le MÊME résultat — sans le correctif, cet ordre passait par hasard alors que le premier échouait', async () => {
    const tx = txFactice([nouvelle, ancienne]);

    const resultat = await chargerConditionsPaiementEnVigueur(tx, CTX, 'client-1', dateBascule);

    expect(resultat.delaiPaiementJours).toBe(30);
    expect(resultat.modePaiement).toBe('comptant');
  });

  it('la veille de la bascule (09.08) : seule l’ANCIENNE condition est en vigueur, quel que soit l’ordre du tableau', async () => {
    const veille = new Date('2026-08-09T00:00:00.000Z');

    for (const lignes of [
      [ancienne, nouvelle],
      [nouvelle, ancienne],
    ]) {
      const tx = txFactice(lignes);
      const resultat = await chargerConditionsPaiementEnVigueur(tx, CTX, 'client-1', veille);
      expect(resultat.delaiPaiementJours).toBe(10);
      expect(resultat.modePaiement).toBe('facture_mensuelle');
    }
  });

  it('aucune condition en vigueur (client sans conditions paramétrées) : rend {} (jamais null, la colonne JSONB est not null default {})', async () => {
    const tx = txFactice([]);

    const resultat = await chargerConditionsPaiementEnVigueur(tx, CTX, 'client-1', dateBascule);

    expect(resultat).toEqual({});
  });
});
