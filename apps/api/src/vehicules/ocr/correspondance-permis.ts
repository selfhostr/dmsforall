/**
 * Correspondance des champs extraits (`extraction-permis.ts`) contre la base : le référentiel
 * ASTRA (`type_approbation_ch`), les véhicules et les clients DÉJÀ EXISTANTS du tenant courant.
 * Une correspondance trouvée VALIDE la lecture (le code type en particulier — voir en-tête de
 * tâche) ; elle ne crée jamais rien (décision @laupernoe : cet endpoint ne crée ni véhicule ni client).
 *
 * Formes de sortie alignées sur `CorrespondanceVehiculeExistant`/`CorrespondanceClientExistant`
 * (`@dfa/shared`, contrat convergé avec l'écran de scan) : EXACTES uniquement pour véhicule/client,
 * une correspondance au plus par entité (jamais une liste de candidats approximatifs) — la forme
 * de sortie ne change PAS pour le code type ASTRA (`CorrespondanceTypeApprobationBrute.trouve`
 * reste un booléen), mais `rechercherCorrespondanceTypeApprobationApprox` ci-dessous l'atteint
 * aussi par distance d'édition en repli de la recherche exacte — jamais un candidat approximatif
 * exposé tel quel, seulement un `trouve: true` une fois qu'il est le SEUL à cette distance.
 */
import { sql } from 'drizzle-orm';
import type { CorrespondanceClientExistant, CorrespondanceVehiculeExistant } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../../db';
import { detecterDoublons } from '../../clients/detection-doublons';
import { trouverVehiculeCollisionPlaque } from '../vehicule-requetes';
import type { PlaqueExtraite } from './extraction-permis';

type LigneTypeApprobationBrute = {
  readonly code_type_ch: string;
  readonly marque: string;
  readonly modele: string;
  readonly carburant_code: string | null;
};

/**
 * Sortie INTERNE (pas le contrat public) : ce que le référentiel ASTRA donne pour préremplir
 * `VehiculeScanne.marque`/`.modele` — jamais exposée telle quelle, `service-vehicule-ocr.ts` la
 * traduit en `ChampScanne<string>` (confiance `sure` seulement si `trouve`).
 */
export interface CorrespondanceTypeApprobationBrute {
  readonly trouve: boolean;
  readonly marque: string | null;
  readonly modele: string | null;
  readonly carburantCode: string | null;
}

const AUCUNE_CORRESPONDANCE_TYPE_APPROBATION: CorrespondanceTypeApprobationBrute = {
  trouve: false,
  marque: null,
  modele: null,
  carburantCode: null,
};

/**
 * Essaie chaque candidat DANS L'ORDRE (`extraction-permis.candidatsCodeType`, le plus probable en
 * premier) et s'arrête au premier trouvé dans `type_approbation_ch` — `normaliser_recherche` des
 * deux côtés, même doctrine que `service-referentiel-vehicules-ch.ts` (aucune similarité floue :
 * un code type est un identifiant technique, pas un nom commercial).
 */
export async function rechercherCorrespondanceTypeApprobation(
  tx: TransactionDfa,
  candidats: readonly string[],
): Promise<CorrespondanceTypeApprobationBrute> {
  for (const candidat of candidats) {
    const resultat = await tx.execute<LigneTypeApprobationBrute>(sql`
      select code_type_ch, marque, modele, carburant_code
        from public.type_approbation_ch
       where public.normaliser_recherche(code_type_ch) = public.normaliser_recherche(${candidat})
       limit 1
    `);
    const ligne = resultat.rows[0];
    if (ligne) {
      return {
        trouve: true,
        marque: ligne.marque,
        modele: ligne.modele,
        carburantCode: ligne.carburant_code,
      };
    }
  }
  return AUCUNE_CORRESPONDANCE_TYPE_APPROBATION;
}

