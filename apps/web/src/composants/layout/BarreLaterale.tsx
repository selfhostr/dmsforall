import { ChevronsUpDown, LogOut, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useDeconnexion } from '@/hooks/useDeconnexion';
import { useSession } from '@/hooks/useSession';
import { cleTraductionRole } from '@/lib/roles';
import { cn } from '@/lib/utils';

import { BasculeTheme } from './BasculeTheme';
import {
  cheminEntree,
  ENTREE_REGLAGES,
  entreesVisibles,
  reglagesVisibles,
  trouverCorrespondance,
  type EntreeMenu,
} from './navigation-modele';
import { SelecteurSiteEntete } from './SelecteurSiteEntete';
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
 *
 * LOT « CADRE APPLICATIF » (19.08.2026, demande @laupernoe) — TROIS ajouts, tous motivés par le même
 * constat : l'ancienne `EnTete.tsx` occupait 64 px de hauteur sur CHAQUE écran pour n'afficher que
 * du contexte permanent (tenant, site, identité, déconnexion) — un défilement vertical inutile sur
 * un métier où « un écran est plus large que haut ». Ce contexte appartient au CADRE, pas à une
 * bande qui se répète en haut de chaque page :
 *
 *  1. BLOC TENANT + SITE en tête de colonne, à la place de l'ancien mot-symbole « dmsforall ».
 *     Repris de @laupernoe SANS détour : le mot-symbole ne ressemblait à rien du reste de la barre (taille
 *     de police différente, corps étranger) et, pire, faisait de la publicité pour le produit une
 *     fois DANS l'application — personne ne le regarde, le nom du produit est déjà dans l'onglet du
 *     navigateur et dans l'URL. Le nom du TENANT, lui, est une information utile en permanence
 *     (« je travaille pour quel garage »), donc la marque est SUPPRIMÉE (pas réduite à un
 *     pictogramme — un pictogramme resterait la même publicité, juste plus petite) et sa place
 *     revient entièrement au tenant + au sélecteur de site (`SelecteurSiteEntete`, déplacé tel quel
 *     depuis `EnTete.tsx`, dont la résolution URL -> préférence mémorisée est reprise ICI à
 *     l'identique — voir `site` ci-dessous, seule source pour toute la colonne). La marque reste
 *     l'affaire de l'écran de connexion (`EcranConnexion.tsx`, hors périmètre), pas du cadre
 *     applicatif une fois authentifié.
 *  2. PIED COMPTE — identité + Réglages + déconnexion regroupés en UN SEUL déclencheur adjacent au
 *     filet du pied (§4.2 déjà en place), qui déplie un menu (`DropdownMenu`) au lieu de trois
 *     éléments dispersés. RE-ARBITRAGE ASSUMÉ de la doctrine « Se déconnecter jamais enfoui »
 *     (ancien commentaire de tête d'`EnTete.tsx`, motivé par le poste d'atelier PARTAGÉ) : ce
 *     motif reste vrai à sa place d'origine, la BORNE MURALE (`poste_atelier`), qui ne monte de
 *     toute façon jamais cette colonne (`AppShell.tsx` retire l'`aside` entier pour elle, voir
 *     `BandeauSansNavigation.tsx` où la déconnexion reste un bouton en clair, seule pour cette
 *     raison). Pour un poste de PERSONNE (celui qui monte réellement cette colonne), @laupernoe demande
 *     explicitement ce lot un menu qui se déplie — et dupliquer Réglages en lien direct ICI EN PLUS
 *     du menu aurait reproduit le défaut que ce dépôt corrige déjà ailleurs (deux commandes vers la
 *     même destination sur le même écran, voir `GabaritEcran.tsx`, retour @laupernoe du 12.08.2026).
 *  3. `EnTete.tsx` est SUPPRIMÉ. Ce qu'il portait pour un poste de personne (tenant, site, identité,
 *     déconnexion) descend ici ; la recherche permanente devient `BarreOutilsSuperieure.tsx` (un
 *     bandeau de 48 px, pas 64, avec la ligne du tiroir mobile FUSIONNÉE dedans plutôt qu'empilée
 *     dessus) ; le seul besoin qui restait — la déconnexion pour un poste SANS colonne
 *     (`poste_atelier`, mode scan mobile) — devient `BandeauSansNavigation.tsx`. Voir leurs en-têtes
 *     respectifs pour le chiffrage de hauteur gagnée et le détail de cette scission.
 */
