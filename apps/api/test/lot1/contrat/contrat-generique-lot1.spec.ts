/**
 * Tests de contrat §13 de `docs/contrats-api-etape-1.md`, exécutés sur le document OpenAPI
 * GÉNÉRÉ (`packages/shared/openapi/dfa-openapi.json`), pas route par route (sans quoi la 41ᵉ route
 * échapperait à la règle) — et sur `CODES_ERREUR` / les fichiers de traduction, pour les
 * invariants qui n'ont pas besoin d'un document OpenAPI pour être vérifiés.
 *
 * CE QUI EST ICI ET POURQUOI MAINTENANT (même si AUCUN contrôleur du lot 1 n'existe encore,
 * `app.module.ts` n'important que les modules de l'étape 0) :
 *   - ces tests portent sur ce que le document contient RÉELLEMENT, quel qu'il soit ; ils sont
 *     donc déjà vrais aujourd'hui (0 route lot 1) et le resteront APRÈS L1-16 sans qu'il faille
 *     y toucher — c'est tout l'intérêt d'un test « sur le catalogue » (cf. R-9) ;
 *   - C-13 est un cas particulier : il est ACTUELLEMENT ROUGE (6 codes manquants dans les trois
 *     langues, voir le test dédié) — c'est ATTENDU, pas une régression que ce fichier introduit :
 *     c'est le garde-fou que L1-17 (traductions) doit faire passer au vert, exactement comme
 *     `probleme.ts` l'annonce pour l'invariant socle ci-dessous.
 *
 * CE QUI N'EST PAS ICI, ET POURQUOI :
 *   - C-02 (verbe ⇒ POST), C-05 (codes déclarés = codes émis), C-08 (Idempotency-Key sur §5.1),
 *     C-09 (409 de transition avec blocages/actionsProposees), C-10 (enveloppe {donnees,
 *     avertissements}), C-14 (example de refus) et C-16 HTTP (404 pas 403) exigent des ENDPOINTS
 *     réels — aucun n'existe. Signalé dans la réponse de tâche, à reprendre une fois L1-16 posé.
 *   - C-04 (toute réponse ≥400 référence ProblemeDetailCommunDto) porterait aujourd'hui
 *     exclusivement sur les endpoints socle — hors périmètre du lot 1, laissé à qui possède ce
 *     module s'il souhaite l'écrire.
 *   - C-06/C-07 (pagination) : déjà couverts, au niveau HTTP, par
 *     `test/integration/pagination-curseur.spec.ts` (générique, pas spécifique à `/sites`).
 *   - C-11/C-12 (`x-dfa-enum-extensible`) : AUCUN enum du document actuel (étape 0) ne porte cette
 *     extension — c'est une convention introduite par le contrat de l'étape 1, jamais appliquée
 *     rétroactivement aux DTO de l'étape 0 (TenantCourantDto, UtilisateurCourantDto...). Un test
 *     « chaque enum du document porte l'extension » serait donc rouge dès aujourd'hui pour une
 *     raison ÉTRANGÈRE au lot 1, sans propriétaire dans cette vague pour le corriger — remonté à
 *     l'orchestrateur plutôt que tranché unilatéralement ici.
 *   - C-15 (instantané versionné) : l'instantané de référence est un livrable de L1-16
 *     (« assemblage, OpenAPI, démarrage réel »), qui n'existe pas encore.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CODES_ERREUR,
  CODES_ERREUR_SOCLE,
  CODES_AVERTISSEMENT,
  CODES_CONFIRMATION,
} from '@dfa/shared';

// __dirname = apps/api/test/lot1/contrat → 5 niveaux jusqu'à la racine du dépôt (un de plus que
// test/contrat/openapi.spec.ts, qui est un niveau moins profond).
const CHEMIN_OPENAPI = path.resolve(
  __dirname,
  '../../../../../packages/shared/openapi/dfa-openapi.json',
);
const CHEMIN_I18N_ERREURS = (langue: 'fr' | 'de' | 'it') =>
  path.resolve(__dirname, `../../../../../apps/web/src/i18n/locales/${langue}/erreurs.json`);

function chargerOpenApi(): { paths?: Record<string, Record<string, unknown>> } {
  let brut: string;
  try {
    brut = readFileSync(CHEMIN_OPENAPI, 'utf8');
  } catch {
    throw new Error(
      `Document OpenAPI introuvable (${CHEMIN_OPENAPI}). Générer avec "pnpm api:openapi" avant ce test.`,
    );
  }
  return JSON.parse(brut) as { paths?: Record<string, Record<string, unknown>> };
}

/** C-03, extrait en fonction pure pour pouvoir la pointer, dans le même fichier, sur un document
 *  SAIN (le vrai) et sur un document SYNTHÉTIQUE portant volontairement un DELETE — la preuve que
 *  ce vérificateur détecte réellement ce qu'il prétend détecter (« un test qui ne peut pas échouer
 *  ne teste rien »), sans jamais écrire de DELETE dans le vrai document généré. */
