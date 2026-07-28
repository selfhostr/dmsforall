import type { ResultatRecherche } from '@dfa/shared';

import { texteResume } from './resume';

export interface ProprietesResultatClient {
  readonly resultat: ResultatRecherche;
}

/** Contenu d'une ligne de résultat « client ». Enveloppé dans un `CommandItem` par
 *  `PanneauResultatsRecherche` — ce composant ne rend que le contenu de la ligne. */
export function ResultatClient({ resultat }: ProprietesResultatClient) {
  const nom = texteResume(resultat.resume.nom) ?? '';
  const numeroClient = texteResume(resultat.resume.numeroClient);
  const telephone = texteResume(resultat.resume.telephone);
  const localite = texteResume(resultat.resume.localite);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className="texte-corps font-medium text-foreground">{nom}</span>
      {numeroClient ? <span className="texte-libelle text-muted-foreground">{numeroClient}</span> : null}
      {telephone ? <span className="texte-libelle text-muted-foreground">{telephone}</span> : null}
      {localite ? <span className="texte-libelle text-muted-foreground">{localite}</span> : null}
    </div>
  );
}
