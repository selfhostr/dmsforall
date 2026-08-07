import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type { LigneSuiviVente } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
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
 * n'est nécessaire ici — `ecrans/ventes/suivi/droits.ts` reste défensif seulement, comme le reste
 * du produit.
 *
 * `dansJours` filtre CÔTÉ SERVEUR (brief : « en s'appuyant sur le paramètre... plutôt qu'en
 * filtrant côté client ») — changer d'horizon relance la requête, jamais un `.filter()` local sur
 * les lignes déjà chargées.
 */
export function EcranSuiviVentes() {
  const { t } = useTranslation(['ventes', 'commun']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

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

  const enTete = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="texte-titre-section font-semibold text-foreground">
        {t('ventes:suivi.titre')}
      </h1>
      <Link
        to={chemins.ventes.dossiers.liste(site)}
        className="texte-corps text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('ventes:suivi.retourListe')}
      </Link>
    </div>
  );

  // DÉFAUT AUDIT corrigé — les onglets sont rendus INCONDITIONNELLEMENT, AVANT tout retour anticipé
  // chargement/erreur (même patron que `EcranListeFactures.tsx`, référence explicite du brief).
  // Changer d'horizon change `dansJours`, donc la clé de requête, donc `isPending` repasse à vrai :
  // si les onglets vivaient DANS les branches de retour anticipé (comme avant ce correctif), la
  // barre entière disparaissait puis reparaissait à chaque changement d'horizon — et en cas
  // d'erreur réseau, plus aucun moyen de revenir à l'onglet précédent. Seul le CONTENU sous les
  // onglets (chargement / erreur / table) varie selon l'état de la requête.
  return (
    <div className="flex flex-col gap-6 p-6">
      {enTete}

      <Tabs value={horizon} onValueChange={(valeur) => setHorizon(valeur as Horizon)}>
        <TabsList aria-label={t('ventes:suivi.filtres.horizonLabel')}>
          {OPTIONS_HORIZON.map((valeur) => (
            <TabsTrigger key={valeur} value={valeur}>
              {t(`ventes:suivi.filtres.horizon.${valeur}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
    </div>
  );
}
