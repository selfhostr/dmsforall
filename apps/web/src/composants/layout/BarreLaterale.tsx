import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

import {
  cheminEntree,
  ENTREE_REGLAGES,
  entreesVisibles,
  reglagesVisibles,
  trouverCorrespondance,
  type EntreeMenu,
} from './navigation-modele';
import type { UtiliserRepliBarreLaterale } from './useRepliBarreLaterale';

/**
 * Numéro de version affiché collé au bouton Réglages (demande explicite de @laupernoe, 17.08.2026 :
 * « mets-le au-dessus ou en dessous du bouton Réglages », pas un pied de page détaché). But réel :
 * identifier sans ambiguïté le BUNDLE FRONT réellement affiché en test à distance (« bundle
 * périmé ou vrai défaut ? », doute qui a coûté du temps réel le 16.08.2026) — le numéro de
 * version seul (`apps/web/package.json`) ne suffit pas, il ne bouge pas entre deux commits de la
 * même journée, d'où le hash court en plus (voir `vite.config.ts`, `define`).
 *
 * Repli défensif « valeur manquante » — PAS seulement celui déjà posé côté build
 * (`calculerInfoVersionWeb` dans `vite.config.ts`, `'inconnu'` si `git` est absent) : sous
 * Vitest, `vitest.config.ts` est une config SÉPARÉE qui ne porte pas le `define` de
 * `vite.config.ts`, donc `import.meta.env.VITE_DFA_VERSION_INFO` y est un simple accès de
 * propriété sur l'objet réel `import.meta.env` → `undefined`, jamais une exception.
 * `typeof … === 'string'` traite ce cas (et toute chaîne vide) exactement comme une vraie valeur
 * manquante — règle maison : absence de donnée ≠ valeur, le mot « inconnue » (traduit dans
 * `navigation.json`) ne doit jamais se confondre avec un vrai numéro.
 *
 * RE-ARBITRAGE 17.08.2026 : l'issue #85 cachait la version (« un client au comptoir ne doit voir
 * ni branche ni hash Git ») — @laupernoe a tranché l'inverse ce jour-là, visible tout le temps, y compris
 * devant un client, pour identifier sans ambiguïté le bundle servi en test à distance. Ne pas
 * « corriger » cette visibilité en croyant réappliquer #85 : elle est voulue, plus le contraire.
 */
function infoVersionBrute(): string {
  const brut = import.meta.env.VITE_DFA_VERSION_INFO;
  return typeof brut === 'string' && brut.trim() !== '' ? brut : '';
}

