import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  STATUTS_FACTURE_FOURNISSEUR,
  TRI_DEFAUT_FACTURES_FOURNISSEUR,
  type ReponseFactureFournisseur,
  type StatutFactureFournisseur,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import type { FiltresEcranFacturesFournisseur } from '@/hooks/pieces/factures-fournisseur.api';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useListeFacturesFournisseur } from '@/hooks/pieces/useListeFacturesFournisseur';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterMontant } from '@/lib/formats';

import { BadgeStatutFactureFournisseur } from './BadgeStatutFactureFournisseur';
import { peutDeposerFactureFournisseur, peutLireFactureFournisseur } from './droits';
import { IndicateurCertitude } from './IndicateurCertitude';
import { calculerSyntheseEcarts, certitudeChampEnTete } from './utils-factures-fournisseur';

const DELAI_DEBOUNCE_MS = 300;

/**
 * Consultation des factures fournisseur déposées (brief, point 3 : « retrouver une facture
 * déposée, la revoir »). Même architecture que `EcranListeCommandesFournisseur` : filtre +
 * `TableComptoir` paginée par curseur, trois états explicites (chargement/vide/erreur).
 *
 * PAS de forme « résumé » séparée dans le contrat partagé (`ReponseFactureFournisseur` porte les
 * lignes complètes même en liste, voir `factures-fournisseur.api.ts`) : `presenceEcarts`
 * est donc calculé ICI, par ligne de tableau, via `calculerSyntheseEcarts` — pas envoyé tout fait.
 *
 * `schemaFiltresFacturesFournisseur` porte `q` (recherche serveur sur `nomCreancier`/
 * `numeroFacture`, `pieces/facture-fournisseur.ts`) — même architecture que `EcranListeArticles` :
 * la recherche est appliquée au SQL, jamais filtrée sur les lignes déjà chargées. Les deux champs
 * sont issus d'une lecture QR/OCR incertaine (`champsOrigine`) et peuvent être `null` : une facture
 * sans l'un ou l'autre reste cherchable par le champ qui lui reste.
 */
