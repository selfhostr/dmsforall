/**
 * Test de BOUT EN BOUT — détection de rôle (`lecteurs/detecteur-role.ts`) -> projection contrat
 * (`projection-analyse-reprise.ts`) -> génération de plan (`plan/generation-plan-reprise.ts`).
 *
 * Régression du 25.08.2026 (import réel sur l'archive Auto-i de @laupernoe, 359 tables sur 359 exclues) :
 * un test unitaire sur `evaluerRoleTable` passait (bonne classification, confiance fractionnaire
 * 0-1 correcte), un test unitaire sur `genererPlanDepuisTables` passait (seuil 0-100 correctement
 * appliqué à des `TableDetecteeReprise` CONSTRUITS À LA MAIN sur l'échelle 0-100) — mais le
 * RACCORD entre les deux (la conversion d'échelle dans `projeterTableDetectee`) n'était vérifié
 * nulle part. Un `Math.round(confiance)` sans `* 100` rendait 0 ou 1 pour TOUTE table, sous le
 * seuil `SEUIL_CONFIANCE_MINIMUM = 40` (0-100) : plan systématiquement vide.
 *
 * Ce fichier ferme ce trou : il n'invoque QUE les fonctions PURES réelles (aucune donnée
 * construite à la main au niveau `TableDetecteeReprise`), du contenu de table brut jusqu'au
 * verdict d'inclusion dans le plan — exactement le chemin parcouru en production.
 */
import { describe, expect, it } from 'vitest';

import { evaluerRoleTable } from '../lecteurs/detecteur-role';
import type { LigneTable } from '../lecteurs/types';
import { genererPlanDepuisTables } from '../plan/generation-plan-reprise';
import { projeterTableDetectee } from './projection-analyse-reprise';

function construireLignes(valeurs: Record<string, unknown>[]): LigneTable[] {
  return valeurs.map((v, i) => ({ index: i, valeurs: v as Record<string, never> }));
}

const NOMS_PRENOMS = ['Dupont Jean', 'Meier Anna', 'Rossi Marco', 'Keller Nicole', 'Favre Luc'];

/** Même forme que la table « Kunden » d'un DMS tiers qui a déclenché le
 *  défaut : nom de table qui ne dit rien du métier, contenu clairement client. */
function tableKundenPlausible(): LigneTable[] {
  return construireLignes(
    Array.from({ length: 20 }, (_, i) => ({
      NOM: NOMS_PRENOMS[i % NOMS_PRENOMS.length],
      EMAIL: `client${i}@example.ch`,
      NPA: String(1000 + (i % 9) * 100),
      VILLE: 'Lausanne',
    })),
  );
}

describe('pipeline détection -> plan (bout en bout, régression échelle indiceConfiance)', () => {
  it('une table "Kunden" correctement détectée à forte confiance se retrouve INCLUSE dans le plan', () => {
    const rapport = evaluerRoleTable({
      table: 'Kunden',
      nomsColonnes: ['NOM', 'EMAIL', 'NPA', 'VILLE'],
      lignesActives: tableKundenPlausible(),
    });

    // Pré-condition : le détecteur classe bien la table (déjà couvert par
    // lecteurs/detecteur-role.spec.ts, revérifié ici pour que le test reste lisible seul).
    expect(rapport.evaluations[0]!.role).toBe('client');
    const confianceFractionnaire = rapport.evaluations[0]!.confiance;
    expect(confianceFractionnaire).toBeGreaterThan(0.4); // fractionnaire, échelle interne lecteurs/

    const detectee = projeterTableDetectee('DATA/KUNDEN.DBF', rapport, []);
    // Échelle CONTRAT : 0-100, exactement la conversion attendue — c'est le point précis qui a
    // manqué (un `indiceConfiance` resté à 0 ou 1 est la signature exacte du défaut du 25.08.2026).
    expect(detectee.roleDeduit).toBe('clients');
    expect(detectee.indiceConfiance).toBe(Math.round(confianceFractionnaire * 100));
    expect(detectee.indiceConfiance).toBeGreaterThan(40); // au-dessus de SEUIL_CONFIANCE_MINIMUM

    // Volume réaliste (plusieurs milliers de lignes) — seul le nombre de lignes
    // change par rapport à ce que `evaluerRoleTable` a rendu (l'échantillon reste borné), le reste
    // du verdict (rôle, confiance) est celui produit par le pipeline réel.
    const detecteeVolumeReel = { ...detectee, nombreLignes: 7000 };

    const { elements, exclusions } = genererPlanDepuisTables([detecteeVolumeReel]);

    // LE test décisif : le raccord détection -> plan ne perd plus la table en route.
    expect(exclusions).toEqual([]);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      domaine: 'clients',
      tableDetecteeId: detectee.id,
      inclus: true,
      volumeAttenduLignes: 7000,
    });
  });

  it("une table sans aucun signal métier reste EXCLUE (role_indetermine) après le correctif d'échelle", () => {
    // Contrôle négatif : le correctif ne doit pas transformer le pipeline en "tout inclure".
    const lignes = construireLignes(
      Array.from({ length: 10 }, (_, i) => ({ COL_X: `valeur-opaque-${i}` })),
    );
    const rapport = evaluerRoleTable({
      table: 'TBL_INDETERMINEE',
      nomsColonnes: ['COL_X'],
      lignesActives: lignes,
    });
    expect(rapport.evaluations[0]!.role).toBe('inconnu');

    const detectee = projeterTableDetectee('DATA/TBL_INDETERMINEE.DBF', rapport, []);
    expect(detectee.roleDeduit).toBe('inconnu');

    const { elements, exclusions } = genererPlanDepuisTables([detectee]);
    expect(elements).toEqual([]);
    expect(exclusions).toEqual([{ tableDetecteeId: detectee.id, motif: 'role_indetermine' }]);
  });
});
