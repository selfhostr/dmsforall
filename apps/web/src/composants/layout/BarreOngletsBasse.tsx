import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';

import { usePastilleAssistant } from '@/hooks/assistant/usePastilleAssistant';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

import { PastilleConfiguration } from './PastilleConfiguration';

import {
  cheminEntree,
  entreesVisibles,
  sujetNavigation,
  trouverCorrespondance,
  type EntreeMenu,
} from './navigation-modele';

interface Props {
  /** Ouvre le MÊME tiroir (`Sheet` + `BarreLaterale`) que le bouton hamburger de
   *  `BarreOutilsSuperieure` en palier tablette — état contrôlé par `AppShell`, partagé. */
  readonly ouvrirPlus: () => void;
  readonly plusOuvert: boolean;
}

/**
 * BARRE D'ONGLETS BASSE — mode téléphone (< `md`, 768 px), refonte navigation mobile
 * (demande produit, 24.08.2026). Remplace le geste « ouvrir le tiroir puis choisir » par un
 * geste unique, à portée de pouce en bas d'écran, là où `env(safe-area-inset-bottom)`
 * (`--zone-sure-bas`, `index.css`) et `--barre-onglets-hauteur` (56 px) ont été posés par
 * le lot de fondations sans jamais être consommés.
 *
 * QUATRE ENTRÉES PRIMAIRES + « Plus », jamais les six. Choix fondé sur `navigation-modele.ts`
 * lui-même (voir sa doc de tête, « L'ORDRE DES ENTRÉES SUIT LA JOURNÉE ») : Aujourd'hui (le
 * matin), Atelier (la journée, atterrissage par défaut de technicien/magasinier sur
 * Pointage), Clients & véhicules (« le téléphone », le comptoir), Pièces (« la pièce qu'on
 * va chercher », atterrissage du magasinier sur Comptoir) sont les quatre destinations
 * qu'un garagiste rejoint plusieurs fois par heure, téléphone/tablette en main. Facturation
 * est explicitement « le soir » dans ce même commentaire — une tâche de fin de journée, plus
 * proche du bureau que du plancher d'atelier — et Ventes explicitement « le rythme mensuel » :
 * les deux vont dans le tiroir derrière « Plus », pas perdues, à un geste de plus. Cette
 * MÊME source (`entreesVisibles`, déjà filtrée et ordonnée par rôle) alimente les quatre
 * onglets : un rôle qui n'a accès qu'à deux ou trois entrées en voit deux ou trois, jamais
 * une case vide — pas de liste séparée à maintenir en double de `navigation-modele.ts`.
 *
 * « Plus » n'ouvre PAS un second menu : il ouvre le MÊME tiroir (`Sheet`/`BarreLaterale`) que
 * la barre d'outils supérieure en palier tablette (`BarreOutilsSuperieure.tsx`) — état
 * contrôlé partagé, posé par `AppShell.tsx`. Aucune troisième liste de navigation à écrire
 * ni à faire diverger : le tiroir donne accès à la totalité (Facturation, Ventes, Réglages,
 * et les entrées primaires elles-mêmes) — c'est très exactement « la dernière place sert
 * d'accès au reste ».
 *
 * `aria-current="page"` sur les quatre onglets réels (même contrat que `BarreLaterale`/
 * `OngletsDomaine` : `Link`, jamais `NavLink`, pour ne pas dépendre de sa comparaison interne
 * `to`/`pathname` — voir leur doc respective pour le cas où elle diverge). Le bouton « Plus »
 * n'est PAS une page : `aria-current="true"` (valeur ARIA générique, pas `"page"`) quand la
 * route active appartient à une entrée hors des quatre primaires (Facturation, Ventes,
 * Réglages) — orientation conservée sans mentir sur ce que le bouton représente.
 *
 * L'onglet actif ne se distingue jamais par la seule couleur (doctrine `BadgeStatut`,
 * reprise de `BarreLaterale`) : poids de police ET couleur changent ensemble.
 *
 * `h-barre-onglets-hauteur` (56 px, jeton posé par le lot de fondations) pour la rangée de
 * cibles ; `pb-zone-sure-bas` sur le `<nav>` ajoute l'éventuel indicateur d'accueil
 * iOS/Android SOUS la rangée, jamais dans la zone cliquable — c'est ce qui rend chaque cible
 * >=44 px de haut y compris sur un appareil à encoche. `pl-zone-sure-gauche`/
 * `pr-zone-sure-droite` : la barre est `fixed inset-x-0`, bord à bord, donc directement
 * concernée par l'encoche en orientation paysage — aucun autre élément du cadre ne l'est
 * autant.
 */
