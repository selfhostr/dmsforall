import { TRI_DEFAUT_CREATION } from '@dfa/shared';
import {
  decoderCurseurTrie,
  encoderCurseurTrie,
  valeurCurseurTimestamptz,
} from '../../common/pagination';
import { ErreurMetier } from '../../common/erreurs';

/**
 * Pagination par défaut (`creeLe:desc`, keyset sur `(cree_le, id)`) pour les collections de
 * référentiels du lot 1 (taux horaires, prestations) — AUCUNE des deux n'est listée dans le
 * tableau normatif de tris/filtres de contrats-api-etape-1.md §6.2 (qui ne couvre que clients,
 * véhicules, RDV, OR, pointages, audit) ; §6.4 ne les liste pas non plus parmi les 3 exceptions
 * non paginées (recherche, `/parametres-atelier`, `contexte-atelier`). Elles restent donc des
 * COLLECTIONS au sens de la règle générale (§6.1) : curseur par défaut, sans tri alternatif tant
 * qu'aucun n'est documenté — inventer une liste de tris ici serait exactement le risque que §6.1
 * cherche à éviter (« un tri non listé produit 400, jamais un tri silencieusement ignoré »).
 */

/**
 * `creeLeTexte` est le texte NATIF PostgreSQL du `timestamptz` de création (colonne sélectionnée
 * avec `::text` dans la requête appelante), JAMAIS le `Date` rendu par le query builder Drizzle
 * typé (`mode: 'date'`, `colonneCreeLe()` de `db/colonnes-communes.ts`) — ce dernier a déjà
 * tronqué la microseconde au moment où il atteint ce module, `Date` n'ayant qu'une résolution
 * milliseconde (limite structurelle du type, pas un détail contournable). Voir
 * `common/pagination/valeur-temporelle.ts` pour la mesure complète du défaut corrigé ici.
 */
export interface LigneAvecCreation {
  readonly creeLeTexte: string;
  readonly id: string;
}

/** Curseur par défaut décodé : `creeLeTexte` reste du texte de bout en bout (aucun `Date`). */
export interface CurseurDefautDecode {
  readonly creeLeTexte: string;
  readonly id: string;
}

/**
 * Décode le curseur reçu, ou `null` en première page. Toujours contre `TRI_DEFAUT_CREATION`.
 *
 * DÉFAUT CORRIGÉ (même classe que `common/pagination/curseur.ts`, déjà corrigé dans
 * `clients/pagination-triee.ts`, `vehicules/service-vehicule.ts`, `socle/service-site.ts`,
 * `pneus/pagination-triee.ts`) : le seul tri de ce module porte sur `cree_le`, une colonne
 * `timestamptz` (voir `service-taux-horaires.ts`/`service-prestations.ts`, qui castent
 * `curseurDecode.creeLeTexte` en `::timestamptz` dans la clause `WHERE`) — un curseur
 * syntaxiquement valide dont la valeur n'était pas un horodatage PostgreSQL bien formé traversait
 * ce décodage intact et faisait lever à PostgreSQL une erreur `22007` non interceptée (`500` sur
 * une simple liste de taux horaires/prestations). `typeValeur: 'temporel'` ferme ce trou au
 * décodage, avant toute requête SQL.
 */
export function decoderCurseurDefaut(curseur: string | undefined): CurseurDefautDecode | null {
  if (!curseur) return null;
  const donnees = decoderCurseurTrie(curseur, TRI_DEFAUT_CREATION, 'temporel');
  if (typeof donnees.valeur !== 'string') {
    // Un curseur v2 valide pour `TRI_DEFAUT_CREATION` mais dont `v` n'est pas une chaîne ne peut
    // pas être un texte `timestamptz` — donnée cliente malformée, jamais une erreur serveur.
    throw new ErreurMetier('VALIDATION_ECHOUEE', 'Curseur de pagination invalide.', {
      erreurs: [
        { champ: 'curseur', code: 'curseur_invalide', message: 'Curseur de pagination illisible.' },
      ],
    });
  }
  return { creeLeTexte: donnees.valeur, id: donnees.id };
}

/**
 * Découpe `limite + 1` lignes rendues par la requête (triée `cree_le desc, id desc`) en une page
 * de taille `limite` et un `curseurSuivant` — `null` si la ligne surnuméraire n'existait pas.
 *
 * `valeurCurseurTimestamptz` canonicalise `creeLeTexte` SANS jamais transiter par `Date` : c'est
 * le remplacement direct de l'ancien `dernier.creeLe.toISOString()`, qui tronquait la
 * microseconde à l'encodage même quand `decoderCurseurDefaut` avait déjà cessé de le faire au
 * décodage — les deux bouts de la chaîne devaient être corrigés ensemble.
 */
export function pageDepuisLignes<T extends LigneAvecCreation>(
  lignes: readonly T[],
  limite: number,
): { readonly page: readonly T[]; readonly curseurSuivant: string | null } {
  const aSuite = lignes.length > limite;
  const page = aSuite ? lignes.slice(0, limite) : lignes;
  const dernier = page[page.length - 1];

  const curseurSuivant =
    aSuite && dernier
      ? encoderCurseurTrie({
          tri: TRI_DEFAUT_CREATION,
          valeur: valeurCurseurTimestamptz(dernier.creeLeTexte),
          id: dernier.id,
        })
      : null;

  return { page, curseurSuivant };
}