// -------------------------------------------------------------------------------------------
// Recherche APPROXIMATIVE (distance d'édition) — seulement si la recherche EXACTE ci-dessus, sur
// TOUS les candidats de bordure (`candidatsCodeType`), n'a rien trouvé. Le bruit qui reste à ce
// stade est au niveau du CARACTÈRE (0/O, 1/I, 5/S… — mesure du calibrage précédent), pas de la
// bordure : une distance d'édition de 1-2 caractères contre les 216 819 lignes ASTRA.
// -------------------------------------------------------------------------------------------

/** Bornée à `max` : sort dès que la distance MINIMALE possible sur la ligne DP dépasse `max`, rend
 *  alors `max + 1` (jamais une vraie distance) — inutile de calculer plus loin, `max` est le seul
 *  seuil qui compte pour la décision d'acceptation. Coût négligeable ici (chaînes de quelques
 *  caractères, quelques dizaines de lignes par candidat après filtrage trigramme — v. plus bas). */
function distanceEditionBornee(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const courante = [i];
    let minLigne = courante[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      const valeur = Math.min(precedente[j]! + 1, courante[j - 1]! + 1, precedente[j - 1]! + cout);
      courante.push(valeur);
      if (valeur < minLigne) minLigne = valeur;
    }
    if (minLigne > max) return max + 1;
    precedente = courante;
  }
  return Math.min(precedente[b.length]!, max + 1);
}

/** Un code type ASTRA est retenu par distance d'édition jusqu'à cette valeur (consigne de tâche :
 *  « à un ou deux caractères près »). */
const DISTANCE_MAX_CODE_TYPE = 2;

/** Combien de candidats de `candidatsCodeType` (le plus probable en premier) sont essayés en
 *  approximatif — borne le coût (une requête Postgres par candidat essayé) sans exclure les
 *  variantes de bordure les plus plausibles, qui restent utiles ici : un candidat tronqué de 1-2
 *  caractères EN PLUS d'une confusion de caractère reste à distance d'édition <= 2 d'un code
 *  correct, un candidat brut non tronqué ne le serait pas forcément. */
const CANDIDATS_CODE_TYPE_ESSAYES_APPROX = 5;

/** Nombre de lignes ramenées PAR candidat essayé, triées par similarité trigramme décroissante —
 *  large marge au-dessus de ce qu'une distance d'édition <= 2 peut produire de voisins réels sur
 *  un code type court, sans ramener la table entière. */
const LIMITE_LIGNES_PAR_REQUETE_APPROX = 40;

interface MeilleureLigneApprox {
  readonly distance: number;
  readonly ligne: LigneTypeApprobationBrute;
}

