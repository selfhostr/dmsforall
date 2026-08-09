import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { useVersionApplication } from '@/hooks/useVersionApplication';
import { cn } from '@/lib/utils';

import {
  cheminEntree,
  ENTREE_REGLAGES,
  entreesVisibles,
  reglagesVisibles,
  trouverCorrespondance,
  type EntreeMenu,
} from './navigation-modele';

interface Props {
  readonly className?: string;
}

/**
 * BARRE LATÉRALE — Lot D de la refonte (`docs/refonte-navigation.md` §4.2,
 * `docs/plan-refonte-navigation.md`, « Lot D — Le menu à six entrées »).
 *
 * TRENTE ENTRÉES DEVIENNENT SIX, plus Réglages en pied. Ce qui disparaît d'ici n'est pas supprimé :
 * tout descend d'un niveau, en onglets (`OngletsDomaine.tsx`) et en vues, et le tableau complet du
 * déménagement vit dans `navigation-modele.ts`. Deux chemins alternatifs, livrés avant ce lot, sont
 * ce qui rend la coupe possible sans enfermer personne : la recherche permanente de l'en-tête
 * (Lot A, `Ctrl+K` et bouton loupe) et les fiches devenues cliquables (Lot B). L'ordre était
 * inversable dans un plan de projet, pas dans la réalité — retirer les entrées d'abord aurait
 * retiré le seul chemin vers des écrans qui n'en avaient aucun autre.
 *
 * AUCUN DÉFILEMENT, et c'est le cœur du lot. La zone de liens portait `overflow-y-auto` : avec
 * trente entrées, un `chef_atelier` sur une tablette faisait défiler son menu, et un menu qui
 * défile n'a pas de mémoire spatiale — « troisième entrée, sous Atelier » cesse d'être vrai dès
 * que la position dépend du défilement, et le support téléphonique perd son repère le plus utile.
 * Six lignes de 44 px tiennent partout, y compris sur le plus petit appareil visé, donc plus rien
 * ne défile ici. Ne pas réintroduire `overflow-y-auto` « par sécurité » : ce serait rouvrir la
 * porte à une septième, puis une huitième entrée, sans que rien ne rougisse.
 *
 * L'ORDRE EST LE MÊME POUR TOUS LES RÔLES (§2). Les droits masquent des entrées, ils n'en
 * réordonnent aucune. Trois arborescences selon le poste, c'est trois fois la question « tu es
 * connecté avec quel compte ? » avant chaque réponse au téléphone, et trois jeux de captures
 * d'écran à maintenir — pour un produit tenu par une personne qui dépanne dix garages.
 *
 * MASQUAGE : chaque entrée est visible si et seulement si au moins un de ses onglets l'est
 * (`entreesVisibles`), donc aucune entrée ne peut ouvrir sur un contenu vide. La distinction
 * « protection réelle » / « confort de menu » reste celle documentée dans `routes/droits-routes.ts`
 * — masquer ici n'a jamais protégé quoi que ce soit, l'API reste l'arbitre.
 *
 * LARGEUR : les libellés sont dimensionnés sur l'ALLEMAND, le plus long des trois langues (Q7).
 * Budget réel pour le texte d'une entrée : 240 px de colonne − 24 px d'inset (`p-3`) − 24 px de
 * padding de lien (`px-3`) − 16 px d'icône − 12 px de gouttière = 164 px. Le pire cas des trois
 * langues est « Kunden & Fahrzeuge » (18 caractères, ~130 px à `text-sm`) : il passe, et c'est le
 * seul libellé qui s'en approche. `Reparaturauftrag`, le mot qui motivait la question, n'est plus
 * un libellé d'entrée mais un ONGLET, donc dans une rangée horizontale sans contrainte de largeur.
 * Aucune troncature n'est posée : tronquer un libellé de menu détruit précisément le repère que ce
 * lot cherche à construire. Si une traduction future ne tenait pas, c'est la colonne qui s'élargit.
 *
 * `poste_atelier` (la borne murale) ne voit AUCUNE entrée — c'est un appareil, pas un employé
 * (§2). `AppShell` retire alors la colonne entière plutôt que d'afficher un cadre vide.
 */
