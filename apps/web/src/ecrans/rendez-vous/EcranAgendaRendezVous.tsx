import { CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GrilleAgendaSemaine } from '@/composants/rendez-vous/GrilleAgendaSemaine';
import { VueListeRendezVous } from '@/composants/rendez-vous/VueListeRendezVous';
import type { JourAgenda, RendezVousCarte } from '@/composants/rendez-vous/types';

export type VueAgendaEcran = 'jour' | 'semaine' | 'liste';

interface Props {
  /** `undefined` = aucun site sélectionné dans l'en-tête — état dédié, jamais un site deviné
   *  (conception, Écran 1). */
  readonly site: { readonly id: string; readonly nom: string } | undefined;
  readonly vue: VueAgendaEcran;
  readonly onChangerVue: (vue: VueAgendaEcran) => void;
  /** Déjà formaté par l'appelant (« 10 – 16 août 2026 » en semaine, « Jeudi 13 août 2026 » en
   *  jour) — cet écran ne recalcule aucune date, il affiche ce qu'on lui donne. */
  readonly periodeLabel: string;
  readonly onPrecedent: () => void;
  readonly onSuivant: () => void;
  readonly onAujourdhui: () => void;
  readonly recherche: string;
  readonly onChangerRecherche: (recherche: string) => void;
  /** `undefined` = rôle sans `rendez_vous.creer` (ex. technicien, chef d'atelier) — MASQUE le
   *  bouton partout (barre d'outils ET état vide), ne le désactive jamais (consigne du
   *  coordinateur : « un geste proposé à qui n'y a pas droit est pire que pas de geste »). */
  readonly onNouveauRendezVous?: () => void;
  readonly etat: 'chargement' | 'erreur' | 'contenu';
  readonly messageErreur?: string;
  readonly onReessayer?: () => void;
  /** En vue Semaine : les sept jours de la période. En vue Jour : UN SEUL élément (le jour affiché)
   *  — à charge de l'appelant de ne fournir que ce jour-là. */
  readonly jours: readonly JourAgenda[];
  readonly onCliquerJour: (jour: JourAgenda) => void;
  readonly onOuvrirRendezVous: (rendezVous: RendezVousCarte) => void;
}

/**
 * Agenda des rendez-vous — Écran 1 (`docs/conception-rendez-vous-ecrans.md`). Composant CONTRÔLÉ :
 * toute la donnée (site, période, recherche, rendez-vous) et sa navigation viennent du PARENT via
 * props — aucun accès réseau ici, ce qui le rend testable dès maintenant avec des fixtures locales,
 * indépendamment du contrat `/api/v1/rendez-vous*` (pas encore livré à cette date, voir le rapport
 * de livraison). Le futur conteneur réseau n'aura qu'à brancher ses hooks sur ces mêmes props.
 */
export function EcranAgendaRendezVous({
  site,
  vue,
  onChangerVue,
  periodeLabel,
  onPrecedent,
  onSuivant,
  onAujourdhui,
  recherche,
  onChangerRecherche,
  onNouveauRendezVous,
  etat,
  messageErreur,
  onReessayer,
  jours,
  onCliquerJour,
  onOuvrirRendezVous,
}: Props) {
  const { t } = useTranslation(['planning', 'commun', 'erreurs']);

  if (!site) {
    return (
      <EtatVide
        titre={t('planning:site.manquant.titre')}
        description={t('planning:site.manquant.description')}
      />
    );
  }

  const totalRendezVous = jours.reduce((somme, jour) => somme + jour.rendezVous.length, 0);
  const rechercheActive = recherche.trim() !== '';

  function contenu() {
    if (etat === 'chargement') {
      return vue === 'liste' ? (
        <EtatChargement lignes={5} />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {Array.from({ length: vue === 'jour' ? 1 : 7 }, (_, index) => (
            <Skeleton key={index} className="h-40 w-full" />
          ))}
        </div>
      );
    }

    if (etat === 'erreur') {
      return (
        <EtatErreur
          titre={t('planning:erreur.titre')}
          description={messageErreur ?? t('erreurs:inattendue.description')}
          onReessayer={onReessayer}
        />
      );
    }

    if (totalRendezVous === 0 && rechercheActive) {
      return (
        <EtatVideRecherche
          titre={t('planning:vide.recherche.titre')}
          description={t('planning:vide.recherche.description', { recherche })}
        />
      );
    }

    if (totalRendezVous === 0) {
      return (
        <EtatVide
          titre={t(vue === 'jour' ? 'planning:vide.jour.titre' : 'planning:vide.semaine.titre')}
          description={t(
            vue === 'jour' ? 'planning:vide.jour.description' : 'planning:vide.semaine.description',
          )}
          action={
            onNouveauRendezVous ? (
              <Button type="button" onClick={onNouveauRendezVous}>
                <CalendarPlus aria-hidden className="h-4 w-4" />
                {t('planning:toolbar.nouveauRendezVous')}
              </Button>
            ) : undefined
          }
        />
      );
    }

    if (vue === 'liste') {
      // `dateLe` (jour) suffit à trier : à l'intérieur d'un même jour, `GrilleAgendaSemaine` porte
      // déjà le tri par moment/heure — la vue Liste n'a pas besoin de le reproduire, `TableComptoir`
      // reste triable par l'utilisateur si besoin.
      const toutesLesCartes = jours
        .flatMap((jour) => jour.rendezVous)
        .slice()
        .sort((a, b) => a.dateLe.localeCompare(b.dateLe));
      return (
        <VueListeRendezVous rendezVous={toutesLesCartes} onOuvrirRendezVous={onOuvrirRendezVous} />
      );
    }

    return (
      <GrilleAgendaSemaine
        jours={jours}
        onCliquerJour={onCliquerJour}
        onOuvrirRendezVous={onOuvrirRendezVous}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={vue} onValueChange={(valeur) => onChangerVue(valeur as VueAgendaEcran)}>
          <TabsList>
            <TabsTrigger value="semaine">{t('planning:toolbar.bascule.semaine')}</TabsTrigger>
            <TabsTrigger value="jour">{t('planning:toolbar.bascule.jour')}</TabsTrigger>
            <TabsTrigger value="liste">{t('planning:toolbar.bascule.liste')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPrecedent}
            aria-label={t('planning:toolbar.navigation.semainePrecedente')}
          >
            ←
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onAujourdhui}>
            {t('planning:toolbar.navigation.aujourdhui')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSuivant}
            aria-label={t('planning:toolbar.navigation.semaineSuivante')}
          >
            →
          </Button>
          <span className="texte-corps font-medium text-foreground">{periodeLabel}</span>
        </div>

        {onNouveauRendezVous ? (
          <Button type="button" onClick={onNouveauRendezVous}>
            <CalendarPlus aria-hidden className="h-4 w-4" />
            {t('planning:toolbar.nouveauRendezVous')}
          </Button>
        ) : null}
      </div>

      <BarreFiltres
        q={recherche}
        onChangeQ={onChangerRecherche}
        placeholderRecherche={t('planning:toolbar.recherchePlaceholder')}
        filtresActifs={rechercheActive}
        onEffacerFiltres={() => onChangerRecherche('')}
      />

      {contenu()}
    </div>
  );
}
