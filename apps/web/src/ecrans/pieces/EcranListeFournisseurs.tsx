import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  STATUTS_FOURNISSEUR,
  TRI_DEFAUT_FOURNISSEURS,
  type FiltresFournisseurs,
  type ReponseFournisseur,
  type StatutFournisseur,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
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
import { useListeFournisseurs } from '@/hooks/pieces/useListeFournisseurs';
import { useSession } from '@/hooks/useSession';

import { BadgeStatutFournisseur } from './BadgeStatutFournisseur';
import { peutEcrireFournisseur } from './droits';
import { FormulaireFournisseur } from './FormulaireFournisseur';
import { texteOuVide } from './utils';

const DELAI_DEBOUNCE_MS = 300;

/**
 * Liste des fournisseurs (RP-26, §1) — référentiel minimal (nom, coordonnées, délai habituel).
 * `schemaFiltresFournisseurs` porte `q` (recherche serveur sur `nom`, `pieces/fournisseur.ts`) —
 * même architecture que `EcranListeArticles` : la recherche est appliquée au SQL, jamais filtrée
 * sur les lignes déjà chargées.
 */
export function EcranListeFournisseurs() {
  const { t } = useTranslation(['pieces', 'commun']);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const actions = session?.actions;

  const [statut, setStatut] = useState<StatutFournisseur | undefined>('actif');
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const [qSaisie, setQSaisie] = useState('');
  const [q, reinitialiserQ] = useValeurDebouncee(qSaisie, DELAI_DEBOUNCE_MS);

  const filtres: FiltresFournisseurs = {
    q: q.trim() === '' ? undefined : q.trim(),
    statut: statut ? [statut] : undefined,
    tri: TRI_DEFAUT_FOURNISSEURS,
    limite: 50,
  };
  const {
    fournisseurs,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeFournisseurs(filtres);

  function effacerFiltres() {
    // Levier de reset (choix produit 26.08.2026) : `effacerFiltres` est un geste de reprise en
    // main, pas une frappe — `q` doit refléter la case vide immédiatement, pas après le même
    // délai qu'une recherche (voir le commentaire de `useValeurDebouncee`, `hooks/commun/`).
    setQSaisie('');
    reinitialiserQ();
    setStatut(undefined);
  }

  const colonnes: ColonneComptoir<ReponseFournisseur>[] = [
    {
      id: 'nom',
      libelle: t('pieces:fournisseurs.nom'),
      rendu: (fournisseur) => <span className="font-medium">{fournisseur.nom}</span>,
    },
    {
      id: 'coordonnees',
      libelle: t('pieces:fournisseurs.coordonnees'),
      rendu: (fournisseur) => (
        <div className="flex flex-col texte-libelle text-muted-foreground">
          <span>{texteOuVide(fournisseur.email)}</span>
          <span>{texteOuVide(fournisseur.telephone)}</span>
        </div>
      ),
    },
    {
      id: 'delai',
      libelle: t('pieces:fournisseurs.delaiHabituelJours'),
      alignement: 'droite',
      rendu: (fournisseur) => (
        <span className="tabular-nums">{texteOuVide(fournisseur.delaiHabituelJours)}</span>
      ),
    },
    {
      id: 'statut',
      libelle: t('pieces:fournisseurs.statut'),
      rendu: (fournisseur) => <BadgeStatutFournisseur statut={fournisseur.statut} />,
    },
  ];

  if (isPending) {
    return (
      <GabaritEcran titre={t('pieces:fournisseurs.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('pieces:fournisseurs.titre')}>
        <EtatErreur
          titre={t('pieces:fournisseurs.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  // Titre MASQUÉ automatiquement — « Fournisseurs » est un doublon strict du libellé de la vue
  // active « Fournisseurs » (`navigation-modele.ts`, `ONGLETS_PIECES`, vue « fournisseurs » de
  // l'onglet Approvisionnement) : `GabaritEcran` le détecte lui-même (§3 du contrat du chantier
  // « titres doublés », 17.08.2026), plus besoin de le faire à la main ici.
  const boutonAjouter = peutEcrireFournisseur(actions) ? (
    <Button onClick={() => setFormulaireOuvert(true)}>
      {t('pieces:fournisseurs.actions.ajouter')}
    </Button>
  ) : undefined;

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche
        titre={t('pieces:fournisseurs.vide.recherche.titre')}
        description={t('pieces:fournisseurs.vide.recherche.description')}
      />
    );
  } else if (statut !== undefined) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('pieces:fournisseurs.vide.filtre.titre')}
        description={t('pieces:fournisseurs.vide.filtre.description')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('pieces:fournisseurs.vide.premierUsage.titre')}
        description={t('pieces:fournisseurs.vide.premierUsage.description')}
      />
    );
  }

  return (
    <GabaritEcran titre={t('pieces:fournisseurs.titre')} actions={boutonAjouter}>
      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        placeholderRecherche={t('pieces:fournisseurs.filtres.rechercherPlaceholder')}
        filtresActifs={q.trim() !== '' || statut !== undefined}
        onEffacerFiltres={effacerFiltres}
      >
        <div className="flex flex-col gap-champ">
          <Label htmlFor="filtre-statut-fournisseur">{t('pieces:fournisseurs.statut')}</Label>
          <Select
            value={statut ?? 'tous'}
            onValueChange={(valeur) =>
              setStatut(valeur === 'tous' ? undefined : (valeur as StatutFournisseur))
            }
          >
            <SelectTrigger
              id="filtre-statut-fournisseur"
              aria-label={t('pieces:fournisseurs.statut')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('pieces:fournisseurs.filtres.statutTous')}</SelectItem>
              {STATUTS_FOURNISSEUR.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`pieces:fournisseurs.statuts.${valeur}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BarreFiltres>

      <TableComptoir
        colonnes={colonnes}
        lignes={fournisseurs}
        cleLigne={(fournisseur) => fournisseur.id}
        onOuvrirLigne={(fournisseur) => navigate(`/pieces/fournisseurs/${fournisseur.id}`)}
        libelleLigne={(fournisseur) => t('commun:actions.ouvrirElement', { nom: fournisseur.nom })}
        contenuVide={contenuVide}
      />

      <BoutonChargerPlus
        aChargerPlus={Boolean(hasNextPage)}
        enChargement={isFetchingNextPage}
        onChargerPlus={() => void fetchNextPage()}
      />

      <FormulaireFournisseur
        ouvert={formulaireOuvert}
        onOuvertChange={setFormulaireOuvert}
        onCree={(fournisseur) => navigate(`/pieces/fournisseurs/${fournisseur.id}`)}
      />
    </GabaritEcran>
  );
}
