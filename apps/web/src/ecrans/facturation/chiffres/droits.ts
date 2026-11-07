import { peut, type ActionsSession } from '@/droits';

/**
 * Page « Chiffres » : le chiffre d'affaires vient de `GET /tableau-bord/financier`
 * (`tableau_bord.financier.lire`, direction et comptable seuls — jamais `admin`, RF-115), les
 * encaissements par moyen de `GET /paiements` (`facturation.paiement.lire`). Les deux droits sont
 * exigés : sans l'un, une section tomberait en 403.
 */
export const peutVoirChiffres = (a: ActionsSession) =>
  peut(a, 'tableau_bord.financier.lire') && peut(a, 'facturation.paiement.lire');