export function BarreLaterale({ className, repli }: Props) {
  const { t } = useTranslation(['navigation', 'auth']);
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
  const deconnexion = useDeconnexion();
  // Numéro de version — voir la doc de `infoVersionBrute` en tête de fichier. Repli traduit
  // (« inconnue ») posé ICI, pas dans `infoVersionBrute`, pour rester une fonction pure sans
  // dépendance à `t`.
  const infoVersion = infoVersionBrute() || t('navigation:pied.versionInconnue');

  // Résolution du nom de site affiché — reprise À L'IDENTIQUE de l'ancienne `EnTete.tsx` (même
  // doctrine « absence de donnée ≠ valeur », issue #91) : un `site` qui ne correspond à AUCUN site
  // de la session (lien obsolète, site renommé/supprimé) est une ABSENCE, jamais la valeur brute de
  // l'URL ni « tous les sites » deviné. `SelecteurSiteEntete` REÇOIT ce libellé déjà résolu, il ne
  // le recalcule pas — un seul endroit qui décide, comme avant ce lot.
  const libelleSite = session
    ? (session.sites.find((candidat) => candidat.id === site)?.nom ??
      t('navigation:entete.siteNonChoisi'))
    : '';

  // Identité du pied compte (§2 du lot ci-dessus) — repris à l'identique de l'ancien
  // `MenuUtilisateur.tsx` (initiales, nom complet, libellé de rôle traduit).
  const libelleCompte = session ? `${session.utilisateur.prenom} ${session.utilisateur.nom}` : '';
  const libelleRole = session ? t(cleTraductionRole(session.utilisateur.role)) : '';
  const initiales = session
    ? `${session.utilisateur.prenom.charAt(0)}${session.utilisateur.nom.charAt(0)}`.toUpperCase()
    : '';

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
            'flex h-11 items-center rounded-md texte-corps font-medium transition-colors',
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
      {repli || session ? (
        // EN-TÊTE DE COLONNE — tenant + site (voir le §1 du lot « cadre applicatif » en tête de
        // fichier), plus le bouton de repli quand `repli` est fourni (jamais dans le tiroir
        // mobile). Rendu dès que L'UN DES DEUX existe : le bouton de repli ne dépend d'aucune
        // donnée de session (préférence locale pure) et doit rester utilisable même avant que la
        // session ne soit résolue — seul le bloc tenant/site, lui, attend `session` pour ne rien
        // affirmer de faux pendant le chargement (même doctrine que le reste du fichier, « le menu
        // s'enrichit, il ne clignote pas »).
        <div
          className={cn(
            'flex shrink-0 flex-col gap-2 border-b p-3',
            replie ? 'items-center gap-3 p-2' : undefined,
          )}
        >
          <div
            className={cn(
              'flex w-full items-center gap-2',
              replie ? 'flex-col' : 'justify-between',
            )}
          >
            {session && !replie ? (
              <p
                className="min-w-0 flex-1 truncate texte-corps font-semibold tracking-tight"
                title={session.tenant.raisonSociale}
              >
                {session.tenant.raisonSociale}
              </p>
            ) : null}
            {repli ? (
              // `aria-expanded` porte l'état pour un lecteur d'écran ; `title` donne l'infobulle
              // au survol, en confort du `aria-label` qui reste le porteur obligatoire.
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
            ) : null}
          </div>
          {session ? (
            <SelecteurSiteEntete
              sites={session.sites}
              siteIdActif={site}
              libelle={libelleSite}
              compact={replie}
            />
          ) : null}
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
       * PIED COMPTE — identité + Réglages + déconnexion, voir le §2 du lot « cadre applicatif » en
       * tête de fichier. Séparé des six entrées par un filet (§4.2) — `shrink-0` : ne rétrécit
       * jamais. UN SEUL déclencheur (`DropdownMenuTrigger`), jamais trois éléments dispersés : la
       * doctrine anti-doublon du dépôt (`GabaritEcran.tsx`) interdit déjà deux commandes vers la
       * même destination sur le même écran — Réglages ne vit donc QUE dans ce menu, pas aussi en
       * lien direct à côté.
       *
       * Rendu dès que `session` existe, SANS dépendre de `reglagesVisibles(role)` — contrairement
       * à l'ancien pied qui conditionnait tout (Réglages ET la version) sur ce même test. Piège
       * évité : `reglagesVisibles` ne vaut aujourd'hui jamais `false` pour un rôle de personne
       * (l'onglet « Tarifs et prestations » n'a AUCUNE restriction), donc l'ancien couplage était
       * invisible en pratique — mais un futur retrait de cette exception aurait fait disparaître la
       * DÉCONNEXION en même temps que Réglages pour le rôle concerné, une régression opérationnelle
       * bien plus grave qu'un onglet manquant. Le menu ne propose Réglages QUE si
       * `reglagesVisibles(role)` reste vrai ; la déconnexion, elle, est TOUJOURS proposée.
       *
       * Numéro de version SOUS le déclencheur, pas dessus (demande @laupernoe, 17.08.2026 : « au-dessus ou
       * en dessous du bouton Réglages », choix laissé à l'agent — Réglages a changé de forme depuis,
       * l'ordre de lecture reste le même : l'action en premier, la métadonnée de confort ensuite).
       *
       * REPLIÉ (icônes seules, colonne à 64 px) : le texte identité + le texte de version sont
       * MASQUÉS entièrement (`hidden`), jamais tronqués — même idiome que le reste de la colonne
       * repliée. L'avatar seul reste le déclencheur, `aria-label`/`title` portent le nom complet +
       * le rôle (même motif que les six entrées : posé dans LES DEUX états, jamais recalculé selon
       * ce qui est visuellement affiché).
       *
       * ABSENT pour `poste_atelier` (borne murale, `AppShell.tsx` retire l'`aside` entier) : la
       * déconnexion de la borne reste un bouton en clair, JAMAIS enfoui — voir
       * `BandeauSansNavigation.tsx`, seul endroit où l'ancienne doctrine « jamais dans un menu »
       * reste appliquée à la lettre, précisément parce que c'est un poste PARTAGÉ.
       */}
      {session ? (
        <div className={cn('shrink-0 border-t', replie ? 'p-2' : 'p-3')}>
          {/* Refonte visuelle (mode sombre, voir DESIGN.md) — bascule clair/sombre POSÉE ICI,
              « près du profil » (demande explicite de @laupernoe) : juste au-dessus du déclencheur de
              compte, dans le même bloc que lui, plutôt qu'enfouie dans le menu qui se déplie (elle
              resterait alors à un clic de plus, pour un réglage qu'un garagiste ajuste une fois et
              rarement ensuite — pas la même fréquence que Réglages/Déconnexion). Repliée en colonne
              (`flex-col`, centrée) quand la barre est repliée : même idiome que le reste de la
              colonne repliée (icône seule, centrée), voir `rendreEntree` plus haut. */}
          <div
            className={cn('flex', replie ? 'flex-col items-center gap-1' : 'items-center gap-2')}
          >
            <BasculeTheme />
            <div className="min-w-0 flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'anneau-focus flex h-11 w-full items-center rounded-md texte-corps font-medium transition-colors hover:bg-muted',
                      replie ? 'justify-center px-2' : 'gap-3 px-3',
                    )}
                    aria-label={`${libelleCompte} — ${libelleRole}`}
                    title={replie ? `${libelleCompte} — ${libelleRole}` : undefined}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary texte-petit font-semibold text-primary-foreground"
                      aria-hidden="true"
                    >
                      {initiales}
                    </span>
                    {!replie ? (
                      <>
                        <span className="min-w-0 flex-1 text-left leading-tight">
                          <span className="block truncate text-foreground">{libelleCompte}</span>
                          <span className="block truncate text-muted-foreground">
                            {libelleRole}
                          </span>
                        </span>
                        <ChevronsUpDown
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </>
                    ) : null}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-56">
                  <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                    {libelleCompte} — {libelleRole}
                  </DropdownMenuLabel>
                  {reglagesVisibles(role) ? (
                    <DropdownMenuItem asChild>
                      <Link to={cheminEntree(ENTREE_REGLAGES, role, site) ?? ''}>
                        <Settings className="h-4 w-4" aria-hidden="true" />
                        {t('navigation:entrees.reglages')}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={() => deconnexion.mutate()}
                    disabled={deconnexion.isPending}
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {t('auth:deconnexion.action')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
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
