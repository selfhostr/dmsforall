import { useEffect, useState } from 'react';

/**
 * Palier de repli en cartes de `TableComptoir` — sous 768px (seuil `md` de Tailwind). Avant ce
 * chantier, `md:` n'était utilisé nulle part dans le front pour de la mise en page (une seule
 * occurrence, `Plaque.tsx`, sans rapport — une clé d'objet de variantes) : l'UI sautait de 640px
 * (`sm`) à 1024px (`lg`), sans palier entre les deux. C'est justement la largeur d'une tablette en
 * portrait (iPad 768px pile, iPad mini idem) — `(max-width: 767px)` cible le téléphone SEUL ; à
 * 768px et au-delà, la table dense reste le gabarit.
 *
 * Même seuil `md` que `useModeScanMobile` (composants/layout/), motif différent et délibérément
 * séparé : celui-ci restreint des FONCTIONNALITÉS par rôle, celui-ci change seulement une MISE EN
 * PAGE — aucune règle métier, aucun `pointer: coarse` (un poste fixe redimensionné sous 768px doit
 * aussi profiter des cartes, la table à 8 colonnes y déborderait pareillement).
 */
const REQUETE_MEDIA_CARTE_COMPTOIR = '(max-width: 767px)';

function detecterCarte(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REQUETE_MEDIA_CARTE_COMPTOIR).matches;
}

/** `true` sous le palier de repli : `TableComptoir` doit rendre des cartes plutôt qu'une table. */
export function useModeCarteComptoir(): boolean {
  const [carte, setCarte] = useState(detecterCarte);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const requete = window.matchMedia(REQUETE_MEDIA_CARTE_COMPTOIR);
    const surChangement = (evenement: MediaQueryListEvent) => setCarte(evenement.matches);
    requete.addEventListener('change', surChangement);
    return () => requete.removeEventListener('change', surChangement);
  }, []);

  return carte;
}
