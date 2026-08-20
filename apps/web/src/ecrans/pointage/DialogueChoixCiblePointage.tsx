import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseLigneOr, ReponseOrdreReparation, StatutLigneOr } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { lignesPointables } from '@/hooks/pointage/lignes-assignees';

/**
 * Issue #152 — SIGNALÉ AU COORDINATEUR, PAS CORRIGÉ À LA SOURCE (hors du périmètre d'écriture de
 * cet agent, `hooks/pointage/**` n'y est pas) : `lignesPointables()` (`hooks/pointage/
 * lignes-assignees.ts`, `STATUTS_LIGNE_POINTABLE`) considère `'proposee'`/`'a_valider'`/`'realisee'`
 * comme pointables — le SERVEUR, lui (`apps/api/src/pointage/regles-pointage.ts`,
 * `STATUTS_LIGNE_POINTABLES`, RM-93), n'accepte de démarrer un pointage QUE sur `'validee'` ou
 * `'en_cours'` ; toute autre valeur répond `409 POINTAGE_LIGNE_NON_POINTABLE`. Constat terrain (test
 * navigateur réel) : une ligne dans un de ces trois états intermédiaires s'affichait normalement,
 * PLEINEMENT cliquable, et le clic échouait systématiquement au serveur. Filtre CORRECTIF, LOCAL à
 * ce composant, appliqué EN PLUS de `lignesPointables()` plutôt qu'à sa place (qui reste la source
 * pour la liste elle-même) : verrouille sur la vérité SERVEUR pour décider quoi désactiver, sans
 * toucher au fichier partagé. RM-121/CT-54 reste inchangé : une ligne `'en_cours'` PAR UN AUTRE
 * technicien demeure cliquable (un second technicien peut rejoindre la même ligne) — seul le STATUT
 * de la ligne compte ici, jamais `technicienId` (voir `assigneeAutre` plus bas, qui reste une simple
 * information, jamais un blocage — arbitrage @laupernoe du 14.08.2026, INCHANGÉ).
 */
const STATUTS_LIGNE_REELLEMENT_POINTABLES: ReadonlySet<StatutLigneOr> = new Set([
  'validee',
  'en_cours',
]);

function ligneReellementPointable(ligne: ReponseLigneOr): boolean {
  return STATUTS_LIGNE_REELLEMENT_POINTABLES.has(ligne.statut);
}

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
 *
 * PAS DE `h1` ICI (chantier « titres doublés », 17.08.2026) : ce composant est monté par
 * `EcranPointageTechnicien`/`EcranBornePointage` comme un ÉTAT de leur écran routé, pas comme un
 * écran séparé — le titre « Que pointez-vous ? » est désormais porté par le `GabaritEcran` de
 * l'appelant (un seul niveau 1 par état d'écran). Le bouton « Retour » ci-dessous reste ici, colocalisé
 * avec la gestion de focus qu'il porte (`boutonRetourRef`).
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
                {lignes.map((ligne) => {
                  // Issue #152 — voir la docstring de `ligneReellementPointable` ci-dessus : le
                  // SERVEUR refuse `409 POINTAGE_LIGNE_NON_POINTABLE` sur toute ligne hors
                  // `'validee'`/`'en_cours'`, quoi que propose `lignesPointables()`. Désactivée dès
                  // l'affichage — visuellement (`disabled`, style atténué déjà porté par
                  // `disabled:opacity-50` du bouton) ET pour un lecteur d'écran (`disabled` retire
                  // le bouton de l'ordre de tabulation et l'annonce comme indisponible), AVEC la
                  // raison en clair. `assigneeAutre` reste, elle, une simple INFORMATION (jamais un
                  // blocage, RM-121/CT-54, arbitrage 14.08.2026 inchangé) : une ligne assignée à un
                  // autre technicien mais `'validee'`/`'en_cours'` demeure pleinement cliquable.
                  const pointable = ligneReellementPointable(ligne);
                  return (
                    <Button
                      key={ligne.id}
                      size="lg"
                      variant="outline"
                      className="h-auto min-h-[72px] w-full flex-col items-start justify-center whitespace-normal break-words text-left text-base"
                      disabled={enDemarrage || !pointable}
                      onClick={() => onChoisirLigne(requeteOr.data, ligne)}
                    >
                      <span>{ligne.designation}</span>
                      {!pointable ? (
                        <span className="texte-libelle font-normal text-muted-foreground">
                          {t('pointage:technicien.choisirCible.nonPointable')}
                        </span>
                      ) : ligne.technicienId && ligne.technicienId !== technicienId ? (
                        <span className="texte-libelle font-normal text-muted-foreground">
                          {t('pointage:technicien.choisirCible.assigneeAutre')}
                        </span>
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