interface Props {
  readonly className?: string;
  /**
   * Repli DESKTOP uniquement (demande @laupernoe, revue webui du 10.08.2026) — absent (`undefined`) =>
   * toujours déplié, comme avant ce lot. C'est l'état du tiroir mobile (`Sheet` d'`AppShell.tsx`) :
   * déjà en surimpression et se fermant entièrement au moindre geste, un repli y serait un second
   * mécanisme pour le même besoin. Seul l'`aside` desktop d'`AppShell.tsx` passe ce prop, construit
   * par `useRepliBarreLaterale` — ce composant ne lit ni n'écrit lui-même la préférence.
   */
  readonly repli?: UtiliserRepliBarreLaterale;
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
 * porte à une septième, puis une huitième entrée, sans que rien ne rougisse. Le repli desktop
 * ci-dessous ne change rien à cette règle : il réduit la LARGEUR de la colonne, jamais sa hauteur
 * ni son nombre de lignes.
 *
 * L'ORDRE EST LE MÊME POUR TOUS LES RÔLES (§2). Les droits masquent des entrées, ils n'en
 * réordonnent aucune. Trois arborescences selon le poste, c'est trois fois la question « tu es
 * connecté avec quel compte ? » avant chaque réponse au téléphone, et trois jeux de captures
 * d'écran à maintenir — pour un produit tenu par une personne qui dépanne dix garages.
 *
 * MASQUAGE : chaque entrée est visible si et seulement si au moins un de ses onglets l'est
 * (`entreesVisibles`), donc aucune entrée ne peut ouvrir sur un contenu vide. La distinction
 * « protection réelle » / « confort de menu » reste celle documentée dans `routes/droits-routes.ts`
 * — masquer ici n'a jamais protégé quoi que ce soit, l'API reste l'arbitre. Le repli est un TROISIÈME
 * axe, orthogonal : une préférence d'affichage de l'utilisateur connecté, jamais un substitut au
 * masquage par rôle — `poste_atelier` (borne murale) continue de n'avoir AUCUNE entrée, repliée ou
 * non, et `AppShell` retire pour lui la colonne entière (voir plus bas).
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
export function BarreLaterale({ className, repli }: Props) {
  const { t } = useTranslation('navigation');
  const [searchParams] = useSearchParams();
  const { preferenceSiteId } = useSiteCourant();
  // CORRECTIF issue #91 (« le logiciel oublie mon choix dès que je change d'écran ») : l'URL reste
  // la source qui FAIT FOI (doctrine ci-dessous, inchangée), mais quand elle n'en porte AUCUN, on
  // retombe sur la dernière préférence connue (`hooks/site/ContexteSiteCourant.tsx`) plutôt que sur
  // « aucun site » — c'est précisément ce qui faisait retomber la navigation sur « Tous les sites »
  // sans que l'utilisateur ait rien changé, quand un écran hors de ce périmètre construisait un lien
  // interne sans propager `?site=`. Une fois CE lien cliqué, l'URL suivante porte à nouveau le site,
  // qui redevient alors la source pour la navigation suivante.
  const site = searchParams.get('site') ?? preferenceSiteId;
  const { pathname } = useLocation();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  // Numéro de version — voir la doc de `infoVersionBrute` en tête de fichier. Repli traduit
  // (« inconnue ») posé ICI, pas dans `infoVersionBrute`, pour rester une fonction pure sans
  // dépendance à `t`.
  const infoVersion = infoVersionBrute() || t('navigation:pied.versionInconnue');

  // `repli` absent (tiroir mobile) => jamais replié, quelle que soit la préférence mémorisée par
  // ailleurs : la lecture de cette préférence est entièrement du ressort de l'appelant desktop.
  const replie = repli?.replie ?? false;

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
    const libelle = t(entree.cleLibelle);
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
            faire porter l'attribut par `actif` — la même valeur qui pose déjà le remplissage plein
            de l'état actif ci-dessous.
            `aria-label` posé dans LES DEUX états, pas seulement replié : replié, c'est le SEUL
            porteur du nom accessible (l'icône est `aria-hidden`, le libellé texte devient
            `sr-only`) ; déplié, il double le texte visible sans changer le nom accessible calculé
            (identique), donc sans coût. `title` réservé au repli : c'est l'infobulle au survol,
            un CONFORT jamais requis pour comprendre l'entrée (inatteignable au tactile) — déplié,
            le libellé est déjà visible en clair, une infobulle y serait redondante. */}
        <Link
          to={cible}
          aria-current={actif ? 'page' : undefined}
          aria-label={libelle}
          title={replie ? libelle : undefined}
          className={cn(
            // h-11 = 44 px : plancher tactile du produit, jamais réduit sur desktop (les postes de
            // comptoir sont des écrans tactiles de 24 pouces, §4.6) — y compris replié, voir la
            // largeur de colonne posée par `AppShell.tsx` (`w-16`, 64 px, largement au-dessus du
            // plancher une fois l'inset `p-2` du repli soustrait).
            // `rounded-md` posé dans les deux états, jamais conditionnel : la FORME de la ligne
            // ne change jamais, seul son remplissage change au clic. Poser la forme uniquement à
            // l'état actif aurait fait « sauter » la ligne d'un rectangle à un autre au clic — ici
            // rien ne bouge, seule la couleur transite (`transition-colors`).
            // Retour @laupernoe du 12.08.2026 (revue structure haute) : la pilule pleine (`rounded-full`,
            // posée le même jour, voir git blame) détonnait avec l'arrondi des boutons du produit
            // (`components/ui/button.tsx` : `rounded-md` partout, `variantesBouton`) — « je veux que
            // ce soit la même chose que les autres boutons ». Remplacement par `rounded-md`, seul
            // rayon d'arrondi utilisé ailleurs dans l'interface (boutons, `Select`, `Input`, cartes) :
            // l'indicateur d'écran actif rejoint ce vocabulaire au lieu d'en inventer un second.
            'flex h-11 items-center rounded-md text-sm font-medium transition-colors',
            replie ? 'justify-center px-2' : 'gap-3 px-3',
            'anneau-focus',
            actif
              ? // Refonte du 12.08.2026 (demande @laupernoe : « le truc gris avec un autre gris avec une
                // barre à gauche » manquait de contraste et ne se voyait pas d'un coup d'œil). Le
                // filet gris sur gris (`--secondary`/`--secondary-foreground`, hérité de l'état actif
                // des onglets et abandonné ici) est remplacé par un REMPLISSAGE PLEIN dans la couleur
                // de marque (`--primary` = `--marque`, blanc dessus) : 11.28:1 de contraste mesuré
                // (AAA, voir `index.css`), largement au-dessus de la paire grise qu'elle remplace.
                // Le signal ne tient jamais à la seule couleur (doctrine `BadgeStatut`) : la FORME
                // change (fond plein contre rien), le POIDS du texte change (`font-semibold`
                // contre `font-medium`), et `aria-current="page"` reste posé pour les technologies
                // d'assistance — trois signaux, pas un.
                'bg-primary font-semibold text-primary-foreground shadow-sm'
              : 'text-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className={replie ? 'sr-only' : undefined}>{libelle}</span>
        </Link>
      </li>
    );
  }

