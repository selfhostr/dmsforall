import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { Langue, SessionCourante } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { enregistrerLangueProfil } from '@/api/session';
import { useLangue, type UtiliserLangue } from '@/hooks/useLangue';

/**
 * Choix de langue des sélecteurs de l'application (issue #62).
 *
 * - connecté : la langue est une préférence du PROFIL -- enregistrée sur le serveur, jamais sur le
 *   poste. Un poste partagé affiche donc toujours la langue de la personne connectée.
 * - non connecté (écran de connexion) : seule la langue de l'écran de connexion est gardée sur le
 *   poste (localStorage), via `useLangue`.
 */
export function useLangueProfil(): UtiliserLangue {
  const poste = useLangue();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();

  const changerLangue = (langue: Langue): void => {
    const session = queryClient.getQueryData<SessionCourante | null>(clesQuery.session());
    if (!session) {
      poste.changerLangue(langue);
      return;
    }
    const precedente = session.utilisateur.langue;
    void i18n.changeLanguage(langue);
    queryClient.setQueryData<SessionCourante>(clesQuery.session(), {
      ...session,
      utilisateur: { ...session.utilisateur, langue },
    });
    enregistrerLangueProfil(langue).catch(() => {
      // Échec d'enregistrement : on revient à la langue du profil, qui reste la référence.
      void i18n.changeLanguage(precedente);
      queryClient.setQueryData<SessionCourante>(clesQuery.session(), session);
    });
  };

  return { ...poste, changerLangue };
}
