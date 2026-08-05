/** Signal interne : une tentative a dépassé `PolitiqueResilienceConnecteur.delaiMaxMs`. Jamais
 *  remontée telle quelle à un appelant HTTP — `ServiceExecuteurConnecteurResilient` l'absorbe et
 *  rend un `ResultatExecutionConnecteurResilient` typé. */
export class ErreurDelaiDepasseConnecteur extends Error {
  constructor(readonly delaiMs: number) {
    super(`Délai de connecteur dépassé après ${delaiMs} ms`);
    this.name = 'ErreurDelaiDepasseConnecteur';
  }
}