  return (
    // `h-full` : résolu par le parent — `AppShell` donne à l'aside desktop une hauteur de viewport
    // (`lg:h-dvh`) et le tiroir mobile (`Sheet`) est déjà en hauteur pleine.
    <nav aria-label={t('navigation:principale.aria')} className="flex h-full flex-col">
      {repli ? (
        // Bouton de repli — SEULEMENT quand `repli` est fourni (jamais dans le tiroir mobile, voir
        // la doc du prop). `aria-expanded` porte l'état pour un lecteur d'écran ; `title` donne
        // l'infobulle au survol, en confort du `aria-label` qui reste le porteur obligatoire.
        <div
          className={cn(
            'flex shrink-0 items-center p-3 pb-0',
            replie ? 'justify-center' : 'justify-between',
          )}
        >
          {/* Mot-symbole (demande @laupernoe, revue webui du 10.08.2026) — un `span`, pas un `h1`/`h2` :
              ni le fil d'Ariane ni le titre d'écran ne doivent lui céder leur rôle de repère de
              navigation, il ne fait que remplir le vide au-dessus des six entrées. AUCUNE clé
              i18n : c'est un nom de produit, identique en fr/de/it — une clé qui porterait trois
              fois la même valeur ne protégerait rien et ajouterait une entrée à traduire pour rien.
              `hidden` (pas une opacité à zéro) une fois repliée : retiré du flux ET de l'arbre
              d'accessibilité, aucun espace réservé ne subsiste pour annuler le gain de largeur, et
              un lecteur d'écran ne l'annonce plus. */}
          <span className={cn('truncate text-sm font-semibold tracking-tight', replie && 'hidden')}>
            dmsforall
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={repli.basculer}
            aria-expanded={!replie}
            aria-label={t(replie ? 'navigation:repli.agrandir' : 'navigation:repli.reduire')}
            title={t(replie ? 'navigation:repli.agrandir' : 'navigation:repli.reduire')}
          >
            {replie ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      ) : null}

      {/* AUCUN `overflow-y-auto` ICI — voir le paragraphe « aucun défilement » en tête de fichier.
          `flex-1` pousse simplement le pied en bas quand la colonne est plus haute que ses six
          lignes ; il ne crée aucune zone défilante, et il n'y a plus de `min-h-0` à poser puisque
          plus rien n'a besoin de se rétrécir sous sa taille de contenu. */}
      <ul className={cn('flex flex-1 flex-col gap-1', replie ? 'p-2' : 'p-3', className)}>
        {entrees.map((entree) => rendreEntree(entree))}
      </ul>

      {/*
       * Pied ancré, séparé des six entrées par un filet (§4.2) — `shrink-0` : ne rétrécit jamais.
       * Le filet encode une frontière réelle : au-dessus, les six plans de travail qu'on ouvre
       * chaque jour ; en dessous, ce qu'on configure rarement et jamais dans le flux de travail
       * (Réglages), puis le numéro de version.
       *
       * Numéro de version SOUS Réglages, pas dessus (demande @laupernoe, 17.08.2026 : « au-dessus ou en
       * dessous du bouton Réglages », choix laissé à l'agent) : le lien actionnable se lit en
       * premier, la métadonnée de confort ensuite — même ordre qu'un pied d'application classique
       * (action, puis « à propos »/version). Conditionné par LE MÊME `reglagesVisibles(role)` que
       * le lien : « collé au bouton », donc rien à afficher si ce bouton n'existe pas pour ce
       * rôle — jamais un second pied indépendant.
       *
       * REPLIÉ (icônes seules, colonne à 64 px) : le texte est MASQUÉ entièrement (`hidden`),
       * jamais tronqué ni réduit — même idiome que le mot-symbole « dmsforall » en tête de cette
       * barre (`hidden`, pas une opacité à zéro : retiré du flux ET de l'arbre d'accessibilité).
       * Aucune chaîne de version ne tient sur les ~48 px utiles restants sans déborder ou perdre
       * tout son sens tronquée, et ce texte n'est qu'une métadonnée de confort — jamais un
       * contrôle qu'un lecteur d'écran devrait pouvoir atteindre en repli.
       *
       * ABSENTE pour `poste_atelier` (borne murale, `AppShell.tsx` retire l'`aside` entier) :
       * assumé, confirmé sans effet de bord par les tests de masquage par rôle existants
       * (`describe('BarreLaterale — masquage par rôle')`) — rien de spécifique à ajouter ici, la
       * disparition suit celle de toute la colonne.
       */}
      {reglagesVisibles(role) ? (
        <div className={cn('shrink-0 border-t', replie ? 'p-2' : 'p-3')}>
          <ul className="flex flex-col gap-1">{rendreEntree(ENTREE_REGLAGES)}</ul>
          <p
            className={cn(
              'texte-libelle select-text text-muted-foreground',
              replie ? 'hidden' : 'mt-1 px-3',
            )}
            title={t('navigation:pied.version', { info: infoVersion })}
          >
            {infoVersion}
          </p>
        </div>
      ) : null}
    </nav>
  );
}
