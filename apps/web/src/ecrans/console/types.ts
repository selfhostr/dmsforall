/**
 * Types locaux du palier 1 de la console d'exploitation (vue plateforme,
 * `docs/conception-console-exploitation-ecrans.md` §2).
 *
 * Le contrat réel (`GarageConsole`, `ReponseSantePlateforme`, `NiveauSanteGarage`,
 * `StatutExportComptableConsole`, etc.) vit désormais dans `@dfa/shared`
 * (`packages/shared/src/contrats/exploitation/`) et est importé directement là où il est utilisé —
 * il n'est plus dupliqué ici. Ce fichier ne garde que ce qui n'a AUCUN équivalent dans ce contrat,
 * parce que ce n'est pas une notion de la porte 1 servie par l'API, mais un besoin d'affichage
 * purement local à cet écran.
 */

/**
 * Identité plateforme affichée dans la bande console (§2 : « identité de la personne connectée
 * avec son rôle plateforme »). PROVISOIRE au sens fort : le modèle d'accès n'a pas encore tranché
 * QUI porte cette identité ni comment elle est authentifiée (`conception-console-exploitation-acces.md`
 * §2.1 : « le rôle admin n'est pas une porte de sortie » — donc explicitement PAS
 * `UtilisateurCourant`/`useSession`, qui décrivent un compte DE TENANT, une notion différente).
 * Tant qu'aucune source réelle n'existe, `ConsoleShell` reçoit cette identité en prop optionnelle
 * plutôt que d'aller la chercher elle-même — voir le commentaire de `ConsoleShell.tsx`. Cette
 * notion n'appartient pas au contrat `exploitation` : la porte 1 rend des agrégats de garages,
 * jamais l'identité de l'exploitant qui regarde l'écran.
 */
export interface IdentitePlateformeConsole {
  readonly prenom: string;
  readonly nom: string;
  /** Libellé déjà résolu (pas un enum de rôles plateforme — cet enum n'existe pas encore). */
  readonly libelleRole: string;
}
