/**
 * Classement de rôle métier d'une table — au contenu, jamais au nom. Fonction pure : prend un
 * échantillon déjà lu (via `lireLignesDbf`/`lireLignesAccess`, côté appelant), ne fait aucune I/O,
 * donc testable avec des lignes construites directement en mémoire.
 *
 * Faits mesurés sur deux garages réels qui ont guidé cette conception (cf. rapport de
 * livraison) : le nom de table ment (allemand abrégé, sans rapport avec le métier), un gros
 * fichier peut être un catalogue tiers sans donnée du garage, et une table au nom officiel
 * "clients"/"véhicules" peut être vide alors que la vraie donnée vit ailleurs — d'où la garde
 * "table vide -> inconnu" avant toute autre heuristique.
 */
import type { EvaluationRole, LigneTable, RapportTable, RoleMetier, SignalColonne } from './types';
import {
  signalChassis,
  signalDatePlausible,
  signalEmail,
  signalEnumeration,
  signalIdentifiant,
  signalMontant,
  signalNomFichier,
  signalNpaSuisse,
  signalPlaqueSuisse,
  signalTexteLibre,
  type ResultatSignal,
} from './signaux-contenu';

const EFFECTIF_MIN_SIGNAL = 3;
const SEUIL_CONFIANCE_MIN = 0.15;
const NB_LIGNES_VOLUMINEUSE = 3000;

interface ColonneRetenue {
  colonne: string;
  taux: number;
  effectif: number;
}

type Detecteur = (lignes: readonly LigneTable[], colonne: string) => ResultatSignal;