export function releverOperationsDelete(document: {
  paths?: Record<string, Record<string, unknown>>;
}): string[] {
  const infractions: string[] = [];
  for (const [chemin, operationsDuChemin] of Object.entries(document.paths ?? {})) {
    if ('delete' in operationsDuChemin) {
      infractions.push(`DELETE ${chemin}`);
    }
  }
  return infractions;
}

describe('C-03 — aucune opération DELETE dans tout le document (RM-110 : pas de suppression physique)', () => {
  it('le document réellement généré ne contient aucun DELETE', () => {
    const document = chargerOpenApi();
    expect(
      Object.keys(document.paths ?? {}).length,
      'document sans aucun chemin — génération incomplète ?',
    ).toBeGreaterThan(0);
    expect(releverOperationsDelete(document)).toEqual([]);
  });

  it('preuve que le vérificateur détecte réellement un DELETE (document synthétique, jamais le vrai fichier)', () => {
    const documentFautif = {
      paths: {
        '/clients/{id}': {
          get: { responses: { 200: {} } },
          delete: { responses: { 204: {} } },
        },
      },
    };
    expect(releverOperationsDelete(documentFautif)).toEqual(['DELETE /clients/{id}']);
  });
});

describe('CODES_ERREUR — invariant de préfixe socle, re-vérifié à l\'exécution (probleme.ts §"Garde de compilation")', () => {
  it("les 13 premiers éléments de CODES_ERREUR sont EXACTEMENT CODES_ERREUR_SOCLE, dans l'ordre", () => {
    expect(CODES_ERREUR.slice(0, CODES_ERREUR_SOCLE.length)).toEqual([...CODES_ERREUR_SOCLE]);
  });

  it("CODES_ERREUR_SOCLE compte bien 13 codes (le socle de l'étape 0 est gelé, aucune évolution attendue)", () => {
    expect(CODES_ERREUR_SOCLE).toHaveLength(13);
  });
});

describe('C-13 — chaque CodeErreur/CodeAvertissement/CodeConfirmation a une entrée dans les trois langues', () => {
  const union = Array.from(
    new Set<string>([...CODES_ERREUR, ...CODES_AVERTISSEMENT, ...CODES_CONFIRMATION]),
  ).sort();

  it("l'union des trois familles de codes n'est pas vide (précondition du test lui-même)", () => {
    expect(union.length).toBeGreaterThan(0);
  });

  it.each(['fr', 'de', 'it'] as const)(
    "erreurs:codes.* (%s) couvre l'union complète des codes",
    (langue) => {
      const json = JSON.parse(readFileSync(CHEMIN_I18N_ERREURS(langue), 'utf8')) as {
        codes?: Record<string, unknown>;
      };
      const manquants = union.filter((code) => !json.codes || !(code in json.codes));
      expect(manquants, `codes absents de ${langue}/erreurs.json:codes.*`).toEqual([]);
    },
  );
});
