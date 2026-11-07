import type {
  EntreeCorrectionFacture,
  EntreeCreationAvoir,
  EntreeCreationDocumentVente,
  EntreeCreationLigneDocument,
  EntreeEmissionDocumentVente,
  EntreeModificationDocumentVente,
  EntreeModificationLigneDocument,
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
 * jamais ceux de `api/types.gen.ts`. NOTE DE FRAÎCHEUR (corrigée `10.08.2026`) : l'en-tête ci-dessus
 * affirmait que « l'OpenAPI de la facturation n'existe pas encore » — c'était vrai au `04.08.2026`,
 * ça ne l'est plus depuis la régénération du contrat (`33b0124`, "Contrat: regenerer l'OpenAPI et les
 * types du front") : `apps/web/src/api/types.gen.ts` documente désormais `/documents-vente` et ses
 * sous-routes. Ce fichier continue néanmoins de consommer `@dfa/shared` plutôt que les `operations[]`
 * générées, par choix délibéré (même raison que `hooks/atelier/ordres-reparation.api.ts` : les filtres
 * de liste sérialisés à la main ne sont pas documentés par les `operations[]`), pas par retard de
 * régénération — ne pas relancer cette vérification, la question a été tranchée.
 *
 * ÉCART SIGNALÉ, DÉSORMAIS CONFIRMÉ (corrigé `10.08.2026`) : le paragraphe ci-dessous doutait du verbe
 * HTTP de suppression d'une ligne de brouillon (« à confirmer avec l'équipe API »). `types.gen.ts`
 * confirme `DELETE /documents-vente/{id}/lignes/{ligneId}` → `DocumentVenteController_supprimerLigne`
 * ("Suppression d'une ligne sur un brouillon (MD-19, MD-21)") : l'hypothèse de `supprimerLigneDocument`
 * ci-dessous était correcte sur le VERBE. DÉSORMAIS CÂBLÉES (issue #125, `EcranFicheFacture.tsx` via
 * `DialogueLigneDocumentVente.tsx`) : `ajouterLigneDocument`/`supprimerLigneDocument`/
 * `modifierLigneDocument` (cette dernière NOUVELLE, le hook manquait) ont désormais un appelant
 * écran — ce n'était plus du code mort à cette date, et un second bug d'enveloppe de réponse a été
 * corrigé au passage (voir le commentaire de chacune des trois fonctions ci-dessous).
 *
 * Historique (contexte, ne plus revérifier) : le contrat partagé documente le CORPS de chaque action
 * (`schemaCreationAvoir`, `schemaCorrectionFacture`, `schemaEmissionDocumentVente`…) et le VERBE dans
 * ses commentaires (`POST /documents-vente/{id}/emettre`, etc.) ; `ligne.ts` indique qu'aucun `DELETE`
 * n'existe sur une ligne d'OR (RM-71) et que la facturation suit un principe voisin mais INVERSE pour
 * un brouillon (« la ligne se retire librement », contrairement à l'OR).
 *
 * ÉCART SIGNALÉ ET CONTOURNÉ (bug confirmé en exécution, `2026-08-04`) : `GET /documents-vente`
 * NE renvoie PAS `DocumentVenteResume` malgré le commentaire ci-dessous et le type annoncé par
 * `requeteApi<PageCurseur<DocumentVenteResume>>` — `ServiceDocumentsVente.lister`
 * (`apps/api/.../service-documents.ts`, hors périmètre de ce lot) documente lui-même la
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
 *  écran 2 §4.3 — désormais aussi l'ajout de ligne générique de l'écran 2, issue #125).
 *
 *  CORRECTIF (issue #125, confirmé en lisant `DocumentVenteController.ajouterLigne` /
 *  `ServiceDocumentsVente.ajouterLigne`) : le corps RÉEL de cette route est une ENVELOPPE
 *  `ReponseAvecAvertissements<ReponseDocumentVente>` (`{ donnees, avertissements }`), jamais un
 *  `ReponseDocumentVente` nu — cette fonction le typait et le retournait tel quel avant ce
 *  correctif (bug jamais manifesté : ni elle ni `useAjouterLigneDocument` n'avaient d'appelant
 *  écran avant l'ajout du dialogue de lignes). Les avertissements éventuels (ex. dépassement de
 *  stock RP-19/RP-20 sur une ligne `piece` — hors périmètre du dialogue actuel, qui ne pose jamais
 *  `articleId`) sont délibérément ignorés ici plutôt que fuités jusqu'à l'appelant : aucun écran de
 *  ce module n'affiche encore d'avertissement pour cette action. */
export async function ajouterLigneDocument(
  id: string,
  entree: EntreeCreationLigneDocument,
  idempotencyKey: string,
): Promise<ReponseDocumentVente> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDocumentVente>>(
    `/documents-vente/${id}/lignes`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /documents-vente/lignes.');
  }
  return reponse.donnees;
}

/** `PATCH /documents-vente/{id}/lignes/{ligneId}` — édition d'une ligne sur un brouillon (MD-21,
 *  issue #125). Corps ENTIÈREMENT repeuplé par l'appelant (jamais un diff partiel avec des clés
 *  omises) : `schemaModificationLigneDocument` porte des `.default(...)` hérités de la forme de
 *  création (voir le commentaire de `DocumentVenteController.modifierLigne`) qui s'appliqueraient
 *  à tort à un champ omis — envoyer systématiquement la valeur RÉELLE de chaque champ affiché,
 *  jamais `undefined` pour « je ne change pas ce champ », lève toute ambiguïté côté client. */
export async function modifierLigneDocument(
  id: string,
  ligneId: string,
  entree: EntreeModificationLigneDocument,
): Promise<ReponseDocumentVente> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDocumentVente>>(
    `/documents-vente/${id}/lignes/${ligneId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH /documents-vente/lignes.');
  }
  return reponse.donnees;
}

/** `DELETE /documents-vente/{id}/lignes/{ligneId}` — voir l'ÉCART SIGNALÉ en tête de fichier :
 *  verbe supposé, jamais confirmé par le contrat partagé. Uniquement pour une ligne ajoutée en
 *  facturation sur un brouillon, jamais une ligne recopiée d'un OR (§4.3 du design).
 *
 *  CORRECTIF (issue #125, même bug d'enveloppe que `ajouterLigneDocument` ci-dessus, confirmé en
 *  lisant `ServiceDocumentsVente.supprimerLigne`, qui rend `{ donnees, avertissements }`) : voir
 *  le commentaire de `ajouterLigneDocument`, même correctif, même doctrine d'ignorer
 *  `avertissements` ici (aucun écran ne les affiche pour ce geste à ce jour). */
export async function supprimerLigneDocument(
  id: string,
  ligneId: string,
): Promise<ReponseDocumentVente> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDocumentVente>>(
    `/documents-vente/${id}/lignes/${ligneId}`,
    {
      method: 'DELETE',
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : DELETE /documents-vente/lignes.');
  }
  return reponse.donnees;
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

/** `POST /documents-vente` — `Idempotency-Key` OBLIGATOIRE. Crée un BROUILLON (ici : un devis,
 *  `typeDocument = 'devis'`) ; les lignes s'ajoutent ensuite sur la fiche (`ajouterLigneDocument`). */
export async function creerDocumentVente(
  entree: EntreeCreationDocumentVente,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDocumentVente>>(
    '/documents-vente',
    { method: 'POST', body: JSON.stringify(entree), idempotencyKey },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /documents-vente.');
  }
  return reponse;
}
