import { useTranslation } from 'react-i18next';

import { Segments } from '@/composants/commun/Segments';

/**
 * Deux façons de regarder le même parc en stock (issue #84, `securite` — constat testeur : « deux
 * clics et j'ai les six voitures », le meilleur écran du logiciel, ET l'écran qu'on tourne vers le
 * client). La vue VENDEUR (défaut) garde tout — jours en stock, provenance, prix d'achat sur
 * demande — pour PILOTER le stock. La vue CLIENT ne masque rien avec un cache-cache d'icône : les
 * champs qui révèlent la marge ou l'ancienneté du véhicule sont RETIRÉS de l'écran, pas
 * simplement assombris derrière un bouton « voir ». Rien à cliquer par erreur devant un client qui
 * regarde par-dessus l'épaule du vendeur — le critère décisif du chantier : un clic malheureux ne
 * doit jamais suffire.
 *
 * Bascule explicite, jamais un rôle ni un droit d'accès : le vendeur A le droit de voir sa marge,
 * c'est le REGARD DU CLIENT qu'on protège, pas la donnée elle-même (voir `ValeurConfidentielle`,
 * même doctrine).
 *
 * État porté par `?vue=` dans l'URL (même patron que `?site=` — `EcranListeVehiculesStock`,
 * `EcranFicheVehiculeStock` le lisent chacun via `lireVueAffichageStock`) plutôt qu'un contexte
 * React ou un store : deux onglets ne doivent jamais se contredire, et le mode survit à un
 * rafraîchissement de page. Absent de l'URL => vendeur : jamais de vue client par accident au
 * premier chargement d'un lien partagé ou mis en favori.
 *
 * STYLE — retour produit du 12.08.2026 (revue structure haute) : « le bouton Vue vendeur / Vue client
 * ne respecte pas les autres éléments de l'interface ». `components/ui/tabs.tsx` (`TabsList`/
 * `TabsTrigger`, non réutilisés ici) porte le style de la NAVIGATION (soulignement, voir
 * `OngletsDomaine.tsx`, onglets de premier niveau) — ce contrôle-ci ne navigue nulle part, il
 * change la façon dont CET écran affiche les mêmes lignes, exactement le rôle des « vues » de
 * second niveau qu'`OngletsDomaine` sait déjà distinguer visuellement des onglets (fond plein
 * `bg-secondary`/`rounded-md`, jamais un soulignement). Ce composant reprend CE style déjà établi
 * — pas une nouvelle convention — via `@base-ui/react/tabs` directement plutôt que le wrapper
 * `components/ui/tabs.tsx` (dont le style de premier niveau ne convient pas ici) : mêmes rôles
 * ARIA (`tablist`/`tab`), même clavier (flèches, `Home`/`End`), même contrat de test
 * (`getByRole('tab', …)`, voir `EcranListeVehiculesStock.spec.tsx`), seule l'habillage change.
 *
 * `@base-ui/react/tabs` plutôt que `@radix-ui/react-tabs` (chantier d'unification inter-écrans,
 * 25.08.2026) : même bibliothèque, même motif que `EcranListeFactures.tsx` et
 * `components/ui/tabs.tsx` — Tabs n'est pas un composant à portail/superposition, la frontière
 * Radix/Base UI de CONTRIBUTING.md ne s'y applique pas. WCAG 4.1.2 (`aria-controls` de référence brisée,
 * déjà mesuré en e2e sur `EcranListeFactures.tsx`) : ces onglets FILTRENT l'affichage de la même
 * liste, ils n'ouvrent jamais de panneau dédié (aucun `TabsPrimitive.Panel` n'est jamais rendu) —
 * Base UI calcule `aria-controls` depuis les panneaux RÉELLEMENT montés (`TabsRoot.js`,
 * `getTabPanelIdByValue` lit une `Map` alimentée par `registerMountedTabPanel`, jamais appelé ici)
 * : sans `Panel`, l'attribut est simplement OMIS (React n'écrit jamais un attribut `undefined`),
 * vérifié dans `BasculeVueStock.spec.tsx`.
 */
export type VueAffichageStock = 'vendeur' | 'client';

export function lireVueAffichageStock(searchParams: URLSearchParams): VueAffichageStock {
  return searchParams.get('vue') === 'client' ? 'client' : 'vendeur';
}

interface Props {
  readonly vue: VueAffichageStock;
  readonly onChangeVue: (vue: VueAffichageStock) => void;
}

export function BasculeVueStock({ vue, onChangeVue }: Props) {
  const { t } = useTranslation('ventes');

  return (
    <Segments
      valeur={vue}
      onChange={onChangeVue}
      ariaLabel={t('ventes:stock.vue.groupeLabel')}
      options={(['vendeur', 'client'] as const).map((valeur) => ({
        valeur,
        libelle: t(`ventes:stock.vue.${valeur}`),
      }))}
    />
  );
}
