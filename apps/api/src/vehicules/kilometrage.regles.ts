import type { UniteDistance } from '@dfa/shared';

/**
 * Règles pures de RM-23/24/25 — sans I/O, testables à sec. La conversion mi→km est faite ICI,
 * côté serveur, avant toute comparaison (CT-08) : c'est ce qui rend impossible pour un client de
 * rejouer une arithmétique d'unité.
 *
 * `valeur_km` est en réalité une colonne GÉNÉRÉE en base (`round(valeur * 1.609344)::integer`,
 * voir `migrations/0007_vehicules.sql`) : cette fonction DOIT rester l'exacte réciproque de cette
 * expression SQL, sinon un relevé en mi comparerait un `valeurKm` applicatif différent de celui
 * persisté.
 */
const FACTEUR_MILE_VERS_KM = 1.609344;

/** Seuils RM-25 : écart total depuis le dernier relevé, ou écart moyen par jour. */
const ECART_ABERRANT_TOTAL_KM = 100_000;
const ECART_ABERRANT_PAR_JOUR_KM = 500;

const MILLISECONDES_PAR_JOUR = 24 * 60 * 60 * 1000;

export function convertirEnKm(valeur: number, unite: UniteDistance): number {
  return unite === 'mi' ? Math.round(valeur * FACTEUR_MILE_VERS_KM) : valeur;
}

export interface DernierKilometrageConnu {
  readonly valeurKm: number;
  readonly releveLe: Date;
}

export interface DecisionKilometrage {
  /** Le nouveau relevé (converti en km) est strictement inférieur au dernier connu. */
  readonly regressif: boolean;
  /** Écart jugé aberrant (RM-25) — non bloquant, jamais vrai en même temps que `regressif`. */
  readonly aberrant: boolean;
}

/**
 * Évalue un nouveau relevé (déjà converti en km, voir `convertirEnKm`) contre le dernier relevé
 * connu. `null` en l'absence de tout relevé antérieur : le premier relevé d'un véhicule n'est ni
 * régressif ni aberrant par construction.
 */
export function evaluerKilometrage(
  nouveauValeurKm: number,
  dernier: DernierKilometrageConnu | null,
  maintenant: Date,
): DecisionKilometrage {
  if (!dernier) {
    return { regressif: false, aberrant: false };
  }

  if (nouveauValeurKm < dernier.valeurKm) {
    return { regressif: true, aberrant: false };
  }

  const ecartKm = nouveauValeurKm - dernier.valeurKm;
  const ecoulementMs = Math.max(1, maintenant.getTime() - dernier.releveLe.getTime());
  const ecoulementJours = ecoulementMs / MILLISECONDES_PAR_JOUR;
  const ecartParJourKm = ecartKm / ecoulementJours;

  const aberrant = ecartKm > ECART_ABERRANT_TOTAL_KM || ecartParJourKm > ECART_ABERRANT_PAR_JOUR_KM;
  return { regressif: false, aberrant };
}
