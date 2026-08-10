import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { ReponseLigneOr, ReponseOrdreReparation } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type Densite } from '@/components/ui/table';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { lignesAssigneesPointables } from '@/hooks/pointage/lignes-assignees';

interface Props {
  readonly ouvert: boolean;
  readonly onFermer: () => void;
  readonly technicienId: string;
  readonly requeteOr: UseQueryResult<ReponseOrdreReparation>;
  readonly onChoisirLigne: (or: ReponseOrdreReparation, ligne: ReponseLigneOr) => void;
  readonly onChoisirOrEntier: (or: ReponseOrdreReparation) => void;
  readonly enDemarrage: boolean;
  /** Repli `'dense'`, identique au reste du produit — voir la note sur `DialogContent` ci-dessous
   *  pour pourquoi ce dialogue ne peut PAS se contenter d'hériter de son appelant. */
  readonly densite?: Densite;
}

/**
 * « Que pointez-vous ? » — s'ouvre quand le technicien tape un OR dans « Mes OR du jour ».
 * Liste UNIQUEMENT les lignes qui LUI sont assignées (`ligne.technicienId === technicienId`) et
 * encore pointables, plus un bouton « OR entier » toujours disponible (RM-87, nature
 * `productif_or` — un OR ne porte pas forcément une répartition par ligne).
 *
 * Partagé par DEUX appelants à densités différentes : `EcranBornePointage` (très aérée) et
 * `EcranPointageTechnicien` (repli dense, poste de travail, inchangé). `DialogContent` rend via
 * `DialogPortal` (Radix) — un portail vers `document.body`, donc HORS de la sous-arborescence DOM
 * de l'écran appelant. Les variables `--densite-*`/`--texte-*` posées par la classe `densite-*` de
 * l'écran (héritage CSS par ancêtre DOM) n'atteignent JAMAIS ce contenu : mesuré en Playwright,
 * sans ce prop le dialogue retombait systématiquement sur les valeurs `dense` (titre 16px) même
 * ouvert depuis la borne en `densite-tres-aeree`. D'où ce prop explicite, posé ICI sur
 * `DialogContent`, plutôt qu'une hypothèse d'héritage qui ne tient pas pour du contenu porté.
 */
export function DialogueChoixCiblePointage({
  ouvert,
  onFermer,
  technicienId,
  requeteOr,
  onChoisirLigne,
  onChoisirOrEntier,
  enDemarrage,
  densite = 'dense',
}: Props) {
  const { t } = useTranslation(['pointage', 'commun']);

  const lignesAssignees = requeteOr.data
    ? lignesAssigneesPointables(requeteOr.data, technicienId)
    : [];

  return (
    <Dialog open={ouvert} onOpenChange={(valeur) => !valeur && onFermer()}>
      <DialogContent className={`densite-${densite} sm:max-w-lg`}>
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