function meilleureColonne(
  nomsColonnes: readonly string[],
  lignes: readonly LigneTable[],
  detecteur: Detecteur,
  effectifMin = EFFECTIF_MIN_SIGNAL,
): ColonneRetenue | null {
  let meilleure: ColonneRetenue | null = null;
  for (const colonne of nomsColonnes) {
    const { taux, effectif } = detecteur(lignes, colonne);
    if (effectif < effectifMin) continue;
    if (!meilleure || taux > meilleure.taux) meilleure = { colonne, taux, effectif };
  }
  return meilleure;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function signal(colonne: ColonneRetenue, motif: string, raison: string): SignalColonne {
  return { colonne: colonne.colonne, motif, confiance: colonne.taux, raison };
}

function pct(taux: number): number {
  return Math.round(taux * 100);
}

interface Score {
  score: number;
  signaux: SignalColonne[];
}

function evaluerVehicule(noms: readonly string[], lignes: readonly LigneTable[]): Score {
  const chassis = meilleureColonne(noms, lignes, signalChassis);
  const plaque = meilleureColonne(noms, lignes, signalPlaqueSuisse);
  const signaux: SignalColonne[] = [];
  let score = 0;
  if (chassis && chassis.taux >= 0.4) {
    score += 0.75 * chassis.taux;
    signaux.push(
      signal(
        chassis,
        'chassis_vin',
        `${pct(chassis.taux)}% des ${chassis.effectif} valeurs non vides de "${chassis.colonne}" ressemblent à un châssis VIN (17 caractères, alphabet valide).`,
      ),
    );
  }
  if (plaque && plaque.taux >= 0.4) {
    score += 0.35 * plaque.taux;
    signaux.push(
      signal(
        plaque,
        'plaque_suisse',
        `${pct(plaque.taux)}% des ${plaque.effectif} valeurs de "${plaque.colonne}" ressemblent à une plaque d'immatriculation suisse.`,
      ),
    );
  }
  return { score: clamp01(score), signaux };
}

function evaluerPersonne(noms: readonly string[], lignes: readonly LigneTable[]): Score {
  const email = meilleureColonne(noms, lignes, signalEmail);
  const npa = meilleureColonne(noms, lignes, signalNpaSuisse);
  const chassis = meilleureColonne(noms, lignes, signalChassis);
  const signaux: SignalColonne[] = [];
  let score = 0;
  if (email && email.taux >= 0.25) {
    score += 0.5 * email.taux;
    signaux.push(
      signal(
        email,
        'email',
        `${pct(email.taux)}% des ${email.effectif} valeurs de "${email.colonne}" ressemblent à une adresse courriel.`,
      ),
    );
  }
  if (npa && npa.taux >= 0.25) {
    score += 0.4 * npa.taux;
    signaux.push(
      signal(
        npa,
        'npa_suisse',
        `${pct(npa.taux)}% des ${npa.effectif} valeurs de "${npa.colonne}" ressemblent à un NPA suisse (4 chiffres).`,
      ),
    );
  }
  if (chassis && chassis.taux >= 0.4) {
    score -= 0.4; // signal fort qu'il s'agit d'une table véhicule, pas d'une table de personnes
  }
  return { score: clamp01(score), signaux };
}

function evaluerArticle(noms: readonly string[], lignes: readonly LigneTable[]): Score {
  const montant = meilleureColonne(noms, lignes, signalMontant);
  const identifiant = meilleureColonne(noms, lignes, signalIdentifiant);
  const designation = meilleureColonne(noms, lignes, signalTexteLibre);
  const email = meilleureColonne(noms, lignes, signalEmail);
  const signaux: SignalColonne[] = [];
  let score = 0;
  if (montant && montant.taux >= 0.6) {
    score += 0.4 * montant.taux;
    signaux.push(
      signal(
        montant,
        'montant',
        `${pct(montant.taux)}% des ${montant.effectif} valeurs numériques de "${montant.colonne}" ont une précision centimes plausible pour un prix.`,
      ),
    );
  }
  if (designation && designation.taux >= 0.3) {
    score += 0.2 * designation.taux;
    signaux.push(
      signal(
        designation,
        'texte_libre',
        `"${designation.colonne}" porte du texte libre assez long, plausible comme désignation.`,
      ),
    );
  }
  // L'identifiant (quasi toutes valeurs distinctes) est un signal d'appoint, jamais suffisant
  // seul : presque toute table a une colonne clé, ça ne dit rien de son rôle métier.
  if (score > 0 && identifiant && identifiant.taux >= 0.85) {
    score += 0.25 * identifiant.taux;
    signaux.push(
      signal(
        identifiant,
        'identifiant',
        `"${identifiant.colonne}" a des valeurs quasi toutes distinctes (${pct(identifiant.taux)}%), plausible comme code article.`,
      ),
    );
  }
  if (email && email.taux >= 0.3) score -= 0.3; // signal client, pas article
  return { score: clamp01(score), signaux };
}

function evaluerDocument(
  role: 'document_vente' | 'ordre_reparation',
  noms: readonly string[],
  lignes: readonly LigneTable[],
): Score {
  const date = meilleureColonne(noms, lignes, signalDatePlausible);
  const montant = meilleureColonne(noms, lignes, signalMontant);
  const chassis = meilleureColonne(noms, lignes, signalChassis);
  const plaque = meilleureColonne(noms, lignes, signalPlaqueSuisse);
  const signaux: SignalColonne[] = [];
  let score = 0;
  if (date && date.taux >= 0.6) {
    score += 0.3 * date.taux;
    signaux.push(
      signal(
        date,
        'date_plausible',
        `"${date.colonne}" porte des dates dans une plage plausible (${pct(date.taux)}%).`,
      ),
    );
  }
  if (montant && montant.taux >= 0.5) {
    score += 0.35 * montant.taux;
    signaux.push(
      signal(
        montant,
        'montant',
        `"${montant.colonne}" a une précision centimes plausible pour un total facturé.`,
      ),
    );
  }
  // Combinaison distinctive, pas juste la somme des deux signaux isolés : une date ET un montant
  // plausibles À LA FOIS sur la même table forment un en-tête de document (date d'émission +
  // total), une combinaison qu'une table d'articles/stock n'a normalement pas (un article a un
  // prix mais pas de date propre). Sans ce bonus, une table pauvre en colonnes (typiquement une
  // facture réduite à identifiant/référence client/date/montant) perdait face à `evaluerArticle`,
  // qui dispose lui d'un bonus "identifiant" sans équivalent ici — mesuré : 0.65 contre 0.76.
  if (date && date.taux >= 0.6 && montant && montant.taux >= 0.5) {
    const bonus = 0.15 * Math.min(date.taux, montant.taux);
    score += bonus;
    signaux.push(
      signal(
        date,
        'entete_document',
        `date ("${date.colonne}") et montant ("${montant.colonne}") plausibles ensemble : combinaison typique d'un en-tête de document, absente d'une table d'articles.`,
      ),
    );
  }
  const chassisFort = chassis !== null && chassis.taux >= 0.3;
  const plaqueFort = plaque !== null && plaque.taux >= 0.3;
  const aUnLienVehicule = chassisFort || plaqueFort;
  // Différenciateur faible, documenté comme tel : un en-tête qui référence directement un
  // véhicule (châssis/plaque en colonne) penche "ordre de réparation" ; sinon "document de
  // vente". La distinction fine et fiable vient du rapprochement inter-tables (cf. liens.ts),
  // hors de portée d'une évaluation par table isolée.
  const correspondAuRole = aUnLienVehicule === (role === 'ordre_reparation');
  if (!correspondAuRole) score *= 0.6;
  if (aUnLienVehicule) {
    const col = (chassis?.taux ?? 0) >= (plaque?.taux ?? 0) ? chassis : plaque;
    if (col)
      signaux.push(
        signal(
          col,
          'reference_vehicule',
          `"${col.colonne}" référence probablement un véhicule (indice faible, à confirmer par appariement inter-tables).`,
        ),
      );
  }
  return { score: clamp01(score), signaux };
}

function evaluerLigneDocument(
  role: 'ligne_document_vente' | 'ligne_ordre_reparation',
  noms: readonly string[],
  lignes: readonly LigneTable[],
): Score {
  const montant = meilleureColonne(noms, lignes, signalMontant);
  const designation = meilleureColonne(noms, lignes, signalTexteLibre);
  const date = meilleureColonne(noms, lignes, signalDatePlausible);
  const email = meilleureColonne(noms, lignes, signalEmail);
  const signaux: SignalColonne[] = [];
  let score = 0;
  // Signal de base seulement : une table de lignes se reconnaît surtout à un rapport de
  // cardinalité avec sa table d'en-tête (bien supérieur), signal inter-tables porté par
  // `detecterLiens`, pas par cette évaluation par table isolée.
  if (montant && montant.taux >= 0.5) {
    score += 0.35 * montant.taux;
    signaux.push(
      signal(
        montant,
        'montant',
        `"${montant.colonne}" a une précision centimes plausible pour un montant de ligne.`,
      ),
    );
  }
  if (designation && designation.taux >= 0.3) {
    score += 0.15 * designation.taux;
    signaux.push(
      signal(
        designation,
        'texte_libre',
        `"${designation.colonne}" porte du texte libre, plausible comme désignation de ligne.`,
      ),
    );
  }
  if (date && date.taux >= 0.6) score -= 0.15; // une ligne porte rarement sa propre date, l'en-tête si
  if (email && email.taux >= 0.3) score -= 0.3;
  return { score: clamp01(score) * 0.7, signaux }; // plafonné : confiance faible sans le signal de cardinalité
}

function evaluerPaiement(noms: readonly string[], lignes: readonly LigneTable[]): Score {
  const montant = meilleureColonne(noms, lignes, signalMontant);
  const date = meilleureColonne(noms, lignes, signalDatePlausible);
  const mode = meilleureColonne(noms, lignes, signalEnumeration);
  const signaux: SignalColonne[] = [];
  let score = 0;
  if (montant && montant.taux >= 0.6) {
    score += 0.4 * montant.taux;
    signaux.push(
      signal(
        montant,
        'montant',
        `"${montant.colonne}" a une précision centimes plausible pour un montant encaissé.`,
      ),
    );
  }
  if (date && date.taux >= 0.6) {
    score += 0.25 * date.taux;
    signaux.push(signal(date, 'date_plausible', `"${date.colonne}" porte des dates plausibles.`));
  }
  if (mode && mode.taux >= 0.6) {
    score += 0.25 * mode.taux;
    signaux.push(
      signal(
        mode,
        'enumeration',
        `"${mode.colonne}" a peu de valeurs distinctes très répétées, plausible comme mode de paiement.`,
      ),
    );
  }
  return { score: clamp01(score), signaux };
}

function evaluerIndexDocumentaire(noms: readonly string[], lignes: readonly LigneTable[]): Score {
  const fichier = meilleureColonne(noms, lignes, signalNomFichier);
  const identifiant = meilleureColonne(noms, lignes, signalIdentifiant);
  const signaux: SignalColonne[] = [];
  let score = 0;
  if (fichier && fichier.taux >= 0.4) {
    score += 0.7 * fichier.taux;
    signaux.push(
      signal(
        fichier,
        'nom_fichier',
        `${pct(fichier.taux)}% des ${fichier.effectif} valeurs de "${fichier.colonne}" ont une extension de document (pdf, jpg, tif...).`,
      ),
    );
  }
  // Signal d'appoint uniquement : une colonne identifiant ne signifie rien sans le signal
  // "nom de fichier" qui porte, seul, la preuve d'un index documentaire.
  if (score > 0 && identifiant && identifiant.taux >= 0.85) {
    score += 0.15 * identifiant.taux;
  }
  return { score: clamp01(score), signaux };
}

function evaluerReferentielConstructeur(
  noms: readonly string[],
  lignes: readonly LigneTable[],
  scoresAutres: number[],
): Score {
  const identifiant = meilleureColonne(noms, lignes, signalIdentifiant);
  const signaux: SignalColonne[] = [];
  const volumineuse = lignes.length >= NB_LIGNES_VOLUMINEUSE;
  const aucunAutreSignalFort = scoresAutres.every((s) => s < 0.3);
  let score = 0;
  if (volumineuse && aucunAutreSignalFort && identifiant && identifiant.taux >= 0.5) {
    // Indice faible et documenté comme tel : le signal décisif mesuré en pratique (gros fichier
    // au nom du produit, sans aucune donnée du garage) est l'ABSENCE d'appariement de clé contre
    // les autres tables de l'archive — un constat inter-tables porté par `detecterLiens`, hors de
    // portée d'une évaluation par table isolée. Ceci n'est qu'un indice de présomption.
    score = 0.35;
    signaux.push(
      signal(
        identifiant,
        'grande_table_sans_signal_metier',
        `Table volumineuse (${lignes.length}+ lignes échantillonnées) sans signal client/véhicule/document dominant : présomption de référentiel tiers, à confirmer par l'absence de lien inter-tables.`,
      ),
    );
  }
  return { score, signaux };
}

/**
 * Évalue chaque rôle métier candidat pour une table, à partir d'un échantillon de lignes déjà
 * lues (jamais du nom de la table). Rend les évaluations triées, la plus probable en tête.
 *
 * Garde absolue en tête de fonction : une table sans ligne active reçoit `inconnu` à confiance 0,
 * quel que soit son nom ou son schéma — jamais mappée par erreur sur la foi d'un nom métier.
 */
export function evaluerRoleTable(params: {
  table: string;
  nomsColonnes: readonly string[];
  lignesActives: readonly LigneTable[];
  lignesSupprimees?: number;
}): RapportTable {
  const { table, nomsColonnes, lignesActives } = params;
  const lignesSupprimees = params.lignesSupprimees ?? 0;

  if (lignesActives.length === 0) {
    return {
      table,
      lignesActives: 0,
      lignesSupprimees,
      evaluations: [
        {
          role: 'inconnu',
          confiance: 0,
          raison:
            'table vide (0 ligne active dans cet échantillon) : jamais mappée sur la foi de son nom.',
          signaux: [],
        },
      ],
    };
  }

  const vehicule = evaluerVehicule(nomsColonnes, lignesActives);
  const client = evaluerPersonne(nomsColonnes, lignesActives);
  const article = evaluerArticle(nomsColonnes, lignesActives);
  const documentVente = evaluerDocument('document_vente', nomsColonnes, lignesActives);
  const ordreReparation = evaluerDocument('ordre_reparation', nomsColonnes, lignesActives);
  const ligneDocumentVente = evaluerLigneDocument(
    'ligne_document_vente',
    nomsColonnes,
    lignesActives,
  );
  const ligneOrdreReparation = evaluerLigneDocument(
    'ligne_ordre_reparation',
    nomsColonnes,
    lignesActives,
  );
  const paiement = evaluerPaiement(nomsColonnes, lignesActives);
  const indexDocumentaire = evaluerIndexDocumentaire(nomsColonnes, lignesActives);

  // fournisseur : mêmes signaux qu'un client (adresse/contact), la désambiguïsation par taille
  // relative se fait à un niveau supérieur (comparaison entre plusieurs tables candidates) —
  // ici, confiance systématiquement réduite pour ne jamais l'emporter sur "client" à signaux égaux.
  const fournisseurBrut = evaluerPersonne(nomsColonnes, lignesActives);
  const fournisseur: Score = {
    score: fournisseurBrut.score * 0.7,
    signaux: fournisseurBrut.signaux,
  };

  const referentielConstructeur = evaluerReferentielConstructeur(nomsColonnes, lignesActives, [
    vehicule.score,
    client.score,
    article.score,
    documentVente.score,
    ordreReparation.score,
    paiement.score,
  ]);

  const candidats: { role: RoleMetier; resultat: Score }[] = [
    { role: 'vehicule', resultat: vehicule },
    { role: 'client', resultat: client },
    { role: 'fournisseur', resultat: fournisseur },
    { role: 'article', resultat: article },
    { role: 'document_vente', resultat: documentVente },
    { role: 'ordre_reparation', resultat: ordreReparation },
    { role: 'ligne_document_vente', resultat: ligneDocumentVente },
    { role: 'ligne_ordre_reparation', resultat: ligneOrdreReparation },
    { role: 'paiement', resultat: paiement },
    { role: 'index_documentaire', resultat: indexDocumentaire },
    { role: 'referentiel_constructeur', resultat: referentielConstructeur },
  ];

  const evaluations: EvaluationRole[] = candidats
    .filter((c) => c.resultat.score >= SEUIL_CONFIANCE_MIN)
    .map((c) => ({
      role: c.role,
      confiance: c.resultat.score,
      raison: composerRaison(c.role, c.resultat),
      signaux: c.resultat.signaux,
    }))
    .sort((a, b) => b.confiance - a.confiance);

  if (evaluations.length === 0) {
    evaluations.push({
      role: 'inconnu',
      confiance: 1 - Math.max(0, ...candidats.map((c) => c.resultat.score)),
      raison: `aucun signal de contenu suffisant sur les ${nomsColonnes.length} colonnes examinées (${lignesActives.length} lignes actives échantillonnées) pour retenir un rôle métier.`,
      signaux: [],
    });
  }

  return { table, lignesActives: lignesActives.length, lignesSupprimees, evaluations };
}

function composerRaison(role: RoleMetier, resultat: Score): string {
  if (resultat.signaux.length === 0) {
    return `confiance ${pct(resultat.score)}% pour "${role}", sans signal de colonne individualisable au-dessus du seuil.`;
  }
  const detail = resultat.signaux.map((s) => s.raison).join(' ');
  return `confiance ${pct(resultat.score)}% pour "${role}" : ${detail}`;
}