export function BarreOngletsBasse({ ouvrirPlus, plusOuvert }: Props) {
  const garageAConfigurer = usePastilleAssistant();
  const { t } = useTranslation('navigation');
  const [searchParams] = useSearchParams();
  const { preferenceSiteId } = useSiteCourant();
  const site = searchParams.get('site') ?? preferenceSiteId;
  const { pathname } = useLocation();
  const { data: session } = useSession();
  const sujet = sujetNavigation(session);

  // Nombre d'entrées primaires — voir la justification complète en tête de fichier. Une
  // constante nommée plutôt qu'un `4` nu dans `.slice()` : le prochain lot qui relit ce
  // fichier n'a pas à recompter les `<li>` du JSX pour retrouver la décision.
  const NB_ENTREES_PRIMAIRES = 4;
  const entrees = entreesVisibles(sujet).slice(0, NB_ENTREES_PRIMAIRES);
  const correspondance = trouverCorrespondance(pathname);
  const idEntreeActive = correspondance?.entree.id;
  const activeParmiPrimaires = entrees.some((entree) => entree.id === idEntreeActive);
  const activeDansPlus = idEntreeActive !== undefined && !activeParmiPrimaires;

  function rendreEntree(entree: EntreeMenu) {
    const cible = cheminEntree(entree, sujet, site);
    if (cible === undefined) return null;
    const Icone = entree.icone;
    const actif = entree.id === idEntreeActive;
    const libelle = t(entree.cleLibelle);
    return (
      <li key={entree.id} className="flex flex-1">
        <Link
          to={cible}
          aria-current={actif ? 'page' : undefined}
          className={cn(
            'anneau-focus flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-center transition-colors',
            actif
              ? 'font-semibold text-primary'
              : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icone className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="texte-petit w-full truncate leading-none">{libelle}</span>
        </Link>
      </li>
    );
  }

  return (
    // `fixed inset-x-0 bottom-0` : bord à bord, au-dessus du contenu (`z-40`, sous les
    // superpositions Radix qui montent bien plus haut). `md:hidden` : mode téléphone
    // strictement — la barre haute et le tiroir reprennent la main dès `md` (tablette
    // portrait), voir `AppShell.tsx`.
    <nav
      aria-label={t('navigation:barreBasse.aria')}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-zone-sure-bas pl-zone-sure-gauche pr-zone-sure-droite lg:hidden"
    >
      <ul className="flex h-barre-onglets-hauteur items-stretch gap-1 px-1">
        {entrees.map((entree) => rendreEntree(entree))}
        <li className="flex flex-1">
          <button
            type="button"
            onClick={ouvrirPlus}
            aria-expanded={plusOuvert}
            aria-current={activeDansPlus ? 'true' : undefined}
            className={cn(
              'anneau-focus flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-center transition-colors',
              activeDansPlus
                ? 'font-semibold text-primary'
                : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <span className="relative flex">
              <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
              {garageAConfigurer ? <PastilleConfiguration className="-right-1 -top-1" /> : null}
            </span>
            <span className="texte-petit w-full truncate leading-none">
              {t('navigation:barreBasse.plus')}
              {garageAConfigurer ? (
                <span className="sr-only"> — {t('navigation:configurer.pastille')}</span>
              ) : null}
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
