import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useDeconnexion } from '@/hooks/useDeconnexion';
import { useSession } from '@/hooks/useSession';

/**
 * BANDEAU MINIMAL — remplace `EnTete.tsx` pour les DEUX postes SANS barre latérale
 * (`AppShell.tsx`, `afficheNavigation` faux) : `poste_atelier` (la borne murale, §2 — « aucun
 * menu, aucun en-tête, aucune recherche ») et le mode scan mobile (restriction stricte au scan
 * seul, `useModeScanMobile.ts`). Aucun des deux n'a de `BarreLaterale` où loger identité/Réglages/
 * déconnexion (Lot « cadre applicatif », 19.08.2026) — un SEUL besoin reste réel ici : quitter la
 * session.
 *
 * BOUTON EN CLAIR, JAMAIS DANS UN MENU — contrairement au pied compte de `BarreLaterale.tsx`
 * (identité + Réglages + déconnexion regroupés dans un menu qui se déplie, RE-ARBITRAGE ASSUMÉ de
 * cette même doctrine pour un poste de PERSONNE). Ici, la doctrine d'origine reste appliquée à la
 * lettre : la borne d'atelier est un poste PARTAGÉ entre plusieurs collègues, la déconnexion doit
 * rester un geste immédiat et visible, jamais un clic de plus derrière un déclencheur.
 *
 * PLUS ÉTROIT que l'ancienne `EnTete.tsx`, qui gardait TOUT son contenu (recherche, tenant, site,
 * identité) pour ces deux postes « contrairement à la lettre de §2 », uniquement parce que rien ne
 * séparait alors ces besoins d'une déconnexion nécessaire. En reconstruisant le bandeau depuis
 * zéro pour ce lot, §2 est désormais honoré au plus près : ni recherche, ni tenant, ni site, ni
 * identité — seulement ce que la nécessité opérationnelle documentée exige. 48 px de haut (`h-12`)
 * contre 64 (`h-16` de l'ancienne `EnTete`) : un gain de hauteur mécanique, en plus de la
 * simplification.
 */
export function BandeauSansNavigation() {
  const { t } = useTranslation('auth');
  const { data: session } = useSession();
  const deconnexion = useDeconnexion();

  if (!session) return null;

  return (
    <header className="flex h-12 shrink-0 items-center justify-end border-b bg-background px-4">
      <Button
        type="button"
        variant="outline"
        onClick={() => deconnexion.mutate()}
        disabled={deconnexion.isPending}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t('auth:deconnexion.action')}
      </Button>
    </header>
  );
}
