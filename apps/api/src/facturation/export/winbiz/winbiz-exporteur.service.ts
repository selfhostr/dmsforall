/**
 * Service d'export WinBIZ — implémente `AccountingExporter` (`packages/shared/…/export.ts`) et
 * orchestre décomposition + sérialisation + découpage en lots + empreinte.
 *
 * `AccountingExporter` (contrat gelé, `MD-84`) ne déclare que `cible`/`capacites` — le fichier
 * source précise explicitement que le contrat HTTP complet de déclenchement reste à concevoir
 * (« hors du périmètre demandé pour ce lot »). Les méthodes ci-dessous sont donc une EXTENSION
 * de ce service, pas une promesse d'interface partagée : un futur contrat HTTP (l'équipe API)
 * pourra les envelopper différemment sans que ce fichier n'ait à changer de forme interne.
 *
 * Ce service ne touche NI la base NI le réseau : il reçoit une liste d'`EcritureExport` déjà
 * résolues (comptes et codes TVA déjà mappés en amont, `EF-01`) et rend des octets. Le
 * déclenchement réel (lecture des documents non exportés, écriture de `export_comptable`,
 * marquage `document_vente.export_id`/`paiement.export_id`) appartient à un futur service
 * d'orchestration — ce module n'est PAS câblé dans `app.module.ts`, voir le rapport de livraison.
 */

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import type { AccountingExporter, CapacitesExport, CibleExport, EcritureExport } from '@dfa/shared';

import { TAILLE_MAX_LOT_OCTETS_WINBIZ } from './winbiz.constantes';
import { ErreurExportWinbiz } from './winbiz.erreurs';
import { serialiserEcrituresWinbiz, type AvertissementExportWinbiz } from './winbiz-serialiseur';

export interface LotExportWinbiz {
  readonly contenu: Buffer;
  readonly nomFichier: string;
  readonly nbEcritures: number;
  readonly nbLignesCsv: number;
  readonly totalDebitCentimes: bigint;
  readonly totalCreditCentimes: bigint;
  readonly empreinteSha256: string;
  readonly avertissements: readonly AvertissementExportWinbiz[];
}

@Injectable()
export class WinbizExporteurService implements AccountingExporter {
  readonly cible: CibleExport = 'winbiz';

  /**
   * `multiDevise: false` — le pilote ne couvre que CHF (`EF-13`, colonnes `ME_*` toujours
   * vides dans cet adaptateur). `centresDeCharge: true` — `EcritureExport.centreDeCharge`
   * alimente `Ecr_ana` (colonne 19, « n° de compte analytique »). `codesTva: true` — méthode
   * `<vt_code=…>` recommandée par l'éditeur (`EF-17`). `granularite` : les deux modes du cœur
   * sont acceptés tels quels — cet adaptateur sérialise la liste d'écritures qu'on lui donne,
   * quel que soit le mode qui l'a produite (`EF-04`), sans logique de regroupement propre.
   */
  readonly capacites: CapacitesExport = {
    multiDevise: false,
    centresDeCharge: true,
    codesTva: true,
    granularite: ['detaille', 'agrege'],
  };

  /**
   * Sérialise un unique lot (pas de découpage taille). À réserver aux appels dont l'appelant a
   * déjà garanti que le résultat tiendra sous `TAILLE_MAX_LOT_OCTETS_WINBIZ` — sinon préférer
   * `genererLots`.
   *
   * @throws ErreurExportWinbiz — voir `serialiserEcrituresWinbiz`.
   */
  genererLot(ecritures: readonly EcritureExport[], nomFichier: string): LotExportWinbiz {
    const resultat = serialiserEcrituresWinbiz(ecritures);
    return {
      contenu: resultat.contenu,
      nomFichier,
      nbEcritures: resultat.nbEcritures,
      nbLignesCsv: resultat.nbLignesCsv,
      totalDebitCentimes: resultat.totalDebitCentimes,
      totalCreditCentimes: resultat.totalCreditCentimes,
      empreinteSha256: createHash('sha256').update(resultat.contenu).digest('hex'),
      avertissements: resultat.avertissements,
    };
  }

  /**
   * Répartit des écritures en plusieurs lots WinBIZ, chacun sous `tailleMaxOctets` (défaut :
   * `TAILLE_MAX_LOT_OCTETS_WINBIZ`, la limite documentée de `ENTRIESIMPORT`, `EF-18`/`EF-18` a).
   *
   * Chaque `EcritureExport` reste ENTIÈRE dans un seul lot — jamais scindée entre deux fichiers,
   * pour garder ensemble les lignes WinBIZ issues d'une même pièce (`Pièce`/`Libellé`
   * identiques). Le découpage par EXERCICE COMPTABLE (`EF-18` a : « jamais deux exercices dans un
   * lot ») n'est PAS de la responsabilité de ce découpage par taille — c'est `periode_comptable`
   * (base, hors de portée de cet adaptateur pur) qui définit les bornes d'exercice ; l'appelant
   * doit déjà avoir restreint `ecritures` à une seule période avant d'appeler cette méthode.
   *
   * @throws ErreurExportWinbiz `LOT_VIDE` si `ecritures` est vide, ou toute erreur de
   *         sérialisation d'une écriture individuelle (propagée avec sa `reference`).
   */
  genererLots(
    ecritures: readonly EcritureExport[],
    fabriqueNomFichier: (indexLot: number) => string,
    tailleMaxOctets: number = TAILLE_MAX_LOT_OCTETS_WINBIZ,
  ): readonly LotExportWinbiz[] {
    if (ecritures.length === 0) {
      throw new ErreurExportWinbiz('LOT_VIDE', 'Aucune écriture à exporter vers WinBIZ.');
    }

    const groupes: EcritureExport[][] = [];
    let groupeCourant: EcritureExport[] = [];
    let tailleCourante = 0;

    for (const ecriture of ecritures) {
      // Taille marginale exacte : sérialiser l'écriture SEULE donne la taille de ses lignes
      // CSV (en-tête exclu, ajouté une fois par lot ci-dessous). Coûteux en théorie (une
      // sérialisation par écriture, en plus de celle du lot final) mais chaque écriture reste
      // petite (quelques lignes) — la précision prime sur l'économie de cycles ici : une
      // estimation approximative risquerait de produire un lot qui dépasse malgré tout la
      // limite de l'API. Effet de bord volontairement conservateur : cette mesure isolée inclut
      // sa propre ligne d'en-tête (~150 octets) que le lot final, lui, ne paie qu'une fois —
      // `tailleCourante` surestime donc légèrement le lot réel, ce qui ne peut que déclencher
      // une coupure un peu plus tôt que strictement nécessaire, jamais un dépassement.
      const { contenu } = serialiserEcrituresWinbiz([ecriture]);
      const tailleMarginale = contenu.length;

      if (groupeCourant.length > 0 && tailleCourante + tailleMarginale > tailleMaxOctets) {
        groupes.push(groupeCourant);
        groupeCourant = [];
        tailleCourante = 0;
      }
      groupeCourant.push(ecriture);
      tailleCourante += tailleMarginale;
    }
    if (groupeCourant.length > 0) {
      groupes.push(groupeCourant);
    }

    return groupes.map((groupe, index) => this.genererLot(groupe, fabriqueNomFichier(index)));
  }
}
