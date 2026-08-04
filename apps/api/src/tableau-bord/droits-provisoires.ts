import type { RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';

/**
 * PALLIATIF TEMPORAIRE — `apps/api/src/tableau-bord/**` (périmètre d'écriture de ce module) n'a
 * PAS accès en écriture à `apps/api/src/auth/matrice-droits.ts` (propriété d'un autre agent). Les
 * deux actions qui devraient gouverner ces routes n'existent donc pas encore :
 *   - `tableau_bord.activite.lire`
 *   - `tableau_bord.financier.lire`
 *
 * MÊME SITUATION, MÊME SOLUTION que celle déjà documentée et déjà éprouvée dans ce dépôt pour le
 * bloc créancier avant que ses actions n'existent (`auth/matrice-droits.ts`, section « Bloc
 * créancier QR-facture ») : les routes portent `@AucunDroitRequis()` (authentifié suffit pour
 * `GardeDroit`, `common/droits/garde-droit.ts`) et la vérification RÉELLE du rôle est faite ICI,
 * en service, AVANT toute lecture de données — jamais un accès ouvert à tout rôle authentifié en
 * attendant que la matrice soit mise à jour. `verifierRoleAutorise` est appelée en tout DÉBUT des
 * deux services (`ServiceTableauBordActivite.obtenir` / `ServiceTableauBordFinancier.obtenir`),
 * avant tout appel à `AccesBase.enTenant` : un rôle refusé n'atteint jamais la base, encore moins
 * une donnée financière.
 *
 * À FAIRE PAR expert-auth quand `matrice-droits.ts` est accessible à cette tâche : ajouter les
 * deux actions ci-dessus à `TOUTES_ACTIONS`, deux blocs `DROITS_TABLEAU_BORD_*_PAR_ROLE` (mêmes
 * rôles qu'ici, EXACTEMENT — voir le détail sous chaque constante), les fusionner dans
 * `MATRICE_DROITS`, puis dans CE module : remplacer `@AucunDroitRequis()` par
 * `@ExigerDroit('tableau_bord.activite.lire')` / `@ExigerDroit('tableau_bord.financier.lire')`
 * sur les deux contrôleurs, et supprimer les deux appels à `verifierRoleAutorise` (devenus
 * redondants avec `GardeDroit`).
 */

/**
 * Activité atelier + stock : QUANTITÉS et COMPTES seulement, jamais un montant (voir
 * `ReponseActiviteTableauBord`, `@dfa/shared`). Ouvert à tout rôle de PERSONNE — même doctrine que
 * `LECTURE_ETENDUE` (`auth/matrice-droits.ts`, doctrine de tête de fichier : la lecture est
 * ouverte par défaut, seule l'écriture est gouvernée).
 *
 * SEULE exception : `poste_atelier`, la borne murale de l'atelier (`ROLES_COMPTE_DE_SERVICE`).
 * Son périmètre de droits est construit PAR ÉNUMÉRATION dans la matrice, pas par défaut ouvert
 * (voir `DROITS_POSTE_ATELIER` : « le périmètre est CONSTRUIT PAR ÉNUMÉRATION, et tout ce qui n'y
 * figure pas est refusé » — raison PHYSIQUE, un écran mural sans verrouillage, visible de tout
 * client/visiteur de l'atelier). Un écran de synthèse n'est d'aucune utilité à sa fonction
 * (identifier un technicien par PIN, démarrer/arrêter un pointage) et l'exposer là serait le
 * premier écran de statistiques accroché au mur d'un atelier — hors de son rôle.
 */
export const ROLES_TABLEAU_BORD_ACTIVITE: readonly RoleUtilisateur[] = [
  'technicien',
  'magasinier',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'comptable',
  'direction',
  'admin',
];

/**
 * Chiffre d'affaires, encaissements, encours clients : donnée financière agrégée sur L'ENSEMBLE du
 * garage — une exposition structurellement PLUS large qu'un document ou un paiement pris un par un
 * (`RF-114`/`RF-116` gouvernent chacun UN document ou UN paiement, jamais leur somme sur toute
 * l'activité). C'est précisément le piège que ce lot devait éviter : un tableau de bord qui
 * afficherait le chiffre d'affaires à tout rôle authentifié contournerait la séparation des
 * pouvoirs déjà posée par `ROLES_SANS_MONTANT`/`ROLES_SANS_MONTANT_FACTURATION`.
 *
 * Aligné sur le palier de gouvernance le PLUS ÉLEVÉ déjà posé dans la matrice — EXACTEMENT le même
 * périmètre que le bloc créancier, l'export fiduciaire et la disposition d'une avance de paiement
 * (`DROITS_PARAMETRAGE_CREANCIER_PAR_ROLE`, `DROITS_EXPORT_COMPTABLE_PAR_ROLE`,
 * `DISPOSITION_AVANCE_PAIEMENT`, tous dans `auth/matrice-droits.ts`) : `direction` + `comptable`
 * SEULS.
 *
 * `admin` EXCLU délibérément (`RF-115`, littéral : « admin est un rôle technique et n'a aucun
 * droit financier ») — NE JAMAIS combler par copier-coller de `direction`, exactement le geste que
 * `RF-115` interdit et que ce fichier même met en garde à plusieurs reprises dans
 * `auth/matrice-droits.ts`.
 *
 * `vendeur`/`receptionnaire`/`chef_atelier` EXCLUS bien que chacun détienne un droit d'ÉMISSION
 * sur UN document (`facturation.document.emettre*`, `DROITS_DOCUMENT_PAR_ROLE`) : émettre UNE
 * facture n'est pas la même exposition que voir le chiffre d'affaires CONSOLIDÉ du garage sur une
 * période. Écart SIGNALÉ, pas tranché ici — si le terrain montre qu'un chef d'atelier ou un
 * vendeur VN/VO a besoin de voir le CA de son propre périmètre, c'est une décision de @laupernoe, pas une
 * inférence de cet agent (même prudence que RF-117 « À CONFIRMER AVEC @laupernoe » dans la matrice).
 */
export const ROLES_TABLEAU_BORD_FINANCIER: readonly RoleUtilisateur[] = ['direction', 'comptable'];

/** Lève `403 DROIT_INSUFFISANT` si `role` n'est pas dans `rolesAutorises` — voir l'en-tête de ce
 *  fichier : appelée en tout début de service, AVANT tout accès base. */
export function verifierRoleAutorise(
  role: RoleUtilisateur,
  rolesAutorises: readonly RoleUtilisateur[],
  nomAction: string,
): void {
  if (!rolesAutorises.includes(role)) {
    throw new ErreurMetier(
      'DROIT_INSUFFISANT',
      `Le rôle "${role}" n'a pas accès à "${nomAction}".`,
    );
  }
}
