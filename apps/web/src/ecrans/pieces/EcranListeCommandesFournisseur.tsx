import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import {
  STATUTS_COMMANDE_FOURNISSEUR,
  TRI_DEFAUT_COMMANDES_FOURNISSEUR,
  type FiltresCommandesFournisseur,
  type ReponseCommandeFournisseur,
  type StatutCommandeFournisseur,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useListeCommandesFournisseur } from '@/hooks/pieces/useListeCommandesFournisseur';
import { useSession } from '@/hooks/useSession';
import { formaterDate } from '@/lib/formats';

import { BadgeStatutCommandeFournisseur } from './BadgeStatutCommandeFournisseur';
import { peutEcrireCommandeFournisseur } from './droits';

const DELAI_DEBOUNCE_MS = 300;

/**
 * Liste des commandes fournisseur (RP-26 → RP-31, §6.2, priorité 1 du lot) — filtres statut,
 * fournisseur, site, et le raccourci « avec reliquat » (§6.3 de `commande-fournisseur.ts`, sucre
 * équivalent à `statut: ['envoyee','partiellement_recue']`, documenté explicitement côté contrat).
 * `ReponseCommandeFournisseur` ne porte aucun libellé de fournisseur/site embarqué — même remarque
 * que `EcranReservationsPieces` : le fournisseur est un lien cliquable, le site est résolu depuis
 * la session (liste COMPLÈTE, contrairement aux fournisseurs qui peuvent être paginés).
 *
 * `schemaFiltresCommandesFournisseur` porte `q` (recherche serveur sur `reference`,
 * `pieces/commande-fournisseur.ts`) — même architecture que `EcranListeArticles` : la recherche est
 * appliquée au SQL, jamais filtrée sur les lignes déjà chargées. `reference` est optionnelle (une
 * commande d'origine `reapprovisionnement_auto` n'en porte pas forcément) : la recherche ne
 * retrouve donc que les commandes qui en portent une, honnêtement annoncé par le texte du champ
 * (« Rechercher par référence »), jamais présenté comme une recherche universelle.
 */
