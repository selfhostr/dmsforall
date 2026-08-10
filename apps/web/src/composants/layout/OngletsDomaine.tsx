import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

import {
  ongletsVisibles,
  trouverCorrespondance,
  vuesVisibles,
  type CorrespondanceNavigation,
} from './navigation-modele';

interface Props {
  readonly className?: string;
}

/**
 * ONGLETS INTERNES — le second niveau de l'arborescence du Lot D
 * (`docs/refonte-navigation.md` §4.2). Les vingt-quatre entrées de menu retirées ne sont pas
 * supprimées : elles descendent ici, en onglets et en vues. « Un onglet n'est pas une fusion,
 * c'est un rangement. »
 *
 * DE VRAIS LIENS, jamais un `Tabs` à état local (le composant `components/ui/tabs.tsx` existe et
 * n'est délibérément pas utilisé ici) : chaque onglet est une ROUTE. Conséquences concrètes, toutes
 * voulues — Ctrl/Cmd+clic ouvre l'onglet dans un nouvel onglet du navigateur, le bouton Précédent
 * revient à l'onglet précédent, une URL copiée-collée rouvre exactement la même vue, et le
 * surlignage survit à un rechargement. Un `Tabs` à état local perdrait les quatre.
 *
 * RENDU DEPUIS `AppShell`, pas depuis chaque écran. C'est la décision structurante de ce composant
 * et elle mérite d'être justifiée, parce que la consigne du lot disait « que les écrans de domaine
 * consommeront » : trente-cinq écrans devant chacun se souvenir d'appeler ce composant, c'est
 * trente-cinq occasions d'oublier — exactement le défaut « écrit, testé, jamais câblé » que ce
 * dépôt collectionne (un contrôleur absent de son `@Module`, un namespace i18n non enregistré). En
 * le montant une fois dans la coquille, la rangée d'onglets EXISTE pour toute route qui appartient
 * à l'arborescence, y compris les écrans livrés par d'autres agents et ceux qui n'existent pas
 * encore, sans qu'aucun d'eux n'ait une ligne à écrire.
 *
 * Il reste réutilisable au sens strict : `trouverCorrespondance` et `navigation-modele.ts` sont
 * exportés, et un écran qui aurait besoin de sa propre rangée (un plein écran hors coquille, par
 * exemple) peut monter ce composant lui-même.
 *
 * ÉTAT VIDE : une URL hors arborescence (`/recherche`, `/login`, une 404) ou un onglet unique ne
 * rend RIEN — pas une rangée à un seul onglet, qui n'offre aucun choix et ne ferait que voler
 * 44 px de hauteur à l'écran. Il n'y a ni chargement ni erreur à gérer : la structure est statique
 * et le seul appel réseau (`useSession`, déjà en cache à ce niveau) ne fait que FILTRER — pendant
 * sa résolution, les onglets sans restriction de rôle s'affichent et les onglets gouvernés
 * apparaissent ensuite, jamais l'inverse (voir `estAutorise`) : la rangée s'enrichit, elle ne
 * clignote pas.
 */
export function OngletsDomaine({ className }: Props) {
  const { t } = useTranslation('navigation');
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const correspondance: CorrespondanceNavigation | undefined = trouverCorrespondance(pathname);
  if (correspondance === undefined) return null;

  const onglets = ongletsVisibles(correspondance.entree, role);
  const vues = vuesVisibles(correspondance.onglet, role);

  const afficheOnglets = onglets.length > 1;
  const afficheVues = vues.length > 1;
  if (!afficheOnglets && !afficheVues) return null;

  const libelleEntree = t(correspondance.entree.cleLibelle);

  return (
    <div className={cn('shrink-0 border-b bg-background', className)}>
      {afficheOnglets ? (
        // `aria-label` nommé par le domaine (« Onglets d'Atelier ») et non « Onglets » tout court :
        // deux zones de navigation dans la même page (barre latérale + onglets) doivent porter des
        // noms distincts, sinon un lecteur d'écran annonce deux fois « navigation » sans dire
        // laquelle. Défilement horizontal sur petit écran plutôt qu'un repli en menu déroulant :
        // sur une tablette, faire glisser une rangée est un geste, ouvrir un menu en est deux.
        <nav
          aria-label={t('navigation:onglets.aria', { domaine: libelleEntree })}
          className="overflow-x-auto"
        >
          <ul className="flex min-w-max items-stretch gap-1 px-2">
            {onglets.map((onglet) => {
              const actif = onglet.id === correspondance.onglet.id;
              return (
                <li key={onglet.id} className="flex">
                  {/* `Link` et non `NavLink` : `NavLink` ne restitue `aria-current` que si son
                      PROPRE `isActive` interne (comparaison de `to` à `location.pathname`) est
                      vrai, ce qui coïncide ici avec `actif` par construction (`to` est toujours le
                      chemin propre de l'onglet rendu) — mais cette coïncidence tiendrait à un
                      détail du modèle de navigation, pas à une garantie du composant. Voir le même
                      correctif, motivé par un cas où la coïncidence casse, dans
                      `BarreLaterale.tsx`. Un `Link` laisse `aria-current` porté par `actif`, la
                      même valeur qui pose déjà `border-primary`, sans dépendre de cette
                      coïncidence. */}
                  <Link
                    to={onglet.chemin(site)}
                    aria-current={actif ? 'page' : undefined}
                    className={cn(
                      // h-11 = 44 px, plancher tactile du produit (postes de comptoir tactiles,
                      // §4.6) — jamais réduit sur desktop, la souris n'est pas la seule entrée.
                      'flex h-11 items-center whitespace-nowrap rounded-t-md border-b-2 px-4 text-sm transition-colors',
                      'anneau-focus',
                      actif
                        ? 'border-primary font-semibold text-foreground'
                        : 'border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {t(onglet.cleLibelle)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {afficheVues ? (
        // Second niveau, visuellement subordonné (pastilles pleines contre soulignement) pour que
        // la hiérarchie se lise sans avoir à comparer les libellés. Même hauteur de cible : un
        // troisième niveau reste tactile.
        <nav
          aria-label={t('navigation:onglets.vuesAria', {
            onglet: t(correspondance.onglet.cleLibelle),
          })}
          className={cn('overflow-x-auto', afficheOnglets ? 'border-t' : undefined)}
        >
          <ul className="flex min-w-max items-stretch gap-1 px-2 py-1.5">
            {vues.map((vue) => {
              const actif = vue.id === correspondance.vue?.id;
              return (
                <li key={vue.id} className="flex">
                  {/* `Link`, même motif que la rangée d'onglets ci-dessus : `aria-current` doit
                      rester porté par `actif` plutôt que par l'`isActive` interne de `NavLink`. */}
                  <Link
                    to={vue.chemin(site)}
                    aria-current={actif ? 'page' : undefined}
                    className={cn(
                      'flex h-11 items-center whitespace-nowrap rounded-md px-3 text-sm transition-colors',
                      'anneau-focus',
                      actif
                        ? 'bg-secondary font-semibold text-secondary-foreground'
                        : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {t(vue.cleLibelle)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
