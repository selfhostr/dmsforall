/**
 * Enums du domaine rendez-vous d'atelier (`docs/conception-rendez-vous-metier.md`,
 * `docs/conception-rendez-vous-donnees.md`). Miroir exact des enums Postgres
 * `moment_rendez_vous` / `statut_rendez_vous` / `origine_rendez_vous` (migration dédiée, `db/`).
 */

/** §1 de la conception données : jour + moment, jamais un intervalle horaire précis par défaut. */
export const MOMENTS_RENDEZ_VOUS = ['matin', 'apres_midi', 'toute_journee'] as const;
export type MomentRendezVous = (typeof MOMENTS_RENDEZ_VOUS)[number];

/**
 * Machine à états du RDV (§7 métier) : `confirme` est l'unique état initial (un RDV pris par
 * téléphone est confirmé par construction, RV-06) ; `honore`/`absent`/`annule` sont TERMINAUX,
 * jamais rouverts (RV-19, trigger `rendez_vous_empecher_reouverture` côté base). Nommé `absent`
 * (arbitrage @laupernoe, `migrations/0052` §B), pas `no_show` : vocabulaire métier français à l'écran
 * comme en base — « no-show » reste réservé à la documentation interne (§10 conception métier).
 *
 * ÉCART DE CONTRAT SIGNALÉ : `contrats/atelier/enums.ts` déclare déjà un `STATUTS_RENDEZ_VOUS`/
 * `StatutRendezVous` **GELÉ** (« déclaré au lot 1, servi au lot 4 ») avec des valeurs DIFFÉRENTES
 * (`demande, planifie, honore, absent, annule_client, annule_garage, reporte`) — une spéculation
 * antérieure, jamais implémentée (aucune table `rendez_vous`, aucun consommateur). La conception
 * commissionnée pour CE chantier (`docs/conception-rendez-vous-metier.md` §7, arbitrages de @laupernoe)
 * prescrit un modèle plus simple et délibérément différent : pas d'état brouillon (un RDV
 * téléphonique est confirmé par construction), un report n'est PAS un état (RV-16), une seule
 * valeur `annule` (client/garage non distingués en base). Je n'ai NI modifié NI supprimé l'enum
 * spéculatif gelé (hors de mon périmètre d'écriture, et la doctrine interdit de toucher un enum
 * gelé) — je nomme donc les valeurs RÉELLEMENT implémentées ici `STATUTS_RDV`/`StatutRdv` (préfixe
 * déjà utilisé par les codes d'erreur `RDV_*` de `contrats/probleme.ts`) pour éviter la collision
 * de nom sans trancher unilatéralement lequel des deux modèles est le bon. À arbitrer avec
 * l'orchestrateur : l'ancien `STATUTS_RENDEZ_VOUS` (mort, sans table ni service) devrait
 * probablement être retiré au prochain nettoyage.
 */
export const STATUTS_RDV = ['confirme', 'honore', 'absent', 'annule'] as const;
export type StatutRdv = (typeof STATUTS_RDV)[number];

/**
 * Distingue une vraie prise de RDV d'un walk-in reconstitué a posteriori (`rdvRetroactifAuto`).
 *
 * MÊME ÉCART SIGNALÉ que `STATUTS_RDV` ci-dessus : `contrats/atelier/enums.ts` déclare déjà
 * `ORIGINES_RENDEZ_VOUS`/`OrigineRendezVous` **gelé**, avec des valeurs qui décrivent le CANAL de
 * contact (`telephone, comptoir, email, formulaire_web, importe, rappel_automatique`) — une
 * question différente de celle que `docs/conception-rendez-vous-donnees.md` §3 tranche ici
 * (réservation réelle vs reconstitution rétroactive d'un walk-in). Renommé `ORIGINES_RDV` pour la
 * même raison de non-collision, même renvoi d'arbitrage.
 */
export const ORIGINES_RDV = ['reservation', 'retroactif'] as const;
export type OrigineRdv = (typeof ORIGINES_RDV)[number];

/**
 * État lisible de la capacité d'un (site, date, moment) — RV-06/RV-07/RV-08. `non_definie` est
 * une valeur DISTINCTE de `disponible` : un site qui n'a jamais paramétré sa capacité
 * (`parametreSite.capaciteHeuresJourCentiemes IS NULL`) n'est PAS « toujours disponible » au sens
 * calculé, il est « pas mesuré » — jamais rendu comme un 0 minutes occupées sur une capacité de 0,
 * qui afficherait à tort une jauge pleine. Voir `apps/api/src/rendezvous/calcul-capacite.ts`.
 */
export const ETATS_CAPACITE_RENDEZ_VOUS = ['non_definie', 'disponible', 'complete'] as const;
export type EtatCapaciteRendezVous = (typeof ETATS_CAPACITE_RENDEZ_VOUS)[number];
