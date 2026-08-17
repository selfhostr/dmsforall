/**
 * Nommage du canal Redis Pub/Sub — UN CANAL PAR TENANT, jamais un canal unique filtré côté
 * application. C'est la première ligne de défense de l'isolation tenant (règle n°1 du dépôt) :
 * `RegistreAbonnesTempsReel` ne s'abonne (`SUBSCRIBE`) au canal d'un tenant que lorsqu'au moins un
 * poste de CE tenant est connecté à CETTE instance — un événement du tenant A n'est même pas
 * acheminé par Redis vers une instance qui n'a aucun abonné du tenant A, a fortiori jamais vers un
 * poste du tenant B. Le filtrage par rôle (`rolesCibles`, voir `registre-abonnes-temps-reel.ts`)
 * est une SECONDE barrière, appliquée en mémoire une fois le message reçu.
 *
 * Fonctions PURES (aucune I/O) : testables sans Redis réel.
 */
const PREFIXE_CANAL = 'dfa:temps-reel:';

export function canalTenant(tenantId: string): string {
  return `${PREFIXE_CANAL}${tenantId}`;
}

/** `null` si `canal` n'est pas un canal de ce module (garde-fou si Redis sert un jour d'autres
 *  usages de Pub/Sub sur la même instance). */
export function tenantIdDepuisCanal(canal: string): string | null {
  if (!canal.startsWith(PREFIXE_CANAL)) return null;
  const tenantId = canal.slice(PREFIXE_CANAL.length);
  return tenantId.length > 0 ? tenantId : null;
}
