import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { LigneSuiviVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { FiltreSite } from '@/composants/commun/FiltreSite';
import { Segments } from '@/composants/commun/Segments';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useFiltreSite } from '@/hooks/site/useFiltreSite';
import { useListeSuiviVente } from '@/hooks/ventes/suivi/useListeSuiviVente';
import { chemins } from '@/routes/chemins';

import { BadgeEcheanceSuivi } from './BadgeEcheanceSuivi';
import { CelluleFinancementSuivi } from './CelluleFinancementSuivi';
import { CelluleGarantieSuivi } from './CelluleGarantieSuivi';

/** Options d'horizon (`GET /ventes/suivi?dansJours=`) — `toutes` omet le paramètre : le serveur
 *  renvoie alors tout dossier suivi, échéances déjà dépassées comprises, triées en premier
 *  (voir l'en-tête de `contrats/ventes/suivi.ts`). Forme extensible, pas un enum du contrat. */
const OPTIONS_HORIZON = ['30', '90', '180', 'toutes'] as const;
type Horizon = (typeof OPTIONS_HORIZON)[number];
const HORIZON_DEFAUT: Horizon = '30';

function versDansJours(horizon: Horizon): number | undefined {
  return horizon === 'toutes' ? undefined : Number(horizon);
}

/**
 * Écran d'ACTION, pas un rapport (brief) : ce qui arrive bientôt doit sauter aux yeux, chaque
 * ligne ouvre son dossier en un clic, une liste vide est la BONNE nouvelle (rien n'arrive à
 * échéance) — jamais formulée comme un échec.
 *
 * Route dédiée `/ventes/suivi` (`routes/routeur.tsx`, `chemins.ventes.suivi`) — gardée par le
 * MÊME `rolesAutorises={ROLES_VENTES}` que `/ventes/dossiers`, car le droit de lecture serveur
 * (`ventes.dossier.lire`) est déjà celui qui garde `/ventes/dossiers` au niveau routeur (même
 * liste de rôles, `droits-routes.ts` documente l'invariant), donc aucune garde supplémentaire
 * n'est nécessaire ici.
 *
 * `dansJours` filtre CÔTÉ SERVEUR (brief : « en s'appuyant sur le paramètre... plutôt qu'en
 * filtrant côté client ») — changer d'horizon relance la requête, jamais un `.filter()` local sur
 * les lignes déjà chargées.
 */
