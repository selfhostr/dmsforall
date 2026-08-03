import { z } from 'zod';
import { schemaFiltresPaiements, schemaParametresPage } from '@dfa/shared';

/**
 * Schéma de requête composé LOCALEMENT — même patron que `apps/api/src/clients/schemas.ts` :
 * `schemaFiltresPaiements` (contrat gelé) porte les filtres ET un `tri` fermé, mais pas
 * `limite`/`curseur` (communs à toute collection, `schemaParametresPage`). Composer les deux ici
 * est la seule façon d'obtenir un schéma de requête complet sans dupliquer `tri` avec deux formes
 * différentes.
 */
export const schemaListePaiements = schemaParametresPage
  .omit({ tri: true })
  .extend(schemaFiltresPaiements.shape);
export type ParametresListePaiements = z.infer<typeof schemaListePaiements>;

export const schemaUuidPaiement = z.string().uuid();
