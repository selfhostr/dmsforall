import {
  Ban,
  Calendar,
  CheckCircle2,
  Circle,
  HelpCircle,
  KeyRound,
  Lock,
  PackageSearch,
  Receipt,
  Search,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EtatAfficheOrdreReparation } from '@dfa/shared';

import { cn } from '@/lib/utils';

type TokenStatut = 'neutre' | 'info' | 'attention' | 'succes' | 'terminal' | 'danger';
type FormeBadge = 'plein' | 'contour';

interface EntreeStatutOr {
  /** Suffixe de la clé `or:statuts.<cle>` — casse camelCase du fichier de traduction, distincte
   *  de la valeur d'enum snake_case (`en_cours` -> `enCours`). */
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/**
 * Mapping exhaustif et type-safe (sur le modèle de `lib/roles.ts`) : ajouter une valeur à
 * `ETATS_AFFICHES_ORDRE_REPARATION` fait échouer `tsc` avant d'atteindre un écran.
 *
 * Source normative — `docs/design-etape-1-atelier.md` §5.2, reprise **telle quelle** (12 lignes ;
 * le texte « 11 statuts » du même document est une erreur de rédaction, la table fait foi).
 * Consomme `EtatAfficheOrdreReparation` (12 valeurs), jamais `StatutOrdreReparation` (9 valeurs) :
 * un badge câblé sur le statut brut n'afficherait jamais les trois états d'attente
 * (`attente_accord`/`attente_pieces`/`attente_externe`), pourtant l'information la plus utile au
 * comptoir pour expliquer pourquoi une voiture ne bouge pas.
 */
const CONFIG_STATUT_OR: Readonly<Record<EtatAfficheOrdreReparation, EntreeStatutOr>> = {
  planifie: { cle: 'planifie', icone: Calendar, token: 'neutre', forme: 'contour' },
  ouvert: { cle: 'ouvert', icone: Circle, token: 'info', forme: 'plein' },
  en_cours: { cle: 'enCours', icone: Wrench, token: 'info', forme: 'plein' },
  attente_accord: { cle: 'attenteAccord', icone: HelpCircle, token: 'attention', forme: 'plein' },
  attente_pieces: {
    cle: 'attentePieces',
    icone: PackageSearch,
    token: 'attention',
    forme: 'plein',
  },
  attente_externe: { cle: 'attenteExterne', icone: Truck, token: 'attention', forme: 'plein' },
  controle: { cle: 'controle', icone: Search, token: 'attention', forme: 'plein' },
  termine: { cle: 'termine', icone: CheckCircle2, token: 'succes', forme: 'plein' },
  facture: { cle: 'facture', icone: Receipt, token: 'succes', forme: 'plein' },
  restitue: { cle: 'restitue', icone: KeyRound, token: 'succes', forme: 'plein' },
  cloture: { cle: 'cloture', icone: Lock, token: 'terminal', forme: 'contour' },
  // `Ban` (cercle barré), jamais `Trash2` : le mot « supprimer » n'existe pas dans ce produit,
  // l'iconographie non plus (docs/design-etape-1-atelier.md §5.2).
  annule: { cle: 'annule', icone: Ban, token: 'danger', forme: 'contour' },
};

const CLASSES_PLEIN: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-transparent bg-statut-neutre-fond text-statut-neutre',
  info: 'border-transparent bg-statut-info-fond text-statut-info',
  attention: 'border-transparent bg-statut-attention-fond text-statut-attention',
  succes: 'border-transparent bg-statut-succes-fond text-statut-succes',
  terminal: 'border-transparent bg-statut-terminal-fond text-statut-terminal',
  danger: 'border-transparent bg-statut-danger-fond text-statut-danger',
};

const CLASSES_CONTOUR: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-statut-neutre bg-background text-statut-neutre',
  info: 'border-statut-info bg-background text-statut-info',
  attention: 'border-statut-attention bg-background text-statut-attention',
  succes: 'border-statut-succes bg-background text-statut-succes',
  terminal: 'border-statut-terminal bg-background text-statut-terminal',
  danger: 'border-statut-danger bg-background text-statut-danger',
};

interface Props {
  readonly etat: EtatAfficheOrdreReparation;
  readonly className?: string;
}

/** Statut affiché d'un OR — LE seul badge du produit autorisé à consommer les tokens
 *  `--statut-*` (§5.1 du document atelier, §2 de docs/design-comptoir.md : le budget couleur leur
 *  est exclusivement réservé). Couleur + forme (plein/contour) + icône + mot : jamais la couleur
 *  seule (vérification daltonisme §5.5, `--statut-info` et `--statut-succes` restent séparables
 *  en protanopie grâce à des formes/icônes distinctes). */
export function BadgeStatutOr({ etat, className }: Props) {
  const { t } = useTranslation('or');
  const config = CONFIG_STATUT_OR[etat];
  const Icone = config.icone;
  const classesToken =
    config.forme === 'plein' ? CLASSES_PLEIN[config.token] : CLASSES_CONTOUR[config.token];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        classesToken,
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`or:statuts.${config.cle}`)}
    </span>
  );
}
