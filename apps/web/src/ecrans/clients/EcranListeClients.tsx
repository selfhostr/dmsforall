import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { useListeClients, type TriClients } from '@/hooks/clients/useListeClients';
import { formaterDate } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

import { FormulaireNouveauClient } from './FormulaireNouveauClient';
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
  const [qEffectif, setQEffectif] = useState('');
  const [type, setType] = useState<TypeClient | undefined>(undefined);
  const [inclureInactifs, setInclureInactifs] = useState(false);
  const [tri, setTri] = useState<TriClients>('nom:asc');
  const [sheetOuvert, setSheetOuvert] = useState(false);

  // Debounce de la recherche libre : `BarreFiltres` est un composant purement contrôlé (aucun
  // debounce interne, par contrat), la responsabilité revient donc à l'écran (F1-R2).
  useEffect(() => {
    const identifiant = setTimeout(() => setQEffectif(qSaisi.trim()), 300);
    return () => clearTimeout(identifiant);
  }, [qSaisi]);

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

  const filtresActifs = qSaisi.trim() !== '' || type !== undefined || inclureInactifs;

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
      action={
        <Button type="button" onClick={() => setSheetOuvert(true)}>
          <Plus aria-hidden className="h-4 w-4" />
          {t('clients:nouveau')}
        </Button>
      }
    />
  );

  const estErreurReseau = requete.error instanceof ErreurReseau;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="texte-titre font-semibold text-foreground">{t('clients:titre')}</h1>
        <Button type="button" onClick={() => setSheetOuvert(true)}>
          <Plus aria-hidden className="h-4 w-4" />
          {t('clients:nouveau')}
        </Button>
      </div>

      <BarreFiltres
        q={qSaisi}
        onChangeQ={setQSaisi}
        filtresActifs={filtresActifs}
        onEffacerFiltres={effacerFiltres}
      >
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

      <Sheet open={sheetOuvert} onOpenChange={setSheetOuvert}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('clients:nouveau')}</SheetTitle>
          </SheetHeader>
          <FormulaireNouveauClient
            ouvert={sheetOuvert}
            onCree={(id) => {
              setSheetOuvert(false);
              navigate(chemins.clients.detail(id, site));
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
