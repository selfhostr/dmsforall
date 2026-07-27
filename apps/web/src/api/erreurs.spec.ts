import { describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { construireErreurApi, ErreurApi, ErreurReseau, messageErreur } from './erreurs';

async function attendreI18nPret() {
  if (!i18n.isInitialized) {
    await new Promise<void>((resoudre) => i18n.on('initialized', () => resoudre()));
  }
}

describe('construireErreurApi / messageErreur', () => {
  it('extrait le code depuis un problem+json valide et traduit via erreurs:codes.<CODE>', async () => {
    await attendreI18nPret();
    const reponse = new Response(
      JSON.stringify({
        type: 'https://docs.dmsforall.example/erreurs/AUTH_IDENTIFIANTS_INVALIDES',
        title: 'Identifiants invalides',
        status: 401,
        code: 'AUTH_IDENTIFIANTS_INVALIDES',
        instance: 'req-1',
        detail: 'Ne doit jamais apparaître à l’écran',
      }),
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur).toBeInstanceOf(ErreurApi);
    expect(erreur.probleme.code).toBe('AUTH_IDENTIFIANTS_INVALIDES');

    const message = messageErreur(erreur, i18n.t);
    expect(message).toBe('Adresse e-mail ou mot de passe incorrect.');
    expect(message).not.toContain('Ne doit jamais apparaître');
  });

  it('synthétise ERREUR_INTERNE sur un corps HTML non-JSON (ex. 502 de proxy)', async () => {
    await attendreI18nPret();
    const reponse = new Response('<html><body>Bad Gateway</body></html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur.probleme.code).toBe('ERREUR_INTERNE');
    expect(messageErreur(erreur, i18n.t)).toBe("Une erreur interne s'est produite. Réessayez.");
  });

  it('synthétise ERREUR_INTERNE si le Content-Type annonce problem+json mais le corps est illisible', async () => {
    await attendreI18nPret();
    const reponse = new Response('{ceci-nest-pas-du-json', {
      status: 500,
      headers: { 'content-type': 'application/problem+json' },
    });
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur.probleme.code).toBe('ERREUR_INTERNE');
  });

  it('synthétise ERREUR_INTERNE si le code du problem+json est inconnu du contrat', async () => {
    await attendreI18nPret();
    const reponse = new Response(
      JSON.stringify({
        type: 'https://docs.dmsforall.example/erreurs/UN_CODE_QUI_NEXISTE_PAS',
        title: 'Inconnu',
        status: 400,
        code: 'UN_CODE_QUI_NEXISTE_PAS',
        instance: 'req-2',
      }),
      { status: 400, headers: { 'content-type': 'application/problem+json' } },
    );
    const erreur = construireErreurApi(reponse, await reponse.clone().text());
    expect(erreur.probleme.code).toBe('ERREUR_INTERNE');
  });

  it('produit un message réseau distinct pour ErreurReseau', async () => {
    await attendreI18nPret();
    const message = messageErreur(new ErreurReseau(new Error('fetch failed')), i18n.t);
    expect(message).toBe('Vérifiez votre connexion internet, puis réessayez.');
  });
});
