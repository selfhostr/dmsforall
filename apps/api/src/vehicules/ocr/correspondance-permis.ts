/**
 * Correspondance des champs extraits (`extraction-permis.ts`) contre la base : le référentiel
 * ASTRA (`type_approbation_ch`), les véhicules et les clients DÉJÀ EXISTANTS du tenant courant.
 * Une correspondance trouvée VALIDE la lecture (le code type en particulier — voir en-tête de
 * tâche) ; elle ne crée jamais rien (décision @laupernoe : cet endpoint ne crée ni véhicule ni client).
 *
 * Formes de sortie alignées sur `CorrespondanceVehiculeExistant`/`CorrespondanceClientExistant`
 * (`@dfa/shared`, contrat convergé avec l'écran de scan) : EXACTES uniquement, une correspondance
 * au plus par entité (jamais une liste de candidats approximatifs).
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

type LigneVehiculeParVinBrute = {
  readonly id: string;
  readonly marque: string;
  readonly modele: string;
};

function libelleVehicule(marque: string, modele: string): string {
  return `${marque} ${modele}`.trim();
}

/** VIN exact (17 caractères, déjà validé structurellement par `extraction-permis.extraireVin`
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
