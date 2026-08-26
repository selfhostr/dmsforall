/**
 * Fonctions PURES de projection : vocabulaire de `lecteurs/` (`RoleMetier`, `RapportTable`,
 * `ProfilColonne`) -> vocabulaire du contrat gelé `contrats/reprise.ts` (`RoleTableReprise`,
 * `TableDetecteeReprise`, `ConstatQualiteTableReprise`). Testées à part de tout accès base —
 * c'est ici que vit la seule vraie « logique métier » de l'analyse côté module reprise, la
 * détection elle-même restant la responsabilité de `lecteurs/`.
 */

import { randomUUID } from 'node:crypto';

import type {
  ConstatQualiteTableReprise,
  FichierArchiveReprise,
  MotifDeductionRoleTable,
  RoleTableReprise,
  TableDetecteeReprise,
} from '@dfa/shared';

import type { RoleMetier } from '../lecteurs/types';
// La conversion `lecteurs/types.ts::FamilleMoteur` -> `contrats/reprise.ts::
// FamilleMoteurSourceReprise` vivait ICI (`projeterFamilleMoteur`) — déplacée dans l'adaptateur
// (`lecture/adaptateur-lecteur-archive-reprise.ts`), qui est désormais le SEUL point du module à
// connaître le vocabulaire interne de `lecteurs/` pour la famille de moteur. Voir l'en-tête de
// `lecture/port-lecteur-archive-reprise.ts` pour la justification complète.
import type {
  FichierArchiveSource,
  ProfilColonne,
  RapportTable,
} from '../lecture/port-lecteur-archive-reprise';

/** `lecteurs/types.ts::RoleMetier` -> `contrats/reprise.ts::RoleTableReprise` — mapping EXPLICITE,
 *  jamais une coercition de chaîne : une valeur non listée ici est un défaut de câblage (l'union
 *  TypeScript source le rend impossible à la compilation), pas un cas silencieusement ignoré. */
const ROLE_METIER_VERS_ROLE_TABLE_REPRISE: Readonly<Record<RoleMetier, RoleTableReprise>> = {
  client: 'clients',
  vehicule: 'vehicules',
  document_vente: 'documents_vente',
  ligne_document_vente: 'lignes_document_vente',
  ordre_reparation: 'ordres_reparation',
  ligne_ordre_reparation: 'lignes_ordre_reparation',
  article: 'articles_stock',
  fournisseur: 'fournisseurs',
  paiement: 'paiements',
  index_documentaire: 'index_documents_scannes',
  referentiel_constructeur: 'referentiel_constructeur',
  inconnu: 'inconnu',
};

export function projeterFichierArchive(fichier: FichierArchiveSource): FichierArchiveReprise {
  return {
    chemin: fichier.chemin,
    tailleOctets: fichier.tailleOctets,
    // Le TYPE (base_donnees / export_tabulaire / …) est déduit AILLEURS (détection de famille +
    // extension) — ce fichier ne fait que transporter l'inventaire brut ; voir
    // `service-analyse-reprise.ts::classerTypeFichier`.
    type: 'inconnu',
    lisible: fichier.lisible,
    empreinteSha256: fichier.empreinteSha256,
  };
}

/** Meilleure évaluation d'une `RapportTable` : la première (triée par confiance décroissante côté
 *  `lecteurs/`, doctrine documentée en tête de `lecteurs/types.ts` : « la meilleure en tête »). */
export function projeterTableDetectee(
  fichierChemin: string,
  rapport: RapportTable,
  profils: readonly ProfilColonne[],
): TableDetecteeReprise {
  const meilleure = rapport.evaluations[0];
  const roleDeduit: RoleTableReprise = meilleure
    ? (ROLE_METIER_VERS_ROLE_TABLE_REPRISE[meilleure.role] ?? 'inconnu')
    : 'inconnu';
  // SEUL point de conversion d'échelle de tout le module : `meilleure.confiance` est la confiance
  // FRACTIONNAIRE 0-1 propre à `lecteurs/` (doctrine de `lecteurs/types.ts::EvaluationRole`,
  // jamais changée ici) ; `TableDetecteeReprise.indiceConfiance` (contrat, doc sur le champ) est
  // GELÉ sur l'échelle 0-100. Défaut réel corrigé le 25.08.2026 : un `Math.round(meilleure.
  // confiance)` SANS le `* 100` ne pouvait rendre que 0 ou 1, faisant tomber CHAQUE table sous
  // `SEUIL_CONFIANCE_MINIMUM` (`plan/generation-plan-reprise.ts`, échelle 0-100) — plan toujours
  // vide, quelle que soit la qualité réelle de la détection. `clamp` défensif : `confiance` est
  // déjà garantie dans [0, 1] par `clamp01()` (lecteurs/detecteur-role.ts), mais un futur
  // producteur qui l'oublierait ne doit jamais faire déborder le contrat hors de son intervalle
  // documenté.
  const indiceConfiance = meilleure
    ? Math.max(0, Math.min(100, Math.round(meilleure.confiance * 100)))
    : 0;

  const motifsDeduction: MotifDeductionRoleTable[] = meilleure
    ? meilleure.signaux.length > 0
      ? meilleure.signaux.map((signal) => ({
          code: 'colonnes_correspondantes' as const,
          donnees: { colonne: signal.colonne, motif: signal.motif, raison: signal.raison },
        }))
      : [{ code: 'estimation_faible_confiance' as const, donnees: { raison: meilleure.raison } }]
    : [];

  return {
    id: randomUUID(),
    fichierChemin,
    nomTechnique: rapport.table,
    roleDeduit,
    indiceConfiance,
    motifsDeduction,
    nombreLignes: rapport.lignesActives,
    // Aucune colonne date min/max exposée par le port de lecture actuel — jamais fabriquée ici :
    // `null` = « non déterminée », pas une estimation approximative déguisée en fait.
    periodeCouverte: null,
    constatsQualite: constatsDepuisProfils(profils),
  };
}

const SEUIL_REMPLISSAGE_FAIBLE = 0.3;

export function constatsDepuisProfils(
  profils: readonly ProfilColonne[],
): readonly ConstatQualiteTableReprise[] {
  const constats: ConstatQualiteTableReprise[] = [];
  for (const profil of profils) {
    if (profil.total > 0 && profil.tauxRemplissage < SEUIL_REMPLISSAGE_FAIBLE) {
      constats.push({
        type: 'remplissage_faible',
        champ: profil.colonne,
        gravite: 'attention',
        donnees: { tauxRemplissage: profil.tauxRemplissage },
      });
    }
    if (profil.formatDateDetecte === 'aaaa.mm.jj') {
      constats.push({
        type: 'format_date_ambigu',
        champ: profil.colonne,
        gravite: 'information',
        donnees: { formatDetecte: profil.formatDateDetecte },
      });
    }
    if (profil.formatDateDetecte === 'inconnu' && profil.datesAberrantes !== undefined) {
      constats.push({
        type: 'format_date_ambigu',
        champ: profil.colonne,
        gravite: 'attention',
        donnees: { formatDetecte: profil.formatDateDetecte },
      });
    }
    if (profil.datesAberrantes !== undefined && profil.datesAberrantes > 0) {
      constats.push({
        type: 'dates_aberrantes',
        champ: profil.colonne,
        gravite: 'bloquante',
        donnees: { nombre: profil.datesAberrantes },
      });
    }
  }
  return constats;
}