/**
 * Recherche par distance d'édition contre `type_approbation_ch` (216 819 lignes) — PAS de scan
 * complet : le filtre trigramme `%` (`pg_trgm`, index GIN posé par la migration 0060) réduit
 * d'abord à quelques dizaines de lignes plausibles PAR candidat essayé, la distance d'édition
 * EXACTE n'est ensuite calculée qu'en mémoire sur ce petit lot (`distanceEditionBornee`) — le
 * trigramme est un filtre de PRÉ-SÉLECTION, jamais le critère de décision final (deux chaînes
 * courtes très différentes en édition peuvent avoir une similarité trigramme non nulle).
 *
 * Seuil de similarité abaissé à 0.2 (défaut Postgres : 0.3, `set local` — ne vit que la
 * transaction du scan) : un code type est court (5-8 caractères, peu de trigrammes), une seule
 * confusion de caractère y fait chuter la similarité sous le défaut plus vite que sur un texte
 * long — mesuré en exécution avant ce choix (rapport de livraison).
 *
 * DÉCISION : le gagnant à distance minimale doit être SEUL à cette distance, tous candidats
 * essayés confondus (jamais « le premier candidat essayé qui trouve un gagnant » — deux candidats
 * de bordure différents pourraient chacun pointer vers un code type distinct à distance égale,
 * c'est alors une ambiguïté RÉELLE, pas un artefact d'ordre d'essai). Zéro ou plusieurs gagnants
 * ex æquo -> non trouvé, même contrat que la recherche exacte.
 *
 * LIMITE MESURÉE SUR LE RÉFÉRENTIEL RÉEL (rapport de livraison, PAS un défaut de cette fonction) :
 * `type_approbation_ch` est DENSE — un même constructeur homologue souvent des dizaines de variantes
 * d'un même modèle sous des codes qui ne diffèrent que d'un ou deux caractères (moteur, boîte,
 * finition : ex. `1BB244`/`1BB344`, deux codes BMW réels). Sur un échantillon de 300 codes réels
 * pris au hasard, AUCUN n'était isolé à distance d'édition <= 2 de tout autre code du référentiel.
 * Conséquence directe : une confusion d'UN SEUL caractère sur un code type produit très souvent
 * PLUSIEURS candidats réels à distance égale (le vrai code ET une variante voisine authentique), pas
 * un gagnant unique — la garantie de sécurité (§ DÉCISION ci-dessus) s'applique alors et refuse de
 * choisir. Élargir ou réduire `DISTANCE_MAX_CODE_TYPE` ne change RIEN à cette limite structurelle
 * (les codes voisins mesurés le sont déjà à distance 1, pas seulement 2) : contrairement au VIN
 * (`extraction-permis.rechercherVin`, où l'ambiguïté vient d'une COÏNCIDENCE arithmétique rare sur
 * la clé de contrôle), ici l'ambiguïté vient de la DENSITÉ RÉELLE des données — un autre moteur de
 * correction (score de proximité pondéré par catégorie/marque déjà connue, par exemple) serait
 * nécessaire pour aller plus loin, pas un ajustement de seuil.
 */
export async function rechercherCorrespondanceTypeApprobationApprox(
  tx: TransactionDfa,
  candidats: readonly string[],
): Promise<CorrespondanceTypeApprobationBrute> {
  const essayes = candidats.slice(0, CANDIDATS_CODE_TYPE_ESSAYES_APPROX);
  if (essayes.length === 0) return AUCUNE_CORRESPONDANCE_TYPE_APPROBATION;

  await tx.execute(sql`set local pg_trgm.similarity_threshold = 0.2`);

  const meilleurParCode = new Map<string, MeilleureLigneApprox>();

  for (const candidat of essayes) {
    const resultat = await tx.execute<LigneTypeApprobationBrute>(sql`
      select code_type_ch, marque, modele, carburant_code
        from public.type_approbation_ch
       where public.normaliser_recherche(code_type_ch) % public.normaliser_recherche(${candidat})
       order by public.similarity(
                  public.normaliser_recherche(code_type_ch),
                  public.normaliser_recherche(${candidat})
                ) desc
       limit ${LIMITE_LIGNES_PAR_REQUETE_APPROX}
    `);

    for (const ligne of resultat.rows) {
      const distance = distanceEditionBornee(candidat, ligne.code_type_ch, DISTANCE_MAX_CODE_TYPE);
      if (distance > DISTANCE_MAX_CODE_TYPE) continue;
      const existant = meilleurParCode.get(ligne.code_type_ch);
      if (!existant || distance < existant.distance) {
        meilleurParCode.set(ligne.code_type_ch, { distance, ligne });
      }
    }
  }

  if (meilleurParCode.size === 0) return AUCUNE_CORRESPONDANCE_TYPE_APPROBATION;

  const distanceMinimale = Math.min(...[...meilleurParCode.values()].map((v) => v.distance));
  const gagnants = [...meilleurParCode.values()].filter((v) => v.distance === distanceMinimale);
  if (gagnants.length !== 1) return AUCUNE_CORRESPONDANCE_TYPE_APPROBATION;

  const { ligne } = gagnants[0]!;
  return {
    trouve: true,
    marque: ligne.marque,
    modele: ligne.modele,
    carburantCode: ligne.carburant_code,
  };
}

/**
 * Point d'entrée unique côté service (`service-vehicule-ocr.ts`) : exact d'abord (rapide, le cas
 * le plus fréquent une fois le bruit de bordure calibré), approximatif seulement en repli — jamais
 * l'inverse, une correspondance exacte ne doit jamais être court-circuitée par une recherche floue.
 */