export function EcranListeCommandesFournisseur() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const actions = session?.actions;
  const sites = session?.sites ?? [];

  const [statut, setStatut] = useState<StatutCommandeFournisseur | undefined>(undefined);
  const [avecReliquat, setAvecReliquat] = useState(false);

  const [qSaisie, setQSaisie] = useState('');
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);

  const filtres: FiltresCommandesFournisseur = useMemo(
    () => ({
      q: q.trim() === '' ? undefined : q.trim(),
      statut: statut ? [statut] : undefined,
      avecReliquat: avecReliquat ? true : undefined,
      tri: TRI_DEFAUT_COMMANDES_FOURNISSEUR,
      limite: 50,
    }),
    [q, statut, avecReliquat],
  );

  const {
    commandes,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeCommandesFournisseur(filtres);

  const nomSite = (siteId: string) => sites.find((site) => site.id === siteId)?.nom ?? siteId;

  const filtresStructuresActifs = statut !== undefined || avecReliquat;
  const filtresActifs = q.trim() !== '' || filtresStructuresActifs;
  function effacerFiltres() {
    // Levier de reset (choix produit 26.08.2026) : `effacerFiltres` est un geste de reprise en
    // main, pas une frappe — `q` doit refléter la case vide immédiatement, pas après le même
    // délai qu'une recherche (voir le commentaire de `useValeurDebouncee`, `hooks/commun/`).
    setQSaisie('');
    reinitialiserQ();
    setStatut(undefined);
    setAvecReliquat(false);
  }

  const colonnes: ColonneComptoir<ReponseCommandeFournisseur>[] = [
    {
      id: 'date',
      libelle: t('pieces:commandes.dateCommande'),
      rendu: (commande) => (
        <div className="flex flex-col">
          <span className="font-medium">{formaterDate(commande.dateCommande)}</span>
          {commande.reference ? (
            <span className="texte-libelle text-muted-foreground">{commande.reference}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'site',
      libelle: t('pieces:commandes.site'),
      rendu: (commande) => nomSite(commande.siteId),
    },
    {
      id: 'fournisseur',
      libelle: t('pieces:commandes.fournisseur'),
      rendu: (commande) => (
        <Link
          to={`/pieces/fournisseurs/${commande.fournisseurId}`}
          className="texte-corps font-medium text-primary underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('pieces:commandes.voirFournisseur')}
        </Link>
      ),
    },
    {
      id: 'origine',
      libelle: t('pieces:commandes.origine'),
      rendu: (commande) => t(`pieces:commandes.origines.${commande.origine}`),
    },
    {
      id: 'statut',
      libelle: t('pieces:commandes.statut'),
      rendu: (commande) => <BadgeStatutCommandeFournisseur statut={commande.statut} />,
    },
  ];

  if (isPending) {
    return (
      <GabaritEcran titre={t('pieces:commandes.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('pieces:commandes.titre')}>
        <EtatErreur
          titre={t('pieces:commandes.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  // Titre MASQUÉ automatiquement — « Commandes fournisseur » (`pieces:commandes.titre`) est un
  // doublon de la vue active « Commandes » (`navigation-modele.ts`, `ONGLETS_PIECES`, vue
  // « commandes » de l'onglet Approvisionnement) : `GabaritEcran` le détecte par inclusion (le
  // titre CONTIENT le libellé de la vue). Défaut cité nommément par @laupernoe le 17.08.2026 (« dans
  // Commandes, "Commandes fournisseur" ») — l'ancien commentaire ici (« pas un doublon », retiré
  // par ce correctif) argumentait l'inverse ; le choix produit a explicitement tranché dans l'autre sens.
  const boutonCreer = peutEcrireCommandeFournisseur(actions) ? (
    <Button onClick={() => navigate('/pieces/commandes-fournisseur/nouvelle')}>
      {t('pieces:commandes.actions.creer')}
    </Button>
  ) : undefined;

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('pieces:commandes.vide.recherche.titre')}
        description={t('pieces:commandes.vide.recherche.description')}
      />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('pieces:commandes.vide.filtre.titre')}
        description={t('pieces:commandes.vide.filtre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('pieces:commandes.vide.premierUsage.titre')}
        description={t('pieces:commandes.vide.premierUsage.description')}
        action={boutonCreer}
      />
    );
  }

  return (
    <GabaritEcran titre={t('pieces:commandes.titre')} actions={boutonCreer}>
      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        placeholderRecherche={t('pieces:commandes.filtres.rechercherPlaceholder')}
        filtresActifs={filtresActifs}
        onEffacerFiltres={effacerFiltres}
      >
        <div className="flex flex-col gap-champ">
          <Label htmlFor="filtre-statut-commande">{t('pieces:commandes.statut')}</Label>
          <Select
            value={statut ?? 'tous'}
            onValueChange={(valeur) =>
              setStatut(valeur === 'tous' ? undefined : (valeur as StatutCommandeFournisseur))
            }
          >
            <SelectTrigger id="filtre-statut-commande" aria-label={t('pieces:commandes.statut')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('pieces:commandes.filtres.statutTous')}</SelectItem>
              {STATUTS_COMMANDE_FOURNISSEUR.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pieces:commandes.statuts.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label
          htmlFor="commandes-avec-reliquat"
          className="flex items-center gap-champ texte-corps pb-2"
        >
          <Checkbox
            id="commandes-avec-reliquat"
            checked={avecReliquat}
            onCheckedChange={(coche) => setAvecReliquat(coche === true)}
          />
          {t('pieces:commandes.filtres.avecReliquat')}
        </label>
      </BarreFiltres>

      <TableComptoir
        colonnes={colonnes}
        lignes={commandes}
        cleLigne={(commande) => commande.id}
        onOuvrirLigne={(commande) => navigate(`/pieces/commandes-fournisseur/${commande.id}`)}
        libelleLigne={(commande) =>
          t('commun:actions.ouvrirElement', {
            nom: commande.reference ?? formaterDate(commande.dateCommande),
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