export function EcranSuiviVentes() {
  const { t } = useTranslation(['ventes', 'commun']);
  const navigate = useNavigate();
  const filtreSite = useFiltreSite('ventes.suivi');
  const site = filtreSite.siteId;

  const [horizon, setHorizon] = useState<Horizon>(HORIZON_DEFAUT);

  const filtres = useMemo(
    () => ({ siteId: site, dansJours: versDansJours(horizon) }),
    [site, horizon],
  );

  const {
    lignes,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeSuiviVente(filtres);

  const colonnes: ColonneComptoir<LigneSuiviVente>[] = [
    {
      id: 'dossier',
      libelle: t('ventes:suivi.colonnes.dossier'),
      rendu: (ligne) => (
        <div className="flex flex-col gap-0.5">
          <span className="texte-corps font-medium text-foreground">
            {ligne.clientAcheteur.nomAffiche}
          </span>
          <span className="texte-libelle text-muted-foreground">
            {ligne.vehicule
              ? `${ligne.vehicule.designation}${ligne.vehicule.vin ? ` · ${ligne.vehicule.vin}` : ''}`
              : t('ventes:dossier.liste.vehiculeNonAssigne')}
          </span>
        </div>
      ),
    },
    {
      id: 'echeance',
      libelle: t('ventes:suivi.colonnes.echeance'),
      rendu: (ligne) => <BadgeEcheanceSuivi prochaineEcheanceLe={ligne.prochaineEcheanceLe} />,
    },
    {
      id: 'financement',
      libelle: t('ventes:suivi.colonnes.financement'),
      // `financement` est ABSENT (clé manquante, pas `null`) pour un rôle sans
      // `ventes.financement.lire` (voir l'en-tête de `contrats/ventes/suivi.ts`) — à ne jamais
      // confondre avec `null` (« pas de financement à suivre »). `in` est le seul test fiable
      // pour distinguer les deux après désérialisation JSON (même doctrine que
      // `CelluleFinancementSuivi` sur `echeanceLe`). Absence = rien n'est rendu pour cette
      // cellule, pas un texte "non renseigné" trompeur.
      rendu: (ligne) =>
        'financement' in ligne ? (
          <CelluleFinancementSuivi financement={ligne.financement ?? null} />
        ) : null,
    },
    {
      id: 'garantie',
      libelle: t('ventes:suivi.colonnes.garantie'),
      rendu: (ligne) => <CelluleGarantieSuivi garantie={ligne.garantie} />,
    },
  ];

  // Une liste vide ICI est une bonne nouvelle : rien n'arrive à échéance sur l'horizon choisi.
  const contenuVide = (
    <EtatVide
      titre={t('ventes:suivi.vide.titre')}
      description={t('ventes:suivi.vide.description')}
    />
  );

  // Titre MASQUÉ automatiquement — « Suivi financement & garantie » (`ventes:suivi.titre`) est
  // IDENTIQUE, à la lettre, à l'onglet de navigation actif « Suivi financement & garantie »
  // (`navigation-modele.ts`, `ONGLETS_VENTES`) : égalité stricte après normalisation (§3 du contrat
  // du chantier « titres doublés », 17.08.2026). `GabaritEcran` le détecte lui-même — ne JAMAIS
  // poser `titreVisible` ici.
  //
  // Retiré (retour produit du 12.08.2026, revue structure haute) : le lien « Retour aux dossiers de
  // vente », qui flottait seul en haut à droite (« mal placé ») ET doublait l'onglet « Dossiers »
  // d'`OngletsDomaine` un rang au-dessus (« c'est doublé aussi ») — même destination, même défaut
  // que le bouton retiré d'`EcranListeDossiersVente`, voir sa note d'en-tête de fichier.

  // DÉFAUT AUDIT corrigé — les onglets sont rendus INCONDITIONNELLEMENT, AVANT tout retour anticipé
  // chargement/erreur (même patron que `EcranListeFactures.tsx`, référence explicite du brief).
  // Changer d'horizon change `dansJours`, donc la clé de requête, donc `isPending` repasse à vrai :
  // si les onglets vivaient DANS les branches de retour anticipé (comme avant ce correctif), la
  // barre entière disparaissait puis reparaissait à chaque changement d'horizon — et en cas
  // d'erreur réseau, plus aucun moyen de revenir à l'onglet précédent. Seul le CONTENU sous les
  // onglets (chargement / erreur / table) varie selon l'état de la requête.
  return (
    <GabaritEcran titre={t('ventes:suivi.titre')} actions={<FiltreSite filtre={filtreSite} />}>
      {/* Sélecteur d'horizon — retour produit du 17.08.2026 : « 30/90/60 jours, toutes les échéances des
          jours, tu peux enlever l'espace aussi qui n'est pas très beau ». `components/ui/tabs.tsx`
          (utilisé avant ce correctif) porte le style de la NAVIGATION (soulignement, `h-11`,
          `border-b`) — un poids visuel de rangée de navigation pour un simple filtre d'horizon, qui
          épaississait l'écart entre l'en-tête, ce groupe et le tableau. Ce contrôle change la façon
          dont CET écran affiche les mêmes lignes, il ne navigue nulle part : même doctrine, mêmes
          classes que `BasculeVueStock` (issue #84, déjà approuvée par @laupernoe pour EXACTEMENT ce
          distinguo) — fond plein compact plutôt que soulignement, alignée sur le gabarit de poids
          visuel de la barre de filtres (`BarreFiltres`) plutôt que sur la navigation de premier
          niveau. Rôles ARIA (`tablist`/`tab`) et clavier inchangés, même contrat de test
          (`getByRole('tab', …)`) — `@base-ui/react/tabs` directement (chantier d'unification
          inter-écrans, 25.08.2026, même motif que `BasculeVueStock`/`EcranListeFactures.tsx` :
          Tabs n'est pas un composant à portail, la frontière Radix/Base UI de CONTRIBUTING.md ne s'y
          applique pas ; ces onglets FILTRENT la même table, aucun `TabsPrimitive.Panel` n'est
          jamais rendu, donc Base UI omet `aria-controls` — WCAG 4.1.2, voir `BasculeVueStock.tsx`
          pour le détail vérifié dans le code source, et `EcranSuiviVentes.spec.tsx` pour la preuve
          ici). */}
      <Segments
        valeur={horizon}
        onChange={setHorizon}
        ariaLabel={t('ventes:suivi.filtres.horizonLabel')}
        options={OPTIONS_HORIZON.map((valeur) => ({
          valeur,
          libelle: t(`ventes:suivi.filtres.horizon.${valeur}`),
        }))}
      />

      {isPending ? (
        <EtatChargement lignes={6} />
      ) : isError ? (
        <EtatErreur
          titre={t('ventes:suivi.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      ) : (
        <>
          <TableComptoir
            colonnes={colonnes}
            lignes={lignes}
            cleLigne={(ligne) => ligne.dossierVenteId}
            onOuvrirLigne={(ligne) =>
              navigate(chemins.ventes.dossiers.detail(ligne.dossierVenteId, site))
            }
            libelleLigne={(ligne) =>
              t('commun:actions.ouvrirElement', { nom: ligne.clientAcheteur.nomAffiche })
            }
            contenuVide={contenuVide}
          />

          <BoutonChargerPlus
            aChargerPlus={Boolean(hasNextPage)}
            enChargement={isFetchingNextPage}
            onChargerPlus={() => void fetchNextPage()}
          />
        </>
      )}
    </GabaritEcran>
  );
}
