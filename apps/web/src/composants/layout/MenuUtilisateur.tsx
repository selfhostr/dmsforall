import { useTranslation } from 'react-i18next';

import type { UtilisateurCourant } from '@dfa/shared';

import { cleTraductionRole } from '@/lib/roles';

interface Props {
  readonly utilisateur: UtilisateurCourant;
}

/** Affichage identité + rôle. Volontairement non interactif : le bouton de déconnexion est
 *  affiché en clair dans EnTete, PAS enfoui dans ce menu (poste partagé d'atelier). */
export function MenuUtilisateur({ utilisateur }: Props) {
  const { t } = useTranslation('commun');
  const initiales = `${utilisateur.prenom.charAt(0)}${utilisateur.nom.charAt(0)}`.toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        {initiales}
      </span>
      <div className="hidden text-sm leading-tight sm:block">
        <p className="font-medium">
          {utilisateur.prenom} {utilisateur.nom}
        </p>
        <p className="text-muted-foreground">{t(cleTraductionRole(utilisateur.role))}</p>
      </div>
    </div>
  );
}