export function EcranListeFacturesFournisseur() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const session = useSession();
  const actions = session.data?.actions;
  const peutLire = peutLireFactureFournisseur(actions);

  const [statut, setStatut] = useState<StatutFactureFournisseur | undefined>(undefined);

  const [qSaisie, setQSaisie] = useState('');
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);

  const filtres: FiltresEcranFacturesFournisseur = useMemo(
    () => ({
      q: q.trim() === '' ? undefined : q.trim(),
      statut: statut ? [statut] : undefined,
      tri: TRI_DEFAUT_FACTURES_FOURNISSEUR,
    }),
    [q, statut],
  );

  // Gardé par le droit AVANT de partir (même correctif que `EcranFicheCommandeFournisseur`,
  // `peutLireCommandeFournisseur`) : un rôle du routeur large (`ROLES_PIECES`, 7 rôles) mais hors
  // du droit métier étroit ne déclenche plus AUCUN appel réseau, au lieu d'un `403` générique
  // rattrapé après coup par `isError`.
  const {
    factures,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeFacturesFournisseur(filtres, !session.isLoading && peutLire);

  const filtresActifs = q.trim() !== '' || statut !== undefined;
  function effacerFiltres() {
    // Levier de reset (choix produit 26.08.2026) : `effacerFiltres` est un geste de reprise en
    // main, pas une frappe — `q` doit refléter la case vide immédiatement, pas après le même
    // délai qu'une recherche (voir le commentaire de `useValeurDebouncee`, `hooks/commun/`).
    setQSaisie('');
    reinitialiserQ();
    setStatut(undefined);
  }

  const boutonDeposer = peutDeposerFactureFournisseur(actions) ? (
    <Button onClick={() => navigate('/pieces/factures-fournisseur/deposer')}>
      {t('pieces:facturesFournisseur.actions.deposer')}
    </Button>
  ) : undefined;

  const colonnes: ColonneComptoir<ReponseFactureFournisseur>[] = [
    {
      id: 'fichier',
      libelle: t('pieces:facturesFournisseur.colonnes.fichier'),
      rendu: (facture) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {facture.numeroFacture ?? t('pieces:facturesFournisseur.sansNumero')}
          </span>
          <span className="texte-libelle text-muted-foreground">
            {formaterDate(facture.document.deposeLe)}
          </span>
        </div>
      ),
    },
    {
      id: 'fournisseur',
      libelle: t('pieces:facturesFournisseur.colonnes.fournisseur'),
      rendu: (facture) =>
        facture.nomCreancier ?? (
          <IndicateurCertitude
            certitude={certitudeChampEnTete(
              facture.nomCreancier,
              'nomCreancier',
              facture.champsOrigine,
            )}
          />
        ),
    },
    {
      id: 'montant',
      libelle: t('pieces:facturesFournisseur.colonnes.montant'),
      alignement: 'droite',
      rendu: (facture) =>
        facture.montantTotalCentimes !== null ? (
          formaterMontant(facture.montantTotalCentimes)
        ) : (
          <IndicateurCertitude
            certitude={certitudeChampEnTete(
              facture.montantTotalCentimes,
              'montantTotalCentimes',
              facture.champsOrigine,
            )}
          />
        ),
    },
    {
      id: 'statut',
      libelle: t('pieces:facturesFournisseur.colonnes.statut'),
      rendu: (facture) => <BadgeStatutFactureFournisseur statut={facture.statut} />,
    },
    {
      id: 'ecarts',
      libelle: t('pieces:facturesFournisseur.colonnes.ecarts'),
      rendu: (facture) =>
        calculerSyntheseEcarts(facture.lignes).nombreLignesAvecEcart > 0 ? (
          <span className="texte-libelle font-medium text-avertissement">
            {t('pieces:facturesFournisseur.ecartsPresents')}
          </span>
        ) : null,
    },
  ];

  if (session.isLoading) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (!peutLire) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <p className="text-muted-foreground">
          {t('pieces:facturesFournisseur.droitRequis.lecture')}
        </p>
      </GabaritEcran>
    );
  }

  if (isPending) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titre')}>
        <EtatErreur
          titre={t('pieces:facturesFournisseur.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('pieces:facturesFournisseur.vide.recherche.titre')}
        description={t('pieces:facturesFournisseur.vide.recherche.description')}
      />
    );
  } else if (statut !== undefined) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('pieces:facturesFournisseur.vide.filtre.titre')}
        description={t('pieces:facturesFournisseur.vide.filtre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('pieces:facturesFournisseur.vide.premierUsage.titre')}
        description={t('pieces:facturesFournisseur.vide.premierUsage.description')}
      />
    );
  }

  return (
    <GabaritEcran titre={t('pieces:facturesFournisseur.titre')} actions={boutonDeposer}>
      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        placeholderRecherche={t('pieces:facturesFournisseur.filtres.rechercherPlaceholder')}
        filtresActifs={filtresActifs}
        onEffacerFiltres={effacerFiltres}
      >
        <div className="flex flex-col gap-champ">
          <Select
            value={statut ?? 'tous'}
            onValueChange={(valeur) =>
              setStatut(valeur === 'tous' ? undefined : (valeur as StatutFactureFournisseur))
            }
          >
            <SelectTrigger
              id="filtre-statut-facture"
              aria-label={t('pieces:facturesFournisseur.colonnes.statut')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">
                {t('pieces:facturesFournisseur.filtres.statutTous')}
              </SelectItem>
              {STATUTS_FACTURE_FOURNISSEUR.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pieces:facturesFournisseur.statuts.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BarreFiltres>

      <TableComptoir
        colonnes={colonnes}
        lignes={factures}
        cleLigne={(facture) => facture.id}
        onOuvrirLigne={(facture) => navigate(`/pieces/factures-fournisseur/${facture.id}`)}
        libelleLigne={(facture) =>
          t('commun:actions.ouvrirElement', {
            nom: facture.numeroFacture ?? t('pieces:facturesFournisseur.sansNumero'),
          })
        }
        contenuVide={contenuVide}
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />
    </GabaritEcran>
  );
}
