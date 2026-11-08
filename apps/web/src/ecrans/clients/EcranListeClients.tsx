import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { ClientResume, StatutClient, TypeClient } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
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
import { PanneauLateral } from '@/composants/PanneauLateral';
import { BarreFiltres } from '@/composants/comptoir/BarreFiltres';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import {
  TableComptoir,
  type ColonneComptoir,
  type EtatTriComptoir,
} from '@/composants/comptoir/TableComptoir';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { BadgeTypeClient } from '@/composants/identite/BadgeTypeClient';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useListeClients, type TriClients } from '@/hooks/clients/useListeClients';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import {
  aUnBrouillonNouveauClientEnCours,
  FormulaireNouveauClient,
} from './FormulaireNouveauClient';
import { texteOuVide } from './utils';

/** `statut` envoyé au serveur : `undefined` laisse jouer le défaut contrat (`actif`+`bloque`,
 *  RM-08 : un client bloqué reste visible au comptoir). « Inclure les inactifs » n'AJOUTE que
 *  `inactif` — jamais un `[]` qui, pour ce filtre, signifierait « aucun statut », pas « tous ». */
function statutsPourFiltre(inclureInactifs: boolean): readonly StatutClient[] | undefined {
  return inclureInactifs ? (['actif', 'bloque', 'inactif'] as const) : undefined;
}

function champTriDepuis(tri: TriClients): string {
  return tri.split(':')[0] ?? 'nom';
}

function sensTriDepuis(tri: TriClients): 'asc' | 'desc' {
  return tri.endsWith(':desc') ? 'desc' : 'asc';
}

