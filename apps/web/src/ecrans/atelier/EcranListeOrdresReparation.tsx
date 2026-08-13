import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import {
  ATTENTES_ORDRE_REPARATION,
  STATUTS_ORDRE_REPARATION,
  TRI_DEFAUT_ORDRES_REPARATION,
  TRIS_ORDRES_REPARATION,
  type AttenteOrdreReparation,
  type OrdreReparationResume,
  type StatutOrdreReparation,
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
import { SelecteurTri } from '@/composants/comptoir/SelecteurTri';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';
import { IdentiteClient } from '@/composants/identite/IdentiteClient';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { EtatVideFiltre } from '@/composants/motifs/EtatVideFiltre';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { EtatVideRecherche } from '@/composants/motifs/EtatVideRecherche';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { peutCreerOrdreReparation } from '@/ecrans/atelier/droits';
import { useListeOrdresReparation } from '@/hooks/atelier/useListeOrdresReparation';
import { useSession } from '@/hooks/useSession';
import { formaterDate, formaterMontant } from '@/lib/formats';
import { chemins } from '@/routes/chemins';

const DELAI_DEBOUNCE_MS = 300;

/** `<champ>:<asc|desc>` -> suffixe de clé i18n (même convention que `EcranListeVehicules`). */
const CLES_TRI: Record<(typeof TRIS_ORDRES_REPARATION)[number], string> = {
  'ouvertLe:desc': 'or:liste.tri.ouvertLeDesc',
  'ouvertLe:asc': 'or:liste.tri.ouvertLeAsc',
  'restitutionPromiseLe:asc': 'or:liste.tri.restitutionPromiseLeAsc',
  'restitutionPromiseLe:desc': 'or:liste.tri.restitutionPromiseLeDesc',
  'joursAttenteRetrait:desc': 'or:liste.tri.joursAttenteRetraitDesc',
};

/** `StatutOrdreReparation` (snake_case) -> suffixe camelCase de `or:statuts` — même mapping que
 *  `BadgeStatutOr`/`ResultatOr`, dupliqué ici faute d'export partagé (ces deux composants
 *  n'appartiennent pas au périmètre de cet écran). */
const CLES_STATUT: Record<StatutOrdreReparation, string> = {
  planifie: 'planifie',
  ouvert: 'ouvert',
  en_cours: 'enCours',
  controle: 'controle',
  termine: 'termine',
  facture: 'facture',
  restitue: 'restitue',
  cloture: 'cloture',
  annule: 'annule',
};

/** `AttenteOrdreReparation` -> suffixe de `or:statuts` — issue #111 : PAS un statut (voir la doc
 *  du filtre `attente` sur `FiltresListeOrdresReparation`), donc ABSENT de `CLES_STATUT`
 *  ci-dessus, mais le mot affiché reste le même que sur le badge (« Attente pièces »…) : réutilise
 *  les clés `or:statuts.attente*` existantes plutôt que d'en dupliquer trois de plus. */
const CLES_ATTENTE: Record<AttenteOrdreReparation, string> = {
  accord: 'attenteAccord',
  pieces: 'attentePieces',
  externe: 'attenteExterne',
};

/** Convention assumée en l'absence de câblage de `src/routes/` à ce jour (agent dédié) — même
 *  chemin que celui déjà utilisé par `EcranFicheClient.tsx` (`/ordres-reparation/${id}`) ; à
 *  ajuster ici si le nom réel diffère une fois le routage posé. */
function cheminDetailOr(id: string, site: string | undefined): string {
  return site
    ? `/ordres-reparation/${id}?site=${encodeURIComponent(site)}`
    : `/ordres-reparation/${id}`;
}

/**
 * Liste des ordres de réparation — le cœur du produit côté comptoir/atelier : recherche, filtre
 * par statut et par site, tri, pagination par curseur. Trois états obligatoires
 * (chargement/vide/erreur), plus les trois variantes de vide établies par le comptoir
 * (recherche/filtre/premier usage — docs/design-comptoir.md §4).
 *
 * Colonne « Total TTC » absente pour un rôle sans droit aux montants (`totalTtcCentimes` est
 * alors absent du DTO, jamais `0`) : `formaterMontant` n'est appelé QUE si le champ est présent,
 * jamais substitué par un texte inventé qui laisserait croire à un montant nul.
 */
export function EcranListeOrdresReparation() {
  const { t } = useTranslation(['or', 'commun']);
  const navigate = useNavigate();
  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // deux onglets sur deux sites différents ne doivent pas se contredire.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  // CORRECTIF issue #47 : cet écran n'avait aucun bouton de création — le geste le plus fréquent
  // du comptoir (`EcranNouvelOrdreReparation.tsx`) n'était atteignable que depuis la fiche d'un
  // client ou d'un véhicule. Gardé par `atelier.or.creer` (défensif d'ergonomie, voir
  // `ecrans/atelier/droits.ts` — le serveur reste l'arbitre final) : `vendeur`/`technicien`/
  // `magasinier`/`comptable`/`poste_atelier` ne le voient pas. Sans `clientId` dans le lien : la
  // liste ne porte pas de client précis, `EcranNouvelOrdreReparation` gère déjà cette absence en
  // renvoyant vers `/recherche` (état « Client non sélectionné »).
  const session = useSession();
  const peutCreer = peutCreerOrdreReparation(session.data?.utilisateur.role);

  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');
  const [statut, setStatut] = useState<StatutOrdreReparation | undefined>(undefined);
  // Issue #111 — filtre ORTHOGONAL au statut (voir `CLES_ATTENTE` ci-dessus), jamais fusionné dans
  // le même `<Select>` : un OR « attente pièces » a par ailleurs un statut réel (`en_cours` le
  // plus souvent) que ce second filtre ne doit jamais masquer.
  const [attente, setAttente] = useState<AttenteOrdreReparation | undefined>(undefined);
  const [tri, setTri] = useState<string>(TRI_DEFAUT_ORDRES_REPARATION);

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const filtres = useMemo(
    () => ({ q: q.trim() === '' ? undefined : q.trim(), statut, attente, siteId: site, tri }),
    [q, statut, attente, site, tri],
  );

  const {
    ordres,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useListeOrdresReparation(filtres);

  const filtresStructuresActifs = statut !== undefined || attente !== undefined;
  const filtresActifs = q.trim() !== '' || filtresStructuresActifs;

  function effacerFiltres() {
    setQSaisie('');
    setQ('');
    setStatut(undefined);
    setAttente(undefined);
  }

  const colonnes: ColonneComptoir<OrdreReparationResume>[] = [
    {
      id: 'numero',
      libelle: t('or:liste.colonnes.numero'),
      rendu: (or) => <span className="font-medium text-foreground">{or.numero}</span>,
    },
    {
      id: 'vehicule',
      libelle: t('or:liste.colonnes.vehicule'),
      rendu: (or) => <IdentiteVehicule vehicule={or.vehicule} taillePlaque="sm" />,
    },
    {
      id: 'client',
      libelle: t('or:liste.colonnes.client'),
      rendu: (or) => <IdentiteClient client={or.client} />,
    },
    {
      id: 'etat',
      libelle: t('or:liste.colonnes.etat'),
      rendu: (or) => <BadgeStatutOr etat={or.etatAffiche} />,
    },
    {
      id: 'restitutionPromise',
      libelle: t('or:liste.colonnes.restitutionPromise'),
      rendu: (or) => (
        <span className="texte-libelle text-muted-foreground">
          {or.restitutionPromiseLe ? formaterDate(or.restitutionPromiseLe) : ''}
        </span>
      ),
    },
    {
      id: 'total',
      libelle: t('or:liste.colonnes.total'),
      alignement: 'droite',
      // Absent (pas 0) pour un rôle sans droit aux montants (`ROLES_SANS_MONTANT`) — ne jamais
      // afficher « 0.00 », qui serait un mensonge (le total existe, seul le droit de le voir manque).
      rendu: (or) => (
        <span className="tabular-nums">
          {or.totalTtcCentimes !== undefined ? formaterMontant(or.totalTtcCentimes) : ''}
        </span>
      ),
    },
  ];

  // Même bouton dans la barre d'actions (persistant) et dans l'état vide « premier usage »
  // (`EtatVidePremierUsage.action`) — même patron que `EcranListeVehicules.tsx`. Absent des deux
  // s'il n'y a rien à créer OU si le rôle courant n'a pas `atelier.or.creer`.
  //
  // CORRECTIF issue #81 (rapport de test terrain) : ce bouton — le plus visible de l'écran
  // Atelier — pointait vers `chemins.atelier.ordresReparation.nouveau(site)` SANS `clientId`,
  // que cet écran (liste, sans contexte client) n'a jamais. `EcranNouvelOrdreReparation` refusait
  // alors systématiquement (`or:nouveau.client.requisTitre`, « Client non sélectionné ») : 100 %
  // des clics depuis ICI tombaient sur ce cul-de-sac, dont le seul rôle était de renvoyer vers
  // `/recherche` — un détour pur, jamais une étape utile. Pointer directement vers `/recherche`
  // retire ce détour au lieu de le maquiller ; le geste réel « ouvrir un OR pour CE client » reste
  // sur la fiche client (`clients:...ouvrirOr`, hors périmètre) et sur la fiche véhicule
  // (`vehicules:...nouvelOr`, hors périmètre) — SIGNALÉ : ces deux boutons et celui-ci portent
  // trois noms différents pour le même geste, non unifiables depuis ce seul périmètre.
  const boutonNouveauOr = peutCreer ? (
    <Button asChild>
      <Link to={chemins.recherche.globale(site)}>
        <Plus aria-hidden className="h-4 w-4" />
        {t('or:liste.actions.nouveau')}
      </Link>
    </Button>
  ) : undefined;

  let contenuVide: ReactNode;
  if (q.trim() !== '') {
    contenuVide = (
      <EtatVideRecherche titre={t('or:liste.titre')} description={t('or:liste.vide.recherche')} />
    );
  } else if (filtresStructuresActifs) {
    contenuVide = (
      <EtatVideFiltre
        titre={t('or:liste.titre')}
        description={t('or:liste.vide.filtre')}
        onEffacerFiltres={effacerFiltres}
      />
    );
  } else {
    contenuVide = (
      <EtatVidePremierUsage
        titre={t('or:liste.titre')}
        description={t('or:liste.vide.premierUsage')}
        action={boutonNouveauOr}
      />
    );
  }

  if (isPending) {
    return (
      <GabaritEcran titre={t('or:liste.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (isError) {
    return (
      <GabaritEcran titre={t('or:liste.titre')}>
        <EtatErreur
          titre={t('or:liste.erreur.titre')}
          description={messageErreur(error, t)}
          onReessayer={() => void refetch()}
        />
      </GabaritEcran>
    );
  }

  // Titre TOUJOURS visible (retour @laupernoe, chantier « zone haute des écrans de liste ») : ce n'est
  // plus un doublon muet de l'onglet actif « Ordres de réparation » — @laupernoe veut voir écrit où il
  // est. « Nouvel ordre de réparation » n'est PAS passé en `actions` de `GabaritEcran` (qui le
  // placerait juste sous le titre, seul sur sa ligne, et décalerait tout le reste) : il rejoint la
  // ligne « Trier par », à droite — écran de référence de ce chantier, même déplacement appliqué
  // ensuite à Pneus/Clients/Véhicules et, en parallèle, à Pièces (`EcranListeArticles.tsx`).
  return (
    <GabaritEcran titre={t('or:liste.titre')}>
      <BarreFiltres
        q={qSaisie}
        onChangeQ={setQSaisie}
        filtresActifs={filtresActifs}
        onEffacerFiltres={effacerFiltres}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-statut-or">{t('or:liste.filtres.statut')}</Label>
          <Select
            value={statut ?? 'tous'}
            onValueChange={(valeur) =>
              setStatut(valeur === 'tous' ? undefined : (valeur as StatutOrdreReparation))
            }
          >
            <SelectTrigger
              id="filtre-statut-or"
              className="w-[200px]"
              aria-label={t('or:liste.filtres.statut')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">{t('or:liste.filtres.statutTous')}</SelectItem>
              {STATUTS_ORDRE_REPARATION.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`or:statuts.${CLES_STATUT[valeur]}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Issue #111 — filtre séparé, jamais fusionné dans le `<Select>` du statut ci-dessus
         *  (voir `CLES_ATTENTE`) : « Attente pièces » est un drapeau, pas un état de la liste des
         *  statuts réels, cumulable avec n'importe lequel d'entre eux. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filtre-attente-or">{t('or:liste.filtres.attente')}</Label>
          <Select
            value={attente ?? 'toutes'}
            onValueChange={(valeur) =>
              setAttente(valeur === 'toutes' ? undefined : (valeur as AttenteOrdreReparation))
            }
          >
            <SelectTrigger
              id="filtre-attente-or"
              className="w-[200px]"
              aria-label={t('or:liste.filtres.attente')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="toutes">{t('or:liste.filtres.attenteToutes')}</SelectItem>
              {ATTENTES_ORDRE_REPARATION.map((valeur) => (
                <SelectItem key={valeur} value={valeur}>
                  {t(`or:statuts.${CLES_ATTENTE[valeur]}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BarreFiltres>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelecteurTri
          options={TRIS_ORDRES_REPARATION.map((valeur) => ({
            valeur,
            libelle: t(CLES_TRI[valeur]),
          }))}
          valeur={tri}
          onChangeValeur={setTri}
          label={t('or:liste.tri.label')}
          className="max-w-xs"
        />
        {boutonNouveauOr}
      </div>

      <TableComptoir
        colonnes={colonnes}
        lignes={ordres}
        cleLigne={(or) => or.id}
        onOuvrirLigne={(or) => navigate(cheminDetailOr(or.id, site))}
        libelleLigne={(or) => t('commun:actions.ouvrirElement', { nom: or.numero })}
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
