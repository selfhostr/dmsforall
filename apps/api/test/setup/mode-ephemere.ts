/**
 * Choix du mécanisme d'éphémère (Postgres ET Redis) pour `pnpm test:integration` : conteneurs
 * testcontainers (comportement historique) ou base/DB jetable créée sur une instance déjà en
 * marche (`postgres-ephemere.ts` § « base jetable », `app-test.ts` pour Redis).
 *
 * PROBLÈME RÉSOLU : sur ce poste (Docker rootless, socket `unix:///run/user/1000/docker.sock`),
 * aucun port publié dans la plage éphémère du noyau (32768-60999) n'est réellement servi —
 * testcontainers y tire ses ports au hasard, donc `Port XXXXX not bound after 120000ms` à coup
 * sûr (voir docs/deploiement-local.md, piège déjà consigné). La pile de dev
 * (`pnpm docker:up`) publie sur des ports FIXES hors de cette plage (5432, 6379) et fonctionne
 * parfaitement : c'est le point d'appui du mode jetable.
 *
 * CHOIX DU CHEMIN, décidé ici plutôt qu'avec une détection réseau ("le port testcontainers
 * répond-il ?") : un sondage réseau peut réussir ou échouer pour de mauvaises raisons (registre
 * d'images lent, cluster Kubernetes qui publie quand même dans cette plage, ...) et choisirait
 * alors SILENCIEUSEMENT le mauvais chemin — précisément le risque signalé dans la mission
 * (« une détection automatique trop maligne »). On s'appuie à la place sur un signal stable et
 * déjà présent, jamais deviné : la variable `CI`, positionnée automatiquement par GitHub Actions
 * (et par toute plateforme CI usuelle) sur TOUS ses jobs, absente de tout poste de dev par
 * défaut.
 *
 *   - `CI` posée (pipeline)      → testcontainers, comportement ACTUEL, zéro modification côté
 *                                   CI (.github/workflows/ci.yml n'a rien à changer).
 *   - `CI` absente (poste de dev) → base/DB jetable sur l'instance `pnpm docker:up`, sans
 *                                   AUCUNE configuration à faire (conforme à la mission : « un
 *                                   développeur qui lance pnpm test:integration sur son poste
 *                                   n'a rien à configurer »).
 *
 * Échappatoire explicite, jamais automatique : `DFA_TEST_EPHEMERE_MODE=testcontainers|jetable`
 * force un chemin précis (utile pour rejouer le chemin testcontainers en local si un jour ce
 * poste change de configuration Docker, ou pour forcer jetable sur un runner CI qui publierait
 * réellement ses ports). Valeur invalide → échec explicite, jamais un repli silencieux.
 */

export type ModeEphemere = 'testcontainers' | 'jetable';

const VALEURS_VALIDES: readonly ModeEphemere[] = ['testcontainers', 'jetable'];

export function determinerModeEphemere(): ModeEphemere {
  const force = process.env.DFA_TEST_EPHEMERE_MODE;
  if (force !== undefined) {
    if ((VALEURS_VALIDES as readonly string[]).includes(force)) {
      return force as ModeEphemere;
    }
    throw new Error(
      `DFA_TEST_EPHEMERE_MODE="${force}" invalide — attendu "testcontainers" ou "jetable" ` +
        `(ou absente pour laisser le choix automatique CI/dev décider, voir mode-ephemere.ts).`,
    );
  }
  return process.env.CI ? 'testcontainers' : 'jetable';
}
