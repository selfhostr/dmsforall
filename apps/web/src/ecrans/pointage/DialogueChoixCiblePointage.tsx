import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { ReponseLigneOr, ReponseOrdreReparation } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';

/**
 * Lignes qu'un technicien peut raisonnablement pointer : jamais `refusee`/`annulee` (RM-93 les
 * refuse au démarrage, `409 POINTAGE_LIGNE_NON_POINTABLE`) ni `facturee` (déjà figée). Un filtrage
 * d'ERGONOMIE — le serveur reste l'arbitre final si l'état a changé entre le chargement de l'OR et
 * le clic (l'écran affiche alors l'erreur serveur normalement, via `messageErreur`).
 */
const STATUTS_LIGNE_POINTABLE = new Set([
  'proposee',
  'a_valider',
  'validee',
  'en_cours',
  'realisee',
]);

function ligneEstPointable(ligne: ReponseLigneOr): boolean {
  return STATUTS_LIGNE_POINTABLE.has(ligne.statut);
}

interface Props {
  readonly ouvert: boolean;
  readonly onFermer: () => void;
  readonly technicienId: string;
  readonly requeteOr: UseQueryResult<ReponseOrdreReparation>;
  readonly onChoisirLigne: (or: ReponseOrdreReparation, ligne: ReponseLigneOr) => void;
  readonly onChoisirOrEntier: (or: ReponseOrdreReparation) => void;
  readonly enDemarrage: boolean;
}

/**
 * « Que pointez-vous ? » — s'ouvre quand le technicien tape un OR dans « Mes OR du jour ».
 * Liste UNIQUEMENT les lignes qui LUI sont assignées (`ligne.technicienId === technicienId`) et
 * encore pointables, plus un bouton « OR entier » toujours disponible (RM-87, nature
 * `productif_or` — un OR ne porte pas forcément une répartition par ligne).
 */
export function DialogueChoixCiblePointage({
  ouvert,
  onFermer,
  technicienId,
  requeteOr,
  onChoisirLigne,
  onChoisirOrEntier,
  enDemarrage,
}: Props) {
  const { t } = useTranslation(['pointage', 'commun']);

  const lignesAssignees = (requeteOr.data?.lignes ?? []).filter(
    (ligne) => ligne.technicienId === technicienId && ligneEstPointable(ligne),
  );

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && onFermer()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pointage:technicien.choisirCible.titre')}</DialogTitle>
        </DialogHeader>

        {requeteOr.isPending ? <EtatChargement lignes={3} /> : null}

        {requeteOr.isError ? (
          <EtatErreur
            titre={t('pointage:technicien.erreur.titre')}
            description={messageErreur(requeteOr.error, t)}
            onReessayer={() => void requeteOr.refetch()}
          />
        ) : null}

        {requeteOr.data ? (
          <div className="flex flex-col gap-4">
            <p className="texte-corps text-muted-foreground">
              {t('pointage:technicien.choisirCible.description')}
            </p>

            <Button
              size="lg"
              variant="secondary"
              className="h-auto min-h-14 w-full justify-start whitespace-normal break-words text-base"
              disabled={enDemarrage}
              onClick={() => onChoisirOrEntier(requeteOr.data)}
            >
              {t('pointage:technicien.boutons.demarrerOr')}
            </Button>

            <div className="flex flex-col gap-2">
              <h3 className="texte-titre-section">
                {t('pointage:technicien.choisirCible.lignesTitre')}
              </h3>
              {lignesAssignees.length === 0 ? (
                <p className="texte-libelle text-muted-foreground">
                  {t('pointage:technicien.choisirCible.aucuneLigne')}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {lignesAssignees.map((ligne) => (
                    <Button
                      key={ligne.id}
                      size="lg"
                      variant="outline"
                      className="h-auto min-h-14 w-full justify-start whitespace-normal break-words text-left text-base"
                      disabled={enDemarrage}
                      onClick={() => onChoisirLigne(requeteOr.data, ligne)}
                    >
                      {ligne.designation}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