export async function rechercherCorrespondanceTypeApprobationComplete(
  tx: TransactionDfa,
  candidats: readonly string[],
): Promise<CorrespondanceTypeApprobationBrute> {
  const exact = await rechercherCorrespondanceTypeApprobation(tx, candidats);
  if (exact.trouve) return exact;
  return rechercherCorrespondanceTypeApprobationApprox(tx, candidats);
}

type LigneVehiculeParVinBrute = {
  readonly id: string;
  readonly marque: string;
  readonly modele: string;
};

function libelleVehicule(marque: string, modele: string): string {
  return `${marque} ${modele}`.trim();
}

/** VIN exact (17 caractères, déjà validé structurellement par `extraction-permis.rechercherVin`
 *  avant appel) — jamais de correspondance partielle sur un VIN, l'identifiant est complet ou il
 *  ne sert à rien. */
async function rechercherVehiculeParVin(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vin: string,
): Promise<CorrespondanceVehiculeExistant | null> {
  const resultat = await tx.execute<LigneVehiculeParVinBrute>(sql`
    select id, marque, modele
      from public.vehicule
     where tenant_id = ${ctx.tenantId}
       and vin is not null
       and upper(vin) = upper(${vin})
     limit 1
  `);
  const ligne = resultat.rows[0];
  return ligne ? { id: ligne.id, libelle: libelleVehicule(ligne.marque, ligne.modele) } : null;
}

/**
 * VIN d'abord (identifiant le plus fiable une fois sa clé de contrôle validée), plaque en repli
 * — réutilise `trouverVehiculeCollisionPlaque` (`vehicule-requetes.ts`, déjà éprouvée à la
 * création d'une fiche) plutôt que d'écrire une seconde requête de correspondance de plaque.
 */
export async function rechercherCorrespondanceVehicule(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  criteres: { readonly vin: string | null; readonly plaque: PlaqueExtraite | null },
): Promise<CorrespondanceVehiculeExistant | null> {
  if (criteres.vin) {
    const parVin = await rechercherVehiculeParVin(tx, ctx, criteres.vin);
    if (parVin) return parVin;
  }

  if (criteres.plaque) {
    const valeurPlaque = `${criteres.plaque.canton} ${criteres.plaque.numero}`;
    const collision = await trouverVehiculeCollisionPlaque(tx, ctx, {
      valeur: valeurPlaque,
      debutLe: new Date().toISOString().slice(0, 10),
    });
    if (collision) {
      return {
        id: collision.vehiculeId,
        libelle: libelleVehicule(collision.marque, collision.modele),
      };
    }
  }

  return null;
}

/**
 * Nom + NPA lus contre les clients du tenant — réutilise TEL QUEL `detecterDoublons`
 * (`clients/detection-doublons.ts`) : égalité normalisée, jamais de similarité floue (un faux
 * positif collerait le scan d'un inconnu sur la fiche d'un client existant). `npa` absent = le
 * seul critère exploitable ici (`nom_npa`) ne s'active pas, rend `null` — comportement hérité de
 * `detecterDoublons`, pas un bug de ce module. Le score le plus élevé gagne quand plusieurs
 * critères matchent (hérité de `detecterDoublons` — n'arrive jamais ici puisqu'un seul critère,
 * `nom_npa`, est exploitable depuis un permis de circulation).
 */
export async function rechercherCorrespondanceClient(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  criteres: { readonly nomComplet: string | null; readonly npa: string | null },
): Promise<CorrespondanceClientExistant | null> {
  if (!criteres.nomComplet || !criteres.npa) return null;

  const candidats = await detecterDoublons(tx, ctx.tenantId, {
    nomComplet: criteres.nomComplet,
    npa: criteres.npa,
  });

  const meilleur = candidats[0];
  return meilleur ? { id: meilleur.clientId, nomAffiche: meilleur.nom } : null;
}
