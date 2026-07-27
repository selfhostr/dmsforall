import { useTranslation } from 'react-i18next';

import { useLangue } from '@/hooks/useLangue';
import { cn } from '@/lib/utils';

/** Accessible AVANT connexion (utilisé sur EcranConnexion) et dans l'en-tête une fois
 *  connecté. Groupe de boutons plutôt qu'un select : cibles tactiles >=44px garanties, pas de
 *  dépendance à un composant de menu complexe pour un choix à 3 valeurs fixes. */
export function SelecteurLangue() {
  const { t } = useTranslation('commun');
  const { langue, languesDisponibles, changerLangue } = useLangue();

  return (
    <div role="group" aria-label={t('commun:langue.choisir')} className="inline-flex overflow-hidden rounded-md border">
      {languesDisponibles.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={langue === code}
          title={t(`commun:langues.${code}`)}
          onClick={() => changerLangue(code)}
          className={cn(
            'h-11 min-w-11 px-3 text-sm font-medium uppercase transition-colors',
            langue === code
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-foreground hover:bg-muted',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
