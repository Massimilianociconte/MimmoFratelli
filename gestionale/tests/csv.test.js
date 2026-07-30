import { describe, expect, it } from 'vitest';
import {
  guessColumnMapping,
  rowToDraftParsed,
} from '../src/channels/csv.js';

describe('guessColumnMapping', () => {
  it('riconosce il listino italiano del PRD', () => {
    expect(guessColumnMapping(['Prodotto', 'Prezzo €/kg', 'Note'])).toEqual({
      name: 0,
      price: 1,
      description: 2,
    });
  });

  it('riconosce sinonimi comuni', () => {
    expect(
      guessColumnMapping(['Articolo', 'Costo', 'Reparto', 'Pezzatura', 'Giacenza']),
    ).toEqual({
      name: 0,
      price: 1,
      category_slug: 2,
      weight: 3,
      quantity: 4,
    });
  });

  it('lascia non mappate le intestazioni sconosciute', () => {
    expect(guessColumnMapping(['Codice interno', 'Fornitore'])).toEqual({});
  });
});

describe('rowToDraftParsed', () => {
  it('normalizza nome, prezzo in centesimi e peso', () => {
    expect(
      rowToDraftParsed(
        [' pomodori ciliegino ', '3,50 €/kg', '500 g', '8', 'Verdura Fresca'],
        {
          name: 0,
          price: 1,
          weight: 2,
          quantity: 3,
          category_slug: 4,
        },
      ),
    ).toMatchObject({
      name: 'Pomodori Ciliegino',
      price: 350,
      unit_type: 'weight',
      weights: [{ grams: 500, qty: 8 }],
      category_slug: 'verdura-fresca',
    });
  });

  it('non inventa il prezzo se la cella è vuota', () => {
    expect(
      rowToDraftParsed(['Arance', ''], { name: 0, price: 1 }),
    ).toMatchObject({
      name: 'Arance',
      price: null,
    });
  });
});
