import { UploadCloud } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface Props {
  readonly onFichierChoisi: (fichier: File) => void;
  readonly desactive?: boolean;
}

/**
 * Zone de dépôt — glisser-déposer OU sélection au clavier (`role="button"`, `tabIndex=0`,
 * `Entrée`/`Espace` ouvrent le sélecteur natif). Un seul fichier accepté : la reprise ne porte
 * QUE sur une archive complète, jamais une sélection multiple.
 *
 * `<input type="file">` cité par la doc d'accessibilité comme le moyen le plus robuste de rester
 * utilisable au clavier ET aux technologies d'assistance sans réinventer un composant Base UI/
 * Radix — c'est un contrôle FEUILLE natif du navigateur, pas une primitive `components/ui/` à
 * remplacer.
 */
export function ZoneDepotFichier({ onFichierChoisi, desactive = false }: Props) {
  const { t } = useTranslation('reprise');
  const entreeRef = useRef<HTMLInputElement>(null);
  const [survole, setSurvole] = useState(false);
  const idDescription = useId();

  function gererDepot(evenement: DragEvent<HTMLDivElement>) {
    evenement.preventDefault();
    setSurvole(false);
    if (desactive) return;
    const fichier = evenement.dataTransfer.files[0];
    if (fichier) onFichierChoisi(fichier);
  }

  function gererChangementInput(fichier: File | undefined) {
    if (fichier) onFichierChoisi(fichier);
    // Permet de redéposer EXACTEMENT le même fichier une seconde fois (reprise après interruption
    // avec le même nom) — sans réinitialiser `value`, un second choix du fichier identique ne
    // déclenche aucun événement `change`.
    if (entreeRef.current) entreeRef.current.value = '';
  }

  function gererClavier(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key === 'Enter' || evenement.key === ' ') {
      evenement.preventDefault();
      entreeRef.current?.click();
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={desactive ? -1 : 0}
        aria-disabled={desactive}
        aria-describedby={idDescription}
        onClick={() => !desactive && entreeRef.current?.click()}
        onKeyDown={gererClavier}
        onDragOver={(evenement) => {
          evenement.preventDefault();
          if (!desactive) setSurvole(true);
        }}
        onDragLeave={() => setSurvole(false)}
        onDrop={gererDepot}
        className={cn(
          'flex flex-col items-center gap-groupe rounded-lg border-2 border-dashed p-carte text-center transition-colors anneau-focus',
          'cursor-pointer',
          survole && !desactive ? 'border-primary bg-primary/5' : 'border-input',
          desactive && 'cursor-not-allowed opacity-50',
        )}
      >
        <UploadCloud aria-hidden="true" className="h-10 w-10 text-muted-foreground" />
        <p className="texte-corps font-medium">
          {survole ? t('reprise:depot.zone.survol') : t('reprise:depot.zone.instruction')}
        </p>
        <p id={idDescription} className="text-sm text-muted-foreground">
          {t('reprise:depot.aideFormat')}
        </p>
      </div>
      <input
        ref={entreeRef}
        type="file"
        accept=".zip"
        className="sr-only"
        disabled={desactive}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(evenement) => gererChangementInput(evenement.target.files?.[0])}
      />
    </div>
  );
}
