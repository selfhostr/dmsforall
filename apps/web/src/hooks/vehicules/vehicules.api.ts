import type {
  EntreeKilometrageVehicule,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseContexteAtelier,
  ReponseVehicule,
  ReponseVehiculeDetention,
  ReponseVehiculeKilometrage,
  VehiculeResume,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/** Filtres de liste consommés par l'écran (sous-ensemble de `FiltresVehicules`, @dfa/shared) —
 *  `tri` reste obligatoire côté serveur (défaut `TRI_DEFAUT_VEHICULES`) mais toujours fourni
 *  explicitement ici pour que la clé de cache (`clesQuery.vehicules.liste`) varie avec lui. */
export interface FiltresListeVehicules {
  readonly q?: string;
  readonly statut?: 'actif' | 'archive';
  readonly importe?: boolean;
  /** Site sélectionné (`?site=` de l'URL, jamais un état global — voir `routes/chemins.ts`). */
  readonly siteId?: string;
  readonly tri: string;
  // Index signature structurelle : requise pour rester assignable à `FiltresListe` (clesQuery.ts,
  // @/api/cles — forme ouverte volontaire, voir son en-tête). Les propriétés nommées ci-dessus
  // restent le contrat réel consommé par ce module.
  readonly [cle: string]: string | number | boolean | undefined;
}

export interface PageVehicules {
  readonly limite: number;
  readonly curseur?: string;
}

/** Sérialise vers `URLSearchParams` — aucune valeur `undefined`/vide n'est envoyée (évite un
 *  filtre serveur mal interprété comme "chaîne vide recherchée"). */
function construireParametres(filtres: FiltresListeVehicules, page: PageVehicules): string {
  const parametres = new URLSearchParams();
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  if (filtres.statut) parametres.set('statut', filtres.statut);
  if (filtres.importe !== undefined) parametres.set('importe', String(filtres.importe));
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

export async function listerVehicules(
  filtres: FiltresListeVehicules,
  page: PageVehicules,
): Promise<PageCurseur<VehiculeResume>> {
  const page_ = await requeteApi<PageCurseur<VehiculeResume>>(
    `/vehicules?${construireParametres(filtres, page)}`,
    {
      method: 'GET',
    },
  );
  return page_ ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

export async function recupererVehicule(vehiculeId: string): Promise<ReponseVehicule> {
  const vehicule = await requeteApi<ReponseVehicule>(`/vehicules/${vehiculeId}`, { method: 'GET' });
  if (!vehicule) {
    throw new Error('Réponse véhicule inattendue : corps vide.');
  }
  return vehicule;
}

/** `GET /vehicules/{id}/contexte-atelier` (§8.1) — agrégat consommé au même instant à la prise
 *  de RDV et à la réception du matin (D-01, RM-36, CT-13). */
export async function recupererContexteAtelier(
  vehiculeId: string,
): Promise<ReponseContexteAtelier> {
  const contexte = await requeteApi<ReponseContexteAtelier>(
    `/vehicules/${vehiculeId}/contexte-atelier`,
    {
      method: 'GET',
    },
  );
  if (!contexte) {
    throw new Error('Réponse contexte-atelier inattendue : corps vide.');
  }
  return contexte;
}

export async function listerKilometragesVehicule(
  vehiculeId: string,
): Promise<readonly ReponseVehiculeKilometrage[]> {
  const releves = await requeteApi<readonly ReponseVehiculeKilometrage[]>(
    `/vehicules/${vehiculeId}/kilometrages`,
    {
      method: 'GET',
    },
  );
  return releves ?? [];
}

export async function listerDetentionsVehicule(
  vehiculeId: string,
): Promise<readonly ReponseVehiculeDetention[]> {
  const detentions = await requeteApi<readonly ReponseVehiculeDetention[]>(
    `/vehicules/${vehiculeId}/detentions`,
    {
      method: 'GET',
    },
  );
  return detentions ?? [];
}

/** `POST /vehicules/{id}/kilometrages` (RM-23/24/25). Sans `motifRegression`, un relevé inférieur
 *  au dernier connu produit `409 VEHICULE_KILOMETRAGE_REGRESSIF` — propagé tel quel (`ErreurApi`,
 *  voir `@/api/erreurs.ts`) pour que l'écran distingue ce cas et redemande un motif. */
export async function creerKilometrageVehicule(
  vehiculeId: string,
  entree: EntreeKilometrageVehicule,
): Promise<ReponseAvecAvertissements<ReponseVehiculeKilometrage>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseVehiculeKilometrage>>(
    `/vehicules/${vehiculeId}/kilometrages`,
    { method: 'POST', body: JSON.stringify(entree) },
  );
  if (!reponse) {
    throw new Error('Réponse de création de kilométrage inattendue : corps vide.');
  }
  return reponse;
}
