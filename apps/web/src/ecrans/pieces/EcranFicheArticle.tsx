import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { useArticle } from '@/hooks/pieces/useArticle';
import { useMarquerObsoleteArticle, useDesactiverArticle, useReactiverArticle } from '@/hooks/pieces/useTransitionsArticle';
import { useSession } from '@/hooks/useSession';

import { peutCreerMouvement, peutEcrireArticle } from './droits';
import { EnTeteFicheArticle } from './EnTeteFicheArticle';
import { FormulaireArticle } from './FormulaireArticle';
import { PanneauMouvementsArticle } from './PanneauMouvementsArticle';
import { PanneauStockArticle } from './PanneauStockArticle';

type Confirmation = 'marquerObsolete' | 'desactiver' | 'reactiver' | null;

/**
 * Fiche article (RP-01 → RP-08, priorité 2 du brief) — détail, stock par site, disponibilité (via
 * `PanneauStockArticle`, déplié à la demande), historique des mouvements (`PanneauMouvementsArticle`).
 * Une seule requête PRIMAIRE bloque l'écran entier (l'article lui-même) — même architecture que
 * `EcranFicheVehicule` : chaque panneau secondaire gère son propre chargement/erreur.
 */
export function EcranFicheArticle() {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const { data: session } = useSession();
  const role = session?.utilisateur.role;
  const sites = session?.sites ?? [];

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  const requeteArticle = useArticle(id);
  const marquerObsolete = useMarquerObsoleteArticle(id ?? '');
  const desactiver = useDesactiverArticle(id ?? '');
  const reactiver = useReactiverArticle(id ?? '');

  if (requeteArticle.isPending) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('pieces:articles.titre')}</h1>
        <EtatChargement lignes={8} />
      </div>
    );
  }

  if (requeteArticle.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="sr-only">{t('pieces:articles.titre')}</h1>
        <EtatErreur
          titre={t('pieces:articles.fiche.erreur.titre')}
          description={messageErreur(requeteArticle.error, t)}
          onReessayer={() => void requeteArticle.refetch()}
        />
      </div>
    );
  }

  const article = requeteArticle.data;
  const peutEcrire = peutEcrireArticle(role);

  function confirmer() {
    if (confirmation === 'marquerObsolete') {
      marquerObsolete.mutate({}, { onSuccess: () => setConfirmation(null) });
    } else if (confirmation === 'desactiver') {
      desactiver.mutate({}, { onSuccess: () => setConfirmation(null) });
    } else if (confirmation === 'reactiver') {
      reactiver.mutate(undefined, { onSuccess: () => setConfirmation(null) });
    }
  }

  const enCoursTransition = marquerObsolete.isPending || desactiver.isPending || reactiver.isPending;
  const erreurTransition = marquerObsolete.error ?? desactiver.error ?? reactiver.error;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="sr-only">{t('pieces:articles.titre')}</h1>

      <EnTeteFicheArticle
        article={article}
        peutEcrire={peutEcrire}
        onModifier={() => setFormulaireOuvert(true)}
        onMarquerObsolete={() => setConfirmation('marquerObsolete')}
        onDesactiver={() => setConfirmation('desactiver')}
        onReactiver={() => setConfirmation('reactiver')}
      />

      {erreurTransition ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(erreurTransition, t)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('pieces:articles.references.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          {article.references.length === 0 ? (
            <EtatVide titre={t('pieces:articles.references.titre')} description={t('pieces:articles.vide')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {article.references.map((reference) => (
                <li key={reference.id} className="flex items-center justify-between gap-3 texte-corps">
                  <span className="font-mono">{reference.reference}</span>
                  <span className="texte-libelle text-muted-foreground">
                    {t(`pieces:articles.references.types.${reference.type}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PanneauStockArticle articleId={article.id} stocksResume={article.stocksResume} sites={sites} />

      <PanneauMouvementsArticle
        articleId={article.id}
        sites={sites}
        peutCreerMouvement={peutCreerMouvement(role)}
        siteParDefaut={site}
      />

      {peutEcrire ? <FormulaireArticle ouvert={formulaireOuvert} onOuvertChange={setFormulaireOuvert} article={article} /> : null}

      <AvertissementConfirmable
        ouvert={confirmation !== null}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setConfirmation(null);
        }}
        titre={confirmation ? t(`pieces:articles.confirmations.${confirmation}Titre`) : ''}
        description={confirmation ? t(`pieces:articles.confirmations.${confirmation}Description`) : ''}
        libelleConfirmation={confirmation ? t(`pieces:articles.actions.${confirmation}`) : ''}
        onConfirmer={confirmer}
        enCours={enCoursTransition}
      />
    </div>
  );
}