export function EcranListeClients() {
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const navigate = useNavigate();
  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // deux onglets sur deux sites différents ne doivent pas se contredire.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [qSaisi, setQSaisi] = useState('');
  // Debounce de la recherche libre : `BarreFiltres` est un composant purement contrôlé (aucun
  // debounce interne, par contrat), la responsabilité revient donc à l'écran (F1-R2). `.trim()`
  // après la temporisation — même valeur finale que l'ancien `setQEffectif(qSaisi.trim())` évalué
  // à l'échéance du minuteur, réarmé sur la saisie BRUTE comme avant.
  const [qSaisiTemporise] = useValeurDebouncee(qSaisi, 300);
  const qEffectif = qSaisiTemporise.trim();
  const [type, setType] = useState<TypeClient | undefined>(undefined);
  const [inclureInactifs, setInclureInactifs] = useState(false);
  const [tri, setTri] = useState<TriClients>('nom:asc');
  const [sheetOuvert, setSheetOuvert] = useState(false);

  const requete = useListeClients({
    q: qEffectif || undefined,
    type,
    statut: statutsPourFiltre(inclureInactifs),
    tri,
  });

  const lignes = useMemo(
    () => requete.data?.pages.flatMap((page) => page.donnees) ?? [],
    [requete.data],
  );

  const effacerFiltres = () => {
    setQSaisi('');
    setType(undefined);
    setInclureInactifs(false);
  };

  const triComptoir: EtatTriComptoir = { colonneId: champTriDepuis(tri), sens: sensTriDepuis(tri) };
  const trier = (colonneId: string) => {
    // `TRIS_CLIENTS` (@dfa/shared) n'expose PAS `dernierPassageLe:asc` — un client jamais venu
    // n'a pas de date à ordonner dans ce sens, seul `:desc` (derniers passages en tête) a un
    // sens métier. Un clic sur cette colonne fixe donc `:desc` sans jamais basculer.
    if (colonneId === 'dernierPassageLe') {
      setTri('dernierPassageLe:desc');
      return;
    }
    const memeColonne = colonneId === triComptoir.colonneId;
    const sens = memeColonne && triComptoir.sens === 'asc' ? 'desc' : 'asc';
    setTri(`${colonneId}:${sens}` as TriClients);
  };

  const colonnes: ColonneComptoir<ClientResume>[] = [
    {
      id: 'nom',
      libelle: t('clients:liste.colonnes.nom'),
      triable: true,
      rendu: (client) => <IdentiteClient client={client} />,
    },
    {
      id: 'type',
      libelle: t('clients:liste.filtres.type'),
      rendu: (client) => <BadgeTypeClient type={client.type} />,
    },
    {
      id: 'localite',
      libelle: t('clients:liste.colonnes.localite'),
      rendu: (client) => (
        <span className="text-muted-foreground">{texteOuVide(client.localite)}</span>
      ),
    },
    {
      id: 'telephone',
      libelle: t('clients:liste.colonnes.telephone'),
      rendu: (client) => (
        <span className="tabular-nums text-muted-foreground">{texteOuVide(client.telephone)}</span>
      ),
    },
    {
      id: 'vehicules',
      libelle: t('clients:liste.colonnes.vehicules'),
      alignement: 'droite',
      rendu: (client) => <span className="tabular-nums">{client.nombreVehicules}</span>,
    },
    {
      id: 'dernierPassageLe',
      libelle: t('clients:liste.colonnes.dernierPassage'),
      triable: true,
      rendu: (client) => (
        <span className="tabular-nums text-muted-foreground">
          {client.dernierPassageLe ? formaterDate(client.dernierPassageLe) : texteOuVide(null)}
        </span>
      ),
    },
  ];

  const contenuVide = qEffectif ? (
    <EtatVideRecherche
      titre={t('clients:vide.recherche')}
      description={t('clients:vide.rechercheDescription')}
    />
  ) : type !== undefined || inclureInactifs ? (
    <EtatVideFiltre
      titre={t('clients:vide.filtre')}
      description={t('clients:vide.filtreDescription')}
      onEffacerFiltres={effacerFiltres}
    />
  ) : (
    <EtatVidePremierUsage
      titre={t('clients:vide.premier')}
      description={t('clients:vide.premierDescription')}
    />
  );

  const estErreurReseau = requete.error instanceof ErreurReseau;

  return (
    // Titre laissé à la détection automatique du gabarit (chantier « titres doublés &
    // espacements », re-choix produit du 17.08.2026 — ANNULE le retour du 12.08.2026 cité ici
    // auparavant, qui demandait ce même h1 visible : l'onglet « Clients », déjà affiché à
    // l'écran, porte désormais ce libellé, le h1 devient `sr-only` (jamais retiré du DOM).
    // Aucun padding local : `AppShell` pose déjà `p-4 sm:p-6` sur tout écran routé.
    // « Nouveau client » est l'action du gabarit : titre et action sur la même ligne, filtres
    // en dessous sur une seule ligne (BarreFiltres).
    <GabaritEcran
      titre={t('clients:titre')}
      actions={
        <Button type="button" onClick={() => setSheetOuvert(true)}>
          <Plus aria-hidden className="h-4 w-4" />
          {t('clients:nouveau')}
        </Button>
      }
      barre={
        <BarreFiltres q={qSaisi} onChangeQ={setQSaisi}>
          <Select
            value={type ?? 'tous'}
            onValueChange={(valeur) =>
              setType(valeur === 'tous' ? undefined : (valeur as TypeClient))
            }
          >
            <SelectTrigger className="w-[200px]" aria-label={t('clients:liste.filtres.type')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('clients:liste.filtres.tousLesTypes')}</SelectItem>
              <SelectItem value="particulier">{t('clients:liste.types.particulier')}</SelectItem>
              <SelectItem value="entreprise">{t('clients:liste.types.entreprise')}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox
              id="clients-inclure-inactifs"
              checked={inclureInactifs}
              onCheckedChange={(valeur) => setInclureInactifs(valeur === true)}
            />
            <Label htmlFor="clients-inclure-inactifs">
              {t('clients:liste.filtres.inclureInactifs')}
            </Label>
          </div>
        </BarreFiltres>
      }
    >
      {requete.isError ? (
        <EtatErreur
          titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : (
        <>
          <TableComptoir
            colonnes={colonnes}
            lignes={lignes}
            cleLigne={(client) => client.id}
            tri={triComptoir}
            onTrier={trier}
            onOuvrirLigne={(client) => navigate(chemins.clients.detail(client.id, site))}
            libelleLigne={(client) => t('commun:actions.ouvrirElement', { nom: client.nomAffiche })}
            enChargement={requete.isLoading}
            contenuVide={contenuVide}
          />
          <BoutonChargerPlus
            aChargerPlus={requete.hasNextPage ?? false}
            enChargement={requete.isFetchingNextPage}
            onChargerPlus={() => void requete.fetchNextPage()}
          />
        </>
      )}

      <PanneauLateral
        ouvert={sheetOuvert}
        onOuvertChange={setSheetOuvert}
        titre={t('clients:nouveau')}
        // Issue #78 (mesuré en navigateur : Échap et un clic sur la zone grisée hors du panneau
        // ferment tous deux ce tiroir PAR DÉFAUT, chez Radix, sans confirmation — un
        // réceptionniste a perdu nom/prénom/téléphone/rue en plein comptoir de cette façon).
        // Les DEUX interactions passent par ces rappels avant d'atteindre `onOpenChange` ;
        // `preventDefault()` les bloque tant qu'une saisie réelle est en jeu
        // (`aUnBrouillonNouveauClientEnCours`, `FormulaireNouveauClient.tsx` — même source de
        // vérité que le brouillon qu'il persiste). Le bouton de fermeture visible (coin
        // supérieur droit de `SheetContent`) n'est PAS concerné : il ne déclenche ni l'un ni
        // l'autre de ces événements, une fermeture par ce bouton reste toujours immédiate — le
        // brouillon reste alors le filet de rattrapage, pas ce garde-fou.
        onEscapeKeyDown={(evenement) => {
          if (aUnBrouillonNouveauClientEnCours()) evenement.preventDefault();
        }}
        onPointerDownOutside={(evenement) => {
          if (aUnBrouillonNouveauClientEnCours()) evenement.preventDefault();
        }}
        onInteractOutside={(evenement) => {
          if (aUnBrouillonNouveauClientEnCours()) evenement.preventDefault();
        }}
      >
        <FormulaireNouveauClient
          ouvert={sheetOuvert}
          onCree={(client) => {
            setSheetOuvert(false);
            // Issue #79 : transmet numéro + nom affiché via l'état de navigation — si la
            // LECTURE de la fiche qui suit échoue (`EcranFicheClient`), l'écran doit pouvoir dire
            // « le client a bien été créé, seul l'affichage a échoué » plutôt que de laisser
            // planer le doute qui a failli faire ressaisir Rossier une seconde fois.
            navigate(chemins.clients.detail(client.id, site), {
              state: { clientCreeNumero: client.numeroClient, clientCreeNom: client.nomAffiche },
            });
          }}
        />
      </PanneauLateral>
    </GabaritEcran>
  );
}
