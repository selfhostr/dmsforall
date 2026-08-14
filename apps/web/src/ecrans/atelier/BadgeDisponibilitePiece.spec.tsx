import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renduAvecQueryClient } from '@/test/utils';

import { BadgeDisponibilitePiece } from './BadgeDisponibilitePiece';

/**
 * Les quatre issues ne se ressemblent JAMAIS (constat terrain) — ce test vérifie que chacune rend
 * un texte DISTINCT, et qu'aucune ne peut être confondue avec une autre par une simple recherche
 * de texte partagé (en particulier « suivi nulle part » contre « suivi mais pas ici » contre
 * « suivi ici mais épuisé » — la confusion à trois têtes signalée par le rapport de test terrain).
 */
describe('BadgeDisponibilitePiece', () => {
  it('« nonSuiviNullePart » : jamais suivi sur aucun site — texte distinct des trois autres', () => {
    renduAvecQueryClient(<BadgeDisponibilitePiece etat={{ type: 'nonSuiviNullePart' }} />);
    expect(
      screen.getByText(
        "Cette pièce n'est suivie dans aucun site du magasin — jamais reçue en stock.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/pas à ce site/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Aucune actuellement disponible/)).not.toBeInTheDocument();
  });

  it('« nonSuiviSurCeSite » : suivi ailleurs mais pas ici — texte distinct de "nonSuiviNullePart" et de "aucune"', () => {
    renduAvecQueryClient(<BadgeDisponibilitePiece etat={{ type: 'nonSuiviSurCeSite' }} />);
    expect(
      screen.getByText('Ce site ne suit pas cette pièce en stock — elle est suivie ailleurs.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/jamais reçue en stock/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Aucune actuellement disponible/)).not.toBeInTheDocument();
  });

  it('« aucune » : suivi ici mais épuisé — texte distinct des deux états "non suivi"', () => {
    renduAvecQueryClient(<BadgeDisponibilitePiece etat={{ type: 'aucune' }} />);
    expect(screen.getByText('Aucune actuellement disponible à ce site.')).toBeInTheDocument();
    expect(screen.queryByText(/jamais reçue en stock/)).not.toBeInTheDocument();
    expect(screen.queryByText(/suivie ailleurs/)).not.toBeInTheDocument();
  });

  it('« disponible » : affiche la quantité en millièmes formatée (jamais un flottant brut)', () => {
    renduAvecQueryClient(
      <BadgeDisponibilitePiece etat={{ type: 'disponible', quantiteMillieme: 2500 }} />,
    );
    expect(screen.getByText('2.5 disponible(s) à ce site.')).toBeInTheDocument();
  });
});
