import { describe, expect, it } from 'vitest';
import {
  centsToEuros,
  eurosToCents,
  formatCents,
  normalizeEan,
  normalizeName,
  parsePrice,
  parsePriceCents,
  parseWeightGrams,
} from '../src/core/normalize.js';

describe('parsePrice', () => {
  it('gestisce €/kg', () => {
    expect(parsePrice('3€/kg')).toEqual({ value: 3, per: 'kg' });
  });

  it('gestisce la virgola italiana', () => {
    expect(parsePrice('2,50 €')).toEqual({ value: 2.5, per: null });
  });

  it('gestisce "al kg"', () => {
    expect(parsePrice('4.90 al kg')).toEqual({ value: 4.9, per: 'kg' });
  });

  it('gestisce il simbolo euro prima del valore', () => {
    expect(parsePrice('€ 1.234,56')).toEqual({ value: 1234.56, per: null });
  });

  it('ritorna null se assente', () => {
    expect(parsePrice('pomodori buoni')).toBeNull();
  });
});

describe('price cents contract', () => {
  it('converte gli euro in centesimi senza errori floating point', () => {
    expect(eurosToCents(2.5)).toBe(250);
    expect(parsePriceCents('3,99 €/kg')).toEqual({ value: 399, per: 'kg' });
  });

  it('converte i centesimi in euro', () => {
    expect(centsToEuros(399)).toBe(3.99);
  });

  it('formatta con locale italiano', () => {
    expect(formatCents(250, 'it-IT', 'EUR')).toContain('2,50');
  });
});

describe('parseWeightGrams', () => {
  it('500g → 500', () => {
    expect(parseWeightGrams('500g')).toBe(500);
  });

  it('1kg → 1000', () => {
    expect(parseWeightGrams('1kg')).toBe(1000);
  });

  it('1,5 kg → 1500', () => {
    expect(parseWeightGrams('1,5 kg')).toBe(1500);
  });

  it('2 etti → 200', () => {
    expect(parseWeightGrams('2 etti')).toBe(200);
  });
});

describe('normalizeName', () => {
  it('capitalizza e pulisce', () => {
    expect(normalizeName('  pomodori CILIEGINO ')).toBe('Pomodori Ciliegino');
  });

  it('non interpreta HTML', () => {
    expect(normalizeName('<img src=x onerror=alert(1)>')).toBe(
      '<img Src=x Onerror=alert(1)>',
    );
  });
});

describe('normalizeEan', () => {
  it('accetta EAN-8 ed EAN-13 validi', () => {
    expect(normalizeEan(' 8000500310427 ')).toBe('8000500310427');
    expect(normalizeEan('96385074')).toBe('96385074');
  });

  it('rifiuta codici con check digit errata', () => {
    expect(normalizeEan('8000500310428')).toBeNull();
  });
});
