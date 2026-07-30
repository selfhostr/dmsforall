import { z } from 'zod';

import { schemaCodePin } from './primitives';

/**
 * Identification par code PIN (RM-113 → RM-115 de la spécification pointage).
 *
 * ## Ce que le PIN GARANTIT
 *
 * Il désigne, parmi les techniciens affectés au site de la borne, LEQUEL est en train d'agir —
 * un problème de FIABILITÉ DE LA DONNÉE (« qui a fait ce geste »), résolu par un moyen adapté à
 * une borne partagée, mains sales ou gantées, sans clavier (RM-113).
 *
 * ## Ce que le PIN NE GARANTIT PAS
 *
 * - **Ce n'est pas une authentification.** Il ne prouve l'identité de personne au sens
 *   sécurité — un espace à 4 chiffres se devine. Le DROIT d'écrire un pointage est déjà porté par
 *   la SESSION DE LA BORNE (compte de service scopé au site, rôle « poste atelier », authentifié
 *   normalement au sens de l'auth existante) — pas par le PIN. Un technicien qui tape le PIN d'un
 *   collègue n'obtient AUCUN privilège que la borne n'a pas déjà ; il fait seulement porter
 *   l'heure au mauvais nom (RM-113 : « le pointage ment sur qui a travaillé », pas une élévation
 *   de privilège).
 * - **`POST /pointages/identification` N'OUVRE AUCUNE SESSION.** Pas de cookie, pas de jeton,
 *   pas d'objet « session PIN » côté serveur. La réponse sert UNIQUEMENT à ce que l'écran affiche
 *   « Bonjour Marco » et attache `technicienId` aux appels de pointage suivants pendant la durée
 *   de vie de l'écran (état LOCAL au client, pas un état serveur) — jusqu'à ce qu'un autre
 *   technicien s'identifie ou que l'écran revienne à « Qui êtes-vous ? » après inactivité
 *   (politique d'inactivité laissée au front, hors périmètre de ce fichier).
 * - **Le PIN n'autorise aucun geste sensible** (RM-115) : signature, transition d'OR, réponse de
 *   devis restent hors du geste PIN, cohérent avec la liste déjà posée de ce qui reste interdit
 *   hors ligne (`plan-etape-1-frontend.md:511-514`) — le PIN couvre uniquement le pointage et le
 *   constat, jamais plus.
 *
 * ## Anti-brute-force (RM-114)
 *
 * L'espace des PIN est volontairement petit (lisibilité, vitesse, mains sales) : SANS
 * ralentissement après échecs répétés, n'importe qui devant la borne peut essayer les 10'000
 * combinaisons en quelques minutes. `POINTAGE_PIN_VERROUILLE` (423, `probleme.ts`) matérialise ce
 * verrouillage temporaire dans le contrat — **le nombre d'essais et la durée de blocage restent
 * DES PARAMÈTRES DE SÉCURITÉ NON FIXÉS ICI**, à trancher avec `expert-auth`
 * (`apps/api/src/auth/`, hors périmètre de ce fichier). Ce que CE fichier fige : la FORME de
 * l'échec (un code dédié, pas un des codes `AUTH_*` — voir plus bas pourquoi), pas ses paramètres.
 *
 * ## Pourquoi PAS un code `AUTH_*`
 *
 * `POINTAGE_PIN_INVALIDE` (401) et `POINTAGE_PIN_VERROUILLE` (423) partagent leur statut HTTP
 * avec `AUTH_IDENTIFIANTS_INVALIDES` / `AUTH_COMPTE_VERROUILLE`, mais sont des codes MÉTIER
 * DISTINCTS et DOIVENT LE RESTER : un intercepteur HTTP générique qui traiterait tout `401`
 * comme « session expirée, renvoyer au login » ferait perdre la borne entière (l'ÉCRAN reste
 * authentifié — c'est sa propre session qui est valide — seule l'IDENTIFICATION DU TECHNICIEN a
 * échoué). Un client de cette API doit distinguer sur `code`, jamais sur `status` seul — c'est
 * déjà la règle de lecture du contrat d'erreur (`probleme.ts` : « le front n'affiche jamais
 * title/detail, seul `code` pilote le comportement »), mais elle mérite d'être répétée ici parce
 * que le statut HTTP identique aux codes `AUTH_*` est un piège facile pour un connecteur écrit
 * vite.
 */
export const schemaIdentificationPin = z.object({ codePin: schemaCodePin });
export type EntreeIdentificationPin = z.infer<typeof schemaIdentificationPin>;

/**
 * `POST /pointages/identification` — réponse volontairement MINIMALE : de quoi afficher un
 * accueil nominatif et attacher `technicienId` aux appels suivants, rien de plus. Pas de droits,
 * pas de rôle, pas de liste d'OR — ce n'est pas un login, ça ne doit pas en avoir la silhouette.
 *
 * Erreurs : `401 POINTAGE_PIN_INVALIDE` (aucun technicien actif du site ne porte ce PIN),
 * `423 POINTAGE_PIN_VERROUILLE` (trop de tentatives récentes — `Retry-After` porte la durée
 * restante, même patron que `429 AUTH_TROP_DE_TENTATIVES`).
 */
export interface ReponseIdentificationPin {
  readonly technicienId: string;
  readonly prenom: string;
  readonly nom: string;
}
