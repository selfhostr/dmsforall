import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { routesConfig } from './routeur';

/**
 * Comportements de bout en bout du routeur réel (`routesConfig`, la même configuration que celle
 * utilisée en production par `routeur` — voir routeur.tsx) : ce fichier teste l'ASSEMBLAGE, pas
 * les écrans eux-mêmes (déjà testés individuellement dans leurs `*.spec.tsx` respectifs).
 */
describe('routeur — protection par défaut', () => {
  it('une route métier protégée sans session redirige vers /login', async () => {
    // Handler par défaut de test/msw/handlers.ts : 401 sur /auth/moi (« pas de session »).
    renduAvecRoutes(routesConfig, { routeInitiale: '/clients' });
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('la même route protégée s’affiche avec une session valide', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/clients', () => HttpResponse.json({ donnees: [], curseurSuivant: null })),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/clients' });
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
  });

  it('/ amène à l’accueil', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, { routeInitiale: '/' });
    expect(await screen.findByText('Retrouvez un client, un véhicule ou un ordre')).toBeInTheDocument();
  });

  it('un lien existant vers l’écran d’OR (pas encore écrit) affiche un message honnête, jamais une page introuvable', async () => {
    // La fiche client (« Ouvrir un OR », derniers OR) et la recherche globale naviguent déjà vers
    // `/ordres-reparation/:id` alors qu'aucun écran d'OR n'existe (module Atelier, hors périmètre
    // — voir EcranFonctionAVenir.tsx). Un 404 générique laisserait croire à un lien cassé.
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    renduAvecRoutes(routesConfig, { routeInitiale: '/ordres-reparation/or-1' });
    expect(await screen.findByText("Cette fonctionnalité n'est pas encore disponible.")).toBeInTheDocument();
    expect(screen.queryByText("Cette page n'existe pas")).not.toBeInTheDocument();
  });
});

/**
 * Le défaut que ce test existe pour attraper : un écran fini, testé, mais câblé nulle part — le
 * routeur n'expose alors qu'une fraction des écrans réellement livrés sans que rien ne le signale
 * (voir consigne de la tâche). Le scan est volontairement fait sur le DISQUE, jamais sur une
 * liste figée à la main — même raison que `scripts/verifier-i18n.mjs` (une liste en dur ment dès
 * qu'un écran s'ajoute sans qu'on pense à la mettre à jour).
 *
 * `ecrans/systeme/**` est exclu : ces écrans (page introuvable, erreur fatale, config invalide,
 * service indisponible, vérification de session) ne sont pas des routes avec un `path` propre —
 * ils sont câblés programmatiquement ailleurs (main.tsx, App.tsx, RouteProtegee/RoutePublique),
 * et le sont déjà (vérifié à la lecture de ces fichiers).
 */
describe('couverture des écrans métier', () => {
  const racineRoutes = path.dirname(fileURLToPath(import.meta.url));
  const racineSrc = path.resolve(racineRoutes, '..');
  const dossierEcrans = path.join(racineSrc, 'ecrans');
  const sourceRouteur = readFileSync(path.join(racineRoutes, 'routeur.tsx'), 'utf-8');

  function listerEcransMetier(dossier: string): string[] {
    const resultats: string[] = [];
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const cheminComplet = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === 'systeme') continue;
        resultats.push(...listerEcransMetier(cheminComplet));
        continue;
      }
      if (entree.name.startsWith('Ecran') && entree.name.endsWith('.tsx') && !entree.name.endsWith('.spec.tsx')) {
        resultats.push(entree.name.replace(/\.tsx$/, ''));
      }
    }
    return resultats;
  }

  it('chaque écran métier existant (hors ecrans/systeme) est référencé dans le routeur', () => {
    const ecrans = listerEcransMetier(dossierEcrans);
    // Garde-fou : si le scan lui-même se casse silencieusement (mauvais chemin, etc.), ce test
    // ne doit pas passer « vide » — il doit trouver AU MOINS les écrans déjà connus au moment où
    // ce test est écrit.
    expect(ecrans.length).toBeGreaterThanOrEqual(7);
    const manquants = ecrans.filter((nomEcran) => !sourceRouteur.includes(nomEcran));
    expect(manquants).toEqual([]);
  });
});
