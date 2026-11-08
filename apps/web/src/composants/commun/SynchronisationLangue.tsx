import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { detecterLangueInitiale } from '@/i18n';
import { useLangue } from '@/hooks/useLangue';
import { useSession } from '@/hooks/useSession';

/** Règle de priorité (issue #62), composant sans rendu monté une fois près de la racine :
 *  - connecté : `utilisateur.langue` (profil) l'emporte TOUJOURS. Sur un poste partagé, le choix
 *    du premier utilisateur n'est jamais imposé au suivant ;
 *  - déconnecté : langue de l'écran de connexion gardée sur le poste (localStorage), sinon langue
 *    du navigateur, sinon FR (`detecterLangueInitiale`). */
export function SynchronisationLangue() {
  const { data: session } = useSession();
  const { langue } = useLangue();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (session === undefined) return;
    const cible = session ? session.utilisateur.langue : detecterLangueInitiale();
    if (cible !== langue) void i18n.changeLanguage(cible);
  }, [session, langue, i18n]);

  return null;
}
