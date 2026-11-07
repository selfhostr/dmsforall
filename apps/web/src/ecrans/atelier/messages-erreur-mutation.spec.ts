import { describe, expect, it } from 'vitest';

import { ErreurApi } from '@/api/erreurs';
import '@/i18n';
import i18n from '@/i18n';

import { messageErreurMutation, messagesErreurMutation } from './messages-erreur-mutation';

async function attendreI18nPret() {
  if (!i18n.isInitialized) {
    await new Promise<void>((resoudre) => i18n.on('initialized', () => resoudre()));
  }
}

/**
 * Défaut réel reproduit ici (fiche OR, dialogue « Ajouter une ligne ») : un client sans taux
 * négocié (RM-07) et un référentiel garage sans taux standard font échouer
 * `POST /ordres-reparation/{orId}/lignes` en `VALIDATION_ECHOUEE`, avec un message métier précis
 * dans `erreurs[0]` — que `messageErreur` seul (qui ne lit que `probleme.code`) perd entièrement
 * derrière le générique `erreurs:codes.VALIDATION_ECHOUEE`.
 */
function erreurTauxHoraireIntrouvable(): ErreurApi {
  return new ErreurApi({
    type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
    title: 'Validation échouée',
    status: 400,
    code: 'VALIDATION_ECHOUEE',
    instance: 'req-taux-1',
    erreurs: [
      {
        champ: 'type',
        code: 'taux_horaire_introuvable',
        message:
          'Aucun taux horaire standard : ce client n’a pas de taux négocié (RM-07) et le ' +
          'référentiel du garage ne porte ni le code « ATELIER » ni un taux unique en vigueur ' +
          'au 2026-08-10. Renseigner les taux horaires dans le paramétrage.',
      },
    ],
  });
}

describe('messagesErreurMutation', () => {
  it('affiche le message métier précis d’un code non-zod dans erreurs[], au lieu du générique VALIDATION_ECHOUEE', async () => {
    await attendreI18nPret();
    const erreur = erreurTauxHoraireIntrouvable();

    const messages = messagesErreurMutation(erreur, i18n.t);

    expect(messages).toEqual([
      'Aucun taux horaire standard : ce client n’a pas de taux négocié (RM-07) et le ' +
        'référentiel du garage ne porte ni le code « ATELIER » ni un taux unique en vigueur ' +
        'au 2026-08-10. Renseigner les taux horaires dans le paramétrage.',
    ]);
    expect(messages[0]).not.toBe(
      'Certaines informations sont incorrectes ou incomplètes. Corrigez les champs signalés, puis réessayez.',
    );
  });

  it('reste général : un DEUXIÈME code métier futur, jamais vu ici, passe sans cas particulier codé en dur', async () => {
    await attendreI18nPret();
    const erreur = new ErreurApi({
      type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
      title: 'Validation échouée',
      status: 400,
      code: 'VALIDATION_ECHOUEE',
      instance: 'req-futur-1',
      erreurs: [
        {
          champ: 'articleId',
          code: 'un_code_metier_qui_nexiste_pas_encore',
          message: 'Message métier inventé pour ce test, jamais encore écrit dans ce dépôt.',
        },
      ],
    });

    expect(messagesErreurMutation(erreur, i18n.t)).toEqual([
      'Message métier inventé pour ce test, jamais encore écrit dans ce dépôt.',
    ]);
  });

  it('traduit un code natif zod (ex. format e-mail) via la clé i18n existante, sans jamais afficher l’anglais brut du serveur', async () => {
    await attendreI18nPret();
    const erreur = new ErreurApi({
      type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
      title: 'Validation échouée',
      status: 400,
      code: 'VALIDATION_ECHOUEE',
      instance: 'req-zod-1',
      erreurs: [{ champ: 'email', code: 'invalid_format', message: 'Invalid email address' }],
    });

    const messages = messagesErreurMutation(erreur, i18n.t);

    expect(messages).toEqual(["Cette adresse e-mail n'est pas valide."]);
    expect(messages.join(' ')).not.toContain('Invalid email address');
  });

  it('plusieurs erreurs de champ produisent un message par champ, dans l’ordre du serveur', async () => {
    await attendreI18nPret();
    const erreur = new ErreurApi({
      type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
      title: 'Validation échouée',
      status: 400,
      code: 'VALIDATION_ECHOUEE',
      instance: 'req-multi-1',
      erreurs: [
        { champ: 'type', code: 'taux_horaire_introuvable', message: 'Message métier A.' },
        { champ: 'quantiteMillieme', code: 'too_small', message: 'Too small' },
      ],
    });

    const messages = messagesErreurMutation(erreur, i18n.t);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe('Message métier A.');
    expect(messages[1]).not.toBe('Too small');
  });

  it('sans erreurs de champ (ex. refus métier, réseau, panne interne), retombe sur messageErreur — comportement inchangé', async () => {
    await attendreI18nPret();
    const erreurBlocage = new ErreurApi({
      type: 'https://docs.dmsforall.example/erreurs/OR_TRANSITION_INTERDITE',
      title: 'Transition interdite',
      status: 409,
      code: 'OR_TRANSITION_INTERDITE',
      instance: 'req-blocage-1',
    });

    expect(messagesErreurMutation(erreurBlocage, i18n.t)).toEqual([
      i18n.t('erreurs:codes.OR_TRANSITION_INTERDITE'),
    ]);
  });
});

describe('messageErreurMutation (variante à chaîne unique)', () => {
  it('joint les messages avec un espace', async () => {
    await attendreI18nPret();
    const erreur = erreurTauxHoraireIntrouvable();

    expect(messageErreurMutation(erreur, i18n.t)).toContain(
      'Renseigner les taux horaires dans le paramétrage.',
    );
  });
});

describe('messageErreurMutation — transition interdite', () => {
  function transition(detail: string | undefined, statutActuel?: string): ErreurApi {
    return new ErreurApi({
      type: 'https://docs.dmsforall.example/erreurs/OR_TRANSITION_INTERDITE',
      title: 'Transition interdite',
      status: 409,
      code: 'OR_TRANSITION_INTERDITE',
      instance: 'req-t',
      ...(detail !== undefined ? { detail } : {}),
      ...(statutActuel
        ? {
            blocages: [
              {
                type: 'ordre_reparation' as const,
                id: 'or-1',
                libelle: 'OR',
                donnees: { statutActuel },
              },
            ],
          }
        : {}),
    });
  }

  it('affiche le detail du problem+json quand c’est une vraie phrase', async () => {
    await attendreI18nPret();
    expect(
      messageErreurMutation(
        transition('Le contrôle qualité est obligatoire avant de terminer.'),
        i18n.t,
      ),
    ).toBe('Le contrôle qualité est obligatoire avant de terminer.');
  });

  it('n’affiche jamais la trace machine : nomme le statut actuel et dit quoi faire', async () => {
    await attendreI18nPret();
    const message = messageErreurMutation(
      transition('entite=ordre_reparation;depuis=termine;vers=en_cours', 'termine'),
      i18n.t,
    );
    expect(message).not.toContain('entite=');
    expect(message).toContain('« Travaux terminés »');
    expect(message).toContain('Rechargez la page');
  });

  it('sans detail ni statut : une phrase qui dit quoi faire', async () => {
    await attendreI18nPret();
    expect(messageErreurMutation(transition(undefined), i18n.t)).toContain('Rechargez la page');
  });
});
