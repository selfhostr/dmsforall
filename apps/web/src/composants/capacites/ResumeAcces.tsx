import { useTranslation } from 'react-i18next';

import type { CapacitesPersonne } from '@dfa/shared';

import { BadgePersonnalise } from './BadgePersonnalise';
import { resumerGrille } from './grille';

/**
 * Colonne « Accès » de la liste des employés : domaines où la personne agit (« Atelier, Pièces »),
 * « · encadre », puis ce qu'elle ne fait que regarder, et le préréglage d'origine ou « Personnalisé ».
 */
interface Props {
  readonly capacites: CapacitesPersonne;
  /** Rôle déjà affiché à côté : le préréglage qui porte le même nom n'est pas répété. */
  readonly roleAffiche?: string;
}

export function ResumeAcces({ capacites, roleAffiche }: Props) {
  const { t } = useTranslation('capacites');
  const resume = resumerGrille(capacites);
  const nom = (d: string) => t(`domaines.${d}.libelle`);

  const faire = resume.faire.map(nom).join(', ');
  let principal: string;
  if (faire !== '') {
    principal = resume.encadre ? `${faire} · ${t('resume.encadre')}` : faire;
  } else if (resume.voir.length > 0) {
    principal = resume.encadre
      ? `${t('resume.lectureSeule')} · ${t('resume.encadre')}`
      : t('resume.lectureSeule');
  } else {
    principal = t('resume.aucun');
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span>{principal}</span>
      {resume.voir.length > 0 ? (
        <span className="texte-libelle text-muted-foreground">
          {t('resume.voit', { liste: resume.voir.map(nom).join(', ') })}
        </span>
      ) : null}
      <span className="flex items-center gap-1.5 texte-libelle text-muted-foreground">
        {capacites.prereglage === null ? (
          <BadgePersonnalise />
        ) : capacites.prereglage !== roleAffiche ? (
          t(`prereglages.${capacites.prereglage}.libelle`)
        ) : null}
      </span>
    </div>
  );
}
