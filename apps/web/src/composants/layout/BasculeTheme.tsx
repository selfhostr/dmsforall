import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

/**
 * BASCULE CLAIR/SOMBRE — refonte visuelle, voir DESIGN.md. `useTheme()` vient de `next-themes`
 * (`<ThemeProvider>` posé dans `App.tsx`, `attribute="class"`), qui pose `class="dark"`/`"light"`
 * sur `<html>` — c'est ce que `@custom-variant dark` et les jetons `.dark { ... }` d'`index.css`
 * attendent. Persistance `localStorage` SEULE (arbitrage de @laupernoe) : ni colonne en base, ni point
 * d'API — le réglage ne suit donc pas le garagiste d'un poste à l'autre, assumé.
 *
 * DEUX ÉTATS EXPOSÉS DANS L'UI, PAS TROIS. `système` reste le point de départ RÉEL avant tout clic
 * (`defaultTheme="system"`, `App.tsx`) : au premier lancement, le produit suit déjà la préférence
 * système sans qu'aucun bouton n'ait été touché — l'écran de connexion et le premier écran vus par
 * un garagiste rendent donc déjà dans le bon thème. Une fois qu'un clic a lieu, le choix devient
 * explicite et n'est plus recalculé si la préférence système change ensuite : trois états à choisir
 * dans l'UI (clair / sombre / système) auraient ajouté un choix rarement utile face au binaire qui
 * couvre le vrai besoin (« je veux voir clair » / « je veux voir sombre », au clic).
 *
 * `resolvedTheme` (JAMAIS `theme`) pilote l'icône affichée : `theme` peut valoir `'system'`, ce qui
 * ne dit rien de ce qui est RÉELLEMENT rendu à l'écran — `resolvedTheme` vaut toujours `'light'` ou
 * `'dark'`, jamais `'system'`.
 *
 * Libellé posé sur le MÊME modèle que `repli.reduire`/`repli.agrandir` (`navigation-modele.ts`,
 * `BarreLaterale.tsx`) : le texte décrit l'ACTION du clic (« passer au thème sombre »), pas l'état
 * courant — cohérent avec le reste de la colonne.
 */
export function BasculeTheme() {
  const { t } = useTranslation('navigation');
  const { resolvedTheme, setTheme } = useTheme();
  const sombre = resolvedTheme === 'dark';
  const libelle = t(sombre ? 'navigation:theme.passerClair' : 'navigation:theme.passerSombre');

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(sombre ? 'light' : 'dark')}
      aria-label={libelle}
      title={libelle}
    >
      {sombre ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}
