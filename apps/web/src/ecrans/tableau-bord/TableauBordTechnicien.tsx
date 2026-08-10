import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { compterLignesAssigneesPointables } from '@/hooks/pointage/lignes-assignees';
import { useMesOrdresAssignes } from '@/hooks/pointage/useMesOrdresAssignes';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

interface Props {
  readonly site: string | undefined;
}

/**
 * Technicien — 1 bloc SEULEMENT, sous le plancher de 3, ASSUMÉ (`docs/design-tableau-bord-par-role.md`
 * §3.7) : son vrai dashboard personnalisé, c'est déjà Pointage › Mon travail
 * (`EcranPointageTechnicien`, chronomètre + ses OR), où `routes/atterrissage.ts` le fait atterrir —
 * inchangé par cette fusion. Ce bloc ne sert que s'il navigue explicitement vers le tableau de bord
 * fusionné ; dupliquer l'écran de pointage ici serait le contraire de « minimaliste ».
 *
 * Même source que « Mes OR du jour » (`useMesOrdresAssignes` + `compterLignesAssigneesPointables`,
 * réutilisés tels quels — SOURCE UNIQUE du calcul, voir `hooks/pointage/lignes-assignees.ts`), mais
 * en LECTURE (lien vers la fiche OR), pas en action de pointage : ce geste-là reste sur son écran
 * de travail.
 */
export function TableauBordTechnicien({ site }: Props) {
  const { t } = useTranslation(['tableauBord', 'pointage', 'commun', 'erreurs']);
  const { data: session } = useSession();
  const technicienId = session?.utilisateur.id;

  const requete = useMesOrdresAssignes(technicienId);
  const ordres = requete.data ?? [];

  let contenu: ReactNode;
  if (requete.isPending) {
    contenu = <EtatChargement lignes={3} />;
  } else if (requete.isError) {
    contenu = (
      <EtatErreur
        titre={t('tableauBord:technicien.erreur')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  } else if (ordres.length === 0) {
    contenu = (
      <EtatVide
        titre={t('tableauBord:technicien.vide.titre')}
        description={t('tableauBord:technicien.vide.description')}
      />
    );
  } else {
    contenu = (
      <div className="flex flex-col gap-3">
        {ordres.map((or) => (
          <Link
            key={or.id}
            to={chemins.atelier.ordresReparation.detail(or.id, site)}
            className="flex min-h-[64px] flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{or.numero}</span>
              <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />
              <IdentiteClient client={or.client} />
            </div>
            <span className="texte-libelle text-muted-foreground">
              {t('pointage:technicien.mesOrs.lignesAssignees', {
                count: compterLignesAssigneesPointables(or, technicienId as string),
              })}
            </span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tableauBord:technicien.titre')}</CardTitle>
      </CardHeader>
      <div className="px-carte pb-carte">{contenu}</div>
    </Card>
  );
}
