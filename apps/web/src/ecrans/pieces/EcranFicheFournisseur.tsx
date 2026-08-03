import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import type { StatutFournisseur } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { useFournisseur } from '@/hooks/pieces/useFournisseur';
import {
  useDesactiverFournisseur,
  useReactiverFournisseur,
} from '@/hooks/pieces/useTransitionsFournisseur';
import { useSession } from '@/hooks/useSession';

import { peutEcrireFournisseur } from './droits';
import { FormulaireFournisseur } from './FormulaireFournisseur';
import { texteOuVide } from './utils';

type Confirmation = 'desactiver' | 'reactiver' | null;

const VARIANTE_BADGE_STATUT: Record<StatutFournisseur, 'default' | 'secondary'> = {
  actif: 'default',
  inactif: 'secondary',
};

/**
 * Fiche fournisseur (RP-26, §1) — identité, coordonnées, délai habituel, transitions de statut.
 * Même architecture que `EcranFicheArticle` : une seule requête PRIMAIRE bloque l'écran entier.
 */
export function EcranFicheFournisseur() {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const role = session?.utilisateur.role;

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  const requeteFournisseur = useFournisseur(id);
  const desactiver = useDesactiverFournisseur(id ?? '');
  const reactiver = useReactiverFournisseur(id ?? '');

  if (requeteFournisseur.isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('pieces:fournisseurs.titre')}</h1>
        <EtatChargement lignes={6} />
      </div>
    );
  }

  if (requeteFournisseur.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('pieces:fournisseurs.titre')}</h1>
        <EtatErreur
          titre={t('pieces:fournisseurs.fiche.erreur.titre')}
          description={messageErreur(requeteFournisseur.error, t)}
          onReessayer={() => void requeteFournisseur.refetch()}
        />
      </div>
    );
  }

  const fournisseur = requeteFournisseur.data;
  const peutEcrire = peutEcrireFournisseur(role);

  function confirmer() {
    if (confirmation === 'desactiver') {
      desactiver.mutate(undefined, { onSuccess: () => setConfirmation(null) });
    } else if (confirmation === 'reactiver') {
      reactiver.mutate(undefined, { onSuccess: () => setConfirmation(null) });
    }
  }

  const enCoursTransition = desactiver.isPending || reactiver.isPending;
  const erreurTransition = desactiver.error ?? reactiver.error;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="sr-only">{t('pieces:fournisseurs.titre')}</h1>

      <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{fournisseur.nom}</h2>
            <Badge variant={VARIANTE_BADGE_STATUT[fournisseur.statut]}>
              {t(`pieces:fournisseurs.statuts.${fournisseur.statut}`)}
            </Badge>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 texte-corps sm:grid-cols-3">
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

      {erreurTransition ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(erreurTransition, t)}
        </p>
      ) : null}

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
      />
    </div>
  );
}
