import { Ban, CheckCircle2, Circle, PieChart, PlusCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutReglementDocument } from '@dfa/shared';

import { cn } from '@/lib/utils';

type TokenStatut = 'neutre' | 'info' | 'succes' | 'danger';

interface EntreeStatut {
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: 'plein' | 'contour';
}

/**
 * Statut de règlement (§2.2) — `non_regle` porte le token NEUTRE, jamais `--statut-attention` :
 * décision de conception reprise telle quelle, une facture fraîchement émise et non payée n'est pas une
 * alerte. `trop_percu`/`irrecouvrable` sont ABSENTS du design (`STATUTS_REGLEMENT_DOCUMENT` en
 * compte cinq, le document n'en illustre que trois) — mapping étendu ici pour rester exhaustif
 * (type-safe, comme `BadgeStatutOr`) avec une iconographie cohérente au reste du produit :
 * `trop_percu` reste informatif (ce n'est pas un problème, c'est une avance à affecter, `RF-79`),
 * `irrecouvrable` est la seule variante réellement `danger` de ce badge.
 */
const CONFIG_STATUT: Readonly<Record<StatutReglementDocument, EntreeStatut>> = {
  non_regle: { cle: 'nonRegle', icone: Circle, token: 'neutre', forme: 'contour' },
  partiel: { cle: 'partiel', icone: PieChart, token: 'info', forme: 'plein' },
  regle: { cle: 'regle', icone: CheckCircle2, token: 'succes', forme: 'plein' },
  trop_percu: { cle: 'tropPercu', icone: PlusCircle, token: 'info', forme: 'plein' },
  irrecouvrable: { cle: 'irrecouvrable', icone: Ban, token: 'danger', forme: 'plein' },
};

const CLASSES_PLEIN: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-transparent bg-statut-neutre-fond text-statut-neutre',
  info: 'border-transparent bg-statut-info-fond text-statut-info',
  succes: 'border-transparent bg-statut-succes-fond text-statut-succes',
  danger: 'border-transparent bg-statut-danger-fond text-statut-danger',
};

const CLASSES_CONTOUR: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-statut-neutre bg-background text-statut-neutre',
  info: 'border-statut-info bg-background text-statut-info',
  succes: 'border-statut-succes bg-background text-statut-succes',
  danger: 'border-statut-danger bg-background text-statut-danger',
};

interface Props {
  readonly statut: StatutReglementDocument;
  readonly className?: string;
  /**
   * Défaut corrigé (issue #129) : `statutReglement` porte la MÊME machine à états sur une
   * `facture` et sur un `avoir` (`document.ts` : « le règlement ne concerne que facture et
   * avoir »), pilotée par le même trigger `imputation_paiement` — mais le mot juste diffère
   * selon le sens de l'argent. Une facture se RÈGLE (le client doit, puis paie) ; un avoir
   * s'IMPUTE (DFA doit au client, le crédit se consomme contre une autre facture ou se
   * rembourse) — « Non réglée » sur un avoir se lit comme une créance impayée, alors que
   * personne ne doit rien : c'est l'ambiguïté remontée par le testeur. Par défaut `'facture'`
   * pour ne pas casser les appelants existants (liste des factures — filtrée `typeDocument:
   * ['facture']` — et la confirmation de `SheetEncaissement`, qui ne concerne jamais un avoir).
   * Mêmes icône/couleur pour les deux — seule la clé i18n change (`reglement.statut` vs
   * `reglement.statutAvoir`) : la distinction DOCUMENT/RÈGLEMENT posée récemment reste intacte,
   * seul le vocabulaire du badge RÈGLEMENT change de contexte.
   */
  readonly contexte?: 'facture' | 'avoir';
}

export function BadgeStatutReglement({ statut, className, contexte = 'facture' }: Props) {
  const { t } = useTranslation('facturation');
  const config = CONFIG_STATUT[statut];
  const Icone = config.icone;
  const classesToken =
    config.forme === 'plein' ? CLASSES_PLEIN[config.token] : CLASSES_CONTOUR[config.token];
  const racineCle = contexte === 'avoir' ? 'reglement.statutAvoir' : 'reglement.statut';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        classesToken,
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`facturation:${racineCle}.${config.cle}`)}
    </span>
  );
}
