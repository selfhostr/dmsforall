import { fermerSignalement, useSignalementOuvert } from '@/hooks/signalement/etat-signalement';
import { useSession } from '@/hooks/useSession';

import { PanneauSignalement } from './PanneauSignalement';

/** Monté une fois dans la coquille : le menu du profil demande l'ouverture, ce panneau la porte.
 *  Reste monté fermé pour que les saisies survivent à une fermeture accidentelle. */
export function SignalerProbleme() {
  const ouvert = useSignalementOuvert();
  const { data: session } = useSession();
  const mode = session?.tenant.modeSignalement;
  if (!session || mode === undefined || mode === 'desactive') return null;
  return (
    <PanneauSignalement
      ouvert={ouvert}
      onOuvertChange={(o) => {
        if (!o) fermerSignalement();
      }}
      mode={mode}
      nbSites={session.sites.length}
    />
  );
}
