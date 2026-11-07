import type {
  AttenteOrdreReparation,
  CodeConfirmation,
  EntreeActionAnnuler,
  EntreeActionReceptionner,
  EntreeActionReprendreTravaux,
  EntreeActionRefuserControle,
  EntreeActionRestituer,
  EntreeActionRouvrir,
  EntreeActionTerminer,
  EntreeActionValiderControle,
  EntreeAnnulationLignes,
  EntreeCreationDevisComplementaire,
  EntreeCreationLigneOr,
  EntreeCreationOrdreReparation,
  EntreeMarquageRealisee,
  EntreeModificationOrdreReparation,
  EntreeRefusLignes,
  EntreeReponseDevisComplementaire,
  EntreeValidationLignes,
  OrdreReparationResume,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseDevisComplementaire,
  ReponseLigneOr,
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
  /** Issue #111 : PAS un statut (`attente_pieces` n'existe QUE dans `EtatAfficheOrdreReparation`,
   *  jamais dans `StatutOrdreReparation`) — un drapeau orthogonal (`AttentesOr`), donc un filtre
   *  SÉPARÉ de `statut` ci-dessus, cumulable avec lui (§6.3, `schemaFiltresOrdresReparation.attente`
   *  côté contrat). Mono-sélection en v1, même doctrine que `statut` juste au-dessus. */
  readonly attente?: AttenteOrdreReparation;
  /** Site sélectionné (`?site=` de l'URL, jamais un état global — voir `routes/chemins.ts`). */
  readonly siteId?: string;
  /** Véhicule (`ordreReparation.vehiculeId`), filtre `eq(...)` SINGULIER côté serveur
   *  (`apps/api/src/atelier/service-or.ts::lister`, `if (filtres.vehiculeId) conditions.push(eq(…))`)
   *  — même doctrine que `detenteurId` (`hooks/vehicules/vehicules.api.ts`) : un seul identifiant
   *  par appel, aucune fusion de requêtes de plusieurs véhicules distincts. Défaut réparé : cette
   *  fonction de transport ne le sérialisait pas alors que le serveur le supporte déjà
   *  (`schemaFiltresOrdresReparation.vehiculeId`), forçant trois écrans (`EnTeteOrdreReparation`,
   *  `EcranFicheVehicule`, `EcranFicheDossierVente`) à contourner par un `useQuery` local avec
   *  `URLSearchParams` construit à la main. */
  readonly vehiculeId?: string;
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

function construireParametres(
  filtres: FiltresListeOrdresReparation,
  page: PageOrdresReparation,
): string {
  const parametres = new URLSearchParams();
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  if (filtres.statut) parametres.set('statut', filtres.statut);
  if (filtres.attente) parametres.set('attente', filtres.attente);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.vehiculeId !== undefined) parametres.set('vehiculeId', filtres.vehiculeId);
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
  const or = await requeteApi<ReponseOrdreReparation>(`/ordres-reparation/${orId}`, {
    method: 'GET',
  });
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
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseOrdreReparation>>(
    '/ordres-reparation',
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
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

export const reprendreTravauxOrdreReparation = (
  orId: string,
  entree: EntreeActionReprendreTravaux,
) => executerActionOr(orId, 'reprendre-travaux', entree);

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

/** `POST /ordres-reparation/{orId}/lignes` (§7.8) — `Idempotency-Key` OBLIGATOIRE (saisie en
 *  rafale au comptoir, un rejeu ne doit pas créer deux lignes). Renvoie SEULEMENT la ligne créée
 *  (`EnveloppeLigneOrDto`), jamais le document OR complet — voir `useActionsLigneOr.ts` pour la
 *  conséquence côté cache (invalidation, pas `setQueryData`). */
export async function creerLigneOrdreReparation(
  orId: string,
  entree: EntreeCreationLigneOr,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseLigneOr>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseLigneOr>>(
    `/ordres-reparation/${orId}/lignes`,
    { method: 'POST', body: JSON.stringify(entree), idempotencyKey },
  );
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST /ordres-reparation/${orId}/lignes.`);
  }
  return reponse;
}

/** `POST /ordres-reparation/{orId}/lignes/{ligneId}/marquer-realisee` — `en_cours -> realisee`.
 *  Réponse : la LIGNE mise à jour (enveloppe), jamais le document OR complet. */
export async function marquerLigneOrRealisee(
  orId: string,
  ligneId: string,
  entree: EntreeMarquageRealisee = {},
): Promise<ReponseAvecAvertissements<ReponseLigneOr>> {
  const chemin = `/ordres-reparation/${orId}/lignes/${ligneId}/marquer-realisee`;
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseLigneOr>>(chemin, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) throw new Error(`Réponse vide inattendue : POST ${chemin}.`);
  return reponse;
}

/** Actions GROUPÉES portées par l'OR (§7.7/§7.8) — renvoient le DOCUMENT COMPLET, comme les
 *  transitions ci-dessus (`executerActionOr`). */
export const validerLignesOrdreReparation = (orId: string, entree: EntreeValidationLignes) =>
  executerActionOr(orId, 'valider-lignes', entree);

export const refuserLignesOrdreReparation = (orId: string, entree: EntreeRefusLignes) =>
  executerActionOr(orId, 'refuser-lignes', entree);

export const annulerLignesOrdreReparation = (orId: string, entree: EntreeAnnulationLignes) =>
  executerActionOr(orId, 'annuler-lignes', entree);

/** `POST /ordres-reparation/{orId}/devis-complementaires` — `Idempotency-Key` OBLIGATOIRE (pièce à
 *  valeur probante, RM-79). Le montant est calculé par le serveur depuis les lignes référencées. */
export async function creerDevisComplementaire(
  orId: string,
  entree: EntreeCreationDevisComplementaire,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDevisComplementaire>> {
  const chemin = `/ordres-reparation/${orId}/devis-complementaires`;
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDevisComplementaire>>(chemin, {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) throw new Error(`Réponse vide inattendue : POST ${chemin}.`);
  return reponse;
}

/** `POST /ordres-reparation/{orId}/devis-complementaires/{devisId}/repondre` — enregistre QUI a
 *  répondu et QUAND (RM-81, `interlocuteurNom` obligatoire). `accepte` valide les lignes du devis. */
export async function repondreDevisComplementaire(
  orId: string,
  devisId: string,
  entree: EntreeReponseDevisComplementaire,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDevisComplementaire>> {
  const chemin = `/ordres-reparation/${orId}/devis-complementaires/${devisId}/repondre`;
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDevisComplementaire>>(chemin, {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) throw new Error(`Réponse vide inattendue : POST ${chemin}.`);
  return reponse;
}

/** `PATCH /ordres-reparation/{orId}` — champs libres de l'en-tête. `If-Match: W/"<version>"`
 *  obligatoire (§9). */
export async function modifierOrdreReparation(
  orId: string,
  entree: EntreeModificationOrdreReparation,
  version: number,
): Promise<ReponseAvecAvertissements<ReponseOrdreReparation>> {
  const chemin = `/ordres-reparation/${orId}`;
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseOrdreReparation>>(chemin, {
    method: 'PATCH',
    body: JSON.stringify(entree),
    ifMatch: `W/"${version}"`,
  });
  if (!reponse) throw new Error(`Réponse vide inattendue : PATCH ${chemin}.`);
  return reponse;
}
