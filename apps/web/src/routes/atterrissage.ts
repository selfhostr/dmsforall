import type { RoleUtilisateur } from '@dfa/shared';

import { chemins } from './chemins';

/**
 * TABLE D'ATTERRISSAGE PAR RÔLE — Lot D (`docs/refonte-navigation.md` §2, table « Rôle /
 * Atterrissage »), RÉVISÉE par l'arbitrage de @laupernoe du 10.08.2026 (fusion Accueil/Tableau de bord,
 * `docs/design-tableau-bord-par-role.md`). Où l'on arrive quand on ouvre l'application, avant
 * d'avoir cliqué quoi que ce soit.
 *
 * C'est la moitié de la réponse à un grief réel : « le menu est pensé pour quelqu'un d'autre ».
 * L'arbitrage refuse trois arborescences par poste (§2 : support téléphonique, casquettes qui
 * changent dans la journée, coût de maintenance) mais retient ce que cette option défendait de
 * juste — le technicien ne doit pas atterrir dans un écran conçu pour le comptoir. Une SEULE
 * arborescence, donc, mais un point d'entrée par rôle. L'autre moitié est l'onglet par défaut d'une
 * entrée, qui varie aussi (`ONGLET_DEFAUT_PAR_ROLE`, `composants/layout/navigation-modele.ts`).
 *
 * CE QUE CE TABLEAU FAIT VRAIMENT : il est passé à `RouteProtegee.redirectionParRole` sur la route
 * index (`routeur.tsx`), mécanisme posé au Lot 0 pour `poste_atelier` et étendu ici aux autres
 * rôles. Ce n'est PAS une restriction — le rôle a bien le droit de voir `/`, on choisit de ne
 * jamais le lui montrer.
 *
 * ARBITRAGE DU 10.08.2026 (verbatim de @laupernoe, transmis par le coordinateur, absent du document de
 * design) : « seuls les rôles de PILOTAGE atterrissent sur le tableau de bord — direction,
 * comptable, chef d'atelier, réceptionnaire. Les rôles d'EXÉCUTION gardent leur écran de travail
 * comme atterrissage : technicien vers son pointage, magasinier vers son comptoir, `poste_atelier`
 * vers sa borne. » CONSÉQUENCE : `comptable` QUITTE ce tableau — avant cet arbitrage, il atterrissait
 * sur Facturation › Factures (« son plan de travail du jour », révolu ci-dessous) ; il atterrit
 * désormais sur `/` comme les trois autres rôles de pilotage, qui n'y étaient DÉJÀ pas listés
 * (absents de ce tableau = atterrissage index, comportement inchangé pour eux). `vendeur` reste sur
 * son écran de travail : son tableau de bord est bloqué par un gap `vendeurId` non résolu côté
 * contrat (`ecrans/ventes/dossiers`, gap signalé, pas construit) — voir `TableauBordVendeurIndisponible.tsx`.
 *
 * Le rôle index unique (`/`) est désormais un simple relais vers `/tableau-bord`
 * (`routes/routeur.tsx`, route index) : `EcranAccueil` a disparu (fusionné), il n'y a donc plus de
 * contenu propre à `/` — tout rôle qui n'est pas redirigé par ce tableau traverse `/` sans jamais y
 * rester affiché.
 *
 * LES NEUF RÔLES, un par un :
 *
 *  | Rôle             | Atterrissage                        | Pourquoi                                |
 *  | ---------------- | ----------------------------------- | --------------------------------------- |
 *  | `poste_atelier`  | `/pointage/borne`                   | un appareil, pas un employé (§2)        |
 *  | `technicien`     | Atelier › Pointage › Mon travail    | chronomètre + ses lignes, rien d'autre  |
 *  | `magasinier`     | Pièces › Comptoir                   | jamais l'inventaire en premier          |
 *  | `vendeur`        | Ventes › Dossiers                   | tableau de bord bloqué, gap `vendeurId` |
 *  | `receptionnaire` | Tableau de bord                     | pilotage : le matin, OR du jour         |
 *  | `chef_atelier`   | Tableau de bord                     | pilotage : idem, + la charge d'atelier  |
 *  | `direction`      | Tableau de bord                     | pilotage : idem, + le bloc financier    |
 *  | `comptable`      | Tableau de bord                     | pilotage : l'argent qui n'est pas rentré|
 *  | `admin`          | Tableau de bord                     | rôle technique, aucun plan métier propre|
 *
 * `technicien` mérite une note : §2 précise que les mécaniciens pointent sur une borne partagée et
 * ne sont pas des utilisateurs quotidiens de l'arborescence (réponse Q2 de @laupernoe). Le compte nominatif
 * `technicien` reste utile — audit trail, reprise d'un pointage, consultation d'un OR — et quand il
 * sert, c'est pour pointer : « Mon travail » est le seul atterrissage qui ait un sens.
 */
export const ATTERRISSAGE_PAR_ROLE: Partial<Record<RoleUtilisateur, string>> = {
  poste_atelier: chemins.pointage.borne(),
  technicien: chemins.pointage.saisie(),
  magasinier: chemins.pieces.rechercheComptoir(),
  vendeur: chemins.ventes.dossiers.liste(),
};
