/**
 * DISPONIBILITÉ DE LA PRISE DE VUE EN DIRECT — `getUserMedia` (accès caméra) n'existe QUE sur une
 * origine sécurisée (HTTPS, ou `localhost`). Au 18.08.2026, le site tourne sur
 * `http://192.168.1.10:5173` : cette fonction y renvoie `false`, `CaptureLiveCadrage.tsx` n'est
 * alors JAMAIS monté et `EcranScan.tsx` retombe sur la capture native (`<input type="file"
 * capture="environment">`, comportement d'avant ce chantier) — SANS AUCUN message d'erreur, la
 * subtilité HTTPS/permissions n'a jamais à être comprise par le garagiste (brief explicite de
 * @laupernoe). Le jour où le site sert en HTTPS, cette fonction renvoie `true` toute seule, sans rien à
 * changer ici : c'est le SEUL point de bascule.
 *
 * Vérifie uniquement que l'API existe et que le contexte l'autorise — PAS que la permission caméra
 * sera accordée (impossible à savoir sans la demander) : un refus de permission ou une caméra
 * absente/occupée est géré séparément, à l'exécution, par `CaptureLiveCadrage.tsx` (même repli
 * silencieux, voir sa doc de tête).
 */
export function estCaptureLiveDisponible(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (window.isSecureContext !== true) return false;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}
