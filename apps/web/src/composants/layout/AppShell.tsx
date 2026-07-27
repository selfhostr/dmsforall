import { Menu } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

import { BarreLaterale } from './BarreLaterale';
import { EnTete } from './EnTete';

/** >=1024px : barre latérale fixe 240px. En dessous : Sheet (tiroir) déclenché par un bouton
 *  hamburger dans la bande supérieure mobile. */
export function AppShell() {
  const { t } = useTranslation('navigation');
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden w-60 shrink-0 border-r lg:block">
        <BarreLaterale />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b lg:hidden">
          <Sheet open={ouvert} onOpenChange={setOuvert}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="m-2"
                aria-label={t('navigation:menu.ouvrir')}
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-60 p-0">
              <SheetTitle className="sr-only">{t('navigation:principale.aria')}</SheetTitle>
              <BarreLaterale className="pt-4" />
            </SheetContent>
          </Sheet>
        </div>

        <EnTete />

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
