import type { EntreeModificationParametresAtelier } from '@dfa/shared';
import { ErreurMetier } from '../../common/erreurs';

/**
 * Gouvernance du `PATCH /parametres-atelier` par drapeau de fonctionnalité (lot 1) —
 * `plan-lot1-execution.md` §L1-07 : « un paramètre dont le drapeau de fonctionnalité est `false`
 * est en lecture seule : `PATCH` le modifiant → `501 FONCTION_NON_DISPONIBLE`. Un paramètre
 * modifiable mais inerte est un mensonge. »
 *
 * AMBIGUÏTÉ DE CONTRAT SIGNALÉE, tranchée ici faute de mieux — voir la réponse de tâche L1-07 :
 * le plan d'exécution énonce HUIT drapeaux (`facturation, stockPieces, depotPneus, prets,
 * planning, pointage, signature, controleQualite`), alors que `ReponseParametresAtelier.
 * fonctionnalites` (contrat GELÉ, `packages/shared/src/contrats/atelier/parametrage.ts`, lui-même
 * dérivé de contrats-api-etape-1.md §8.2) n'en expose QUE QUATRE (`facturation, stockPieces,
 * depotPneus, prets`). Les huit sont donc traités ici comme une politique de gouvernance INTERNE
 * (jamais sérialisée telle quelle dans la réponse publique — voir `mappeur-parametres-atelier.ts`,
 * qui ne construit que les 4 clés gelées), construite par inférence à partir de ce qui est
 * effectivement livré au lot 1 :
 *   - aucun module rendez-vous/planning ni pointage n'existe au lot 1 (absent de la liste des
 *     tâches L1-01→L1-17 de `plan-lot1-execution.md` §8) ⇒ `planning` et `pointage` inertes ;
 *   - aucun endpoint de capture de signature n'est publié au lot 1 (absent du contenu de L1-12) ⇒
 *     `signature` inerte ;
 *   - `parametre_atelier.controle_qualite` est CONTRAINT par `CHECK` à `jamais`/`toujours` au lot 1
 *     (Δ3, `db/migrations/0005_parametrage.sql`) : la fonctionnalité EXISTE bel et bien, restreinte
 *     ⇒ `controleQualite` actif.
 * `stockPieces` et `depotPneus` n'ont aucun champ correspondant dans
 * `EntreeModificationParametresAtelier` : rien à gouverner pour eux ici.
 *
 * Ce fichier doit être revu par lead-backend/expert-api si un autre module (L1-12 notamment)
 * réintroduit une lecture différente de ces huit drapeaux.
 */
export const FONCTIONNALITES_LOT1 = {
  facturation: false,
  planning: false,
  pointage: false,
  signature: false,
  controleQualite: true,
} as const;

type FonctionnaliteLot1 = keyof typeof FONCTIONNALITES_LOT1;

/**
 * Association `<domaine>.<champ>` → fonctionnalité dont il dépend. Seuls les champs INERTES
 * figurent ici ; un champ absent de cette table est actif au lot 1 (défaut permissif — c'est
 * l'ABSENCE de colonne en base, vérifiée champ par champ ci-dessous, qui a guidé cette liste, pas
 * une supposition) :
 *   - `facturation.*` (multiPayeursAutorise, restitutionAvantPaiement, piecesClientAutorisees,
 *     politiqueDemontageRefuse, seuilDemontageCentimes, produitsAtelier) : DEUX de ces six champs
 *     (`piecesClientAutorisees`, `seuilDemontageCentimes`) n'ont d'ailleurs AUCUNE colonne dans
 *     `parametre_atelier` — signe indépendant que le domaine est bien inerte au lot 1 ;
 *   - `planning.noShowSeuilAlerte` / `planning.rappel` (planning absent) et
 *     `planning.tamponPretMinutes` (prêts absents, lot 5) — `planning.rappel` n'a d'ailleurs aucune
 *     colonne en base non plus ;
 *   - `reception.signature` (capture de signature absente du lot 1) ;
 *   - `travaux.chevauchementPointageAutorise` / `pointageObligatoirePourTerminer` /
 *     `arrondiPointage` / `dureeMaxPointageHeures` (pointage absent). `travaux.uniteTemps` reste
 *     ACTIF : il gouverne l'affichage du temps sur les LIGNES d'OR (L1-12), indépendant du
 *     pointage. `travaux.controleQualite` reste ACTIF (Δ3).
 *
 * `or.*`, `reception.kmEntreeObligatoire/kmSortieObligatoire/plafondDefautCentimes/
 * plafondAvoirReceptionnaireCentimes` (RF-117, 0018), `documents.*`, `vehicule.*` : actifs au
 * lot 1, non gouvernés ici.
 */
const FONCTIONNALITE_PAR_CHAMP: Readonly<Record<string, FonctionnaliteLot1>> = {
  'facturation.multiPayeursAutorise': 'facturation',
  'facturation.restitutionAvantPaiement': 'facturation',
  'facturation.piecesClientAutorisees': 'facturation',
  'facturation.politiqueDemontageRefuse': 'facturation',
  'facturation.seuilDemontageCentimes': 'facturation',
  'facturation.produitsAtelier': 'facturation',
  'planning.noShowSeuilAlerte': 'planning',
  'planning.tamponPretMinutes': 'planning',
  'planning.rappel': 'planning',
  'reception.signature': 'signature',
  'travaux.chevauchementPointageAutorise': 'pointage',
  'travaux.pointageObligatoirePourTerminer': 'pointage',
  'travaux.arrondiPointage': 'pointage',
  'travaux.dureeMaxPointageHeures': 'pointage',
};

/**
 * Refuse la modification avec `501 FONCTION_NON_DISPONIBLE` dès qu'UN SEUL champ envoyé dépend
 * d'une fonctionnalité inerte au lot 1 — jamais une application partielle silencieuse du reste du
 * corps : un `PATCH` qui « oublierait » discrètement un champ serait plus trompeur qu'un refus net.
 */
export function verifierChampsActifsParametresAtelier(
  entree: EntreeModificationParametresAtelier,
): void {
  for (const [domaine, valeurDomaine] of Object.entries(entree)) {
    if (valeurDomaine === undefined) continue;
    for (const champ of Object.keys(valeurDomaine as Record<string, unknown>)) {
      const chemin = `${domaine}.${champ}`;
      const fonctionnalite = FONCTIONNALITE_PAR_CHAMP[chemin];
      if (fonctionnalite && !FONCTIONNALITES_LOT1[fonctionnalite]) {
        throw new ErreurMetier(
          'FONCTION_NON_DISPONIBLE',
          `Le paramètre "${chemin}" dépend de la fonctionnalité "${fonctionnalite}", non disponible au lot 1.`,
          { detail: chemin },
        );
      }
    }
  }
}
