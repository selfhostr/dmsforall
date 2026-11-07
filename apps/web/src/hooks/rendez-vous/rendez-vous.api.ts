import type {
  EntreeActionAbsenceRendezVous,
  EntreeActionAnnulerRendezVous,
  EntreeActionArriveeRendezVous,
  EntreeCreationRendezVous,
  EntreeModificationRendezVous,
  PageCurseur,
  ReponseCapaciteRendezVous,
  ReponseMotifRendezVous,
  ReponseRendezVous,
  ReponseRendezVousAvecAvertissements,
  ResumeSiteRendezVous,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du domaine rendez-vous — même convention que `hooks/atelier/ordres-reparation.api.ts` :
 * les types consommés sont ceux de `@dfa/shared` (contrat gelé), jamais ceux de `api/types.gen.ts`.
 * Les filtres sont sérialisés à la main en `URLSearchParams` (l'endpoint `GET /rendez-vous` ne
 * documente pas ses query params dans le Swagger généré, comme la plupart des listes de ce dépôt).
 */

export interface FiltresPeriodeRendezVous {
  readonly du: string;
  readonly au: string;
  readonly siteId: string;
}

function construireParametresPeriode(filtres: FiltresPeriodeRendezVous): string {
  const parametres = new URLSearchParams();
  parametres.set('du', filtres.du);
  parametres.set('au', filtres.au);
  parametres.set('siteId', filtres.siteId);
  return parametres.toString();
}

/** `GET /rendez-vous?du=&au=&siteId=` — les rendez-vous de la période, pour un site. Un agenda
 *  reste TOUJOURS scopé à un seul site (RV-06 : la capacité se calcule site par site, jamais
 *  agrégée tenant) — `siteId` n'est donc jamais omis ici, contrairement à d'autres listes. */
export async function listerRendezVous(
  filtres: FiltresPeriodeRendezVous,
): Promise<PageCurseur<ReponseRendezVous>> {
  const page = await requeteApi<PageCurseur<ReponseRendezVous>>(
    `/rendez-vous?${construireParametresPeriode(filtres)}`,
    { method: 'GET' },
  );
  return page ?? { donnees: [], curseurSuivant: null, limite: 0 };
}

/** `GET /rendez-vous/{id}` — fiche complète. */
export async function obtenirRendezVous(id: string): Promise<ReponseRendezVous> {
  const rendezVous = await requeteApi<ReponseRendezVous>(`/rendez-vous/${id}`, { method: 'GET' });
  if (!rendezVous) {
    throw new Error(`Réponse vide inattendue : GET /rendez-vous/${id}.`);
  }
  return rendezVous;
}

/** `GET /rendez-vous/capacite?du=&au=&siteId=` — capacité par jour et par moment. `siteId` est
 *  OBLIGATOIRE ici, comme pour `listerRendezVous`. */
export async function capaciteRendezVous(
  filtres: FiltresPeriodeRendezVous,
): Promise<ReponseCapaciteRendezVous> {
  const capacite = await requeteApi<ReponseCapaciteRendezVous>(
    `/rendez-vous/capacite?${construireParametresPeriode(filtres)}`,
    { method: 'GET' },
  );
  return capacite ?? { siteId: filtres.siteId, jours: [] };
}

/** `GET /motifs-rendez-vous` — catalogue des motifs, avec durée par défaut (RV-01/RV-02).
 *  `actifs: true` : seulement les motifs proposables à la prise de rendez-vous (filtre serveur) ;
 *  absent : tous, actifs et inactifs (l'écran de paramétrage réactive les inactifs). */
export async function listerMotifsRendezVous(
  filtres: { readonly actifs?: boolean } = {},
): Promise<readonly ReponseMotifRendezVous[]> {
  const requete = filtres.actifs === undefined ? '' : `?actifs=${String(filtres.actifs)}`;
  const motifs = await requeteApi<ReponseMotifRendezVous[]>(`/motifs-rendez-vous${requete}`, {
    method: 'GET',
  });
  return motifs ?? [];
}

/** `GET /rendez-vous/resume-sites?du&au` — rendez-vous non annulés par site, tous sites en un appel. */
export async function resumerRendezVousParSite(
  du: string,
  au: string,
): Promise<readonly ResumeSiteRendezVous[]> {
  const resume = await requeteApi<ResumeSiteRendezVous[]>(
    `/rendez-vous/resume-sites?du=${encodeURIComponent(du)}&au=${encodeURIComponent(au)}`,
    { method: 'GET' },
  );
  return resume ?? [];
}

/** `POST /rendez-vous` — `Idempotency-Key` OBLIGATOIRE (choix produit #2 : motif obligatoire, un
 *  rejeu ne doit jamais créer deux rendez-vous). Le surbooking (`PLANNING_CAPACITE_DEPASSEE`)
 *  n'entre JAMAIS dans le protocole de confirmation (RV-06, choix produit #1 : avertir, jamais
 *  bloquer) — il n'apparaît, s'il apparaît, que dans `avertissements[]` de la réponse. */
export async function creerRendezVous(
  entree: EntreeCreationRendezVous,
  idempotencyKey: string,
): Promise<ReponseRendezVousAvecAvertissements> {
  const reponse = await requeteApi<ReponseRendezVousAvecAvertissements>('/rendez-vous', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /rendez-vous.');
  }
  return reponse;
}

/** `PATCH /rendez-vous/{id}` — déplace ou corrige un rendez-vous encore `confirme` (RV-16, jamais
 *  un changement de statut). */
export async function modifierRendezVous(
  id: string,
  entree: EntreeModificationRendezVous,
): Promise<ReponseRendezVous> {
  const reponse = await requeteApi<ReponseRendezVous>(`/rendez-vous/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : PATCH /rendez-vous/${id}.`);
  }
  return reponse;
}

/** `POST /rendez-vous/{id}/absence` — constat manuel, sans motif (RV-24). */
export async function absenceRendezVous(
  id: string,
  entree: EntreeActionAbsenceRendezVous,
): Promise<ReponseRendezVous> {
  const reponse = await requeteApi<ReponseRendezVous>(`/rendez-vous/${id}/absence`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST /rendez-vous/${id}/absence.`);
  }
  return reponse;
}

/** `POST /rendez-vous/{id}/annuler` — motif OBLIGATOIRE, jamais silencieuse. */
export async function annulerRendezVous(
  id: string,
  entree: EntreeActionAnnulerRendezVous,
): Promise<ReponseRendezVous> {
  const reponse = await requeteApi<ReponseRendezVous>(`/rendez-vous/${id}/annuler`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST /rendez-vous/${id}/annuler.`);
  }
  return reponse;
}

/** `POST /rendez-vous/{id}/arrivee` — `Idempotency-Key` OBLIGATOIRE : crée (ou réceptionne) l'OR
 *  lié, amorce `restitutionPromiseLe` depuis la durée estimée du rendez-vous (le cœur du chantier,
 *  voir le rapport de livraison). `honore` n'est JAMAIS déclaré autrement (RV-18). */
export async function arriveeRendezVous(
  id: string,
  entree: EntreeActionArriveeRendezVous,
  idempotencyKey: string,
): Promise<ReponseRendezVousAvecAvertissements> {
  const reponse = await requeteApi<ReponseRendezVousAvecAvertissements>(
    `/rendez-vous/${id}/arrivee`,
    { method: 'POST', body: JSON.stringify(entree), idempotencyKey },
  );
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST /rendez-vous/${id}/arrivee.`);
  }
  return reponse;
}
