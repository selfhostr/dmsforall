import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseLigneOr, ReponseOrdreReparation } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { lignesPointables } from '@/hooks/pointage/lignes-assignees';

interface Props {
  readonly onFermer: () => void;
  readonly technicienId: string;
  readonly requeteOr: UseQueryResult<ReponseOrdreReparation>;
  readonly onChoisirLigne: (or: ReponseOrdreReparation, ligne: ReponseLigneOr) => void;
  readonly onChoisirOrEntier: (or: ReponseOrdreReparation) => void;
  readonly enDemarrage: boolean;
}

/**
 * « Que pointez-vous ? » — vue PLEIN ÉCRAN (plus une modale, voir ci-dessous), atteinte quand le
 * technicien tape un OR dans « Mes OR du jour » / « Toutes les OR ouvertes ». Liste TOUTES les
 * lignes pointables de l'OR (`lignesPointables`, filtrage par STATUT seul — jamais `refusee`/
 * `annulee`/`facturee`), plus un bouton « OR entier » toujours disponible (RM-87, nature
 * `productif_or` — un OR ne porte pas forcément une répartition par ligne).
 *
 * ARBITRAGE @laupernoe (14.08.2026, NE PAS ROUVRIR — voir `hooks/pointage/lignes-assignees.ts`) : un
 * technicien peut pointer une ligne sans y être assigné (l'apprenti qui prête main-forte au
 * compagnon, par ex.). Ce composant n'appelle donc PLUS `lignesAssigneesPointables` (qui filtrait
 * par `technicienId`) : `technicienId` ne sert plus ici qu'à annoter, à titre d'INFORMATION, les
 * lignes assignées à un AUTRE technicien (`assigneeAutre` ci-dessous) — jamais à les cacher.
 *
 * VUE PLEIN ÉCRAN, PLUS UNE MODALE (correctif ergonomique) : sur une borne d'atelier, mains
 * gantées, le tap accidentel sur le fond assombri d'une modale Radix fermait ce dialogue par
 * erreur. Ce composant remplace désormais ENTIÈREMENT l'écran appelant le temps du choix (même
 * patron que les autres bascules d'état d'`EcranPointageTechnicien`/`EcranBornePointage` — « un
 * seul état affiché à la fois »), avec un bouton « Retour » explicite plutôt qu'un clic hors-cible.
 * Se rendant désormais DANS l'arborescence DOM réelle de l'écran appelant (plus de portail Radix
 * hors sous-arborescence), il hérite normalement des variables `--densite-*`/`--texte-*` posées par
 * la classe `.densite-*` ambiante — le prop `densite` explicite qu'exigeait l'ancienne version
 * (portail vers `document.body`, hors sous-arborescence) n'a donc plus lieu d'être.
 */
export function DialogueChoixCiblePointage({
  onFermer,
  technicienId,
  requeteOr,
  onChoisirLigne,
  onChoisirOrEntier,
  enDemarrage,
}: Props) {
  const { t } = useTranslation(['pointage', 'commun']);
  const boutonRetourRef = useRef<HTMLButtonElement>(null);

  // Foyer explicite sur « Retour » à l'entrée de cette vue plein écran — même doctrine
  // d'accessibilité qu'un changement de route : l'utilisateur (clavier/lecteur d'écran) doit
  // atterrir quelque part de connu, jamais laissé sur un focus perdu dans le DOM précédent.
  useEffect(() => {
    boutonRetourRef.current?.focus();
  }, []);

  const lignes = requeteOr.data ? lignesPointables(requeteOr.data) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          ref={boutonRetourRef}
          type="button"
          variant="ghost"
          size="lg"
          className="min-h-[72px] gap-2 px-3"
          onClick={onFermer}
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          {t('pointage:technicien.choisirCible.retour')}
        </Button>
        <h1 className="texte-titre-page">{t('pointage:technicien.choisirCible.titre')}</h1>
      </div>

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
            className="h-auto min-h-[72px] w-full justify-start whitespace-normal break-words text-base"
            disabled={enDemarrage}
            onClick={() => onChoisirOrEntier(requeteOr.data)}
          >
            {t('pointage:technicien.boutons.demarrerOr')}
          </Button>

          <div className="flex flex-col gap-2">
            <h2 className="texte-titre-section">
              {t('pointage:technicien.choisirCible.lignesTitre')}
            </h2>
            {lignes.length === 0 ? (
              <p className="texte-libelle text-muted-foreground">
                {t('pointage:technicien.choisirCible.aucuneLigne')}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {lignes.map((ligne) => (
                  <Button
                    key={ligne.id}
                    size="lg"
                    variant="outline"
                    className="h-auto min-h-[72px] w-full flex-col items-start justify-center whitespace-normal break-words text-left text-base"
                    disabled={enDemarrage}
                    onClick={() => onChoisirLigne(requeteOr.data, ligne)}
                  >
                    <span>{ligne.designation}</span>
                    {ligne.technicienId && ligne.technicienId !== technicienId ? (
                      <span className="texte-libelle font-normal text-muted-foreground">
                        {t('pointage:technicien.choisirCible.assigneeAutre')}
                      </span>
                    ) : null}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
