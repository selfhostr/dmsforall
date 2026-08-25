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
