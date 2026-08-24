import { LogOut } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { SelecteurLangue } from '@/composants/layout/SelecteurLangue';

import type { IdentitePlateformeConsole } from './types';

interface Props {
  /** PROVISOIRE — voir le commentaire de `IdentitePlateformeConsole` dans `types.ts`. Absente tant
   *  qu'aucune source réelle n'existe : ce bloc de l'en-tête est alors simplement omis, jamais
   *  rempli d'une identité inventée (règle du dépôt : ne jamais fabriquer de fausses données). */
  readonly identite?: IdentitePlateformeConsole;
  /** Repli : navigue vers `/` si aucun geste de déconnexion réel n'est encore câblé (le modèle
   *  d'accès plateforme n'est pas tranché — `conception-console-exploitation-acces.md`). Le
   *  bouton reste RÉEL et ACTIONNABLE dans les deux cas, jamais désactivé : même principe que
   *  `EnTete.tsx` (« bouton visible, jamais enfoui dans un menu »). */
  readonly onDeconnexion?: () => void;
  readonly children: ReactNode;
}

/**
 * Coquille du palier 1 (§2/§8 de la conception) : bande console SANS `BarreLaterale` — un écran
 * unique, pas une application de onze modules. Remplace `EnTete`/`AppShell` (pas de raison
 * sociale de tenant à afficher : il n'y en a pas encore, on est au-dessus de tout tenant).
 */
export function ConsoleShell({ identite, onDeconnexion, children }: Props) {
  const { t } = useTranslation('console');
  const navigate = useNavigate();

  useEffect(() => {
    document.title = t('console:titreOnglet');
  }, [t]);

  const gererDeconnexion = onDeconnexion ?? (() => navigate('/'));

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-background px-4">
        <p className="texte-annexe font-semibold text-foreground">{t('console:titre')}</p>
        <div className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-3">
          {identite ? (
            <div className="hidden text-right texte-corps leading-tight sm:block">
              <p className="font-medium text-foreground">
                {identite.prenom} {identite.nom}
              </p>
              <p className="text-muted-foreground">{identite.libelleRole}</p>
            </div>
          ) : null}
          <SelecteurLangue />
          <Button type="button" variant="outline" onClick={gererDeconnexion}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {t('console:bandeConsole.deconnexion')}
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
