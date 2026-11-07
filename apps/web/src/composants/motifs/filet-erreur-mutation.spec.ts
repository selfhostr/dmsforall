import { afterEach, describe, expect, it } from 'vitest';

import { ErreurApi, ErreurReseau } from '@/api/erreurs';
import '@/i18n';
import i18n from '@/i18n';

import {
  afficherToastFiletErreurMutation,
  construireToastFiletErreurMutation,
  ecouterFiletErreurMutation,
  fermerToastFiletErreurMutation,
  obtenirToastsFiletErreurMutation,
  reinitialiserFiletErreurMutation,
} from './filet-erreur-mutation';

async function attendreI18nPret() {
  if (!i18n.isInitialized) {
    await new Promise<void>((resoudre) => i18n.on('initialized', () => resoudre()));
  }
}

function erreurApi(
  code: 'DROIT_INSUFFISANT' | 'CONFLIT' | 'ERREUR_INTERNE' | 'OR_TRANSITION_INTERDITE',
  status: number,
) {
  return new ErreurApi({
    type: `https://docs.dmsforall.example/erreurs/${code}`,
    title: code,
    status,
    code,
    instance: 'req-test',
  });
}

describe('classification de gravité (construireToastFiletErreurMutation)', () => {
  afterEach(() => reinitialiserFiletErreurMutation());

  it('distingue un refus de droit (403 / DROIT_INSUFFISANT)', async () => {
    await attendreI18nPret();
    const toast = construireToastFiletErreurMutation(erreurApi('DROIT_INSUFFISANT', 403), i18n.t);
    expect(toast.gravite).toBe('droit');
    expect(toast.titre).toBe('Action refusée');
    expect(toast.message).toBe(
      "Votre rôle ne permet pas cette action. Demandez à la direction de vous l'ouvrir, ou faites-la faire par un collègue autorisé.",
    );
  });

  it('distingue un conflit métier (409)', async () => {
    await attendreI18nPret();
    const toast = construireToastFiletErreurMutation(
      erreurApi('OR_TRANSITION_INTERDITE', 409),
      i18n.t,
    );
    expect(toast.gravite).toBe('conflit');
    expect(toast.titre).toBe('Action impossible');
  });

  it('distingue une panne réseau (ErreurReseau, jamais atteint le serveur)', async () => {
    await attendreI18nPret();
    const toast = construireToastFiletErreurMutation(new ErreurReseau(), i18n.t);
    expect(toast.gravite).toBe('reseau');
    expect(toast.titre).toBe('Connexion impossible');
  });

  it('distingue une erreur serveur (5xx / ERREUR_INTERNE)', async () => {
    await attendreI18nPret();
    const toast = construireToastFiletErreurMutation(erreurApi('ERREUR_INTERNE', 500), i18n.t);
    expect(toast.gravite).toBe('serveur');
    expect(toast.titre).toBe('Service momentanément indisponible');
  });

  it('un id UNIQUE est produit à chaque appel (plusieurs toasts simultanés ne se confondent pas)', async () => {
    await attendreI18nPret();
    const erreur = erreurApi('CONFLIT', 409);
    const premier = construireToastFiletErreurMutation(erreur, i18n.t);
    const second = construireToastFiletErreurMutation(erreur, i18n.t);
    expect(premier.id).not.toBe(second.id);
  });
});

describe('magasin de toasts (afficher/fermer/écouter)', () => {
  afterEach(() => reinitialiserFiletErreurMutation());

  it('afficherToastFiletErreurMutation ajoute un toast et notifie les écouteurs', async () => {
    await attendreI18nPret();
    let notifications = 0;
    const desabonner = ecouterFiletErreurMutation(() => {
      notifications += 1;
    });

    afficherToastFiletErreurMutation(erreurApi('CONFLIT', 409), i18n.t);

    expect(obtenirToastsFiletErreurMutation()).toHaveLength(1);
    expect(notifications).toBe(1);
    desabonner();
  });

  it('fermerToastFiletErreurMutation retire UNIQUEMENT le toast visé, les autres restent', async () => {
    await attendreI18nPret();
    afficherToastFiletErreurMutation(erreurApi('CONFLIT', 409), i18n.t);
    afficherToastFiletErreurMutation(erreurApi('ERREUR_INTERNE', 500), i18n.t);
    const [premier, second] = obtenirToastsFiletErreurMutation();

    fermerToastFiletErreurMutation(premier!.id);

    const restants = obtenirToastsFiletErreurMutation();
    expect(restants).toHaveLength(1);
    expect(restants[0]!.id).toBe(second!.id);
  });

  it('fermer un id inconnu ne fait rien (pas de notification superflue)', async () => {
    await attendreI18nPret();
    afficherToastFiletErreurMutation(erreurApi('CONFLIT', 409), i18n.t);
    let notifications = 0;
    const desabonner = ecouterFiletErreurMutation(() => {
      notifications += 1;
    });

    fermerToastFiletErreurMutation('id-qui-nexiste-pas');

    expect(obtenirToastsFiletErreurMutation()).toHaveLength(1);
    expect(notifications).toBe(0);
    desabonner();
  });
});
