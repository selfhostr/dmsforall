import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseRecherche, ResultatRecherche, TypeResultatRecherche } from '@dfa/shared';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { EtatVide } from '@/composants/commun/EtatVide';
import { useSession } from '@/hooks/useSession';

import { ChoixPlaqueInterchangeable } from './ChoixPlaqueInterchangeable';
import { naturesRechercheesPourRole, recherchePerimetreRestreint } from './droits-recherche';
import { ResultatArticle } from './ResultatArticle';
import { ResultatClient } from './ResultatClient';
import { ResultatDepotPneu } from './ResultatDepotPneu';
import { ResultatDocumentVente } from './ResultatDocumentVente';
import { ResultatFournisseur } from './ResultatFournisseur';
import { ResultatOr } from './ResultatOr';
import { ResultatVehicule } from './ResultatVehicule';

/** Formate la liste des natures effectivement interrogées en une énumération lisible, dans la
 *  langue courante — jamais un `join(', ')` figé qui lirait mal en allemand/italien pour le
 *  dernier élément (« et »/« und »/« e »). Utilisé UNIQUEMENT pour dire ce qui A été cherché
 *  (sûr : ça ne révèle l'existence de rien), jamais pour lister ce qui a été exclu. */
function formaterListeNatures(libelles: readonly string[], langue: string): string {
  return new Intl.ListFormat(langue, { style: 'long', type: 'conjunction' }).format(libelles);
}

export interface ProprietesPanneauResultatsRecherche {
  readonly valeur: string;
  readonly onValeurChange: (valeur: string) => void;
  /** `null` tant qu'aucune réponse n'est encore arrivée (requête pas encore déclenchée, ou en
   *  vol — voir `enChargement`). La normalisation de `valeur` reste strictement serveur. */
  readonly reponse: ReponseRecherche | null;
  readonly enChargement?: boolean;
  readonly onSelectionner: (resultat: ResultatRecherche) => void;
  readonly onEchap?: () => void;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * Panneau de résultats de la recherche globale (D-08) — groupes Véhicules / Clients / Ordres de
 * réparation, navigation clavier complète (↑ ↓ fournis par `cmdk`, Entrée = `onSelect`,
 * Échap = `onEchap`). Autonome et testable seul : porte son propre `CommandInput` contrôlé
 * (`valeur`/`onValeurChange`), l'écran R2 se contente de le monter et de brancher le hook réseau.
 *
 * Aucune requête ici : purement présentationnel, reçoit `reponse` déjà résolue par l'appelant.
 */
export function PanneauResultatsRecherche({
  valeur,
  onValeurChange,
  reponse,
  enChargement = false,
  onSelectionner,
  onEchap,
  placeholder,
  className,
}: ProprietesPanneauResultatsRecherche) {
  const { t, i18n } = useTranslation('recherche');
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  function gererClavier(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key === 'Escape' && onEchap) {
      evenement.preventDefault();
      onEchap();
    }
  }

  const vehicules = reponse?.resultats.filter((resultat) => resultat.type === 'vehicule') ?? [];
  const clients = reponse?.resultats.filter((resultat) => resultat.type === 'client') ?? [];
  const ordres =
    reponse?.resultats.filter((resultat) => resultat.type === 'ordre_reparation') ?? [];
  const documents =
    reponse?.resultats.filter((resultat) => resultat.type === 'document_vente') ?? [];
  const articles = reponse?.resultats.filter((resultat) => resultat.type === 'article') ?? [];
  const fournisseurs =
    reponse?.resultats.filter((resultat) => resultat.type === 'fournisseur') ?? [];
  const depotsPneus = reponse?.resultats.filter((resultat) => resultat.type === 'depot_pneu') ?? [];
  const plaqueInterchangeable = reponse?.plaqueInterchangeable === true;
  const aucunResultat = reponse !== null && reponse.resultats.length === 0;

  // RF-116 / « une absence de donnée n'est pas une valeur » (CONTRIBUTING.md) : un rôle sans droit sur
  // une nature (ex. `admin` sans `pieces.article.lire`, RF-115) ne doit jamais lire « Aucun
  // résultat » — ce message affirme que la donnée n'existe pas, alors que le serveur n'a
  // simplement pas cherché là. `naturesRechercheesPourRole` ne révèle QUE ce qui a été cherché
  // (toujours sûr), jamais ce qui a été exclu ni un compte de résultats masqués — voir
  // `droits-recherche.ts` pour la limite anti-fuite.
  //
  // Symétrique : `role` peut être `undefined` (session pas encore résolue — la palette Ctrl+K est
  // montée dans l'en-tête, avant `RouteProtegee` — ou session résolue à « pas de session »).
  // `recherchePerimetreRestreint` retourne alors `false` par contrat : le vrai portillon a joué
  // côté serveur sur la session serveur, qui a cherché dans les sept natures — affirmer ici un
  // périmètre restreint qu'on n'a pas vérifié serait un mensonge, pas une prudence. On retombe
  // simplement sur le message plat (`vide.description`).
  const perimetreRestreint = recherchePerimetreRestreint(role);
  const titreVide = perimetreRestreint ? t('vide.titrePerimetreRestreint') : t('vide.titre');
  const descriptionVide = perimetreRestreint
    ? t('vide.descriptionPerimetreRestreint', {
        natures: formaterListeNatures(
          naturesRechercheesPourRole(role).map((nature: TypeResultatRecherche) =>
            t(`natures.${nature}`),
          ),
          i18n.language,
        ),
      })
    : t('vide.description');

