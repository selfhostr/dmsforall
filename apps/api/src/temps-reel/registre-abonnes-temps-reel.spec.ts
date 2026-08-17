import { describe, expect, it, vi } from 'vitest';

import { FauxCourtierRedis } from './fixtures/faux-courtier-redis';
import { RegistreAbonnesTempsReel } from './registre-abonnes-temps-reel';
import type {
  ClientRedisAbonneTempsReel,
  EvenementDiffuseLocalement,
} from './registre-abonnes-temps-reel';
import { ServiceEvenementsTempsReel } from './service-evenements-temps-reel';
import type { ClientRedisPublieurTempsReel } from './service-evenements-temps-reel';

/** Construit un registre relié à sa PROPRE connexion abonnée du courtier partagé — représente
 *  une instance API distincte. */
function nouvelleInstance(courtier: FauxCourtierRedis): RegistreAbonnesTempsReel {
  const client = courtier.creerClientAbonne() as unknown as ClientRedisAbonneTempsReel;
  const registre = new RegistreAbonnesTempsReel(client);
  registre.onModuleInit();
  return registre;
}

function publieur(courtier: FauxCourtierRedis): ServiceEvenementsTempsReel {
  return new ServiceEvenementsTempsReel(
    courtier.creerClientPublieur() as unknown as ClientRedisPublieurTempsReel,
  );
}

describe('RegistreAbonnesTempsReel — isolation tenant et propagation multi-instances', () => {
  it('un événement émis par le tenant A sur UNE instance atteint un abonné du tenant A sur UNE AUTRE instance', async () => {
    const courtier = new FauxCourtierRedis();
    // Instance 1 : émet (simule l'API qui a traité le scan).
    const instanceEmettrice = publieur(courtier);
    // Instance 2 : porte la connexion SSE du poste qui doit être notifié — connexion Redis
    // DISTINCTE de celle de l'instance émettrice, uniquement reliée via le courtier partagé.
    const instanceReceptrice = nouvelleInstance(courtier);

    const recus: EvenementDiffuseLocalement[] = [];
    instanceReceptrice.enregistrer('tenant-a', 'direction', (evenement) => recus.push(evenement));

    await instanceEmettrice.publier(
      'tenant-a',
      'vehicule.correspondance_scan_permis',
      { clientId: 'client-1' },
      ['direction'],
    );

    expect(recus).toHaveLength(1);
    expect(recus[0]).toMatchObject({
      type: 'vehicule.correspondance_scan_permis',
      donnees: { clientId: 'client-1' },
    });
    // L'enveloppe reçue localement NE PORTE PAS rolesCibles — jamais transmise plus loin.
    expect(recus[0]).not.toHaveProperty('rolesCibles');
  });

  it('un abonné du tenant B ne reçoit RIEN quand le tenant A émet (preuve exigée par la tâche)', async () => {
    const courtier = new FauxCourtierRedis();
    const emetteur = publieur(courtier);
    const instanceB = nouvelleInstance(courtier);

    const recusTenantB: EvenementDiffuseLocalement[] = [];
    instanceB.enregistrer('tenant-b', 'direction', (evenement) => recusTenantB.push(evenement));

    await emetteur.publier(
      'tenant-a',
      'vehicule.correspondance_scan_permis',
      { clientId: 'client-1' },
      ['direction'],
    );

    expect(recusTenantB).toHaveLength(0);
  });

  it('même tenant, deux instances : seule celle qui a un abonné du bon tenant reçoit', async () => {
    const courtier = new FauxCourtierRedis();
    const emetteur = publieur(courtier);
    const instanceA = nouvelleInstance(courtier);
    const instanceSansAbonne = nouvelleInstance(courtier); // aucun enregistrer() appelé dessus

    const recus: EvenementDiffuseLocalement[] = [];
    instanceA.enregistrer('tenant-a', 'direction', (evenement) => recus.push(evenement));
    void instanceSansAbonne; // n'a jamais souscrit au canal du tenant A

    await emetteur.publier('tenant-a', 'vehicule.correspondance_scan_permis', { clientId: 'x' }, [
      'direction',
    ]);

    expect(recus).toHaveLength(1);
  });

  it('filtre par rôle : un rôle absent de rolesCibles ne reçoit rien, un rôle présent reçoit', async () => {
    const courtier = new FauxCourtierRedis();
    const emetteur = publieur(courtier);
    const instance = nouvelleInstance(courtier);

    const recusDirection: EvenementDiffuseLocalement[] = [];
    const recusTechnicien: EvenementDiffuseLocalement[] = [];
    instance.enregistrer('tenant-a', 'direction', (e) => recusDirection.push(e));
    instance.enregistrer('tenant-a', 'technicien', (e) => recusTechnicien.push(e));

    await emetteur.publier(
      'tenant-a',
      'vehicule.correspondance_scan_permis',
      { clientId: 'x' },
      ['direction', 'receptionnaire'], // 'technicien' délibérément absent
    );

    expect(recusDirection).toHaveLength(1);
    expect(recusTechnicien).toHaveLength(0);
  });

  it('après désabonnement du dernier abonné du tenant, un nouvel événement ne relance rien (ressource libérée)', async () => {
    const courtier = new FauxCourtierRedis();
    const emetteur = publieur(courtier);
    const instance = nouvelleInstance(courtier);

    const recus: EvenementDiffuseLocalement[] = [];
    const desabonner = instance.enregistrer('tenant-a', 'direction', (e) => recus.push(e));
    desabonner();

    await emetteur.publier('tenant-a', 'vehicule.correspondance_scan_permis', { clientId: 'x' }, [
      'direction',
    ]);

    expect(recus).toHaveLength(0);
  });

  it('message Redis malformé sur un canal connu : ignoré, ne fait pas planter la distribution', () => {
    const courtier = new FauxCourtierRedis();
    const instance = nouvelleInstance(courtier);
    const rappel = vi.fn();
    instance.enregistrer('tenant-a', 'direction', rappel);

    // Accès à la méthode privée via cast, pour simuler un message corrompu reçu de Redis sans
    // dépendre de la sérialisation réelle du publieur.
    (instance as unknown as { distribuer: (canal: string, message: string) => void }).distribuer(
      'dfa:temps-reel:tenant-a',
      '{ pas du json valide',
    );

    expect(rappel).not.toHaveBeenCalled();
  });
});
