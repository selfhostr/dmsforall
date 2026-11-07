import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { i18nPret } from '@/i18n';
import '@/index.css';
import { ErreurEnvInvalide, initialiserEnv } from '@/config/env';
import { installerCollecteur } from '@/diagnostic/tampon';
import { initialiserSentry } from '@/observabilite/sentry';

// Tampon mémoire du diagnostic de « Signaler un problème » : branché avant tout le reste pour ne
// rien manquer du démarrage. Rien n'est persisté ni envoyé tant que l'utilisateur ne le demande pas.
installerCollecteur();

const conteneur = document.getElementById('root');
if (!conteneur) {
  throw new Error('Élément racine #root introuvable dans index.html.');
}
const racine = createRoot(conteneur);

// Traductions de la langue active en mémoire avant tout rendu (y compris l'écran d'erreur ci-dessous).
await i18nPret.catch(() => undefined);

// La config est validée AVANT tout le reste : si elle est invalide, on n'importe même pas
// App (et donc jamais api/client.ts, qui lit VITE_API_URL) — import dynamique volontaire.
try {
  initialiserEnv();
  // Non bloquant à dessein : initialiserSentry() charge le SDK en tâche de fond (voire ne fait
  // rien si VITE_SENTRY_DSN est absent) et ne doit jamais retarder le premier rendu.
  initialiserSentry();
  const { default: App } = await import('@/App');
  racine.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (erreur) {
  const { EcranConfigInvalide } = await import('@/ecrans/systeme/EcranConfigInvalide');
  racine.render(
    <StrictMode>
      <EcranConfigInvalide erreur={erreur instanceof ErreurEnvInvalide ? erreur : undefined} />
    </StrictMode>,
  );
}