  // Le focus reste dans `CommandInput` pendant toute la frappe : le changement de résultats en
  // dessous (nombre, passage chargement -> vide/rempli) ne serait jamais annoncé par un lecteur
  // d'écran sans cette région dédiée — `CommandList`/`CommandEmpty` (cmdk) ne posent aucun
  // `aria-live`. Texte caché visuellement, jamais dupliqué avec le contenu déjà visible.
  let annonceLive: string;
  if (enChargement) {
    annonceLive = t('chargement');
  } else if (aucunResultat) {
    annonceLive = titreVide;
  } else if (reponse !== null) {
    annonceLive = t('annonceResultats', { count: reponse.resultats.length });
  } else {
    // Rien saisi/recherché encore — aucune annonce, l'aide (`recherche:aide`) affichée à côté
    // reste l'unique message tant qu'aucune requête n'est partie.
    annonceLive = '';
  }

  return (
    <div onKeyDown={gererClavier} className={className}>
      <span role="status" aria-live="polite" className="sr-only">
        {annonceLive}
      </span>
      {/* RM-18 / §6.9 : rendu HORS de la liste `cmdk` — ni ordonnancement par score, ni
          surlignage automatique du premier élément (voir ChoixPlaqueInterchangeable). */}
      {plaqueInterchangeable && vehicules.length > 0 ? (
        <div className="mb-3">
          <ChoixPlaqueInterchangeable vehicules={vehicules} onChoisir={onSelectionner} />
        </div>
      ) : null}

      <Command label={t('titre')} shouldFilter={false}>
        <CommandInput
          value={valeur}
          onValueChange={onValeurChange}
          placeholder={placeholder ?? t('placeholder')}
        />
        <CommandList>
          {enChargement ? <CommandEmpty>{t('chargement')}</CommandEmpty> : null}
          {!enChargement && aucunResultat ? (
            <CommandEmpty>
              <EtatVide titre={titreVide} description={descriptionVide} />
            </CommandEmpty>
          ) : null}

          {!enChargement && !plaqueInterchangeable && vehicules.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.vehicules', { count: vehicules.length })}
              resultats={vehicules}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatVehicule resultat={resultat} />}
            />
          ) : null}

          {!enChargement && clients.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.clients', { count: clients.length })}
              resultats={clients}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatClient resultat={resultat} />}
            />
          ) : null}

          {!enChargement && ordres.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.ordres', { count: ordres.length })}
              resultats={ordres}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatOr resultat={resultat} />}
            />
          ) : null}

          {!enChargement && documents.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.documents', { count: documents.length })}
              resultats={documents}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatDocumentVente resultat={resultat} />}
            />
          ) : null}

          {!enChargement && articles.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.articles', { count: articles.length })}
              resultats={articles}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatArticle resultat={resultat} />}
            />
          ) : null}

          {!enChargement && fournisseurs.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.fournisseurs', { count: fournisseurs.length })}
              resultats={fournisseurs}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatFournisseur resultat={resultat} />}
            />
          ) : null}

          {!enChargement && depotsPneus.length > 0 ? (
            <GroupeResultats
              heading={t('resultatsGroupes.depotsPneus', { count: depotsPneus.length })}
              resultats={depotsPneus}
              onSelectionner={onSelectionner}
              rendreContenu={(resultat) => <ResultatDepotPneu resultat={resultat} />}
            />
          ) : null}
        </CommandList>
      </Command>
    </div>
  );
}

interface ProprietesGroupeResultats {
  readonly heading: string;
  readonly resultats: readonly ResultatRecherche[];
  readonly onSelectionner: (resultat: ResultatRecherche) => void;
  readonly rendreContenu: (resultat: ResultatRecherche) => ReactNode;
}

function GroupeResultats({
  heading,
  resultats,
  onSelectionner,
  rendreContenu,
}: ProprietesGroupeResultats) {
  return (
    <CommandGroup heading={heading}>
      {resultats.map((resultat) => (
        <CommandItem
          key={resultat.id}
          value={resultat.id}
          onSelect={() => onSelectionner(resultat)}
          className="min-h-11"
        >
          {rendreContenu(resultat)}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
