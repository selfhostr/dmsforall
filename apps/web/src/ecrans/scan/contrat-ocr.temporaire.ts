import i18n from '@/i18n';
import { obtenirEnv } from '@/config/env';
import { construireErreurApi, ErreurReseau } from '@/api/erreurs';

/**
 * CONTRAT TEMPORAIRE — `POST /scan/permis-circulation` n'existe pas encore côté OpenAPI (lot
 * OCR serveur, en parallèle de ce lot). Ce fichier tient lieu de contrat en attendant que
 * `pnpm api:openapi && pnpm web:types` le fasse apparaître dans `apps/web/src/api/types.gen.ts` —
 * RÈGLE DU DÉPÔT : « les types API sont générés depuis l'OpenAPI, jamais redéfinis à la main ».
 * DÈS QUE le contrat réel existe : remplacer les imports de ce fichier par le type généré dans
 * `EcranScan.tsx`/`FormulairePermisScanne.tsx`, puis supprimer ce fichier. Rien d'autre dans
 * `ecrans/scan/` ne devrait bouger si le contrat ci-dessous est respecté à la lettre — voir le
 * rapport de livraison de ce lot pour la version « à faire converger » adressée à le lot OCR.
 *
 * ENDPOINT ATTENDU : `POST /scan/permis-circulation`, `multipart/form-data`, UN SEUL champ
 * `photo` (JPEG, déjà réduit côté client, voir `reduireImage.ts`). Pas d'`Idempotency-Key` : ce
 * n'est ni une création ni une opération à effet — relire deux fois la même photo est sans
 * conséquence, et l'annulation (bouton « Annuler » de l'écran d'attente) doit pouvoir rejouer
 * l'appel sans qu'aucun mécanisme de déduplication ne le bloque.
 *
 * RÉPONSE `200` = `ReponseScanPermisCirculation` ci-dessous. Erreurs attendues, mêmes conventions
 * `problem+json` que le reste de l'API (`@/api/erreurs.ts`) :
 *  - `422` (code proposé : `SCAN_PHOTO_ILLISIBLE`) — l'OCR n'a rien pu extraire d'exploitable
 *    (document absent du cadre, flou, trop sombre...). Distinct d'un simple manque de confiance
 *    par champ : ici, aucun champ, même douteux, n'est retourné.
 *  - `413` — photo trop lourde malgré la réduction côté client (garde-fou serveur).
 *  - `502`/`503` — fournisseur OCR indisponible. Traité comme une erreur serveur générique par
 *    `construireErreurApi`/`messageErreur`, pas de code dédié nécessaire côté front.
 */

export type NiveauConfianceOcr = 'sure' | 'douteuse' | 'absente';

/** Une valeur lue par l'OCR, avec son niveau de confiance — `valeur: null` SEULEMENT si
 *  `confiance: 'absente'` (champ non lu). Les trois combinaisons `(valeur, confiance)` distinctes
 *  demandées par le brief (« non lu », « lu avec doute », « lu et validé ») partent de ces DEUX
 *  informations ; le troisième état (« validé ») est une notion CÔTÉ ÉCRAN — voir `etatChamp` dans
 *  `FormulairePermisScanne.tsx` — jamais renvoyée par le serveur : « validé » inclut aussi bien un
 *  champ `sure` qu'un champ `douteuse` que l'utilisateur a relu et confirmé. */
export interface ChampScanne<T> {
  readonly valeur: T | null;
  readonly confiance: NiveauConfianceOcr;
}

export interface VehiculeScanne {
  readonly marque: ChampScanne<string>;
  readonly modele: ChampScanne<string>;
  readonly vin: ChampScanne<string>;
  readonly plaque: ChampScanne<string>;
  readonly canton: ChampScanne<string>;
  /** ISO `AAAA-MM-JJ` (même forme que `schemaDateJour`, `@dfa/shared`). */
  readonly premiereMiseEnCirculationLe: ChampScanne<string>;
}

export interface DetenteurScanne {
  /** `true` = raison sociale (case B du permis), `false`/`absente` = personne physique. Détermine
   *  `EntreeCreationClient.type` (`particulier` | `entreprise`) — voir la conversion dans
   *  `FormulairePermisScanne.tsx`. */
  readonly estEntreprise: ChampScanne<boolean>;
  readonly nom: ChampScanne<string>;
  readonly prenom: ChampScanne<string>;
  readonly raisonSociale: ChampScanne<string>;
  readonly rue: ChampScanne<string>;
  readonly npa: ChampScanne<string>;
  readonly localite: ChampScanne<string>;
}

export interface DonneesPermisScanne {
  readonly vehicule: VehiculeScanne;
  readonly detenteur: DetenteurScanne;
}

export interface CorrespondanceClientExistant {
  readonly id: string;
  readonly nomAffiche: string;
}

export interface CorrespondanceVehiculeExistant {
  readonly id: string;
  readonly libelle: string;
}

/**
 * MATCH EXACT, jamais un rapprochement flou : `vehicule` par VIN puis par plaque+canton (clés
 * quasi uniques), `client` par IDE exact puis par nom/raison sociale + NPA strictement identiques.
 * Absent (`undefined`) = « rien trouvé dans CE tenant avec ces critères », jamais « pas cherché » —
 * si le serveur ne peut pas garantir un match exact, il doit omettre la clé plutôt que deviner :
 * `EcranScan` PROPOSE alors une création, et la collision réelle (`VEHICULE_PLAQUE_COLLISION` sur
 * `POST /vehicules`, avertissement `CLIENT_DOUBLON_PROBABLE` sur `POST /clients`) reste de toute
 * façon rattrapée à la soumission — voir `EcranScan.tsx`, qui ne fait donc JAMAIS reposer
 * l'exactitude du produit sur la seule présence de ce champ.
 */
export interface CorrespondancesScan {
  readonly client?: CorrespondanceClientExistant;
  readonly vehicule?: CorrespondanceVehiculeExistant;
}

export interface ReponseScanPermisCirculation {
  readonly donnees: DonneesPermisScanne;
  readonly correspondances: CorrespondancesScan;
}

/**
 * Appel dédié plutôt que `@/api/client.ts` (`requeteApi`) : celui-ci pose systématiquement
 * `Content-Type: application/json` dès qu'un corps est fourni, ce qui casserait une requête
 * `multipart/form-data` (le navigateur doit fixer lui-même la frontière `boundary`). Réplique donc
 * à la main les mêmes conventions que `requeteApi` (`credentials: 'include'`, `Accept-Language`,
 * mêmes classes d'erreur) plutôt que de les modifier — hors périmètre d'écriture de ce lot
 * (`apps/web/src/api/**`).
 */
export async function appellerScanPermisCirculation(
  photo: Blob,
  signal: AbortSignal,
): Promise<ReponseScanPermisCirculation> {
  const url = `${obtenirEnv().VITE_API_URL}/scan/permis-circulation`;
  const corps = new FormData();
  corps.append('photo', photo, 'permis.jpg');

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Accept-Language': i18n.language },
      body: corps,
      signal,
    });
  } catch (cause) {
    throw new ErreurReseau(cause);
  }

  const corpsTexte = await reponse.text();
  if (!reponse.ok) throw construireErreurApi(reponse, corpsTexte);
  if (corpsTexte.length === 0) {
    throw new Error('Réponse vide inattendue : POST /scan/permis-circulation.');
  }
  return JSON.parse(corpsTexte) as ReponseScanPermisCirculation;
}
