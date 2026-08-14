/**
 * Génération d'un mot de passe temporaire — création d'employé (issue #137) et réinitialisation
 * d'accès. Le socle sait déjà hacher (Argon2id, `mot-de-passe.service.ts`) mais n'avait jamais
 * eu besoin de PRODUIRE un mot de passe côté serveur : jusqu'ici, seul le seed de démo en posait
 * un, en clair, à la main (`db/seed/seed-dev.ts::MOT_DE_PASSE_DEMO`).
 *
 * Personne ne choisit le mot de passe d'autrui : ni l'employé (il n'a pas encore de session pour
 * se connecter et le poser lui-même — aucun flux self-service n'existe à ce jour), ni la
 * direction/l'admin qui crée le compte ou réinitialise l'accès (taper un mot de passe pour
 * quelqu'un d'autre est justement le genre de canal que la consigne « jamais en clair en base, ni
 * affiché de façon persistante » cherche à fermer). Le serveur tire un secret à haute entropie,
 * le hache immédiatement, et le rend UNE SEULE FOIS dans la réponse HTTP de création/réinitialisation
 * pour que l'admin puisse le transmettre oralement à l'employé — jamais stocké en clair, jamais
 * journalisé (voir `ServiceUtilisateur` : l'audit trace le geste, jamais la valeur).
 */
import { randomBytes } from 'node:crypto';

/** 18 octets CSPRNG → 24 caractères base64url : largement au-dessus de toute exigence de
 *  complexité humaine (entropie ~144 bits), sans jeu de caractères à valider — c'est le serveur
 *  qui le choisit, pas un humain qui pourrait le rendre devinable. */
const OCTETS_ENTROPIE = 18;

export function genererMotDePasseTemporaire(): string {
  return randomBytes(OCTETS_ENTROPIE).toString('base64url');
}
