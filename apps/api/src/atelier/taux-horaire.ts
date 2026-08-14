import { eq } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import { tauxHoraire, type LigneTauxHoraire } from '../db/schema';

/**
 * Code du taux horaire STANDARD du garage dans `taux_horaire` — celui qui s'applique à un client
 * qui n'a négocié aucun tarif particulier (RM-07 : le taux client est « éventuel »). C'est la
 * convention déjà en place dans le référentiel de démonstration (`db/seed/seed-dev.ts`, dont les
 * prestations pointent toutes sur ce code).
 *
 * CONVENTION, PAS ENCORE UN PARAMÈTRE : `parametre_atelier` ne porte aucune colonne désignant le
 * taux par défaut du tenant. Un garage qui nomme son taux autrement est rattrapé par le 3ᵉ cran de
 * la cascade (`resoudreTauxHorairePourDate`) tant qu'il n'en pratique qu'un seul ; au-delà, il doit
 * nommer `ATELIER` celui qui sert de référence. Le vrai correctif —
 * `parametre_atelier.taux_horaire_defaut_code` (migration + schéma Drizzle) — reste HORS périmètre.
 *
 * Historiquement défini dans `service-ligne-or.ts` (RM-65) ; déplacé ici (#72) pour que la
 * résolution devienne UN SEUL mécanisme partagé par la facturation d'un OR ET par l'affichage des
 * conditions commerciales d'un client — `service-ligne-or.ts` le réexporte pour ne pas casser les
 * imports existants (`service-ligne-or.spec.ts` notamment).
 */
export const CODE_TAUX_HORAIRE_DEFAUT = 'ATELIER';

/**
 * Résultat de la résolution RM-65. L'échec porte SON MOTIF : « le taux négocié du client a expiré »
 * et « le garage n'a pas de taux standard » appellent deux gestes de correction différents. Porte
 * aussi `libelle` (#72) — `centimes` seul ne permet pas d'afficher un nom lisible à l'écran.
 */
export type ResolutionTauxHoraire =
  | { readonly code: string; readonly libelle: string; readonly centimes: number }
  | {
      readonly code: null;
      readonly libelle: null;
      readonly centimes: null;
      readonly motif: string;
    };

/**
 * Charge TOUTES les lignes `taux_horaire` du tenant en UN SEUL aller-retour (table « une poignée de
 * lignes par tenant », même doctrine que `references.ts` pour `parametre_atelier` : pas de jeton
 * pour une lecture de table). À appeler UNE FOIS par requête — jamais une fois par ligne d'OR ni
 * une fois par condition commerciale affichée — puis à combiner avec `resoudreTauxHorairePourDate`
 * (pure, sans accès base) pour chaque résolution nécessaire.
 */
export async function chargerToutesTauxHoraire(
  tx: TransactionDfa,
  ctx: ContexteTenant,
): Promise<readonly LigneTauxHoraire[]> {
  return tx.select().from(tauxHoraire).where(eq(tauxHoraire.tenantId, ctx.tenantId));
}

/**
 * Résolution PURE (aucun accès base) de la cascade RM-65 :
 *  1. le taux NÉGOCIÉ du client (`codeClient`), s'il en a un et qu'il couvre `dateReference` ;
 *  2. à défaut, le taux STANDARD du garage (`CODE_TAUX_HORAIRE_DEFAUT`) ;
 *  3. à défaut, l'UNIQUE taux en vigueur du référentiel, si le garage n'en pratique qu'un seul.
 *
 * `dateReference` est un paramètre EXPLICITE plutôt que « aujourd'hui » en dur (comme c'était le
 * cas avant #72) : la facturation d'un OR résout au jour de la lecture, mais l'affichage d'une
 * condition commerciale datée (RM-07) doit résoudre à SA date `valideDuLe` — un taux modifié après
 * coup dans le référentiel ne doit pas réécrire l'historique d'une condition déjà en vigueur.
 *
 * Borne haute EXCLUSIVE — alignée sur la contrainte `EXCLUDE ... daterange(valide_du, valide_au,
 * '[)')` de `taux_horaire` (migration 0005_parametrage.sql) : voir `service-ligne-or.spec.ts` pour
 * le test qui rejoue la séquence de bascule qui a un jour fait dépendre le taux facturé de l'ordre
 * de retour (non garanti) de PostgreSQL.
 *
 * Tri décroissant sur `valideDu`, ceinture et bretelles : l'EXCLUDE garantit qu'au plus UNE période
 * d'un même `code` peut être en vigueur à une date donnée, mais un filtre qui PEUT rendre plusieurs
 * lignes ne doit jamais dépendre d'un ordre non garanti. La période la plus RÉCEMMENT valide gagne
 * en cas d'ambiguïté résiduelle : un tarif fraîchement saisi prime sur un résidu historique mal
 * clôturé.
 */
export function resoudreTauxHorairePourDate(
  lignes: readonly LigneTauxHoraire[],
  codeClient: string | null,
  dateReference: string,
): ResolutionTauxHoraire {
  const enVigueur = [...lignes]
    .sort((a, b) => b.valideDu.localeCompare(a.valideDu))
    .filter(
      (l) => l.valideDu <= dateReference && (l.valideAu === null || l.valideAu > dateReference),
    );

  if (codeClient) {
    const negocie = enVigueur.find((l) => l.code === codeClient);
    return negocie
      ? { code: negocie.code, libelle: negocie.libelle, centimes: negocie.montantCentimes }
      : {
          code: null,
          libelle: null,
          centimes: null,
          motif:
            `Le taux horaire « ${codeClient} » convenu avec ce client (RM-07, figé à ` +
            `l'ouverture de l'OR) n'a aucune période de validité couvrant le ${dateReference}.`,
        };
  }

  const standard = enVigueur.find((l) => l.code === CODE_TAUX_HORAIRE_DEFAUT);
  if (standard) {
    return { code: standard.code, libelle: standard.libelle, centimes: standard.montantCentimes };
  }

  const codesEnVigueur = new Set(enVigueur.map((l) => l.code));
  const unique = codesEnVigueur.size === 1 ? enVigueur[0] : undefined;
  if (unique)
    return { code: unique.code, libelle: unique.libelle, centimes: unique.montantCentimes };

  return {
    code: null,
    libelle: null,
    centimes: null,
    motif:
      `Aucun taux horaire standard : ce client n'a pas de taux négocié (RM-07) et le ` +
      `référentiel du garage ne porte ni le code « ${CODE_TAUX_HORAIRE_DEFAUT} » ni un taux ` +
      `unique en vigueur au ${dateReference}. Renseigner les taux horaires dans le paramétrage.`,
  };
}