export function BarreLaterale({ className }: Props) {
  const { t } = useTranslation('navigation');
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { pathname } = useLocation();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  // Numéro de version (support téléphonique) — `data` reste `undefined` pendant le chargement
  // ET en cas d'erreur, ce qui suffit à ne rien afficher dans les deux cas : voir le paragraphe
  // en bas du JSX pour la justification de cette exception à la règle « chargement / vide /
  // erreur » des écrans métier.
  const { data: sante } = useVersionApplication();

  // Le site actif est lu DEPUIS L'URL, jamais depuis la session (mécanisme unique du produit, voir
  // `routes/chemins.ts`) : deux onglets ouverts sur deux sites différents ne doivent pas se
  // contredire, et un utilisateur qui a navigué vers un site autre que son défaut de session ne
  // doit pas y être silencieusement ramené en cliquant une entrée de cette barre.
  const entrees = entreesVisibles(role);
  const correspondance = trouverCorrespondance(pathname);
  const idEntreeActive = correspondance?.entree.id;

  function rendreEntree(entree: EntreeMenu) {
    const cible = cheminEntree(entree, role, site);
    if (cible === undefined) return null;
    const Icone = entree.icone;
    const actif = entree.id === idEntreeActive;
    return (
      <li key={entree.id}>
        {/* `Link` ordinaire, pas `NavLink` : `NavLink` détruit le prop `aria-current` qu'on lui
            passe (`ariaCurrentProp`) et ne le restitue que si son PROPRE `isActive` interne — la
            comparaison entre SON `to` et `location.pathname` — est vrai. Ici `to` vaut le chemin du
            PREMIER ONGLET VISIBLE de l'entrée (ex. `/ordres-reparation`), pas l'onglet courant
            (ex. `/pointage/equipe`) : `isActive` de `NavLink` est alors `false` alors même que
            l'entrée est bien la bonne au sens métier (`actif`, dérivé de `trouverCorrespondance`,
            qui lui rattache correctement toute URL du domaine à son entrée). Un `Link` ne gère pas
            `aria-current` lui-même : ce qu'on lui passe atteint le DOM tel quel, ce qui permet de
            faire porter l'attribut par `actif` — la même valeur qui pose déjà `bg-primary`. */}
        <Link
          to={cible}
          aria-current={actif ? 'page' : undefined}
          className={cn(
            // h-11 = 44 px : plancher tactile du produit, jamais réduit sur desktop (les postes de
            // comptoir sont des écrans tactiles de 24 pouces, §4.6).
            'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            actif
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t(entree.cleLibelle)}
        </Link>
      </li>
    );
  }

  return (
    // `h-full` : résolu par le parent — `AppShell` donne à l'aside desktop une hauteur de viewport
    // (`lg:h-dvh`) et le tiroir mobile (`Sheet`) est déjà en hauteur pleine.
    <nav aria-label={t('navigation:principale.aria')} className="flex h-full flex-col">
      {/* AUCUN `overflow-y-auto` ICI — voir le paragraphe « aucun défilement » en tête de fichier.
          `flex-1` pousse simplement le pied en bas quand la colonne est plus haute que ses six
          lignes ; il ne crée aucune zone défilante, et il n'y a plus de `min-h-0` à poser puisque
          plus rien n'a besoin de se rétrécir sous sa taille de contenu. */}
      <ul className={cn('flex flex-1 flex-col gap-1 p-3', className)}>
        {entrees.map((entree) => rendreEntree(entree))}
      </ul>

      {/*
       * Pied ancré, séparé des six entrées par un filet (§4.2) — `shrink-0` : ne rétrécit jamais.
       * Le filet encode une frontière réelle : au-dessus, les six plans de travail qu'on ouvre
       * chaque jour ; en dessous, ce qu'on configure rarement et jamais dans le flux de travail
       * (Réglages), puis une métadonnée inerte (la version).
       *
       * Version — chargement et erreur : `sante` reste `undefined` dans les deux cas -> RIEN n'est
       * affiché, aucun squelette ni placeholder. Exception ASSUMÉE à la règle « chaque écran gère
       * chargement / vide / erreur » du CONTRIBUTING.md : c'est une information d'ambiance dans un chrome
       * affiché huit heures par jour, pas un écran métier — quand elle manque, l'utilisateur n'a
       * rien à en faire, et un placeholder permanent serait du bruit. Le texte visible
       * (« main · 0.1.234 ») est déjà explicite pour un lecteur au téléphone, donc pas
       * d'`aria-label` séparé.
       */}
      {reglagesVisibles(role) || sante ? (
        <div className="shrink-0 border-t p-3">
          {reglagesVisibles(role) ? (
            <ul className="flex flex-col gap-1">{rendreEntree(ENTREE_REGLAGES)}</ul>
          ) : null}
          {sante ? (
            <p className="mt-2 px-3 texte-libelle text-muted-foreground">
              {t('navigation:pied.version', { branche: sante.branche, numero: sante.version })}
            </p>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
