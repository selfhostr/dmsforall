import { useTranslation } from 'react-i18next';

import { BlocLogoEntreprise } from '@/ecrans/parametrage/BlocLogoEntreprise';

import { PiedEtape } from '../PiedEtape';
import type { PropsEtape } from '../types-etape';

/** Étape 4 — Logo. `BlocLogoEntreprise` envoie lui-même le fichier (`PUT /parametres-entreprise/logo`). */
export function EtapeLogo({ onSuivant, onRetour, onPasser }: PropsEtape) {
  const { t } = useTranslation('assistant');
  return (
    <div className="flex flex-col gap-5">
      <BlocLogoEntreprise />
      <PiedEtape
        submit={false}
        onSuivant={onSuivant}
        onRetour={onRetour}
        onPasser={onPasser}
        libelleSuivant={t('assistant:actions.suivant')}
      />
    </div>
  );
}
