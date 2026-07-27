import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDeconnexion } from '@/hooks/useDeconnexion';
import { useSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';

import { MenuUtilisateur } from './MenuUtilisateur';
import { SelecteurLangue } from './SelecteurLangue';

/** Bouton « Se déconnecter » visible en clair, jamais enfoui dans un menu : poste d'atelier
 *  partagé entre plusieurs collègues, la déconnexion doit être un geste immédiat et visible. */
export function EnTete() {
  const { t } = useTranslation(['navigation', 'auth']);
  const { data: session } = useSession();
  const deconnexion = useDeconnexion();

  if (!session) return null;

  const site = session.sites.find((candidat) => candidat.actif) ?? session.sites[0];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-4">
      <div className="min-w-0">
        <p className="truncate font-semibold" title={session.tenant.raisonSociale}>
          {session.tenant.raisonSociale}
        </p>
        {site ? (
          <p className="truncate text-sm text-muted-foreground" title={site.nom}>
            {site.nom}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
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
