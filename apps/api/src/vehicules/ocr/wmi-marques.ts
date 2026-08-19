/**
 * Croisement marque -> WMI (World Manufacturer Identifier, 3 premiers caractères du VIN, ISO 3780)
 * — utilisé par `rechercherVin` (`extraction-permis.ts`) comme gage de COHÉRENCE sur un candidat
 * VIN corrigé (substitution de caractères ayant validé la clé de contrôle ISO 3779), quand le code
 * type ASTRA a par ailleurs été retrouvé au référentiel (`correspondance-permis.ts`), donnant une
 * marque connue.
 *
 * POURQUOI UN GAGE DE COHÉRENCE ET PAS SEULEMENT UN DÉPARTAGE — mesuré par simulation (rapport de
 * livraison) : même la correction la PLUS prudente (une seule substitution spéculative, jamais
 * plusieurs — v. `MAX_SUBSTITUTIONS_SIMULTANEES`) reste, sur une lecture dont l'erreur RÉELLE porte
 * en fait sur 2 caractères ou plus (donc hors de portée de cette correction), sujette à ~25 % de
 * coïncidence de clé de contrôle sur un candidat SANS RAPPORT avec le VIN réel — la clé ISO 3779
 * n'offre qu'un chiffre de contrôle (mod 11), largement insuffisant pour arbitrer seule. Un candidat
 * dont le WMI est en CONTRADICTION avec la marque déjà connue via le code type est donc rejeté MÊME
 * s'il est le seul à avoir validé la clé de contrôle — pas seulement utilisé pour trancher entre
 * plusieurs candidats.
 *
 * TABLE CURATÉE, VOLONTAIREMENT NON EXHAUSTIVE — les marques les plus courantes du parc suisse
 * (source : assignations WMI publiques, registrant SAE/ISO 3780). Une marque ABSENTE d'ici (ou dont
 * le WMI réel n'est simplement pas listé) NE REJETTE RIEN : `filtrerParCoherenceWmi` redonne alors
 * les candidats INCHANGÉS — cette table ne sert qu'à CONTREDIRE une correction quand elle est en
 * contradiction établie, jamais à en inventer une ni à en exiger une preuve positive qu'elle ne
 * peut pas fournir pour une marque qu'elle ne couvre pas.
 *
 * Un même constructeur peut avoir PLUSIEURS WMI (marché/usine/type de véhicule différents) : les
 * valeurs sont donc des tableaux, pas un préfixe unique.
 */
export const WMI_PAR_MARQUE: Readonly<Record<string, readonly string[]>> = {
  VOLKSWAGEN: ['WVW', 'WVG', 'WV1', 'WV2', '1VW', '3VW'],
  AUDI: ['WAU', 'WA1', 'TRU'],
  SKODA: ['TMB', 'TMK'],
  SEAT: ['VSS'],
  'MERCEDES BENZ': ['WDB', 'WDC', 'WDD', 'WDF'],
  BMW: ['WBA', 'WBS', 'WBY', 'WBX'],
  MINI: ['WMW'],
  OPEL: ['W0L', 'W0V'],
  FORD: ['WF0', 'WFO'],
  RENAULT: ['VF1', 'VF6'],
  DACIA: ['UU1', 'VF1'],
  PEUGEOT: ['VF3'],
  CITROEN: ['VF7'],
  FIAT: ['ZFA'],
  'ALFA ROMEO': ['ZAR'],
  JEEP: ['1C4', '1J4'],
  TOYOTA: ['JT', 'VNK', 'SB1'],
  LEXUS: ['JTH'],
  NISSAN: ['SJN', 'VSK'],
  HONDA: ['SHH', 'JHM'],
  MAZDA: ['JMZ'],
  SUZUKI: ['VSK', 'JS'],
  MITSUBISHI: ['JMB', 'JA3'],
  SUBARU: ['JF1'],
  HYUNDAI: ['TMA', 'KMH'],
  KIA: ['U5Y', 'KNA'],
  VOLVO: ['YV1', 'YV4'],
  PORSCHE: ['WP0', 'WP1'],
  JAGUAR: ['SAJ'],
  'LAND ROVER': ['SAL'],
  TESLA: ['5YJ', 'LRW'],
  SMART: ['WME'],
} as const;

/** Même esprit que `normaliser_recherche()` (base, 0003) mais SANS accès Postgres — ce fichier ne
 *  sait rien de la base, comme `extraction-permis.ts` (§ en-tête de ce module). Pas de retrait
 *  d'accents : `type_approbation_ch.marque` (0050) est une donnée ASTRA machine, vérifiée en
 *  exécution comme systématiquement ASCII (« CITROEN », « MERCEDES-BENZ », jamais « Škoda ») — un
 *  retrait d'accents serait donc une complexité sans cas d'usage réel. */
function normaliserMarque(marque: string): string {
  return marque
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Réduit `candidats` (VIN déjà validés par la clé de contrôle) à ceux dont le WMI (3 premiers
 * caractères) est CONNU pour `marque` — appelée sur UN SEUL candidat comme sur plusieurs (voir
 * en-tête § POURQUOI UN GAGE DE COHÉRENCE). Rend `candidats` INCHANGÉS si `marque` est absente ou
 * inconnue de la table (rien à contredire) ; peut rendre une liste VIDE si `marque` est connue et
 * qu'AUCUN candidat n'a le bon WMI — c'est le résultat voulu, `rechercherVin` le traite comme
 * « aucun candidat de confiance », pas comme une erreur.
 */
export function filtrerParCoherenceWmi(
  candidats: readonly string[],
  marque: string | null,
): readonly string[] {
  if (!marque) return candidats;

  const wmis = WMI_PAR_MARQUE[normaliserMarque(marque)];
  if (!wmis || wmis.length === 0) return candidats;

  return candidats.filter((candidat) => wmis.some((wmi) => candidat.startsWith(wmi)));
}
