/**
 * Contrats du canal temps réel (notification serveur → poste fixe). Voir
 * `apps/api/src/temps-reel/` (émission, transport SSE) et `apps/web/src/hooks/temps-reel/`
 * (souscription côté navigateur) pour les deux bouts de ce contrat.
 */
export * from './enums';
export * from './evenement';
