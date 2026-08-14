import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { DialogueArriveeRendezVous } from './DialogueArriveeRendezVous';

async function saisirKilometrage(utilisateur: ReturnType<typeof userEvent.setup>) {
  // Le libellé accessible porte l'astérisque « obligatoire » en fin de texte (`aria-hidden`, mais
  // toujours dans le `textContent` — voir `components/ui/label.tsx`) : correspondance partielle.
  const champ = screen.getByLabelText(/Kilométrage à l'entrée/);
  await utilisateur.type(champ, '88450');
}

describe('DialogueArriveeRendezVous', () => {
  it('refuse la confirmation sans kilométrage saisi', async () => {
    const utilisateur = userEvent.setup();
    const onConfirmer = vi.fn();
    render(<DialogueArriveeRendezVous ouvert onOpenChange={vi.fn()} onConfirmer={onConfirmer} />);

    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer l’arrivée' }));

    expect(onConfirmer).not.toHaveBeenCalled();
  });

  it('confirme avec le kilométrage saisi', async () => {
    const utilisateur = userEvent.setup();
    const onConfirmer = vi.fn();
    render(<DialogueArriveeRendezVous ouvert onOpenChange={vi.fn()} onConfirmer={onConfirmer} />);

    await saisirKilometrage(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer l’arrivée' }));

    expect(onConfirmer).toHaveBeenCalledWith(expect.objectContaining({ kilometrageEntree: 88450 }));
  });

  // Issue #108 : un 409 CONFIRMATION_REQUISE (ex. VEHICULE_DEUX_OR_OUVERTS) doit ouvrir une
  // confirmation explicite — avant ce correctif, `confirmationsRequises` n'était même pas un prop
  // du composant, et le refus retombait en écran blanc silencieux (rien d'enregistré, aucun
  // message, retour au planning).
  it('affiche la confirmation explicite quand le serveur exige VEHICULE_DEUX_OR_OUVERTS', async () => {
    // `confirmationsRequises` arrive TOUJOURS après coup dans le flux réel (réponse serveur
    // asynchrone, jamais présente dès le premier rendu) : `rerender` reproduit fidèlement cette
    // transition, plutôt que de monter les deux `Dialog` Radix simultanément dès `render()` — ce
    // second cas de figure n'existe jamais en usage réel et perturbe le suivi `aria-hidden` de
    // Radix entre les deux calques.
    const utilisateur = userEvent.setup();
    const onConfirmer = vi.fn();
    const onConfirmerQuandMeme = vi.fn();
    const { rerender } = render(
      <DialogueArriveeRendezVous
        ouvert
        onOpenChange={vi.fn()}
        onConfirmer={onConfirmer}
        confirmationsRequises={[]}
        onConfirmerQuandMeme={onConfirmerQuandMeme}
      />,
    );
    rerender(
      <DialogueArriveeRendezVous
        ouvert
        onOpenChange={vi.fn()}
        onConfirmer={onConfirmer}
        confirmationsRequises={['VEHICULE_DEUX_OR_OUVERTS']}
        onConfirmerQuandMeme={onConfirmerQuandMeme}
      />,
    );

    expect(
      await screen.findByText('Ce véhicule a déjà deux ordres de réparation ouverts.'),
    ).toBeInTheDocument();

    await utilisateur.click(await screen.findByRole('button', { name: 'Continuer quand même' }));
    expect(onConfirmerQuandMeme).toHaveBeenCalled();
  });

  it('ne rouvre pas la confirmation après un refus explicite (Annuler)', async () => {
    const utilisateur = userEvent.setup();
    const { rerender } = render(
      <DialogueArriveeRendezVous
        ouvert
        onOpenChange={vi.fn()}
        onConfirmer={vi.fn()}
        confirmationsRequises={[]}
        onConfirmerQuandMeme={vi.fn()}
      />,
    );
    rerender(
      <DialogueArriveeRendezVous
        ouvert
        onOpenChange={vi.fn()}
        onConfirmer={vi.fn()}
        confirmationsRequises={['VEHICULE_DEUX_OR_OUVERTS']}
        onConfirmerQuandMeme={vi.fn()}
      />,
    );

    const boutonConfirmer = await screen.findByRole('button', { name: 'Continuer quand même' });
    const dialogueConfirmation = boutonConfirmer.closest('[role="dialog"]') as HTMLElement;
    await utilisateur.click(within(dialogueConfirmation).getByRole('button', { name: 'Annuler' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Continuer quand même' }),
      ).not.toBeInTheDocument(),
    );
    // Laissé quelques instants : si le drapeau de rejet n'existait pas, `confirmationsRequises`
    // resterait posé côté hook et la modale se rouvrirait TOUTE SEULE au rendu suivant.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Continuer quand même' })).not.toBeInTheDocument();
  });

  it('sans confirmationsRequises ni onConfirmerQuandMeme, aucune modale de confirmation ne s’affiche', () => {
    render(<DialogueArriveeRendezVous ouvert onOpenChange={vi.fn()} onConfirmer={vi.fn()} />);

    expect(screen.queryByText('Continuer quand même')).not.toBeInTheDocument();
  });
});
