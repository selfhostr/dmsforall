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
 * `lignes: []` volontairement : le contenu du bon de commande (véhicule, prix, TVA) se saisit dans
 * l'écran facturation existant (`ecrans/facturation/**`, hors périmètre) — ce hook ne fait que
 * poser le brouillon et le rattacher, pour que le sélecteur `bonCommandeDocumentId` de `engager`
 * cesse d'être vide.
 */
export function useCreerBonCommandeDossier(dossier: DossierPourCreationBonCommande): {
  readonly enCours: boolean;
  readonly erreur: unknown;
  readonly creer: (options: {
    readonly onSuccess: (document: ReponseDocumentVente) => void;
  }) => void;
} {
  const queryClient = useQueryClient();
  // Une clé par INTENTION, PAS par appel de `creer()` (voir le commentaire d'en-tête) — même piège
  // documenté par `useCreationDossierVente` : lire `idempotence.cle` juste après régénération
  // renverrait encore l'ancienne clé si on la tenait en `useState` plutôt qu'en `useRef`.
  const cleIdempotenceRef = useRef(genererCleIdempotence());

  const mutation: UseMutationResult<
    ReponseAvecAvertissements<ReponseDocumentVente>,
    unknown,
    EntreeCreationDocumentVente
  > = useMutation({
    mutationFn: (entree: EntreeCreationDocumentVente) =>
      creerBonCommandeDossierVente(entree, cleIdempotenceRef.current),
    onSuccess: () => {
      cleIdempotenceRef.current = genererCleIdempotence();
      void queryClient.invalidateQueries({ queryKey: clesVentesDossiers.detail(dossier.id) });
    },
  });

  function creer(options: { readonly onSuccess: (document: ReponseDocumentVente) => void }) {
    const entree: EntreeCreationDocumentVente = {
      typeDocument: 'bon_commande',
      siteId: dossier.siteId,
      clientId: dossier.clientFacture.id,
      vehiculeId: dossier.vehicule?.id ?? null,
      dossierVenteId: dossier.id,
      devise: 'CHF',
      lignes: [],
    };
    mutation.mutate(entree, { onSuccess: (reponse) => options.onSuccess(reponse.donnees) });
  }

  return { enCours: mutation.isPending, erreur: mutation.error, creer };
}
