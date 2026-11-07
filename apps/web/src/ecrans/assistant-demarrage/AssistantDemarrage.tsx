import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { memoriserEtapeAssistant, useEtatAssistant } from '@/hooks/assistant/etat-assistant';
import { cn } from '@/lib/utils';

import {
  ETAPES_ASSISTANT,
  etapePassable,
  etapePrecedente,
  etapeSuivante,
  type IdEtapeAssistant,
} from './etapes';
import { EtapeAtelier } from './etapes/EtapeAtelier';
import { EtapeEquipe, type CompteCree } from './etapes/EtapeEquipe';
import { EtapeGarage } from './etapes/EtapeGarage';
import { EtapeLogo } from './etapes/EtapeLogo';
import { EtapeModules } from './etapes/EtapeModules';
import { EtapePaiements } from './etapes/EtapePaiements';
import { EtapeTermine } from './etapes/EtapeTermine';
import type { MemoireEtapes } from './memoire-etapes';

interface Props {
  readonly ouvert: boolean;
  /** Quitter (croix, Échap, « Quitter ») ou terminer : l'appelant mémorise la fermeture. */
  readonly onFermer: () => void;
}

/**
 * Assistant de premier démarrage : grand dialogue Radix en sept étapes courtes. L'assistant reste
 * monté quand il est fermé : étape courante, saisies et comptes créés survivent à « Quitter pour
 * l'instant », et la reprise (lien de l'accueil) repart où la personne s'était arrêtée.
 */
export function AssistantDemarrage({ ouvert, onFermer }: Props) {
  const { t } = useTranslation(['assistant', 'commun']);
  // L'étape vit dans la mémoire de session de l'assistant : rouvert depuis la barre latérale
  // (écran différent, assistant remonté), il repart où la personne l'avait laissé.
  const { etape } = useEtatAssistant();
  const setEtape = memoriserEtapeAssistant;
  const [faites, setFaites] = useState<ReadonlySet<IdEtapeAssistant>>(new Set());
  const [comptes, setComptes] = useState<readonly CompteCree[]>([]);
  const memoire = useRef<MemoireEtapes>(new Map()).current;
  const titreEtape = useRef<HTMLHeadingElement>(null);
  const premierRendu = useRef(true);

  // Annonce + focus à chaque changement d'étape (pas à l'ouverture : Radix place déjà le focus).
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    titreEtape.current?.focus();
  }, [etape]);

  const numero = ETAPES_ASSISTANT.indexOf(etape) + 1;
  const total = ETAPES_ASSISTANT.length;

  function suivant() {
    setFaites((f) => new Set(f).add(etape));
    setEtape(etapeSuivante(etape));
  }
  const retour = etape === 'garage' ? undefined : () => setEtape(etapePrecedente(etape));
  const passer = etapePassable(etape) ? () => setEtape(etapeSuivante(etape)) : undefined;
  const propsEtape = { memoire, onSuivant: suivant, onRetour: retour, onPasser: passer };

  return (
    <Dialog open={ouvert} onOpenChange={(o) => (o ? undefined : onFermer())}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('assistant:titre')}</DialogTitle>
        </DialogHeader>

        <nav aria-label={t('assistant:navigation.liste')}>
          <ol className="flex flex-wrap gap-x-4 gap-y-1">
            {ETAPES_ASSISTANT.map((id, i) => {
              const courante = id === etape;
              const terminee = faites.has(id);
              return (
                <li
                  key={id}
                  aria-current={courante ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 texte-libelle',
                    courante ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full border',
                      courante && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {terminee ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  {t(`assistant:etapes.${id}.titre`)}
                  {terminee ? (
                    <span className="sr-only"> ({t('assistant:navigation.terminee')})</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex flex-col gap-4">
          <div>
            <p className="sr-only" aria-live="polite">
              {t('assistant:navigation.position', { numero, total })}
            </p>
            <h3
              ref={titreEtape}
              tabIndex={-1}
              className="texte-titre-section font-semibold outline-none"
            >
              {t(`assistant:etapes.${etape}.titre`)}
            </h3>
          </div>

          {etape === 'garage' ? <EtapeGarage {...propsEtape} /> : null}
          {etape === 'modules' ? <EtapeModules {...propsEtape} /> : null}
          {etape === 'paiements' ? <EtapePaiements {...propsEtape} /> : null}
          {etape === 'atelier' ? <EtapeAtelier {...propsEtape} /> : null}
          {etape === 'logo' ? <EtapeLogo {...propsEtape} /> : null}
          {etape === 'equipe' ? (
            <EtapeEquipe
              {...propsEtape}
              comptes={comptes}
              onCompteCree={(c) => setComptes((l) => [...l, c])}
            />
          ) : null}
          {etape === 'termine' ? (
            <EtapeTermine nombreComptesCrees={comptes.length} onTerminer={onFermer} />
          ) : null}

          {etape !== 'termine' ? (
            <div>
              <Button type="button" variant="link" size="sm" onClick={onFermer}>
                {t('assistant:actions.quitter')}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
