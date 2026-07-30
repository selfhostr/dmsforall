import type { BlocPaiementQrFige } from '@dfa/shared';

interface Props {
  readonly qr: BlocPaiementQrFige | null;
}

/**
 * Bulletin de versement (RF-54 → RF-60, `ReponseDocumentVente.qr`) — affiché EN TEXTE. Le rendu
 * graphique du QR est fait côté serveur dans le PDF (`apps/api/src/facturation/impression/`) : le
 * dupliquer ici créerait deux implémentations qui divergeraient (voir le commentaire de tête de
 * `apps/api/src/facturation/documents/mappeurs.ts::construireBlocQrFige` — la charge est FIGÉE à
 * l'émission avec les coordonnées du garage telles qu'elles étaient à ce moment-là, jamais
 * recalculée ici non plus).
 *
 * `qr === null` est le cas NORMAL — pas une erreur — pour un devis, un bon de commande, un avoir
 * (il crédite le client, il ne se paie pas), un brouillon, OU pour un rôle sans droit aux montants
 * (`RF-116` : la charge QR contient le montant en clair, donc le serveur masque déjà `qr` à `null`
 * avant même d'atteindre ce composant — voir `mapperDocument`, `qr: voitMontants ? ... : null`).
 * Dans tous ces cas : PAS DE CARTE DU TOUT, même patron que `RecapitulatifTVA` (absent en bloc
 * plutôt qu'une zone vide à expliquer).
 *
 * BLOQUÉ — signalé à l'orchestrateur (30.07.2026) : le contenu (créancier, débiteur, IBAN,
 * référence, montant à payer) exige des clés i18n qui n'existent pas encore dans
 * `facturation.json` (`fiche.bulletin.payableA`, `.payablePar`, `.iban`, `.reference`,
 * `.sansReference` — le libellé du montant réutilise `fiche.totalTtc`, déjà présent). Écrire ces
 * appels `t()` avant que les clés existent ferait échouer `pnpm i18n:check` (clé FR manquante) —
 * exactement la « chaîne française en attendant » que la consigne interdit. Ce composant reste
 * donc au stade « masque proprement le cas absent » ; le contenu (créancier/débiteur/montant/
 * référence) est à ajouter ICI dès que les clés seront posées dans les trois langues.
 */
export function CarteBulletinVersement({ qr }: Props) {
  if (!qr) return null;

  return null;
}
