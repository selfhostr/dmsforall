import { FileCheck, FileText, Receipt, ReceiptText, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { NatureFacture, TypeDocumentVente } from '@dfa/shared';

import { cn } from '@/lib/utils';

/**
 * Badge de type de document (§2.3) — comme payeur/origine/localisation à l'étape 1 : AUCUNE
 * couleur de statut, texte + icône sur `--foreground`/`--muted-foreground` uniquement.
 *
 * `bulletin_paiement` (icône `QrCode`) de la table du design n'est PAS un `TypeDocumentVente` —
 * `TYPES_DOCUMENT_VENTE` n'en compte que quatre (`devis`/`bon_commande`/`facture`/`avoir`) — omis
 * ici plutôt que fabriqué : ce badge n'a pas vocation à représenter un bulletin QR isolé, seulement
 * les documents réels de la chaîne.
 */
interface Props {
  readonly type: TypeDocumentVente;
  readonly nature?: NatureFacture | null;
  readonly className?: string;
}

const ICONES: Readonly<Record<TypeDocumentVente, LucideIcon>> = {
  devis: FileText,
  bon_commande: FileCheck,
  facture: Receipt,
  // Jamais `Receipt` seul (confusion visuelle avec une facture) — voir le commentaire de
  // `design-etape-2-facturation.md` §2.3.
  avoir: ReceiptText,
};

export function BadgeTypeDocument({ type, nature, className }: Props) {
  const { t } = useTranslation('facturation');
  const Icone = ICONES[type];
  const cleLibelle = type === 'facture' && nature === 'acompte' ? 'factureAcompte' : type === 'bon_commande' ? 'bonCommande' : type;

  return (
    <span className={cn('inline-flex items-center gap-1.5 texte-corps text-muted-foreground', className)}>
      <Icone aria-hidden className="h-4 w-4 shrink-0" />
      {t(`facturation:document.type.${cleLibelle}`)}
    </span>
  );
}
