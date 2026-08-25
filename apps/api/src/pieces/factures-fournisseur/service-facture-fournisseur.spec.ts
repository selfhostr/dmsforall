import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';

import { ServiceFactureFournisseur } from './service-facture-fournisseur';
import type { ServiceOrchestrateurLectureFacture } from './lecture/orchestrateur-lecture';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const dialect = new PgDialect();

/**
 * `lister()` n'a besoin QUE de `tx.execute` (SQL brut de la page principale) : dès que la page
 * revient vide (`{ rows: [] }`), `documentIds`/`factureIds` sont vides et `chargerLignesParCommande`-
 * like les selects Drizzle des documents/lignes sont court-circuités (même garde que
 * `service-commande-fournisseur.ts::chargerLignesParCommande`) — aucun `tx.select` à mocker pour
 * les tests ci-dessous.
 */
function txFactice(plan: { executes?: ReadonlyArray<{ rows: readonly unknown[] }> } = {}) {
  const executes = [...(plan.executes ?? [])];
  const executeAppels: unknown[] = [];

  const tx = {
    execute: vi.fn((requete: unknown) => {
      executeAppels.push(requete);
      return Promise.resolve(executes.shift() ?? { rows: [] });
    }),
  };

  return { tx: tx as unknown as TransactionDfa, executeAppels };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

const ORCHESTRATEUR_FACTICE = {} as ServiceOrchestrateurLectureFacture;

describe('ServiceFactureFournisseur.lister — filtre `q` tolérant à la casse ET aux accents', () => {
  it(
    'enveloppe `nom_creancier` ET `numero_facture` dans public.normaliser_recherche(...) des deux ' +
      'côtés du `like`, jamais un `ilike` nu',
    async () => {
      const { tx, executeAppels } = txFactice({ executes: [{ rows: [] }] });
      const service = new ServiceFactureFournisseur(accesFactice(tx), ORCHESTRATEUR_FACTICE);

      await service.lister(CTX, { limite: 50, tri: 'creeLe:desc', q: 'crédit sa' });

      const appel = executeAppels[0] as SQL;
      const { sql: texte } = dialect.sqlToQuery(appel);
      expect(texte).toContain(
        'public.normaliser_recherche(ff.nom_creancier) like public.normaliser_recherche(',
      );
      expect(texte).toContain(
        'public.normaliser_recherche(ff.numero_facture) like public.normaliser_recherche(',
      );
      expect(texte).not.toContain('ilike');
    },
  );

  // Test décisif : un `q` accepté par le contrat mais ignoré par le service est le piège maison —
  // un terme inexistant DOIT rendre une liste vide, jamais toutes les factures.
  it('un terme qui ne correspond à aucune facture rend une liste VIDE, jamais toutes les factures', async () => {
    const { tx } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceFactureFournisseur(accesFactice(tx), ORCHESTRATEUR_FACTICE);

    const page = await service.lister(CTX, {
      limite: 50,
      tri: 'creeLe:desc',
      q: 'introuvable-xyz',
    });

    expect(page.donnees).toEqual([]);
    expect(page.curseurSuivant).toBeNull();
  });

  // Piège du zéro/vide : `q` absent (`undefined`) ne doit JAMAIS ajouter la condition —
  // rétrocompatibilité pour un client qui n'envoie pas `q`.
  it('sans `q`, aucune condition de recherche n’est ajoutée au SQL', async () => {
    const { tx, executeAppels } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceFactureFournisseur(accesFactice(tx), ORCHESTRATEUR_FACTICE);

    await service.lister(CTX, { limite: 50, tri: 'creeLe:desc' });

    const appel = executeAppels[0] as SQL;
    const { sql: texte } = dialect.sqlToQuery(appel);
    expect(texte).not.toContain('normaliser_recherche');
  });

  // Le contrôle par rôle (RF-115, vendeur exclu) n'est plus vérifié ICI : GardeDroit sur
  // @ExigerDroit('pieces.facture_fournisseur.lire') (facture-fournisseur.controller.ts), prouvé
  // par la table de vérité auth/matrice-droits.spec.ts (bloc ROLES_SANS_LECTURE, lignes ~651-686).
});
