import { describe, expect, it, vi } from 'vitest';
import type { ReponseEnvoiMessageClientRejetee, RequeteEnvoiMessageClient } from '@dfa/shared';

import type { ServiceJournal } from '../../common/journal';

import { AdaptateurNotificationSenderFactice } from './adaptateur-notification-sender.factice';

/**
 * Complète `adaptateurs-factices.spec.ts` (générique, `describe.each`) avec ce qui est spécifique
 * à `NotificationSender` : la méthode métier `envoyer()` (absente du port générique), et la garde
 * PII propre à ce connecteur (voir l'avertissement en tête de `contrats/connecteurs/
 * notification-sender.ts` : `destinataire`/`texte`/`sujet`/`html` sont des données personnelles
 * qui ne doivent JAMAIS atteindre `ServiceJournal`).
 */

function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
}

const REQUETE_SMS: RequeteEnvoiMessageClient = {
  cleIdempotence: 'relance-42:tentative-1',
  langue: 'fr',
  contenu: {
    canal: 'sms',
    destinataire: '+41791234567',
    texte: 'Rappel : facture F-2026-00042, CHF 340.50 en souffrance. Merci de régulariser.',
  },
  referenceExterne: null,
};

const REQUETE_EMAIL: RequeteEnvoiMessageClient = {
  cleIdempotence: 'relance-43:tentative-1',
  langue: 'fr',
  contenu: {
    canal: 'email',
    destinataire: 'client.exemple@courriel-test.ch',
    sujet: 'Rappel de facture F-2026-00042',
    texte: 'Rappel : facture F-2026-00042, CHF 340.50 en souffrance. Merci de régulariser.',
    html: '<p>Rappel : facture <strong>F-2026-00042</strong>, CHF 340.50 en souffrance.</p>',
  },
  referenceExterne: 'relance-planifiee-43',
};

describe('AdaptateurNotificationSenderFactice', () => {
  it('porte l’interface NotificationSender et un typeConnecteurCode "factice_"', () => {
    const adaptateur = new AdaptateurNotificationSenderFactice(journalFactice());
    expect(adaptateur.nomInterface).toBe('NotificationSender');
    expect(adaptateur.typeConnecteurCode).toBe('factice_notification_sender');
  });

  it('accepte un envoi SMS et rend un identifiant prestataire déterministe, sans fuite de PII au journal', async () => {
    const journal = journalFactice();
    const adaptateur = new AdaptateurNotificationSenderFactice(journal);

    const reponse = await adaptateur.envoyer(REQUETE_SMS);

    expect(reponse).toEqual({
      statut: 'accepte',
      identifiantMessagePrestataire: 'factice-relance-42:tentative-1',
    });

    const journalMock = journal as unknown as { info: ReturnType<typeof vi.fn> };
    const appel = JSON.stringify(journalMock.info.mock.calls);
    expect(appel).not.toContain('+41791234567');
    expect(appel).not.toContain('Rappel : facture F-2026-00042');
    expect(appel).not.toContain('destinataire');
    expect(appel).not.toContain('texte');
  });

  it('accepte un envoi e-mail et rend un identifiant prestataire déterministe, sans fuite de PII au journal', async () => {
    const journal = journalFactice();
    const adaptateur = new AdaptateurNotificationSenderFactice(journal);

    const reponse = await adaptateur.envoyer(REQUETE_EMAIL);

    expect(reponse).toEqual({
      statut: 'accepte',
      identifiantMessagePrestataire: 'factice-relance-43:tentative-1',
    });

    const journalMock = journal as unknown as { info: ReturnType<typeof vi.fn> };
    const appel = JSON.stringify(journalMock.info.mock.calls);
    expect(appel).not.toContain('client.exemple@courriel-test.ch');
    expect(appel).not.toContain('Rappel de facture');
    expect(appel).not.toContain('<strong>');
    expect(appel).not.toContain('destinataire');
    expect(appel).not.toContain('sujet');
    expect(appel).not.toContain('html');
  });

  it('ne journalise que l’ensemble fermé de champs autorisés — jamais `referenceExterne` ni le contenu', async () => {
    const journal = journalFactice();
    const adaptateur = new AdaptateurNotificationSenderFactice(journal);

    await adaptateur.envoyer(REQUETE_EMAIL);

    expect(journal.info).toHaveBeenCalledTimes(1);
    expect(journal.info).toHaveBeenCalledWith('connecteurs.adaptateur_factice.envoi_message', {
      typeConnecteurCode: 'factice_notification_sender',
      nomInterface: 'NotificationSender',
      canal: 'email',
      cleIdempotence: 'relance-43:tentative-1',
      langue: 'fr',
    });
  });

  /**
   * CHOIX ASSUMÉ : ce factice est TOUJOURS-ACCEPTÉ (voir la justification en tête du fichier
   * source) — aucun prestataire précis n'est présumé, donc aucune logique de rejet conditionnel
   * (canal non supporté, destinataire invalide) n'est simulée ici. Le test ci-dessous ne fait donc
   * PAS passer l'adaptateur par un chemin de rejet qui n'existe pas : il construit directement un
   * `ReponseEnvoiMessageClientRejetee` littéral — le type que rendrait un VRAI adaptateur — pour
   * prouver, au niveau du canal de journalisation réellement utilisé par ce module (celui de
   * `envoyer()`, ci-dessus), qu'un `message` de rejet contenant une donnée sensible n'atteint
   * jamais `journal.*`. La preuve porte sur le mécanisme (cet adaptateur ne journalise jamais un
   * champ `message` ni le contenu de la requête), pas sur un comportement de rejet que ce factice
   * n'a jamais eu vocation à simuler.
   */
  it('un message de rejet contenant une donnée sensible n’atteint jamais le journal', async () => {
    const REJET_AVEC_PII: ReponseEnvoiMessageClientRejetee = {
      statut: 'rejete',
      raison: 'destinataire_invalide',
      message: 'numéro invalide : +41791234567',
    };

    const journal = journalFactice();
    const adaptateur = new AdaptateurNotificationSenderFactice(journal);

    // L'adaptateur factice ne produit jamais ce rejet lui-même (toujours-accepté) — on prouve
    // seulement que le seul appel qu'il fait réellement au journal ne porte, structurellement,
    // aucun champ susceptible de recevoir `REJET_AVEC_PII.message`.
    await adaptateur.envoyer(REQUETE_SMS);

    const journalMock = journal as unknown as { info: ReturnType<typeof vi.fn> };
    const appel = JSON.stringify(journalMock.info.mock.calls);
    expect(appel).not.toContain(REJET_AVEC_PII.message);
    expect(appel).not.toContain(REJET_AVEC_PII.raison);
    // Le nom d'événement journalisé porte lui-même le mot « message » (« envoi_message ») — sans
    // rapport avec le champ `ReponseEnvoiMessageClientRejetee.message` : on vérifie donc la clé de
    // structure du journal plutôt qu'une sous-chaîne générique.
    const cles = new Set(
      journalMock.info.mock.calls.flatMap((appelJournal) => Object.keys(appelJournal[1])),
    );
    expect(cles).not.toContain('message');
    expect(cles).not.toContain('raison');
  });
});
