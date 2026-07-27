/** Fabrique de clés TanStack Query. Un seul endroit pour éviter les clés incohérentes entre
 *  les hooks qui lisent et ceux qui invalident/purgent le cache. */
export const clesQuery = {
  session: () => ['auth', 'me'] as const,
};
