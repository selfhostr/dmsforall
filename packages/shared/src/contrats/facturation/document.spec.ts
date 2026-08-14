import { describe, expect, it } from 'vitest';

import { schemaCreationDocumentVente, schemaModificationDocumentVente } from './document';

/**
 * RV-37/MD-70 : `dossierVenteId` sur `document_vente` — accroche à un dossier de vente VN/VO.
 *
 * Deux garanties prouvées ici, au niveau du contrat (zod), avant toute logique serveur :
 *  1. `schemaCreationDocumentVente` n'accepte `dossierVenteId` QUE pour `bon_commande`/`facture`
 *     (`devis`/`avoir` n'ont jamais de raison de le porter — un avoir a son propre schéma dédié,
 *     `schemaCreationAvoir`, hors sujet ici).
 *  2. `schemaModificationDocumentVente` (`PATCH`, brouillon uniquement) n'expose PAS du tout ce
 *     champ — un client qui l'envoie quand même se voit désormais REFUSÉ (`400 VALIDATION_ECHOUEE`,
 *     `.strict()` posé sur ce schéma, issue #12 : un champ silencieusement jeté sur une écriture de
 *     facturation est le même défaut qui a laissé passer une ligne à 0.00 sans erreur — la
 *     correction vaut pour toute la famille, y compris ce cas où le silence servait jusqu'ici,
 *     accidentellement, de garde-fou). Avant ce durcissement, la requête réussissait quand même
 *     (`200`) et le champ disparaissait sans un mot — un silence qui fermait la porte dérobée par
 *     accident, pas par contrat explicite. Le refus nommé est la même garantie, en mieux : un
 *     client qui tente le rattachement via `PATCH` l'apprend immédiatement, plutôt que de croire
 *     l'opération acceptée alors qu'elle n'a rien fait. Le rattachement à un dossier ne doit JAMAIS
 *     devenir un moyen de modifier un document déjà émis (MD-20/MD-21) — et ici, même un document
 *     encore en BROUILLON ne peut pas voir son rattachement changé après coup par ce endpoint,
 *     seule la création le fixe.
 */
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const DOSSIER_ID = '33333333-3333-4333-8333-333333333333';

function payloadCreation(overrides: Record<string, unknown> = {}) {
  return {
    typeDocument: 'bon_commande',
    siteId: SITE_ID,
    clientId: CLIENT_ID,
    devise: 'CHF',
    lignes: [],
    ...overrides,
  };
}

describe('schemaCreationDocumentVente — dossierVenteId (RV-37)', () => {
  it.each(['bon_commande', 'facture'] as const)(
    "accepte dossierVenteId pour typeDocument = '%s'",
    (typeDocument) => {
      const resultat = schemaCreationDocumentVente.safeParse(
        payloadCreation({ typeDocument, dossierVenteId: DOSSIER_ID }),
      );
      expect(resultat.success).toBe(true);
      if (resultat.success) expect(resultat.data.dossierVenteId).toBe(DOSSIER_ID);
    },
  );

  it.each(['devis', 'avoir'] as const)(
    "REFUSE dossierVenteId pour typeDocument = '%s'",
    (typeDocument) => {
      const resultat = schemaCreationDocumentVente.safeParse(
        payloadCreation({ typeDocument, dossierVenteId: DOSSIER_ID }),
      );
      expect(resultat.success).toBe(false);
    },
  );

  it('dossierVenteId absent : toujours valide (champ optionnel), reste null/undefined', () => {
    const resultat = schemaCreationDocumentVente.safeParse(payloadCreation());
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.dossierVenteId).toBeUndefined();
  });

  it('dossierVenteId mal formé (pas un uuid) : rejeté', () => {
    const resultat = schemaCreationDocumentVente.safeParse(
      payloadCreation({ dossierVenteId: 'pas-un-uuid' }),
    );
    expect(resultat.success).toBe(false);
  });
});

/**
 * Issue #12, appliquée à `schemaCreationDocumentVente` (`.strict()`) : un champ inconnu à la
 * racine du document (pas seulement sur une ligne) est refusé et nommé.
 */
describe('schemaCreationDocumentVente — champ inconnu REFUSÉ, nommé (issue #12, .strict())', () => {
  it('un champ inconnu à la racine (remiseCentimes, faux nom) est REFUSÉ', () => {
    const resultat = schemaCreationDocumentVente.safeParse(
      payloadCreation({ remiseCentimes: 500 }),
    );
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "remiseCentimes"');
  });

  it('une ligne embarquée avec un champ inconnu (prixUnitaireCentimes) est REFUSÉE — même défaut que #12, chemin imbriqué', () => {
    const resultat = schemaCreationDocumentVente.safeParse(
      payloadCreation({
        lignes: [
          {
            type: 'forfait',
            designation: 'Révision',
            tauxTvaPourmille: 81,
            datePrestation: '2026-08-04',
            prixUnitaireCentimes: 8900,
          },
        ],
      }),
    );
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "prixUnitaireCentimes"');
  });
});

describe('schemaModificationDocumentVente — dossierVenteId JAMAIS modifiable (RM/MD-20, pas de porte dérobée)', () => {
  it("n'expose pas dossierVenteId : un client qui l'envoie est REFUSÉ (issue #12, .strict())", () => {
    const resultat = schemaModificationDocumentVente.safeParse({ dossierVenteId: DOSSIER_ID });
    expect(resultat.success).toBe(false);
    if (!resultat.success) {
      const issue = resultat.error.issues[0];
      expect(issue?.code).toBe('unrecognized_keys');
      expect(issue?.message).toContain('dossierVenteId');
    }
  });
});
