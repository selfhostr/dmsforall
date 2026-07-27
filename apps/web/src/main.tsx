import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/i18n';
import '@/index.css';
import { ErreurEnvInvalide, initialiserEnv } from '@/config/env';

const conteneur = document.getElementById('root');
if (!conteneur) {
  throw new Error('Élément racine #root introuvable dans index.html.');
}
const racine = createRoot(conteneur);

// La config est validée AVANT tout le reste : si elle est invalide, on n'importe même pas
// App (et donc jamais api/client.ts, qui lit VITE_API_URL) — import dynamique volontaire.
try {
  initialiserEnv();
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
