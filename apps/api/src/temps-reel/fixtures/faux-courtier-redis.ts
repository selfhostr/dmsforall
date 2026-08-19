/**
 * Faux courtier Pub/Sub Redis PARTAGÉ entre plusieurs faux clients — simule un vrai serveur Redis
 * relié à PLUSIEURS connexions distinctes, exactement la topologie que ce module doit supporter en
 * production (N instances API, chacune avec sa propre connexion abonnée, toutes reliées au MÊME
 * Redis). Sert à prouver, en test, qu'un événement traverse bien une connexion Redis distincte de
 * celle qui l'a publié — pas seulement un rappel en mémoire dans le même process.
 *
 * N'implémente QUE le sous-ensemble Pub/Sub réellement utilisé par ce module
 * (`ClientRedisPublieurTempsReel`/`ClientRedisAbonneTempsReel`) — pas un faux Redis générique.
 */
type Gestionnaire = (canal: string, message: string) => void;

export class FauxCourtierRedis {
  private readonly abonnements = new Map<string, Set<Gestionnaire>>();

  creerClientAbonne(): {
    on: (evenement: 'message', gestionnaire: Gestionnaire) => void;
    subscribe: (canal: string) => Promise<number>;
    unsubscribe: (canal: string) => Promise<number>;
  } {
    let gestionnaireMessage: Gestionnaire | null = null;
    return {
      on: (_evenement, gestionnaire) => {
        gestionnaireMessage = gestionnaire;
      },
      subscribe: (canal) => {
        if (!gestionnaireMessage)
          throw new Error('on("message", ...) doit être posé avant subscribe()');
        let ensemble = this.abonnements.get(canal);
        if (!ensemble) {
          ensemble = new Set();
          this.abonnements.set(canal, ensemble);
        }
        ensemble.add(gestionnaireMessage);
        return Promise.resolve(ensemble.size);
      },
      unsubscribe: (canal) => {
        const ensemble = this.abonnements.get(canal);
        if (ensemble && gestionnaireMessage) ensemble.delete(gestionnaireMessage);
        return Promise.resolve(ensemble?.size ?? 0);
      },
    };
  }

  creerClientPublieur(): { publish: (canal: string, message: string) => Promise<number> } {
    return {
      publish: (canal, message) => {
        const ensemble = this.abonnements.get(canal);
        if (!ensemble) return Promise.resolve(0);
        for (const gestionnaire of ensemble) gestionnaire(canal, message);
        return Promise.resolve(ensemble.size);
      },
    };
  }
}
