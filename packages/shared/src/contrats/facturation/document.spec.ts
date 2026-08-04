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
 *     champ — un client qui l'envoie quand même le voit silencieusement disparaître (comportement
 *     zod par défaut, aucun `.strict()`/`.passthrough()` posé sur ce schéma). C'est ce qui ferme la
 *     porte dérobée que la tâche demandait explicitement d'exclure : le rattachement à un dossier
 *     ne doit JAMAIS devenir un moyen de modifier un document déjà émis (MD-20/MD-21) — et ici,
 *     même un document encore en BROUILLON ne peut pas voir son rattachement changé après coup par
 *     ce endpoint, seule la création le fixe.
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

describe('schemaModificationDocumentVente — dossierVenteId JAMAIS modifiable (RM/MD-20, pas de porte dérobée)', () => {
  it("n'expose pas dossierVenteId : un client qui l'envoie le voit disparaître silencieusement (strip zod par défaut)", () => {
    const resultat = schemaModificationDocumentVente.safeParse({ dossierVenteId: DOSSIER_ID });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect('dossierVenteId' in resultat.data).toBe(false);
    }
  });
});
