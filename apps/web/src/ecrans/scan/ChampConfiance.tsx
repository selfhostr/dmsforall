import { Check, CircleDashed, TriangleAlert } from 'lucide-react';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type EtatConfianceChamp = 'nonLu' | 'douteux' | 'valide';

interface Props {
  readonly id: string;
  readonly label: string;
  readonly etat: EtatConfianceChamp;
  /** Le contrôle de saisie déjà câblé par l'appelant (`<Input {...form.register(...)} />`,
   *  `<Select>`...) — ce composant ne le construit pas, il l'entoure. DOIT être un élément UNIQUE
   *  (jamais un fragment/plusieurs enfants) : ce composant lui injecte `aria-describedby` — voir
   *  plus bas. */
  readonly children: ReactNode;
  readonly aide?: ReactNode;
  readonly erreur?: ReactNode;
  readonly className?: string;
}

/**
 * TROIS ÉTATS DISTINCTS, jamais confondus (exigence du brief) : « non lu », « lu avec doute »,
 * « lu et validé ». La distinction passe par ICÔNE + MOT, jamais la seule couleur — doctrine du
 * dépôt (`composants/identite/BadgeStatut.tsx`, vérification daltonisme) — et un ANNEAU neutre
 * autour du contrôle pour « à vérifier », second signal indépendant du texte.
 *
 * Le mot d'état est une DESCRIPTION du champ (`aria-describedby`), jamais une partie de son NOM
 * accessible (`<label>`) — décision corrigée après un premier essai qui postait le mot À
 * L'INTÉRIEUR du `<Label>` : un lecteur d'écran annonçait alors « Nom, Lu et validé » comme nom de
 * champ à CHAQUE navigation dessus (répétitif, redondant avec l'aria-live implicite d'un focus),
 * et `getByLabelText('Nom')` — la requête standard de test pour « le champ appelé Nom » — cessait
 * de matcher parce que le nom accessible réel n'était plus « Nom » seul. `aria-describedby`
 * annonce le mot d'état APRÈS le nom, une seule fois par focus, sans changer ce nom : exactement
 * la sémantique voulue (« Nom » reste le champ, « lu avec doute » en est une propriété).
 *
 * AUCUN TOKEN `--statut-*` NI `--avertissement` ICI, contrairement à un premier réflexe : les deux
 * sont explicitement réservés ailleurs (`index.css`, tête des tokens `--statut-*` : « réservés
 * EXCLUSIVEMENT au statut d'OR et au statut de ligne » ; `--avertissement` : « INTERDIT sur un
 * badge ou une pastille »). Ce marqueur par champ EST une pastille au sens de cette règle — il
 * reste donc en neutre (`foreground`/`muted-foreground`), différencié par l'icône et le poids de
 * texte, jamais par une teinte.
 */
export function ChampConfiance({ id, label, etat, children, aide, erreur, className }: Props) {
  const { t } = useTranslation('scan');
  const idEtat = `${id}-confiance`;

  const config: Record<EtatConfianceChamp, { readonly icone: typeof Check; readonly cle: string }> =
    {
      nonLu: { icone: CircleDashed, cle: 'scan:confiance.nonLu' },
      douteux: { icone: TriangleAlert, cle: 'scan:confiance.douteux' },
      valide: { icone: Check, cle: 'scan:confiance.valide' },
    };
  const Icone = config[etat].icone;

  const enfant = isValidElement(children)
    ? cloneElement(children as ReactElement<{ readonly 'aria-describedby'?: string }>, {
        'aria-describedby':
          [
            (children as ReactElement<{ readonly 'aria-describedby'?: string }>).props[
              'aria-describedby'
            ],
            idEtat,
          ]
            .filter(Boolean)
            .join(' ') || undefined,
      })
    : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id}>{label}</Label>
        <span
          id={idEtat}
          className={cn(
            'inline-flex items-center gap-1 texte-libelle font-normal',
            etat === 'douteux' ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(config[etat].cle)}
        </span>
      </div>
      {/* Anneau neutre (pas de couleur, voir la doc de tête) autour du contrôle pour « à
          vérifier » — signal visuel indépendant du texte, pour qu'un balayage rapide de l'écran
          repère la ligne à relire sans avoir à lire chaque libellé. */}
      <div
        className={cn('rounded-md', etat === 'douteux' && 'ring-2 ring-inset ring-foreground/50')}
      >
        {enfant}
      </div>
      {aide ? <p className="texte-libelle text-muted-foreground">{aide}</p> : null}
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : null}
    </div>
  );
}
