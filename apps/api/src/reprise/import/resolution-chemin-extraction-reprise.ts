/**
 * Rebasage du chemin d'un fichier de table détectée (`TableDetecteeReprise.fichierChemin`, JSONB
 * persisté par `reprise_analyse.tables`) sur le répertoire d'extraction FRAÎCHEMENT créé par
 * l'IMPORT — pur, sans accès disque ni base.
 *
 * LE DÉFAUT (signalé par le lot de campagne, mesuré 3/3 sur une archive synthétique de 3 Ko,
 * `ENOENT`) : `fichierChemin` est un chemin ABSOLU vers le répertoire d'extraction PROPRE À
 * L'ANALYSE (`analyse/service-analyse-reprise.ts::executer`, `fichierChemin: fichierSource.chemin`
 * -> `lecture/adaptateur-lecteur-archive-reprise.ts::extraireEtInventorier`,
 * `mkdtemp(join(racineTravail, 'extrait-'))`) — un répertoire TEMPORAIRE que l'analyse purge
 * elle-même dans son `finally` dès qu'elle a fini (« PURGE DU RÉPERTOIRE D'EXTRACTION », en-tête
 * du même fichier). L'import fait sa PROPRE extraction fraîche de la même archive (nouveau
 * `mkdtemp`, donc un NOUVEAU répertoire `extrait-<autre-suffixe>` sous la MÊME racine partagée) ;
 * lire une ligne avec l'ancien chemin échoue systématiquement — le répertoire de l'analyse
 * n'existe plus.
 *
 * REBASAGE, PAS UN NOUVEAU CONTRAT DE CHEMIN : `racineTravail`
 * (`AdaptateurLecteurArchiveReprise`, constructeur) est une racine PARTAGÉE et STABLE (singleton
 * Nest, `process.cwd()/uploads/reprise-extraction` par défaut) — identique pour TOUTE extraction,
 * analyse ou import, présente ou passée. Seul le nom du sous-répertoire `extrait-XXXXX` (suffixe
 * aléatoire de `mkdtemp`, un SEUL niveau sous la racine) change d'un appel à l'autre. En repérant
 * cette racine partagée (le PARENT du répertoire d'extraction COURANT, connu à l'exécution) et en
 * la retranchant du chemin persisté, on retrouve le chemin RELATIF interne à l'extraction (ex.
 * `KUNDEN.dbf`, ou `DATA/KUNDEN.dbf` si l'archive source imbriquait des dossiers) — puis on le
 * recolle sous le répertoire d'extraction COURANT. Fonctionne identiquement pour une analyse qui
 * vient de tourner ou pour une persistée il y a des semaines : la racine partagée ne dépend d'AUCUN
 * suffixe précis, seulement de la configuration (stable) de l'adaptateur.
 *
 * `null` = chemin persisté hors de la racine partagée (déploiement dont `racineTravail` aurait
 * changé entre l'analyse et l'import — non rencontré mais pas exclu) — l'appelant traite alors la
 * table comme illisible (anomalie nommée), jamais une lecture à l'aveugle d'un chemin qui n'a plus
 * de sens.
 */
import { dirname, join, relative, sep } from 'node:path';

export function rebaserCheminFichierExtractionReprise(
  fichierChemin: string,
  repertoireExtraitCourant: string,
): string | null {
  const racineTravail = dirname(repertoireExtraitCourant);
  const relatifDepuisRacine = relative(racineTravail, fichierChemin);

  // `relative()` rend un chemin commençant par `..` (ou égal à '') quand `fichierChemin` ne
  // descend pas de `racineTravail` — hors racine partagée, jamais rebasable.
  if (relatifDepuisRacine === '' || relatifDepuisRacine.startsWith(`..${sep}`)) {
    return null;
  }
  if (relatifDepuisRacine === '..') return null;

  const segments = relatifDepuisRacine.split(sep);
  // segments[0] = ancien sous-répertoire d'extraction (`extrait-XXXXX`), retranché — le reste est
  // le chemin relatif interne à l'extraction, préservé tel quel (sous-dossiers compris).
  const relatifDansExtraction = segments.slice(1).join(sep);
  if (relatifDansExtraction === '') return null; // fichierChemin pointait la racine elle-même

  return join(repertoireExtraitCourant, relatifDansExtraction);
}
