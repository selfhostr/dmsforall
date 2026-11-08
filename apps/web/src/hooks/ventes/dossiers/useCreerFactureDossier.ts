import { useRef } from 'react';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationDocumentVente,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
  ReponseDossierVente,
} from '@dfa/shared';

import { genererCleIdempotence } from '@/api/idempotence';

import { clesVentesDossiers } from './cles';
import { ligneVehiculeDuDossier, type BlocageDocumentDossier } from './ligne-vehicule-dossier';
import { creerFactureDossierVente } from './bon-commande-dossier.api';

/** Jumeau de `DossierPourCreationBonCommande` (`useCreerBonCommandeDossier.ts`) — mêmes champs,
 *  même raison : composer `EntreeCreationDocumentVente` sans ressaisie. `clientFacture` (RV-40)
 *  reste le bon champ ici aussi, la facture porte le même destinataire que le bon de commande. */
type DossierPourCreationFacture = Pick<
  ReponseDossierVente,
  'id' | 'siteId' | 'clientFacture' | 'vehicule'
>;

/** `POST /documents-vente` avec `typeDocument: 'facture'` et `dossierVenteId` renseigné — #124 :
 * le parcours de vente était une impasse, aucun écran ne permettait de créer la facture qu'exige
 * `livrer` (RV-37, `409 DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE` sinon). Voir l'en-tête de
 * `bon-commande-dossier.api.ts` pour le contexte partagé avec `useCreerBonCommandeDossier`.
 *
 * Idempotence : une clé par INTENTION, même doctrine (`useCreerBonCommandeDossier`,
 * `useCreationDossierVente`) — régénérée seulement après un succès.
 *
 * Le prix du véhicule du dossier est reporté sur une ligne (`ligneVehiculeDuDossier`) ; sans
 * véhicule ni prix, le document n'est PAS créé (`blocage`) plutôt que de naître vide à 0.00.
 */
export function useCreerFactureDossier(dossier: DossierPourCreationFacture): {
  readonly enCours: boolean;
  readonly erreur: unknown;
  /** Non nul : création refusée AVANT tout appel (véhicule ou prix absent) — message métier. */
  readonly blocage: BlocageDocumentDossier | null;
  readonly creer: (options: {
    readonly onSuccess: (document: ReponseDocumentVente) => void;
  }) => void;
} {
  const queryClient = useQueryClient();
  const { ligne, blocage } = ligneVehiculeDuDossier(dossier);
  // Une clé par INTENTION, PAS par appel de `creer()` — voir le commentaire d'en-tête et celui,
  // identique, de `useCreerBonCommandeDossier`.
  const cleIdempotenceRef = useRef(genererCleIdempotence());

  const mutation: UseMutationResult<
    ReponseAvecAvertissements<ReponseDocumentVente>,
    unknown,
    EntreeCreationDocumentVente
  > = useMutation({
    // L'écran affiche déjà l'erreur (`role="alert"` sous le bouton) : pas de second message.
    meta: { filetErreurIgnore: true },
    mutationFn: (entree: EntreeCreationDocumentVente) =>
      creerFactureDossierVente(entree, cleIdempotenceRef.current),
    onSuccess: () => {
      cleIdempotenceRef.current = genererCleIdempotence();
      void queryClient.invalidateQueries({ queryKey: clesVentesDossiers.detail(dossier.id) });
    },
  });

  function creer(options: { readonly onSuccess: (document: ReponseDocumentVente) => void }) {
    if (blocage) return;
    const entree: EntreeCreationDocumentVente = {
      typeDocument: 'facture',
      siteId: dossier.siteId,
      clientId: dossier.clientFacture.id,
      vehiculeId: dossier.vehicule?.id ?? null,
      dossierVenteId: dossier.id,
      devise: 'CHF',
      lignes: ligne ? [ligne] : [],
    };
    mutation.mutate(entree, { onSuccess: (reponse) => options.onSuccess(reponse.donnees) });
  }

  return { enCours: mutation.isPending, erreur: mutation.error, blocage, creer };
}
