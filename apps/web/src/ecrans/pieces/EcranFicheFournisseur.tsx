import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { FilAriane, type SegmentFilAriane } from '@/composants/layout/FilAriane';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useFournisseur } from '@/hooks/pieces/useFournisseur';
import {
  useDesactiverFournisseur,
  useReactiverFournisseur,
} from '@/hooks/pieces/useTransitionsFournisseur';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

import { BadgeStatutFournisseur } from './BadgeStatutFournisseur';
import { peutEcrireFournisseur, peutLireFournisseur } from './droits';
import { FormulaireFournisseur } from './FormulaireFournisseur';
import { messageErreurMutation } from './messages-erreur-mutation';
import { texteOuVide } from './utils';

type Confirmation = 'desactiver' | 'reactiver' | null;

/**
 * Fiche fournisseur (RP-26, §1) — identité, coordonnées, délai habituel, transitions de statut.
 * Même architecture que `EcranFicheArticle` : une seule requête PRIMAIRE bloque l'écran entier.
 */
export function EcranFicheFournisseur() {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const role = session.data?.utilisateur.role;
  const peutLire = peutLireFournisseur(role);

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  // Défaut corrigé : `pieces.fournisseur.lire` (direction/chef_atelier/magasinier SEULS) est
  // STRICTEMENT plus étroit que `ROLES_PIECES` qui protège la ROUTE `/pieces/fournisseurs/:id`
  // (les sept rôles, `routes/droits-routes.ts`) — un vendeur/réceptionnaire/technicien/comptable
  // qui atteignait cette route (menu masqué mais URL directe toujours accessible, doctrine
  // documentée en tête de `droits-routes.ts`) déclenchait un `403` rendu comme une erreur
  // technique générique. Même doctrine que `EcranFicheClient.tsx` (`peutVoirDossiersVente`) :
  // gardé par le droit AVANT de partir — tant que la session n'est pas résolue OU que le rôle n'a
  // pas le droit, `id` n'est jamais transmis à `useFournisseur`, qui n'émet donc aucune requête.
  const requeteFournisseur = useFournisseur(session.isLoading || !peutLire ? undefined : id);
  const desactiver = useDesactiverFournisseur(id ?? '');
  const reactiver = useReactiverFournisseur(id ?? '');

  if (session.isLoading) {
    return (
      <GabaritEcran titre={t('pieces:fournisseurs.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (!peutLire) {
    return (
      <GabaritEcran titre={t('pieces:fournisseurs.titre')}>
        <p className="texte-corps text-muted-foreground">
          {t('pieces:fournisseurs.fiche.droitRequis')}
        </p>
      </GabaritEcran>
    );
  }

  if (requeteFournisseur.isPending) {
    return (
      <GabaritEcran titre={t('pieces:fournisseurs.titre')}>
        <EtatChargement lignes={6} />
      </GabaritEcran>
    );
  }

  if (requeteFournisseur.isError) {
    return (
      <GabaritEcran titre={t('pieces:fournisseurs.titre')}>
        <EtatErreur
          titre={t('pieces:fournisseurs.fiche.erreur.titre')}
          description={messageErreur(requeteFournisseur.error, t)}
          onReessayer={() => void requeteFournisseur.refetch()}
        />
      </GabaritEcran>
    );
  }

  const fournisseur = requeteFournisseur.data;
  const peutEcrire = peutEcrireFournisseur(role);

  // Fil d'Ariane contextuel (même doctrine que `EnTeteFicheArticle`, Lot C) — un seul ancêtre
  // honnête ici : la liste des fournisseurs dont cette fiche vient. Ressource par TENANT (pas de
  // `?site=`, voir `chemins.pieces.fournisseurs`).
  const segmentsFilAriane: readonly SegmentFilAriane[] = [
    {
      cle: 'fournisseurs',
      libelle: t('pieces:fournisseurs.titre'),
      href: chemins.pieces.fournisseurs.liste(),
    },
  ];

  // Ferme la modale seulement sur succès (issue #63, correctif de cause racine) : un échec la
  // laisse ouverte, `AvertissementConfirmable` affiche `erreurTransition` DANS la modale via sa
  // prop `messageErreur` plutôt que dans l'écran, sous l'overlay où il restait invisible.
  function confirmer() {
    if (confirmation === 'desactiver') {
      desactiver.mutate(undefined, { onSuccess: () => setConfirmation(null) });
    } else if (confirmation === 'reactiver') {
      reactiver.mutate(undefined, { onSuccess: () => setConfirmation(null) });
    }
  }

  const enCoursTransition = desactiver.isPending || reactiver.isPending;
  const erreurTransition = desactiver.error ?? reactiver.error;

  // Titre MASQUÉ automatiquement — « Fournisseurs » (titre générique de la fiche, identité RÉELLE
  // portée par le `<h2>` visible ci-dessous, `fournisseur.nom`) est un doublon de la vue active
  // « Fournisseurs » : `GabaritEcran` le détecte lui-même. Un seul `<h1>` par page (accessibilité) —
  // jamais deux niveaux 1 en compétition avec `fournisseur.nom`.
  return (
    <GabaritEcran titre={t('pieces:fournisseurs.titre')}>
      {/* Bordure décorative retirée (DESIGN.md « bordure structurelle uniquement ») — simple
          groupe de contenu (identité + statut + coordonnées), sans comportement propre. Devient
          une vraie `Card` (surface seule), même traitement que `EnTeteFicheArticle.tsx`. */}
      <Card>
        <CardContent className="flex flex-col gap-groupe pt-carte">
          <FilAriane segments={segmentsFilAriane} pageCourante={fournisseur.nom} />

          <div className="flex flex-col gap-groupe sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-champ">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="texte-titre-page">{fournisseur.nom}</h2>
                <BadgeStatutFournisseur statut={fournisseur.statut} />
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-champ texte-corps sm:grid-cols-3">
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:fournisseurs.email')}
                  </dt>
                  <dd>{texteOuVide(fournisseur.email)}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:fournisseurs.telephone')}
                  </dt>
                  <dd>{texteOuVide(fournisseur.telephone)}</dd>
                </div>
                <div>
                  <dt className="texte-libelle text-muted-foreground">
                    {t('pieces:fournisseurs.delaiHabituelJours')}
                  </dt>
                  <dd className="tabular-nums">{texteOuVide(fournisseur.delaiHabituelJours)}</dd>
                </div>
              </dl>
            </div>

            {peutEcrire ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setFormulaireOuvert(true)}>
                  {t('pieces:fournisseurs.actions.modifier')}
                </Button>
                {fournisseur.statut === 'actif' ? (
                  <Button variant="outline" onClick={() => setConfirmation('desactiver')}>
                    {t('pieces:fournisseurs.actions.desactiver')}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmation('reactiver')}>
                    {t('pieces:fournisseurs.actions.reactiver')}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {peutEcrire ? (
        <FormulaireFournisseur
          ouvert={formulaireOuvert}
          onOuvertChange={setFormulaireOuvert}
          fournisseur={fournisseur}
        />
      ) : null}

      <AvertissementConfirmable
        ouvert={confirmation !== null}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setConfirmation(null);
        }}
        titre={confirmation ? t(`pieces:fournisseurs.confirmations.${confirmation}Titre`) : ''}
        description={
          confirmation ? t(`pieces:fournisseurs.confirmations.${confirmation}Description`) : ''
        }
        libelleConfirmation={confirmation ? t(`pieces:fournisseurs.actions.${confirmation}`) : ''}
        onConfirmer={confirmer}
        enCours={enCoursTransition}
        messageErreur={erreurTransition ? messageErreurMutation(erreurTransition, t) : null}
      />
    </GabaritEcran>
  );
}
