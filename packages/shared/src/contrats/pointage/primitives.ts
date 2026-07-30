import { z } from 'zod';

/**
 * Primitives PROPRES au domaine pointage. NON réexportées par `pointage/index.ts` — même règle
 * que `pieces/primitives.ts` et `facturation/primitives.ts` : les primitives génériques déjà
 * publiques (`schemaIdentifiant`, `schemaHorodatage`, `schemaMotif`, `schemaTexteCourt`,
 * `schemaListeIdentifiants`, `schemaCentiemes`, `schemaDateJour`…) restent celles de
 * `contrats/atelier/primitives`, réutilisées par import direct dans les fichiers qui en ont
 * besoin — jamais dupliquées ni réexportées deux fois.
 */

/**
 * Durée BRUTE d'un pointage, en SECONDES entières (suffixe `…Secondes`, à ajouter à la liste des
 * suffixes d'unité de §1.3 aux côtés de `…Centimes` / `…Centiemes` / `…Millieme` / `…Pourmille`).
 *
 * UNITÉ DÉLIBÉRÉMENT DISTINCTE de `schemaCentiemes` (centièmes d'HEURE) déjà utilisé par
 * `ligne_or.tempsReelCentiemes` — c'est la question posée explicitement par la consigne de cette
 * tâche (« une durée ne doit jamais être un float, aligne-toi sur l'unité entière déjà employée,
 * dis laquelle »). Réponse : LES DEUX unités coexistent, pour deux usages différents qui ne
 * doivent PAS être confondus :
 *
 *  - `dureeBruteSecondes` (ce schéma, exposé en lecture par `ReponsePointage`, jamais en entrée
 *    directe — c'est une valeur DÉRIVÉE de `debutLe`/`finLe` par le serveur) : RM-97 dit noir sur
 *    blanc « brut conservé à la seconde ». Un centième d'heure vaut 36 secondes : l'exprimer en
 *    centièmes ferait perdre jusqu'à 35 secondes par pointage — un écart qui s'accumule sur un
 *    mois de pointages et ne se remarque qu'au moment le plus mal choisi, un contrôle de paie.
 *    C'est la valeur de PREUVE : jamais arrondie, jamais recalculée après coup.
 *  - `schemaCentiemes` (réutilisé tel quel depuis `contrats/atelier/primitives`, PAS redéclaré
 *    ici) : la valeur ARRONDIE exposée aux indicateurs (RM-99) et à tout calcul qui doit rester
 *    comparable à `ligne_or.tempsReelCentiemes` — même unité, même échelle, comparaison directe
 *    possible sans conversion. L'arrondi appliqué est celui du paramètre `travaux.arrondiPointage`
 *    (P-19, `contrats/atelier/parametrage.ts`), appliqué UNE FOIS côté serveur, jamais recalculé
 *    côté client (RM-97 : « arrondi à l'affichage/calcul »).
 *
 * Aucun flottant nulle part : ni la seconde brute, ni le centième d'heure arrondi.
 */
export const schemaDureeSecondes = z.number().int().min(0);

/**
 * Code PIN d'attribution — 4 chiffres, source `plan-etape-1-frontend.md:443` (« code PIN à 4
 * chiffres au pavé tactile »), rien inventé sur le format. CE N'EST PAS UN MOT DE PASSE (RM-113,
 * voir `identification.ts`) : il ne protège aucun droit, il désigne seulement un technicien.
 */
export const schemaCodePin = z.string().regex(/^\d{4}$/);

/**
 * Décalage d'horloge mesuré par le CLIENT au dernier échange réussi avec le serveur
 * (`heureServeur − heureClient`, en millisecondes, SIGNÉ — une tablette en avance donne une
 * valeur négative). Source littérale : `plan-etape-1-frontend.md` §4.3 point 6.
 *
 * Sert à distinguer, côté serveur, « cette tablette a un horodatage faux parce que son horloge
 * dérive » (anomalie `derive_horloge`, tolérée, pointage accepté quand même) de « cet horodatage
 * est structurellement impossible » (`fin < debut`, ou un futur qu'aucune dérive plausible
 * n'explique → `400 POINTAGE_HORODATAGE_INVALIDE`, refusé). Sans ce champ, le serveur ne peut pas
 * faire cette distinction et devrait soit tout accepter (des pointages avec des heures fausses
 * passent inaperçus), soit tout refuser (une tablette dont l'horloge dérive de 20 minutes perd
 * du pointage) — les deux sont mauvais, RM-119/§4.3 point 6 disent explicitement qu'une dérive
 * est « un fait, pas un bug à masquer ».
 */
export const schemaDecalageHorlogeMs = z.number().int();

/**
 * Identifiant d'appareil (tablette d'atelier), texte libre déclaré par le client. Sert
 * uniquement la CORRÉLATION en cas de litige de paie (« cette heure vient de quel poste ») —
 * jamais un identifiant d'authentification, jamais utilisé pour une décision d'autorisation.
 */
export const schemaIdAppareil = z.string().trim().min(1).max(100);
