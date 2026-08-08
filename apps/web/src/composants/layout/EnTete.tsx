import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useDeconnexion } from '@/hooks/useDeconnexion';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';

import { MenuUtilisateur } from './MenuUtilisateur';
import { RechercheGlobale } from './RechercheGlobale';
import { SelecteurLangue } from './SelecteurLangue';

/** Bouton « Se déconnecter » visible en clair, jamais enfoui dans un menu : poste d'atelier
 *  partagé entre plusieurs collègues, la déconnexion doit être un geste immédiat et visible. */
export function EnTete() {
  const { t } = useTranslation(['navigation', 'auth']);
  const { data: session } = useSession();
  const deconnexion = useDeconnexion();
  const [searchParams] = useSearchParams();

  if (!session) return null;

  // Le site affiché suit le site réellement consulté (`?site=` dans l'URL), jamais un défaut
  // de session — même mécanisme que BarreLaterale.tsx / EcranListeVehicules (routes/chemins.ts),
  // pas un troisième. `?site=` absent => l'utilisateur est sur « tous les sites », un contexte
  // réel qu'on affiche tel quel plutôt que d'y substituer un site deviné. Un id présent mais qui
  // ne correspond à aucun site de la session (lien obsolète, site renommé/supprimé entre-temps)
  // retombe sur la même mention : jamais la valeur brute de l'URL, non fiable, affichée à l'écran.
  const siteId = searchParams.get('site');
  const site = siteId ? session.sites.find((candidat) => candidat.id === siteId) : undefined;
  const libelleSite = site?.nom ?? t('navigation:entete.tousLesSites');

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-background px-4">
      <div className="min-w-0 shrink">
        <p className="truncate font-semibold" title={session.tenant.raisonSociale}>
          {session.tenant.raisonSociale}
        </p>
        <p className="truncate text-sm text-muted-foreground" title={libelleSite}>
          {libelleSite}
        </p>
      </div>
      {/* Lot A (`docs/plan-refonte-navigation.md`) : centre de la barre haute, auparavant vide —
          la recherche partout, jamais à une route dédiée. `min-w-0` laisse le bouton se réduire
          plutôt que de forcer le header à défiler horizontalement sur petit écran. */}
      <div className="flex min-w-0 flex-1 justify-center">
        <RechercheGlobale />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <SelecteurLangue />
        <MenuUtilisateur utilisateur={session.utilisateur} />
        <Button
          type="button"
          variant="outline"
          onClick={() => deconnexion.mutate()}
          disabled={deconnexion.isPending}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t('auth:deconnexion.action')}
        </Button>
      </div>
    </header>
  );
}
