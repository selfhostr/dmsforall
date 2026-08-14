import type { MomentRendezVous } from '@dfa/shared';

/**
 * Amorce `ordre_reparation.restitution_promise_le` depuis l'estimation prise au téléphone
 * (`rendez_vous.duree_estimee_minutes`) — deuxième moitié du « cœur du chantier » avec
 * `restitution-retard.ts` : sans écrivain, la colonne reste vide indéfiniment (constat du brief).
 *
 * Doctrine reprise de `docs/conception-rendez-vous-donnees.md` §5 : le rendez-vous ne PROMET rien
 * formellement (au téléphone, le garagiste ESTIME) — ce calcul n'est qu'une PROPOSITION initiale,
 * appelée UNE SEULE FOIS à l'ouverture de l'OR (`rendezvous/service-rendez-vous.ts::arrivee`,
 * `atelier/service-transitions.ts::receptionner`), jamais recalculée ensuite : passé ce point,
 * `restitutionPromiseLe` vit sa vie propre sur l'OR (RV-22, modifiable avec `motifReport`
 * obligatoire) — le rendez-vous n'est plus jamais relu pour ça.
 *
 * Fonction PURE, sans accès base : reçoit les quatre champs du rendez-vous nécessaires, rend
 * l'instant de restitution proposé.
 *
 * SIMPLIFICATION SIGNALÉE (fuseau horaire) : `dateLe`/`heureSouhaitee` sont l'heure LOCALE saisie
 * au comptoir (Suisse, CET/CEST) mais traitée ici comme un horodatage UTC direct — aucune table de
 * ce dépôt ne porte le fuseau d'un site à ce jour (`parametre_site.heure_ouverture` est un `time`
 * nu, sans zone), et aucun utilitaire de conversion CET/CEST n'existe encore ailleurs dans le code
 * exploré. Une estimation à ±1h/2h (heure d'été) reste un ordre de grandeur correct pour un
 * indicateur « avertir, jamais bloquer » — mais ce n'est PAS une garantie d'exactitude à la minute.
 * À corriger le jour où un fuseau par site existe.
 */
export interface DonneesAmorcageRestitution {
  /** `AAAA-MM-JJ`. */
  readonly dateLe: string;
  readonly moment: MomentRendezVous;
  /** `HH:MM` ou `HH:MM:SS`, `null` si non fixée. */
  readonly heureSouhaitee: string | null;
  readonly dureeEstimeeMinutes: number;
}

/** Heure de fin conventionnelle d'un moment sans heure fixée — matin/après-midi bornés à la
 *  journée de travail usuelle d'un garage suisse ; `toute_journee` retient la fin d'après-midi. */
const HEURE_FIN_PAR_MOMENT: Readonly<Record<MomentRendezVous, string>> = {
  matin: '12:00',
  apres_midi: '18:00',
  toute_journee: '18:00',
};

export function calculerRestitutionAmorcee(donnees: DonneesAmorcageRestitution): Date {
  const heureBase = (donnees.heureSouhaitee ?? HEURE_FIN_PAR_MOMENT[donnees.moment]).slice(0, 5);
  const debut = new Date(`${donnees.dateLe}T${heureBase}:00.000Z`);
  if (Number.isNaN(debut.getTime())) {
    throw new Error(
      `calculerRestitutionAmorcee : dateLe="${donnees.dateLe}" / heureBase="${heureBase}" ne forment pas un horodatage valide.`,
    );
  }
  return new Date(debut.getTime() + donnees.dureeEstimeeMinutes * 60_000);
}
