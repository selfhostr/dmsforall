import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DocumentVenteResume, StatutDocumentVente } from '@dfa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EtatVide } from '@/composants/commun/EtatVide';
import { formaterDate, formaterMontant } from '@/lib/formats';

/** `StatutDocumentVente` (10 valeurs, `contrats/facturation/enums.ts`) -> suffixe camelCase de
 *  `ventes:dossier.documents.statuts`. `BadgeEtatDocument` (`ecrans/facturation/`) n'en couvre que
 *  3 (brouillon/emis/annule_par_avoir, périmètre volontairement restreint de son auteur) — un
 *  dossier peut embarquer un devis `expire`/`refuse` ou un bon de commande `transforme`, les 7
 *  autres valeurs. Exporté : `PanneauActionsDossierVente` le réutilise (#128) pour composer un
 *  libellé lisible à la place de l'UUID quand `document.numero` est encore `null` (brouillon). */
export const CLES_STATUT_DOCUMENT: Record<StatutDocumentVente, string> = {
  brouillon: 'brouillon',
  emis: 'emis',
  accepte: 'accepte',
  refuse: 'refuse',
  expire: 'expire',
  remplace: 'remplace',
  transforme: 'transforme',
  annule: 'annule',
  annule_par_avoir: 'annuleParAvoir',
  abandonne: 'abandonne',
};

/** `TypeDocumentVente` -> suffixe de `facturation:document.type` — PAS une interpolation directe
 *  de la valeur d'enum : `bon_commande` (snake_case) n'a pas de clé propre, seule `bonCommande`
 *  (camelCase) existe, et `facture` se scinde en `facture`/`factureAcompte` selon `natureFacture`
 *  — copie conforme de `BadgeTypeDocument.tsx` (`ecrans/facturation/`), dupliquée ici plutôt
 *  qu'importée (le composant lui-même rend aussi une icône que cette table ne veut pas). */
function cleTypeDocument(document: DocumentVenteResume): string {
  if (document.typeDocument === 'bon_commande') return 'bonCommande';
  if (document.typeDocument === 'facture' && document.natureFacture === 'acompte') {
    return 'factureAcompte';
  }
  return document.typeDocument;
}

interface Props {
  readonly documents: readonly DocumentVenteResume[];
  readonly documentsTronques: boolean;
}

/**
 * Documents de la chaîne facturation liés au dossier (design §7.5) — table SIMPLE (pas
 * `TableComptoir`, pas de tri/filtre nécessaire pour une poignée de lignes), `dossierVenteId`
 * embarqué en LECTURE (`ReponseDossierVente.documents`), jamais recréé ici : cette carte n'écrit
 * rien, elle n'affiche/ne relie que ce que `facturation` a déjà produit (périmètre d'un autre
 * module). Chaque ligne est un lien vers `/factures/{id}` (`EcranFicheFacture`, générique sur
 * `typeDocument`, route déjà câblée — voir `routes/routeur.tsx`).
 */
export function CarteDocumentsVente({ documents, documentsTronques }: Props) {
  const { t } = useTranslation(['ventes', 'facturation']);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('ventes:dossier.documents.titre')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {documents.length === 0 ? (
          <EtatVide
            titre={t('ventes:dossier.documents.titre')}
            description={t('ventes:dossier.documents.vide')}
          />
        ) : (
          <Table densite="aeree">
            <TableHeader>
              <TableRow>
                <TableHead>{t('ventes:dossier.documents.colonnes.type')}</TableHead>
                <TableHead>{t('ventes:dossier.documents.colonnes.numero')}</TableHead>
                <TableHead>{t('ventes:dossier.documents.colonnes.statut')}</TableHead>
                <TableHead className="text-right">
                  {t('ventes:dossier.documents.colonnes.montantTtc')}
                </TableHead>
                <TableHead className="text-right">
                  {t('ventes:dossier.documents.colonnes.solde')}
                </TableHead>
                <TableHead>{t('ventes:dossier.documents.colonnes.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => (
                <TableRow key={document.id}>
                  <TableCell>
                    <Link to={`/factures/${document.id}`} className="hover:underline">
                      {t(`facturation:document.type.${cleTypeDocument(document)}`)}
                    </Link>
                  </TableCell>
                  <TableCell>{document.numero ?? ''}</TableCell>
                  <TableCell>
                    {t(`ventes:dossier.documents.statuts.${CLES_STATUT_DOCUMENT[document.statut]}`)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {document.totalTtcCentimes !== undefined
                      ? formaterMontant(document.totalTtcCentimes)
                      : ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {document.soldeCentimes !== undefined && document.soldeCentimes > 0
                      ? formaterMontant(document.soldeCentimes)
                      : ''}
                  </TableCell>
                  <TableCell className="texte-libelle text-muted-foreground">
                    {formaterDate(document.dateDocument)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {documentsTronques ? (
          <p className="texte-libelle text-muted-foreground">
            {t('ventes:dossier.documents.tronques')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
