import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';

interface Requete {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly refetch: () => unknown;
}

interface Props {
  readonly titre: string;
  readonly description: string;
  readonly videTitre: string;
  readonly videDescription: string;
  readonly requete: Requete;
  /** Une entrée par ligne, déjà rendue (lien compris) — vide = état vide explicite. */
  readonly lignes: readonly ReactNode[];
  /** Il y a plus de lignes que celles montrées : lien vers l'écran complet. */
  readonly lienToutVoir?: { readonly to: string; readonly texte: string } | undefined;
}

/**
 * Bloc « à faire » de l'accueil : titre, description, puis les trois états obligatoires
 * (chargement, erreur avec réessayer, vide avec message). La liste elle-même est rendue par
 * l'appelant ; ici seulement la mécanique commune.
 */
export function CarteListeAFaire({
  titre,
  description,
  videTitre,
  videDescription,
  requete,
  lignes,
  lienToutVoir,
}: Props) {
  const { t } = useTranslation(['erreurs']);
  let contenu: ReactNode;
  if (requete.isPending) {
    contenu = <EtatChargement lignes={3} />;
  } else if (requete.isError) {
    contenu = (
      <EtatErreur
        titre={t(
          requete.error instanceof ErreurReseau
            ? 'erreurs:reseau.titre'
            : 'erreurs:inattendue.titre',
        )}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  } else if (lignes.length === 0) {
    contenu = <EtatVide titre={videTitre} description={videDescription} />;
  } else {
    contenu = (
      <>
        <ul className="flex flex-col divide-y">
          {lignes.map((ligne, index) => (
            <li key={index}>{ligne}</li>
          ))}
        </ul>
        {lienToutVoir ? (
          <Link
            to={lienToutVoir.to}
            className="anneau-focus mt-2 inline-flex min-h-11 items-center rounded-md texte-libelle font-medium text-primary underline underline-offset-2"
          >
            {lienToutVoir.texte}
          </Link>
        ) : null}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <div className="px-carte pb-carte">{contenu}</div>
    </Card>
  );
}
