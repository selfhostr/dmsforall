import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import i18n from '@/i18n';
import { obtenirEnv } from '@/config/env';
import { construireErreurApi, ErreurReseau } from '@/api/erreurs';

/**
 * Impression de la feuille d'atelier d'un OR — `GET /ordres-reparation/{orId}/pdf`.
 *
 * PRÉCÉDENT EXAMINÉ : `EcranFicheFacture.tsx` sert son PDF (`GET /documents-vente/{id}/pdf`) via
 * un simple `<a href={urlPdf} target="_blank">` — délibérément, parce que ce PDF-là est immuable
 * une fois la facture émise et que le navigateur peut donc le mettre en cache via l'`ETag`
 * (commentaire d'en-tête de `EcranFicheFacture.tsx`). CE PRÉCÉDENT NE CONVIENT PAS ICI : l'OR est
 * vivant, le serveur régénère le PDF à CHAQUE appel et ne pose aucun `ETag` de cache dessus — et
 * surtout un `<a href>` brut n'offre aucun moyen d'intercepter une réponse d'erreur
 * `problem+json` avant qu'elle ne s'affiche telle quelle (binaire cassé) dans le nouvel onglet,
 * ce que ce lot exige explicitement. D'où un mécanisme fetch+blob ci-dessous, qui devient la
 * référence à réutiliser si la facture adopte un jour la même exigence.
 *
 * PAS `requeteApi` (`@/api/client`) : celui-ci suppose systématiquement un corps JSON
 * (`JSON.parse(corpsTexte)`), incompatible avec une réponse binaire `application/pdf`. Ce hook
 * reproduit directement les mêmes conventions qu'`requeteApi` (`credentials: 'include'`,
 * `Accept-Language`, `construireErreurApi` sur un statut non-ok, `ErreurReseau` sur un échec
 * réseau) sans passer par lui.
 *
 * FENÊTRE OUVERTE PAR L'APPELANT, DE FAÇON SYNCHRONE, AVANT `mutate()` — jamais par ce hook
 * lui-même. `useMutation().mutate()` n'invoque PAS forcément `mutationFn` de façon synchrone
 * (TanStack Query intercale au moins un microtick) : un `window.open()` posé ICI, à l'intérieur
 * de `mutationFn`, s'exécuterait donc après un aller-retour dans la boucle micro-tâches — assez
 * pour que Safari (le plus strict des navigateurs sur ce point) ne le rattache plus au geste
 * utilisateur et le bloque silencieusement. La fenêtre DOIT donc être ouverte dans le gestionnaire
 * `onClick` lui-même (voir `BoutonImprimerOr.tsx`), puis passée en variable de mutation — seule
 * façon fiable d'éviter le bloqueur de popups sur tous les navigateurs. Ce hook se contente de la
 * piloter : y écrire sa `location` une fois le PDF reçu, ou la refermer en cas d'échec.
 *
 * JAMAIS DE CACHE, JAMAIS DE RÉUTILISATION D'URL : chaque appel de `imprimer()` obtient sa PROPRE
 * URL d'objet (`URL.createObjectURL`), jamais celle d'un appel précédent. L'ancienne URL n'est
 * révoquée qu'une fois la nouvelle assignée à la fenêtre (jamais avant : la révoquer plus tôt
 * casserait un onglet encore en train de charger le blob précédent) — et au démontage, pour ne
 * jamais laisser fuiter le dernier blob si l'utilisateur ne réimprime jamais.
 */
export function useImprimerOr(orId: string): UseMutationResult<void, unknown, Window | null> {
  const derniereUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (derniereUrlRef.current) {
        URL.revokeObjectURL(derniereUrlRef.current);
        derniereUrlRef.current = null;
      }
    };
  }, []);

  return useMutation({
    mutationFn: async (fenetre: Window | null) => {
      let reponse: Response;
      try {
        reponse = await fetch(`${obtenirEnv().VITE_API_URL}/ordres-reparation/${orId}/pdf`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept-Language': i18n.language },
        });
      } catch (cause) {
        fenetre?.close();
        throw new ErreurReseau(cause);
      }

      if (!reponse.ok) {
        fenetre?.close();
        const corpsTexte = await reponse.text();
        throw construireErreurApi(reponse, corpsTexte);
      }

      const blob = await reponse.blob();
      const url = URL.createObjectURL(blob);
      const urlPrecedente = derniereUrlRef.current;
      derniereUrlRef.current = url;
      if (urlPrecedente) URL.revokeObjectURL(urlPrecedente);

      if (fenetre) {
        fenetre.location.href = url;
      } else {
        // Popup refusée malgré l'ouverture synchrone (réglage navigateur strict) : repli sur un
        // lien invisible cliqué, seule autre façon d'ouvrir le PDF sans quitter la page courante.
        const lien = document.createElement('a');
        lien.href = url;
        lien.target = '_blank';
        lien.rel = 'noopener noreferrer';
        lien.click();
      }
    },
  });
}
