import type { RoleUtilisateur } from '@dfa/shared';

import { chemins } from './chemins';

/**
 * TABLE D'ATTERRISSAGE PAR RÔLE — Lot D (`docs/refonte-navigation.md` §2, table « Rôle /
 * Atterrissage »). Où l'on arrive quand on ouvre l'application, avant d'avoir cliqué quoi que ce
 * soit.
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
 * CONSÉQUENCE À CONNAÎTRE, et elle est délibérée : pour les cinq rôles listés ci-dessous, `/`
 * (`EcranAccueil`) n'est plus rendu. `EcranAccueil` est un lanceur à trois cartes — rechercher,
 * clients, véhicules — dont les trois destinations sont désormais de premier niveau : la recherche
 * est permanente dans l'en-tête (Lot A) et « Clients & véhicules » est la troisième entrée du menu.
 * Il ne perd donc rien, et il disparaîtra au Lot F quand « Aujourd'hui » fusionnera l'accueil et le
 * tableau de bord. Les QUATRE rôles absents de ce tableau (`direction`, `admin`, `receptionnaire`,
 * `chef_atelier`) continuent d'y atterrir, et ce sont exactement ceux à qui l'onglet « Accueil »
 * d'Aujourd'hui reste proposé — les deux listes sont tenues cohérentes à la main, et un écart se
 * verrait immédiatement (un onglet qui rebondit).
 *
 * LES NEUF RÔLES, un par un :
 *
 *  | Rôle             | Atterrissage                        | Pourquoi                                |
 *  | ---------------- | ----------------------------------- | --------------------------------------- |
 *  | `poste_atelier`  | `/pointage/borne`                   | un appareil, pas un employé (§2)        |
 *  | `technicien`     | Atelier › Pointage › Mon travail    | chronomètre + ses lignes, rien d'autre  |
 *  | `magasinier`     | Pièces › Comptoir                   | jamais l'inventaire en premier          |
 *  | `vendeur`        | Ventes › Dossiers                   | son plan de travail du jour             |
 *  | `comptable`      | Facturation › Factures              | son plan de travail du jour             |
 *  | `receptionnaire` | Aujourd'hui                         | le matin : OR du jour, sorties du soir  |
 *  | `chef_atelier`   | Aujourd'hui                         | idem, plus la charge de l'atelier       |
 *  | `direction`      | Aujourd'hui                         | idem, plus le bloc financier            |
 *  | `admin`          | Aujourd'hui                         | rôle technique, aucun plan métier propre|
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
  comptable: chemins.facturation.liste(),
};
