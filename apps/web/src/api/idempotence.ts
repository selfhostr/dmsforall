import { useCallback, useState } from 'react';

import { genererUuid } from '@/lib/uuid';

/**
 * Idempotence côté client (contrats-api-etape-1.md §5, arbitrage l'équipe frontend F1-01).
 *
 * Le plan frontend contenait trois formulations divergentes du moment où générer une clé
 * d'idempotence (§5.6 « au montage du formulaire », §3.5 « à l'ouverture de la barre de saisie »,
 * design doc §4.4 « à l'ouverture de chaque jeton, au `Entrée` »). La règle unique retenue, qui
 * couvre les trois comme cas particuliers :
 *
 * > Une clé par REQUÊTE DISTINCTE, générée dès que le contenu de la requête est déterminé, et
 * > jamais régénérée avant un succès ou un abandon explicite.
 *
 * Pour un formulaire long (client, véhicule), la requête EST le formulaire : la clé naît au
 * montage — c'est `useCleIdempotence` ci-dessous. Pour une saisie en rafale (lot 2), chaque ligne
 * est une requête distincte : une clé par ligne, à l'`Entrée` — c'est `genererCleIdempotence`
 * appelée directement, sans hook, à cet instant précis.
 *
 * RÈGLE DU REJEU CONFIRMÉ (§4.4) : un rejeu qui ajoute `confirmations[]` au corps doit porter une
 * NOUVELLE clé — `confirmations` entre dans l'empreinte d'idempotence (§5.1), donc réutiliser la
 * clé transformerait ce rejeu volontaire en conflit `IDEMPOTENCE_CONFLIT`. L'appelant doit donc
 * appeler `regenerer()` juste avant d'émettre la requête confirmée, PAS après un simple échec de
 * validation qui n'a rien envoyé de nouveau au serveur.
 */

/** Génère une clé d'idempotence : uuid v4, la forme attendue par l'en-tête `Idempotency-Key`
 *  (§5.1). Fonction pure, appelable en dehors du cycle de rendu React — le primitif que
 *  `useCleIdempotence` compose, et celui qu'une saisie en rafale (une clé par ligne, à l'Entrée)
 *  appelle directement sans hook dédié. */
export function genererCleIdempotence(): string {
  return genererUuid();
}

export interface CleIdempotence {
  /** La clé courante. Stable tant qu'aucun succès ni abandon explicite du formulaire n'a eu
   *  lieu : deux soumissions du même formulaire (double-clic, retry après timeout — la norme au
   *  comptoir) portent donc la MÊME clé, ce qui permet au serveur de reconnaître un rejeu plutôt
   *  que de créer deux ressources. */
  readonly cle: string;
  /** À appeler après un succès, un abandon explicite du formulaire, ou juste avant un rejeu
   *  portant `confirmations[]` (voir le commentaire d'en-tête). La prochaine soumission portera
   *  une clé neuve. Ne JAMAIS appeler avant l'un de ces trois cas : une clé régénérée trop tôt
   *  romprait la déduplication du double-clic. */
  readonly regenerer: () => void;
}

/** Une clé d'idempotence pour tout le cycle de vie d'un formulaire — générée une seule fois, au
 *  montage du composant qui appelle ce hook. C'est le cas « la requête est le formulaire » de la
 *  règle unique ci-dessus (création de client, de véhicule, de rendez-vous...). */
export function useCleIdempotence(): CleIdempotence {
  const [cle, setCle] = useState(genererCleIdempotence);
  const regenerer = useCallback(() => setCle(genererCleIdempotence()), []);
  return { cle, regenerer };
}
