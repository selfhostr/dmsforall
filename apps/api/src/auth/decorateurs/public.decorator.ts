/**
 * `@Public()` (contrat gelé étape 0, §2.10).
 *
 * Marque une route comme ne nécessitant PAS de session valide. `GardeSession` lit cette
 * métadonnée pour court-circuiter la résolution de session — mais PAS la vérification `Origin`
 * sur les méthodes mutantes, qui s'applique uniformément (voir le commentaire d'en-tête de
 * `../garde-session.ts`).
 */
import { SetMetadata } from '@nestjs/common';

export const CLE_META_PUBLIC = 'dfa:public';

export const Public = () => SetMetadata(CLE_META_PUBLIC, true);
