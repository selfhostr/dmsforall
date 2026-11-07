import { peut } from '@/droits';
import { CheckCircle2, Circle, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AssistantDemarrage } from '@/ecrans/assistant-demarrage/AssistantDemarrage';
import { doitOuvrirAutomatiquement } from '@/hooks/assistant/ouverture-assistant';
import { useFermetureAssistant } from '@/hooks/assistant/useFermetureAssistant';
import type { EtapeDemarrage, IdEtapeDemarrage } from '@/hooks/accueil/etapes-demarrage';
import { useEtapesDemarrage } from '@/hooks/accueil/useEtapesDemarrage';
import { useMasquageDemarrage } from '@/hooks/accueil/useMasquageDemarrage';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';
import { cn } from '@/lib/utils';

const LIENS: Readonly<Record<IdEtapeDemarrage, string>> = {
  coordonnees: chemins.parametrage.facturation(),
  compte: chemins.parametrage.facturation(),
  tva: chemins.parametrage.facturation(),
  tauxHoraire: chemins.parametrage.referentiels(),
  motifs: `${chemins.parametrage.atelier()}#motifs-rendez-vous`,
  collaborateur: chemins.parametrage.utilisateurs(),
  borne: chemins.parametrage.utilisateurs(),
};

/**
 * « Démarrer votre garage » — ce qu'il reste à régler pour facturer et planifier sans aide.
 * Affichée à `direction`/`admin` tant que les étapes obligatoires ne sont pas faites ; elle se
 * retire seule une fois tout réglé, ou sur « Ne plus afficher » (préférence locale par
 * utilisateur).
 */
export function ChecklistDemarrage() {
  const { data: session } = useSession();
  const autorise = peut(session?.actions, 'socle.utilisateur.lire');
  const { masque, masquer } = useMasquageDemarrage(autorise ? session?.utilisateur.id : undefined);
  const gereLesParametres = peut(session?.actions, 'parametrage.atelier.modifier');
  return (
    <>
      {gereLesParametres && session ? (
        <AssistantAccueil tenantId={session.tenant.id} utilisateurId={session.utilisateur.id}>
          {(reprendre) =>
            autorise && !masque ? <CarteDemarrage masquer={masquer} reprendre={reprendre} /> : null
          }
        </AssistantAccueil>
      ) : autorise && !masque ? (
        <CarteDemarrage masquer={masquer} />
      ) : null}
    </>
  );
}

/**
 * Assistant de démarrage : s'ouvre tout seul pour qui gère les paramètres d'un garage pas encore
 * configuré, tant qu'il n'a pas été fermé (mémoire locale par garage et utilisateur). Le lien
 * « Reprendre l'assistant » de la carte le rouvre.
 */
function AssistantAccueil({
  tenantId,
  utilisateurId,
  children,
}: {
  readonly tenantId: string;
  readonly utilisateurId: string;
  readonly children: (reprendre: () => void) => ReactNode;
}) {
  const { etapes, complet, enChargement } = useEtapesDemarrage();
  const { ferme, memoriserFermeture } = useFermetureAssistant(tenantId, utilisateurId);
  const [ouvert, setOuvert] = useState(false);
  const ouvertureTentee = useRef(false);

  useEffect(() => {
    if (ouvertureTentee.current) return;
    if (
      doitOuvrirAutomatiquement({
        autorise: true,
        // Un état qui n'a pas répondu (erreur réseau, refus) n'est PAS « garage neuf ».
        etatConnu: !enChargement && etapes.every((e) => e.etat !== 'inconnu'),
        garageConfigure: complet,
        ferme,
      })
    ) {
      ouvertureTentee.current = true;
      setOuvert(true);
    }
  }, [enChargement, etapes, complet, ferme]);

  return (
    <>
      <AssistantDemarrage
        ouvert={ouvert}
        onFermer={() => {
          setOuvert(false);
          memoriserFermeture();
        }}
      />
      {children(() => setOuvert(true))}
    </>
  );
}

function CarteDemarrage({
  masquer,
  reprendre,
}: {
  readonly masquer: () => void;
  readonly reprendre?: (() => void) | undefined;
}) {
  const { t } = useTranslation(['accueil', 'assistant']);
  const { etapes, enChargement, complet, reessayer } = useEtapesDemarrage();

  if (complet) return null;

  const total = etapes.filter((e) => !e.facultative).length;
  const faites = etapes.filter((e) => !e.facultative && e.etat === 'fait').length;
  const aVerifier = etapes.some((e) => e.etat === 'inconnu');

  return (
    <Card aria-labelledby="demarrage-titre" role="region">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle id="demarrage-titre" className="texte-titre-section">
            {t('accueil:demarrage.checklist.titre')}
          </CardTitle>
          {!enChargement ? (
            <p className="texte-corps text-muted-foreground">
              {t('accueil:demarrage.checklist.progression', { faites, total })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {reprendre ? (
            <Button type="button" size="sm" onClick={reprendre}>
              {t('assistant:reprise.bouton')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={masquer}>
            {t('accueil:demarrage.checklist.masquer')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {enChargement ? (
          <div
            className="space-y-3"
            role="status"
            aria-label={t('accueil:demarrage.checklist.chargement')}
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {etapes.map((etape) => (
              <LigneEtape key={etape.id} etape={etape} />
            ))}
          </ul>
        )}
        {!enChargement && aVerifier ? (
          <div className="flex items-center gap-3">
            <p className="texte-corps text-muted-foreground">
              {t('accueil:demarrage.checklist.verificationImpossible')}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={reessayer}>
              {t('accueil:demarrage.checklist.reessayer')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LigneEtape({ etape }: { readonly etape: EtapeDemarrage }) {
  const { t } = useTranslation('accueil');
  const fait = etape.etat === 'fait';
  const Icone = fait ? CheckCircle2 : etape.etat === 'inconnu' ? CircleHelp : Circle;
  return (
    <li className="flex items-start gap-3 py-3">
      <Icone className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn('texte-corps font-medium', fait && 'text-muted-foreground')}>
          {t(`accueil:demarrage.etapes.${etape.id}.titre`)}
          <span className="ml-2 texte-libelle font-normal text-muted-foreground">
            {t(`accueil:demarrage.etat.${etape.etat}`)}
            {etape.facultative ? ` · ${t('accueil:demarrage.facultatif')}` : ''}
          </span>
        </p>
        <p className="texte-corps text-muted-foreground">
          {t(`accueil:demarrage.etapes.${etape.id}.pourquoi`)}
        </p>
      </div>
      <Button asChild variant={fait ? 'ghost' : 'outline'} size="sm">
        <Link to={LIENS[etape.id]}>
          {fait ? t('accueil:demarrage.modifier') : t('accueil:demarrage.regler')}
          <span className="sr-only"> — {t(`accueil:demarrage.etapes.${etape.id}.titre`)}</span>
        </Link>
      </Button>
    </li>
  );
}
