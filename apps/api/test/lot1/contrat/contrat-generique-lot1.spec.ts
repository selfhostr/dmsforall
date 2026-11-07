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
 *     le mainteneur plutôt que tranché unilatéralement ici.
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
 *  ne teste rien »), sans jamais écrire de DELETE dans le vrai document généré.
 *
 *  `exceptions` : liste blanche EXPLICITE de chemins EXACTS tolérés (vide par défaut — c'est le
 *  comportement historique, toujours utilisé par le test de preuve ci-dessous). Un chemin absent
 *  de cette liste continue de faire échouer le test, quel qu'il soit : élargir la portée d'une
 *  exception ne peut donc jamais se faire par accident, seulement en ajoutant une entrée nommée et
 *  justifiée. */
export function releverOperationsDelete(
  document: { paths?: Record<string, Record<string, unknown>> },
  exceptions: ReadonlySet<string> = new Set(),
): string[] {
  const infractions: string[] = [];
  for (const [chemin, operationsDuChemin] of Object.entries(document.paths ?? {})) {
    if ('delete' in operationsDuChemin && !exceptions.has(chemin)) {
      infractions.push(`DELETE ${chemin}`);
    }
  }
  return infractions;
}

/**
 * SEULE exception admise à RM-110 aujourd'hui, EXACTEMENT UN chemin :
 * `DELETE /documents-vente/{id}/lignes/{ligneId}` (`document-vente.controller.ts::supprimerLigne`,
 * « Suppression d'une ligne sur un brouillon (MD-21, MD-19) »).
 *
 * CE N'EST PAS UNE VIOLATION DE RM-110 : la migration `0010_facturation.sql` (§7.4, commentaire de
 * tête de `ligne_document`) le documente noir sur blanc — « CONTRAIREMENT à ligne_or qui l'est de
 * façon PERMANENTE (RM-71), le DELETE reste possible tant que le document est en brouillon (une
 * ligne ajoutée par erreur avant émission se retire) ». RM-110 protège les ENREGISTREMENTS
 * MÉTIER (documents ÉMIS, paiements, mouvements de stock, OR...) contre la suppression physique —
 * une ligne d'un document encore en BROUILLON n'en est pas un : rien n'a été facturé, aucune trace
 * comptable ou légale n'existe encore à en garder. `docs/contrats-api-etape-1.md` §1.1/§13 énonce
 * la règle générale dans son absolu (contrat de l'étape 1, avant que cette route de facturation —
 * étape 2 — n'existe) ; cette exception, propre à `document-vente`, ne le contredit pas mais le
 * complète et mériterait un addendum dans ce document — signalé, pas fait ici (hors périmètre
 * `apps/api/test/**`).
 *
 * BORNÉ CÔTÉ SERVICE, PAS SEULEMENT DANS SA DESCRIPTION OPENAPI — vérifié en lisant
 * `service-documents.ts::supprimerLigne` : `estDocumentModifiable(doc.statut)` (`statut ===
 * 'brouillon'` strictement) est vérifié AVANT le DELETE SQL et lève `DOCUMENT_VERROUILLE` (409)
 * sinon — un document déjà émis refuse structurellement cette route, pas seulement par convention
 * documentaire.
 *
 * UNIQUE dans tout le dépôt : aucune autre route `@Delete` n'existe (`grep -r "@Delete" src/**\/*.controller.ts`
 * ne rend que celle-ci). Si une seconde apparaissait ailleurs — un document ÉMIS, un paiement, un
 * mouvement de stock, un OR — elle ne matcherait PAS cette liste blanche à un seul élément et ferait
 * à nouveau échouer ce test, comme voulu.
 */
const EXCEPTIONS_DELETE_JUSTIFIEES_RM_110: ReadonlySet<string> = new Set([
  '/documents-vente/{id}/lignes/{ligneId}',
  // `DELETE /photos/{id}` (`atelier/photos/photos-ligne.controller.ts`) : retirer une photo de
  // ligne d'OR prise par erreur ou floue ; table `ligne_or_photo` marquée
  // `[dfa:suppression-physique]` (migration 0085_ligne_or_photo.sql).
  '/photos/{id}',
  // `DELETE /parametres-entreprise/logo` (`facturation/impression/logo/logo-entreprise.controller.ts`) :
  // retire le logo imprimé sur les documents, un réglage d'entreprise remplaçable, pas un
  // enregistrement métier ni une trace comptable.
  '/parametres-entreprise/logo',
]);

describe('C-03 — aucune opération DELETE dans tout le document, hors liste blanche justifiée (RM-110 : pas de suppression physique)', () => {
  it('le document réellement généré ne contient aucun DELETE en dehors de la liste blanche justifiée', () => {
    const document = chargerOpenApi();
    expect(
      Object.keys(document.paths ?? {}).length,
      'document sans aucun chemin — génération incomplète ?',
    ).toBeGreaterThan(0);
    expect(releverOperationsDelete(document, EXCEPTIONS_DELETE_JUSTIFIEES_RM_110)).toEqual([]);
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
