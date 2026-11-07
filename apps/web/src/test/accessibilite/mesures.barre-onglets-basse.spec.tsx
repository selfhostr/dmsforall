import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { creerQueryClientTest } from '@/test/utils';

import { BarreOngletsBasse } from '@/composants/layout/BarreOngletsBasse';

import { auditerAccessibiliteEcran, exigerAucuneViolation } from './harnais';

/**
 * Mesure 5/4 (chantier « refonte navigation », composant neuf) — barre d'onglets basse, seule
 * navigation en mode téléphone. `BarreOngletsBasse` ne monte aucun composant portalé (pas de
 * `Sheet`/`Dialog` ici — « Plus » ne fait qu'appeler `ouvrirPlus`, le tiroir lui-même vit dans
 * `AppShell.tsx`, hors périmètre) : `document.body` et le `container` de `render()` coïncident,
 * `document.body` est repris quand même pour rester sur la même convention que les autres
 * `mesures.*.spec.tsx` (voir `harnais.ts`).
 *
 * Session `direction` : les SIX entrées lui sont ouvertes (`entreesVisibles`, `navigation-modele.ts`)
 * — le cas qui exerce le plus la barre, quatre primaires ET un « Plus » non vide (Facturation,
 * Ventes, Réglages y échouent). Un rôle à moins de quatre entrées (ex. `vendeur`) ne prouverait
 * rien de plus sur CE composant : le découpage primaires/« Plus » est piloté par `entreesVisibles`,
 * déjà couvert ailleurs (`navigation-modele.spec.ts`, hors périmètre de ce chantier).
 */
function rendre(routeInitiale: string, plusOuvert = false) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({
        ...SESSION_TEST,
        utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' },
      }),
    ),
  );
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <BarreOngletsBasse ouvrirPlus={() => {}} plusOuvert={plusOuvert} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Accessibilité WCAG 2.1 AA — barre d’onglets basse', () => {
  it('entrée primaire active (aria-current="page")', async () => {
    rendre('/ordres-reparation');
    await screen.findByRole('link', { name: 'Atelier' });

    const audit = await auditerAccessibiliteEcran(
      'Barre d’onglets basse — entrée primaire active',
      document.body,
    );
    exigerAucuneViolation(audit);
  });

  it('route active hors primaires — « Plus » porte aria-current="true" (générique, pas "page")', async () => {
    rendre('/parametrage/relances');
    await screen.findByRole('button', { name: 'Plus' });

    const audit = await auditerAccessibiliteEcran(
      'Barre d’onglets basse — « Plus » actif',
      document.body,
    );
    exigerAucuneViolation(audit);
  });
});

describe('Barre d’onglets basse — la couleur n’est jamais le seul indice de l’entrée active', () => {
  it('l’entrée active change de poids ET de couleur ; les autres restent en poids/couleur neutres', async () => {
    rendre('/ordres-reparation');
    const actif = await screen.findByRole('link', { name: 'Atelier' });
    // `font-semibold` + `text-primary` ENSEMBLE — un daltonien perd `text-primary`, jamais
    // `font-semibold` : la distinction doit survivre à la seule perte de la couleur.
    expect(actif.className).toContain('font-semibold');
    expect(actif.className).toContain('text-primary');

    const inactif = screen.getByRole('link', { name: "Tableau de bord" });
    expect(inactif.className).not.toContain('font-semibold');
    expect(inactif.className).not.toContain('text-primary');
    expect(inactif.className).toContain('font-medium');
  });

  it('« Plus » actif suit la même règle poids + couleur que les entrées primaires', async () => {
    rendre('/parametrage/relances');
    const plus = await screen.findByRole('button', { name: 'Plus' });
    expect(plus.className).toContain('font-semibold');
    expect(plus.className).toContain('text-primary');
  });
});

describe('Barre d’onglets basse — clavier', () => {
  it('les cinq cibles (quatre entrées + "Plus") sont atteignables par tabulation, dans l’ordre visuel', async () => {
    const utilisateur = userEvent.setup();
    rendre('/ordres-reparation');
    await screen.findByRole('link', { name: 'Atelier' });

    // Éléments natifs (`<a>`/`<button>`) : la tabulation du navigateur les enchaîne sans qu'aucun
    // `tabIndex` explicite ne soit nécessaire — vérifié ici en rejouant la tabulation réelle plutôt
    // qu'en inspectant l'attribut, qui ne prouve rien sur l'ordre effectif.
    const cibles = [
      screen.getByRole('link', { name: "Tableau de bord" }),
      screen.getByRole('link', { name: 'Atelier' }),
      screen.getByRole('link', { name: 'Clients & véhicules' }),
      screen.getByRole('link', { name: 'Pièces' }),
      screen.getByRole('button', { name: 'Plus' }),
    ];

    for (const cible of cibles) {
      await utilisateur.tab();
      expect(cible).toHaveFocus();
    }
  });

  it('« Plus » est opérable au clavier (Entrée déclenche ouvrirPlus, sans clic souris)', async () => {
    const utilisateur = userEvent.setup();
    let appels = 0;
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' },
        }),
      ),
    );
    render(
      <QueryClientProvider client={creerQueryClientTest()}>
        <MemoryRouter initialEntries={['/ordres-reparation']}>
          <BarreOngletsBasse
            ouvrirPlus={() => {
              appels += 1;
            }}
            plusOuvert={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const bouton = await screen.findByRole('button', { name: 'Plus' });
    bouton.focus();
    await utilisateur.keyboard('{Enter}');

    expect(appels).toBe(1);
  });
});

describe('Barre d’onglets basse — plancher de cible tactile (jeton, pas un rendu mesuré)', () => {
  // LIMITE ASSUMÉE : jsdom ne fait aucune mise en page réelle (`vitest.config.ts` pose `css: false`)
  // — impossible de lire une hauteur en pixels rendue ici, ce serait simuler une mesure plutôt que
  // la faire (voir consigne de la mission). Ce qui EST vérifiable mécaniquement : la valeur du
  // jeton `--barre-onglets-hauteur` (index.css), qui fixe la hauteur de TOUTE la rangée — et donc
  // de chaque `<li className="flex flex-1">` qui s'y étire (`items-stretch`, `BarreOngletsBasse.tsx`).
  // Un jeton qui repasserait sous 44px romprait le plancher tactile du produit pour cette barre
  // entière, silencieusement pour quiconque ne relit pas `index.css` à l'œil — cette assertion le
  // fait échouer à la place. Même technique de lecture directe que `jetons-css.ts`
  // (`contraste-jetons.spec.ts`), pas une copie à la main de la valeur.
  it('le jeton --barre-onglets-hauteur reste au-dessus du plancher de 44px', () => {
    const cheminModule = fileURLToPath(import.meta.url);
    const cheminIndexCss = path.resolve(path.dirname(cheminModule), '../../index.css');
    const source = readFileSync(cheminIndexCss, 'utf-8');

    const correspondance = /--barre-onglets-hauteur:\s*(\d+(?:\.\d+)?)px;/.exec(source);
    expect(
      correspondance,
      'jeton --barre-onglets-hauteur introuvable ou reformulé dans une unité non-px dans index.css',
    ).not.toBeNull();

    const valeurPx = Number(correspondance?.[1]);
    expect(valeurPx).toBeGreaterThanOrEqual(44);
  });
});
