import { CircleHelp } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Props {
  /** Texte court du garagiste, déjà traduit. */
  readonly texte: string;
  /** Nom de la notion expliquée, déjà traduit : sert de nom accessible au bouton. */
  readonly sujet?: string;
  readonly className?: string;
}

/** Délai avant fermeture au départ de la souris : laisse le temps de rejoindre la bulle. */
const DELAI_FERMETURE_MS = 120;

/**
 * Petite icône « ? » cerclée posée en ligne à côté d'un libellé ou d'un titre. Le bouton occupe
 * TOUJOURS 16 px (`size-4`, `shrink-0`) : son apparition ne décale rien. La bulle (Popover Radix,
 * portail) s'ouvre au survol, au focus clavier, et au clic/toucher. Échap la ferme.
 */
export function AideContextuelle({ texte, sujet, className }: Props) {
  const { t } = useTranslation('aide');
  const [ouvert, setOuvert] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Le clic qui suit un survol ne doit pas refermer la bulle que le survol vient d'ouvrir. */
  const enSurvol = useRef(false);

  const annulerFermeture = () => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
  };
  const ouvrir = () => {
    enSurvol.current = true;
    annulerFermeture();
    setOuvert(true);
  };
  const fermerPlusTard = () => {
    enSurvol.current = false;
    annulerFermeture();
    minuteur.current = setTimeout(() => setOuvert(false), DELAI_FERMETURE_MS);
  };

  return (
    <Popover
      open={ouvert}
      onOpenChange={(valeur) => {
        if (!valeur && enSurvol.current) return;
        setOuvert(valeur);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={sujet ? t('aide:ouvrirSujet', { sujet }) : t('aide:ouvrir')}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          onMouseEnter={ouvrir}
          onMouseLeave={fermerPlusTard}
        >
          <CircleHelp aria-hidden className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="max-w-xs p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => {
          enSurvol.current = false;
        }}
        onMouseEnter={ouvrir}
        onMouseLeave={fermerPlusTard}
      >
        {texte}
      </PopoverContent>
    </Popover>
  );
}
