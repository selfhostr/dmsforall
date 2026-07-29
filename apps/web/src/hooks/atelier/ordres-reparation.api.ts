import type {
  CodeConfirmation,
  EntreeActionAnnuler,
  EntreeActionReceptionner,
  EntreeActionReprendreTravaux,
  EntreeActionRefuserControle,
  EntreeActionRestituer,
  EntreeActionRouvrir,
  EntreeActionTerminer,
  EntreeActionValiderControle,
  EntreeCreationOrdreReparation,
  OrdreReparationResume,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseOrdreReparation,
  StatutOrdreReparation,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport de l'OR — même convention que `hooks/vehicules/vehicules.api.ts` : les types
 * consommés sont ceux de `@dfa/shared` (contrat gelé), jamais ceux de `api/types.gen.ts`. Les
 * filtres de liste sont sérialisés à la main en `URLSearchParams`, jamais via les `operations[]`
 * générées (qui ne documentent pas les query params de cet endpoint — voir le reste du front).
 */

/** Filtres de liste consommés par l'écran — sous-ensemble de `FiltresOrdresReparation`
 *  (@dfa/shared). `statut` reste mono-sélection en v1 (comme `vehicules:liste.filtres.statut`) :
 *  le contrat accepte un tableau, mais aucun écran de l'étape 1 n'a besoin de la sélection
 *  multiple pour l'instant — l'étendre à `readonly StatutOrdreReparation[]` reste additif. */
export interface FiltresListeOrdresReparation {
  readonly q?: string;
  readonly statut?: StatutOrdreReparation;
  /** Site sélectionné (`?site=` de l'URL, jamais un état global — voir `routes/chemins.ts`). */
  readonly siteId?: string;
  readonly tri: string;
  // Index signature structurelle : requise pour rester assignable à `FiltresListe` (clesQuery.ts,
  // @/api/cles — forme ouverte volontaire, voir son en-tête).
  readonly [cle: string]: string | number | boolean | undefined;
}

export interface PageOrdresReparation {
  readonly limite: number;
  readonly curseur?: string;
}

/** Corps vide (transitions T-04/T-11/T-19) : le contrat les type `{}` étendu des confirmations
 *  (§4.4) — jamais de corps absent, pour que l'ajout d'un champ futur reste additif. */
export interface EntreeActionSansCorps {
  readonly confirmations?: readonly CodeConfirmation[];
}

function construireParametres(filtres: FiltresListeOrdresReparation, page: PageOrdresReparation): string {
  const parametres = new URLSearchParams();
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  if (filtres.statut) parametres.set('statut', filtres.statut);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /ordres-reparation` — projection de liste (`OrdreReparationResume`, §8.3), jamais le
 *  document complet : la liste comptoir n'a besoin ni des lignes, ni des signatures, ni du
 *  journal. */
export async function listerOrdresReparation(
  filtres: FiltresListeOrdresReparation,
  page: PageOrdresReparation,
): Promise<PageCurseur<OrdreReparationResume>> {
  const page_ = await requeteApi<PageCurseur<OrdreReparationResume>>(
    `/ordres-reparation?${construireParametres(filtres, page)}`,
    { method: 'GET' },
  );
  return page_ ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `GET /ordres-reparation/{id}` — LE document complet (D-10) : lignes, devis, signatures et
 *  cumuls de pointage en font partie, ce n'est pas un agrégat d'écran. */
export async function recupererOrdreReparation(orId: string): Promise<ReponseOrdreReparation> {
  const or = await requeteApi<ReponseOrdreReparation>(`/ordres-reparation/${orId}`, { method: 'GET' });
  if (!or) {
    throw new Error('Réponse OR inattendue : corps vide.');
  }
  return or;
}

/** `POST /ordres-reparation` (§7.6) — `Idempotency-Key` OBLIGATOIRE : un rejeu (double-clic
 *  comptoir, ou nouvelle tentative après confirmation d'un 409 `CONFIRMATION_REQUISE`) ne doit
 *  jamais brûler un numéro d'OR (RM-49). Voir `useCreationOrdreReparation.ts` pour la gestion de
 *  la clé côté appelant. */
export async function creerOrdreReparation(
  entree: EntreeCreationOrdreReparation,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseOrdreReparation>>('/ordres-reparation', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /ordres-reparation.');
  }
  return reponse;
}

/** Toutes les actions de transition (§7.7) renvoient le DOCUMENT COMPLET dans l'enveloppe : après
 *  une transition, l'écran d'OR n'a pas à relire — c'est ce que branchent les hooks de
 *  `useTransitionsOrdreReparation.ts` via `setQueryData`. */
async function executerActionOr<TEntree extends object>(
  orId: string,
  segment: string,
  entree: TEntree,
): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseOrdreReparation>>(
    `/ordres-reparation/${orId}/${segment}`,
    { method: 'POST', body: JSON.stringify(entree) },
  );
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST /ordres-reparation/${orId}/${segment}.`);
  }
  return reponse;
}

export const receptionnerOrdreReparation = (orId: string, entree: EntreeActionReceptionner) =>
  executerActionOr(orId, 'receptionner', entree);

export const demarrerOrdreReparation = (orId: string, entree: EntreeActionSansCorps) =>
  executerActionOr(orId, 'demarrer', entree);

export const reprendreTravauxOrdreReparation = (orId: string, entree: EntreeActionReprendreTravaux) =>
  executerActionOr(orId, 'reprendre-travaux', entree);

export const passerEnControleOrdreReparation = (orId: string, entree: EntreeActionSansCorps) =>
  executerActionOr(orId, 'passer-en-controle', entree);

export const refuserControleOrdreReparation = (orId: string, entree: EntreeActionRefuserControle) =>
  executerActionOr(orId, 'refuser-controle', entree);

export const validerControleOrdreReparation = (orId: string, entree: EntreeActionValiderControle) =>
  executerActionOr(orId, 'valider-controle', entree);

export const terminerOrdreReparation = (orId: string, entree: EntreeActionTerminer) =>
  executerActionOr(orId, 'terminer', entree);

export const rouvrirOrdreReparation = (orId: string, entree: EntreeActionRouvrir) =>
  executerActionOr(orId, 'rouvrir', entree);

export const restituerOrdreReparation = (orId: string, entree: EntreeActionRestituer) =>
  executerActionOr(orId, 'restituer', entree);

export const cloturerOrdreReparation = (orId: string, entree: EntreeActionSansCorps) =>
  executerActionOr(orId, 'cloturer', entree);

export const annulerOrdreReparation = (orId: string, entree: EntreeActionAnnuler) =>
  executerActionOr(orId, 'annuler', entree);
