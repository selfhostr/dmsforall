/**
 * Adaptateur FACTICE de `PortLecteurArchiveReprise`, exclusivement pour les tests de ce module —
 * `lecteurs/` (bibliothèque réelle) est écrite EN PARALLÈLE par un autre agent, aucune dépendance
 * directe ici. Configurable en mémoire : un scénario de test construit une archive synthétique
 * (familles/tables/lignes) et cette classe la rejoue telle quelle.
 */

import type { FamilleMoteurSourceReprise } from '@dfa/shared';
import type {
  FichierArchiveSource,
  LienCandidat,
  LigneTable,
  OptionsLectureDbf,
  PortLecteurArchiveReprise,
  ProfilColonne,
  RapportTable,
  ResultatDetectionFamilleReprise,
} from './port-lecteur-archive-reprise';

export interface TableSynthetiqueReprise {
  readonly nom: string;
  readonly rapport: RapportTable;
  readonly lignes: readonly LigneTable[];
  readonly profils?: readonly ProfilColonne[];
  readonly liens?: readonly LienCandidat[];
}

export interface ArchiveSynthetiqueReprise {
  readonly fichiers: readonly FichierArchiveSource[];
  readonly famille: ResultatDetectionFamilleReprise;
  /** Clé = chemin de fichier (voir `fichiers[].chemin`) -> tables portées par ce fichier. */
  readonly tablesParFichier: Readonly<Record<string, readonly TableSynthetiqueReprise[]>>;
  readonly copiesFaisantFoi?: Readonly<Record<string, string | null>>;
}

export class AdaptateurLecteurArchiveRepriseFactice implements PortLecteurArchiveReprise {
  constructor(private readonly archive: ArchiveSynthetiqueReprise) {}

  /** Chemins/appels de purge enregistrés — permet à un test d'affirmer que l'appelant nettoie
   *  bien dans un `finally` (succès ET échec), sans dépendance à un vrai système de fichiers. */
  readonly repertoiresPurges: string[] = [];

  async extraireEtInventorier(
    _cheminArchive: string,
  ): Promise<{ readonly repertoire: string; readonly fichiers: readonly FichierArchiveSource[] }> {
    return { repertoire: '/factice/extrait', fichiers: this.archive.fichiers };
  }

  async purgerRepertoireExtrait(repertoire: string): Promise<void> {
    this.repertoiresPurges.push(repertoire);
  }

  async detecterFamille(
    _cheminRepertoireExtrait: string,
  ): Promise<ResultatDetectionFamilleReprise> {
    return this.archive.famille;
  }

  async choisirCopieFaisantFoi(candidats: readonly string[]): Promise<string | null> {
    const cle = [...candidats].sort().join('|');
    return this.archive.copiesFaisantFoi?.[cle] ?? candidats[0] ?? null;
  }

  async listerTables(
    cheminFichier: string,
    _famille: FamilleMoteurSourceReprise,
  ): Promise<readonly string[]> {
    return (this.archive.tablesParFichier[cheminFichier] ?? []).map((t) => t.nom);
  }

  async evaluerRole(
    cheminFichier: string,
    _famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<RapportTable> {
    const trouvee = this.trouverTable(cheminFichier, table);
    return trouvee.rapport;
  }

  async profilerColonnes(
    cheminFichier: string,
    _famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<readonly ProfilColonne[]> {
    return this.trouverTable(cheminFichier, table).profils ?? [];
  }

  async detecterLiens(
    cheminFichier: string,
    _famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<readonly LienCandidat[]> {
    return this.trouverTable(cheminFichier, table).liens ?? [];
  }

  async *lireLignes(
    cheminFichier: string,
    _famille: FamilleMoteurSourceReprise,
    table: string,
    options?: OptionsLectureDbf,
  ): AsyncIterable<LigneTable> {
    const lignes = this.trouverTable(cheminFichier, table).lignes;
    const limite = options?.limite ?? lignes.length;
    for (const ligne of lignes.slice(0, limite)) {
      yield ligne;
    }
  }

  async compterLignes(
    cheminFichier: string,
    _famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<number> {
    return this.trouverTable(cheminFichier, table).lignes.length;
  }

  private trouverTable(cheminFichier: string, table: string): TableSynthetiqueReprise {
    const trouvee = (this.archive.tablesParFichier[cheminFichier] ?? []).find(
      (t) => t.nom === table,
    );
    if (!trouvee) {
      throw new Error(
        `AdaptateurLecteurArchiveRepriseFactice : table « ${table} » introuvable dans « ${cheminFichier} ».`,
      );
    }
    return trouvee;
  }
}
