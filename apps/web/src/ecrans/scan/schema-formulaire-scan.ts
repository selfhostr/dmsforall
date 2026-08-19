import { z } from 'zod';

import { schemaCreationClient, schemaCreationVehicule } from '@dfa/shared';

/**
 * Schéma du formulaire de vérification — RÉUTILISE À L'IDENTIQUE les DTO backend
 * (`schemaCreationClient`/`schemaCreationVehicule`, `@dfa/shared`) plutôt que d'en redéfinir un
 * troisième : « validation zod partagée avec les DTO backend quand possible » (standard du dépôt).
 * `POST /clients` et `POST /vehicules` restent les DEUX appels réels à la soumission
 * (`FormulairePermisScanne.tsx`) — ce schéma composé ne sert qu'à VALIDER LE FORMULAIRE VISIBLE en
 * une seule passe, jamais envoyé tel quel à un endpoint.
 *
 * `client` reste TOUJOURS dans la forme, même quand un client existant a déjà été trouvé
 * (`correspondances.client` de l'OCR) et que ses champs ne sont pas rendus à l'écran — voir le
 * commentaire de tête de `FormulairePermisScanne.tsx` pour pourquoi (valeurs par défaut
 * volontairement triviales et jamais envoyées, plutôt qu'un second schéma/second `useForm`).
 */
export const schemaFormulaireScan = z.object({
  client: schemaCreationClient,
  vehicule: schemaCreationVehicule,
});

export type ValeursFormulaireScan = z.infer<typeof schemaFormulaireScan>;
