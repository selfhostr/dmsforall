/**
 * Clés TanStack Query du domaine paramétrage — même convention que `clesFacturation`
 * (`hooks/facturation/cles.ts`) : tuple plat, tenue ICI plutôt que fusionnée dans `api/cles.ts`
 * (gelé, `plan-etape-1-frontend.md` §5.1, hors périmètre de ce lot).
 *
 * `tauxHoraires`/`prestations` : listes du catalogue de référentiels (`GET /referentiels/*`,
 * écran `EcranReferentiels`). Volontairement DISTINCTES de `clesQuery.referentiels.prestations(q)`
 * (`api/cles.ts`) — cette dernière sert un usage différent (autocomplete d'une ligne d'OR, gelé
 * dès la vague 0) ; réutiliser la même clé ferait cohabiter deux formes de cache pour deux
 * consommateurs qui n'invalident pas au même rythme (le catalogue admin après une création/
 * modification de tarif, l'autocomplete au fil de la frappe).
 */
export const clesParametrage = {
  /** Singleton par tenant, aucun paramètre — voir `hooks/parametrage/bloc-creancier.api.ts`. */
  creancier: () => ['parametrage', 'creancier'] as const,

  /** Identité fiscale du garage (`GET|PATCH /parametres-entreprise`) : raison sociale, n° TVA. */
  entreprise: () => ['parametrage', 'entreprise'] as const,

  /** Logo du garage (`GET|PUT|DELETE /parametres-entreprise/logo`). */
  logo: () => ['parametrage', 'entreprise', 'logo'] as const,

  tauxHoraires: {
    /** Liste paginée par curseur (`useInfiniteQuery`) — un seul cache par tenant, pas de filtre
     *  aujourd'hui (le catalogue de taux horaires d'un garage compte rarement plus de quelques
     *  dizaines d'entrées, jamais assez pour justifier une recherche serveur). */
    liste: () => ['parametrage', 'tauxHoraires', 'liste'] as const,
  },

  prestations: {
    liste: () => ['parametrage', 'prestations', 'liste'] as const,
  },
} as const;
