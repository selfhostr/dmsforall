/**
 * Défaut 1 (reprise) : une archive réelle ne pouvait JAMAIS dépasser
 * l'étape d'analyse — `POST /reprise/dossiers/{id}/analyses` rendait 500,
 * `permission denied for table reprise_analyse`, dès le TOUT PREMIER appel.
 *
 * Cause : `ServiceAnalyseReprise.lancer()` (apps/api/src/reprise/analyse/service-analyse-reprise.ts)
 * exécute `DELETE FROM public.reprise_analyse` de façon INCONDITIONNELLE à chaque appel — y
 * compris le premier, où la table est vide pour ce dossier — pour garantir l'idempotence d'une
 * relance (0067, § tête de fichier : « une relance supprime puis réinsère la ligne »). Or 0067
 * n'accordait à `dfa_app` que `select, insert, update` sur cette table.
 *
 * Ce test exécute LE MÊME ordre SQL que `lancer()`, avec le pool `dfa_app` — exactement le rôle
 * de connexion de l'API en production (voir `postgres-ephemere.ts`, en-tête de fichier : le
 * harnais rejoue `01-roles.sql` tel quel et ne rend à l'appelant que des accès `dfa_app` pour tout
 * ce qui n'est pas une vérification de posture). AVANT 0068, ce test échoue avec `permission
 * denied for table reprise_analyse` ; APRÈS 0068, il passe. Ce n'est PAS un test unitaire sur un
 * `tx.execute` mocké : aucun mock ne peut prouver un droit de base, seule une vraie base le peut.
 */

import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import { semerGarageDemo, type GarageDemoFixture } from '../../fixtures/garage-demo';

let bdd: BaseEphemere;
let demo: GarageDemoFixture;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

describe('droits dfa_app — reprise_analyse (défaut 1)', () => {
  it('DELETE FROM reprise_analyse (le même ordre que ServiceAnalyseReprise.lancer()) passe avec le rôle applicatif dfa_app', async () => {
    const tenantId = demo.tenantA.id;
    const utilisateurId = demo.tenantA.utilisateurs[0]!.id;
    const dossierId = randomUUID();
    const analyseId = randomUUID();
    const empreinte = createHash('sha256').update(`archive-test-${dossierId}`).digest();

    // Amorce : un dossier_reprise et une ligne reprise_analyse existante, avec le pool dfa_app —
    // exactement ce que `ServiceCycleVieDossierReprise.creer` et une PREMIÈRE analyse feraient.
    await ecrireSousTenant(bdd.poolApp, tenantId, async (client) => {
      await client.query(
        `insert into public.dossier_reprise
           (id, tenant_id, statut, taille_octets_annoncee, empreinte_sha256_annoncee,
            stockage_chemin, cree_par_id)
         values ($1, $2, 'depot_receptionne', 1000, $3, $4, $5)`,
        [dossierId, tenantId, empreinte, `${tenantId}/${dossierId}`, utilisateurId],
      );
      await client.query(
        `insert into public.reprise_analyse (id, tenant_id, dossier_reprise_id, statut)
         values ($1, $2, $3, 'terminee')`,
        [analyseId, tenantId, dossierId],
      );
    });

    // LE test : le DELETE inconditionnel de `lancer()`, tel quel, sous le rôle dfa_app — doit
    // réussir (et supprimer exactement la ligne existante) plutôt que lever
    // « permission denied for table reprise_analyse ».
    const supprimee = await ecrireSousTenant(bdd.poolApp, tenantId, async (client) => {
      const resultat = await client.query(
        `delete from public.reprise_analyse where tenant_id = $1 and dossier_reprise_id = $2`,
        [tenantId, dossierId],
      );
      return resultat.rowCount;
    });
    expect(supprimee).toBe(1);

    // Deuxième preuve, la plus proche de la réalité de production : le PREMIER appel de
    // `lancer()` sur un dossier qui n'a ENCORE AUCUNE ligne d'analyse (table vide pour ce
    // dossier) doit lui aussi réussir — c'est exactement ce qui bloquait toute archive réelle.
    const supprimeeSurTableVide = await ecrireSousTenant(bdd.poolApp, tenantId, async (client) => {
      const resultat = await client.query(
        `delete from public.reprise_analyse where tenant_id = $1 and dossier_reprise_id = $2`,
        [tenantId, dossierId],
      );
      return resultat.rowCount;
    });
    expect(supprimeeSurTableVide).toBe(0);
  }, 60_000);
});
