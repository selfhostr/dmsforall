/** Erreurs typées de la bibliothèque de lecture des archives de reprise. */

export class ErreurEnTeteDbfInvalide extends Error {
  constructor(cheminDbf: string, motif: string) {
    super(`en-tête DBF invalide (${cheminDbf}) : ${motif}`);
    this.name = 'ErreurEnTeteDbfInvalide';
  }
}

/** `mdbtools` absent ou en échec — jamais une exception non typée qui ferait planter l'appelant. */
export class ErreurOutilAccesIndisponible extends Error {
  constructor(motif: string) {
    super(`mdbtools indisponible : ${motif}`);
    this.name = 'ErreurOutilAccesIndisponible';
  }
}

export class ErreurLectureAccess extends Error {
  constructor(cheminMdb: string, table: string, motif: string) {
    super(`échec de lecture Access (${cheminMdb}, table "${table}") : ${motif}`);
    this.name = 'ErreurLectureAccess';
  }
}

/**
 * Un sous-processus `mdbtools` n'a pas rendu la main dans le délai imposé — soit AUCUNE activité
 * (aucun octet en sortie) pendant `delaiMs` (fichier `.mdb` forgé qui fait boucler le parseur, le
 * cas mesuré comme réel par l'audit sécurité), soit dépassement d'un plafond absolu de sécurité.
 * Le processus est explicitement terminé (`SIGTERM` puis `SIGKILL` après un court délai de grâce)
 * AVANT que cette erreur ne soit levée — jamais un slot de worker occupé indéfiniment.
 */
export class ErreurDelaiDepasseProcessus extends Error {
  constructor(commande: string, contexte: string, motif: 'inactivite' | 'absolu', delaiMs: number) {
    super(
      `délai dépassé (${motif}, ${delaiMs} ms) pour « ${commande} » (${contexte}) — processus terminé`,
    );
    this.name = 'ErreurDelaiDepasseProcessus';
  }
}
