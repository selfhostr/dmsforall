import type {
  EntreeCorrectionFacture,
  EntreeCreationAvoir,
  EntreeCreationLigneDocument,
  EntreeEmissionDocumentVente,
  EntreeModificationDocumentVente,
  FiltresDocumentsVente,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseCorrectionFacture,
  ReponseDocumentVente,
  DocumentVenteResume,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport de la facturation — même convention que `hooks/atelier/ordres-reparation.api.ts` :
 * les types consommés sont ceux de `@dfa/shared` (`packages/shared/src/contrats/facturation/`),
 * jamais ceux de `api/types.gen.ts` (l'OpenAPI de la facturation n'existe pas encore, voir l'en-tête
 * de `packages/shared/src/contrats/facturation/index.ts` : « un écart nécessaire se remonte à
 * l'orchestrateur, il ne se code pas en attendant »).
 *
 * ÉCART SIGNALÉ (à confirmer avec expert-api / l'agent propriétaire des endpoints `documents-vente`) :
 * le contrat partagé documente le CORPS de chaque action (`schemaCreationAvoir`,
 * `schemaCorrectionFacture`, `schemaEmissionDocumentVente`…) et le VERBE dans ses commentaires
 * (`POST /documents-vente/{id}/emettre`, etc.) mais ne fixe pas explicitement le verbe de
 * suppression d'une ligne de brouillon ajoutée en écran 2 (§4.3 du design : « retirer une ligne
 * ajoutée par erreur à l'écran 1 »). `ligne.ts` indique seulement qu'aucun `DELETE` n'existe sur une
 * ligne d'OR (RM-71) et que la facturation suit un principe voisin mais INVERSE pour un brouillon
 * (« la ligne se retire librement », contrairement à l'OR) — `supprimerLigneDocument` ci-dessous
 * suppose donc un `DELETE /documents-vente/{id}/lignes/{ligneId}` classique, à vérifier avant mise
 * en service réelle.
 *
 * ÉCART SIGNALÉ ET CONTOURNÉ (bug confirmé en exécution, `2026-08-04`) : `GET /documents-vente`
 * NE renvoie PAS `DocumentVenteResume` malgré le commentaire ci-dessous et le type annoncé par
 * `requeteApi<PageCurseur<DocumentVenteResume>>` — `ServiceDocumentsVente.lister`
 * (`apps/api/.../service-documents.ts`, hors périmètre de cet agent) documente lui-même la
 * SIMPLIFICATION : chaque ligne passe par `assemblerDocument`, qui rend le document COMPLET
 * (`ReponseDocumentVente`). Vérifié en direct contre l'API du dépôt (`curl` authentifié,
 * `comptable@garage-martin.ch`) : la désignation client vit sous `figees.clientDesignation`,
 * jamais en `clientDesignation` de premier niveau — `DocumentVenteResume.clientDesignation` (le
 * type annoncé) est donc undefined sur CHAQUE réponse réelle, pas seulement au premier rendu. Ce
 * n'était pas visible sur `totalTtcCentimes`/`statutReglement` (déjà au premier niveau dans les
 * deux formes) — d'où le symptôme observé « Client » vide en permanence, « Montant TTC »/« Statut »
 * vides seulement pour un rôle sans droit aux montants (comportement voulu, RF-114 → RF-116, PAS
 * un bug). `projeterResume` ci-dessous rend cette conversion honnête à la frontière transport,
 * plutôt que de laisser `EcranListeFactures` lire un champ qui n'existe pas — la déclaration de
 * type reste vraie pour le reste de l'app. À supprimer le jour où `ServiceDocumentsVente.lister`
 * renvoie réellement une projection `DocumentVenteResume` (le end-to-end redeviendra un simple
 * passe-plat).
 */

/** Le corps RÉEL de `GET /documents-vente` (voir l'ÉCART SIGNALÉ ci-dessus) : un tableau de
 *  `ReponseDocumentVente` complets, jamais la projection `DocumentVenteResume` promise par le nom
 *  du contrat. Typé explicitement pour que la conversion ci-dessous reste honnête. */
type PageDocumentVenteBrute = PageCurseur<ReponseDocumentVente>;

/** Projette un `ReponseDocumentVente` (forme réelle renvoyée par la liste) vers
 *  `DocumentVenteResume` (forme que l'écran consomme) — voir l'ÉCART SIGNALÉ en tête de fichier.
 *  Chaque champ gardé ici est un sous-ensemble strict de `ReponseDocumentVente` : rien n'est
 *  inventé, `clientDesignation` est simplement lu à son emplacement RÉEL (`figees.*`). */
function projeterResume(document_: ReponseDocumentVente): DocumentVenteResume {
  return {
    id: document_.id,
    typeDocument: document_.typeDocument,
    natureFacture: document_.natureFacture,
    numero: document_.numero,
    statut: document_.statut,
    statutReglement: document_.statutReglement,
    clientId: document_.clientId,
    clientDesignation: document_.figees.clientDesignation,
    dateDocument: document_.dateDocument,
    devise: document_.devise,
    totalTtcCentimes: document_.totalTtcCentimes,
    soldeCentimes: document_.soldeCentimes,
    dateEcheance: document_.dateEcheance,
    enRetard: document_.enRetard,
    joursRetard: document_.joursRetard,
  };
}

function construireParametres(filtres: FiltresDocumentsVente): string {
  const parametres = new URLSearchParams();
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  for (const valeur of filtres.typeDocument ?? []) parametres.append('typeDocument', valeur);
  if (filtres.natureFacture) parametres.set('natureFacture', filtres.natureFacture);
  for (const valeur of filtres.statut ?? []) parametres.append('statut', valeur);
  for (const valeur of filtres.statutReglement ?? []) parametres.append('statutReglement', valeur);
  if (filtres.clientId) parametres.set('clientId', filtres.clientId);
  if (filtres.vehiculeId) parametres.set('vehiculeId', filtres.vehiculeId);
  if (filtres.ordreReparationId) parametres.set('ordreReparationId', filtres.ordreReparationId);
  if (filtres.dateDocumentDu) parametres.set('dateDocumentDu', filtres.dateDocumentDu);
  if (filtres.dateDocumentAu) parametres.set('dateDocumentAu', filtres.dateDocumentAu);
  if (filtres.enRetard !== undefined) parametres.set('enRetard', String(filtres.enRetard));
  // `relanceNiveau: 0` est une valeur significative (palier « jamais relancée ») — comparer à
  // `undefined`, jamais tester la véracité de `filtres.relanceNiveau` (même convention que
  // `filtres.importe`/`filtres.anomalie` ci-dessus dans les hooks voisins).
  if (filtres.relanceNiveau !== undefined) {
    parametres.set('relanceNiveau', String(filtres.relanceNiveau));
  }
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  parametres.set('tri', filtres.tri);
  return parametres.toString();
}

export interface PageDocumentsVente {
  readonly limite: number;
  readonly curseur?: string;
}

/** `GET /documents-vente` — projection de liste (`DocumentVenteResume`) attendue par l'écran 5.
 *  Le SERVEUR renvoie en réalité des `ReponseDocumentVente` complets (voir l'ÉCART SIGNALÉ en tête
 *  de fichier) : `projeterResume` fait la conversion ici, à la frontière transport, pour que rien
 *  en aval (l'écran, ses tests) n'ait à connaître cette simplification côté API. */
export async function listerDocumentsVente(
  filtres: FiltresDocumentsVente,
  page: PageDocumentsVente,
): Promise<PageCurseur<DocumentVenteResume>> {
  const parametres = construireParametres(filtres);
  const suffixePage = new URLSearchParams();
  suffixePage.set('limite', String(page.limite));
  if (page.curseur) suffixePage.set('curseur', page.curseur);
  const reponse = await requeteApi<PageDocumentVenteBrute>(
    `/documents-vente?${parametres}&${suffixePage.toString()}`,
    { method: 'GET' },
  );
  if (!reponse) return { donnees: [], curseurSuivant: null, limite: page.limite };
  return { ...reponse, donnees: reponse.donnees.map(projeterResume) };
}

/** `GET /documents-vente/{id}` — le document complet (lignes, ventilation TVA, bloc QR figé). */
export async function recupererDocumentVente(id: string): Promise<ReponseDocumentVente> {
  const document = await requeteApi<ReponseDocumentVente>(`/documents-vente/${id}`, {
    method: 'GET',
  });
  if (!document) {
    throw new Error('Réponse document de vente inattendue : corps vide.');
  }
  return document;
}

/** `PATCH /documents-vente/{id}` — brouillon uniquement (`MD-19`). Porte `If-Match` comme
 *  `PATCH /ordres-reparation/{id}` (même discipline optimiste, `version`/`ETag` exposés sur la
 *  ressource) même si `document.ts` ne le rend pas aussi explicite que `ordre-reparation.ts`. */
export async function modifierDocumentVente(
  id: string,
  entree: EntreeModificationDocumentVente,
  etag: string | null,
): Promise<ReponseDocumentVente> {
  const document = await requeteApi<ReponseDocumentVente>(`/documents-vente/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(entree),
    ifMatch: etag ?? undefined,
  });
  if (!document) {
    throw new Error('Réponse vide inattendue : PATCH /documents-vente.');
  }
  return document;
}

/** `POST /documents-vente/{id}/lignes` — uniquement pour une ligne saisie directement en
 *  facturation (ex. la ligne de démontage proposée, RF-91, ajoutée en écran 1 ou en rattrapage
 *  écran 2 §4.3). */
export async function ajouterLigneDocument(
  id: string,
  entree: EntreeCreationLigneDocument,
  idempotencyKey: string,
): Promise<ReponseDocumentVente> {
  const document = await requeteApi<ReponseDocumentVente>(`/documents-vente/${id}/lignes`, {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!document) {
    throw new Error('Réponse vide inattendue : POST /documents-vente/lignes.');
  }
  return document;
}

/** `DELETE /documents-vente/{id}/lignes/{ligneId}` — voir l'ÉCART SIGNALÉ en tête de fichier :
 *  verbe supposé, jamais confirmé par le contrat partagé. Uniquement pour une ligne ajoutée en
 *  facturation sur un brouillon, jamais une ligne recopiée d'un OR (§4.3 du design). */
export async function supprimerLigneDocument(
  id: string,
  ligneId: string,
): Promise<ReponseDocumentVente> {
  const document = await requeteApi<ReponseDocumentVente>(
    `/documents-vente/${id}/lignes/${ligneId}`,
    {
      method: 'DELETE',
    },
  );
  if (!document) {
    throw new Error('Réponse vide inattendue : DELETE /documents-vente/lignes.');
  }
  return document;
}

/** `POST /documents-vente/{id}/emettre` — `Idempotency-Key` OBLIGATOIRE (`RF-25`), point de
 *  non-retour (`MD-18`). Sert aussi bien une facture (écran 2, §4.5) qu'un avoir (écran 4, §6.2) :
 *  même endpoint, même corps, même contrat pour tout `typeDocument`. */
export async function emettreDocumentVente(
  id: string,
  entree: EntreeEmissionDocumentVente,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDocumentVente>>(
    `/documents-vente/${id}/emettre`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /documents-vente/emettre.');
  }
  return reponse;
}

/** `POST /documents-vente/{factureId}/avoirs` — crée un avoir en BROUILLON (émis séparément via
 *  `emettreDocumentVente`, écran 4 §6). */
export async function creerAvoir(
  factureId: string,
  entree: EntreeCreationAvoir,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDocumentVente>>(
    `/documents-vente/${factureId}/avoirs`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /documents-vente/avoirs.');
  }
  return reponse;
}

/** `POST /documents-vente/{factureId}/corriger` — le geste unique §4.7 (`RF-11` → `RF-14`) : une
 *  transaction, deux documents nés (avoir + facture de remplacement). */
export async function corrigerFacture(
  factureId: string,
  entree: EntreeCorrectionFacture,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseCorrectionFacture>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseCorrectionFacture>>(
    `/documents-vente/${factureId}/corriger`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /documents-vente/corriger.');
  }
  return reponse;
}
