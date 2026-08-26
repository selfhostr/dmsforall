import { fileURLToPath } from 'node:url';

import { test as setup } from '@playwright/test';

import { seConnecter } from '../support/connexion';

const FICHIER_ETAT_AUTHENTIFIE = fileURLToPath(
  new URL('../.auth/utilisateur.json', import.meta.url),
);

/**
 * Projet de dépendance (voir playwright.config.ts, projet `authentification`) : se connecte UNE
 * FOIS avec le compte de démonstration et écrit la session (cookie httpOnly) sur disque. Tous les
 * specs du projet `chromium` réutilisent cet état plutôt que de rejouer le formulaire — voir le
 * commentaire de `FICHIER_ETAT_AUTHENTIFIE` dans playwright.config.ts pour le pourquoi.
 */
setup('authentification', async ({ page }) => {
  await seConnecter(page);
  await page.context().storageState({ path: FICHIER_ETAT_AUTHENTIFIE });
});
