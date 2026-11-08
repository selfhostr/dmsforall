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
import { creerBonCommandeDossierVente } from './bon-commande-dossier.api';

/** Sous-ensemble du dossier nécessaire pour composer `EntreeCreationDocumentVente` sans qu'aucun
 *  champ ne soit ressaisi par l'utilisateur — ce geste n'est PAS un formulaire (design §7.3 :
 *  « Créer le bon de commande », un bouton, pas un dialogue). `clientFacture` (RV-40 : destinataire
 *  réel de la facture, toujours résolu) plutôt que `clientAcheteur`, pour rester cohérent avec le
 *  document qui portera effectivement le montant. */
type DossierPourCreationBonCommande = Pick<
  ReponseDossierVente,
  'id' | 'siteId' | 'clientFacture' | 'vehicule'
>;

/** `POST /documents-vente` avec `typeDocument: 'bon_commande'` et `dossierVenteId` renseigné —
 *  voir l'en-tête de `bon-commande-dossier.api.ts` pour le contexte du blocage résolu (RV-37).
 *
 * Idempotence : une clé par INTENTION (même doctrine que `useCreationDossierVente`/
 * `useCreationOrdreReparation`) — un double-clic sur le bouton pendant que la mutation est en vol
 * ne doit jamais créer deux bons de commande. La clé est régénérée seulement après un succès,
 * jamais après un simple échec (un échec n'a rien fait avaluer côté serveur, rejouer la même clé
 * doit être traité comme le même geste).
 *
 * Le prix du véhicule du dossier est reporté sur une ligne (`ligneVehiculeDuDossier`) ; sans
 * véhicule ni prix, le document n'est PAS créé (`blocage`) plutôt que de naître vide à 0.00.
 */
export function useCreerBonCommandeDossier(dossier: DossierPourCreationBonCommande): {
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
  // Une clé par INTENTION, PAS par appel de `creer()` (voir le commentaire d'en-tête) — même piège
  // documenté par `useCreationDossierVente` : lire `idempotence.cle` juste après régénération
  // renverrait encore l'ancienne clé si on la tenait en `useState` plutôt qu'en `useRef`.
  const cleIdempotenceRef = useRef(genererCleIdempotence());

  const mutation: UseMutationResult<
    ReponseAvecAvertissements<ReponseDocumentVente>,
    unknown,
    EntreeCreationDocumentVente
  > = useMutation({
    // L'écran affiche déjà l'erreur (`role="alert"` sous le bouton) : pas de second message.
    meta: { filetErreurIgnore: true },
    mutationFn: (entree: EntreeCreationDocumentVente) =>
      creerBonCommandeDossierVente(entree, cleIdempotenceRef.current),
    onSuccess: () => {
      cleIdempotenceRef.current = genererCleIdempotence();
      void queryClient.invalidateQueries({ queryKey: clesVentesDossiers.detail(dossier.id) });
    },
  });

  function creer(options: { readonly onSuccess: (document: ReponseDocumentVente) => void }) {
    if (blocage) return;
    const entree: EntreeCreationDocumentVente = {
      typeDocument: 'bon_commande',
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
