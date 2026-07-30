import { describe, expect, it } from 'vitest';
import {
  fromRemoteDraft,
  lowConfidenceFields,
  newDraft,
  toRemoteParsed,
  validateDraft,
} from '../src/core/draft.js';

describe('newDraft', () => {
  it('crea una bozza canonica con prezzo in centesimi', () => {
    const draft = newDraft('manual', { note: 'test' }, { name: 'Arance', price: 250 });
    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.source).toBe('manual');
    expect(draft.parsed.price).toBe(250);
    expect(draft.parsed.unit_type).toBe('weight');
    expect(draft.status).toBe('draft');
  });

  it('rifiuta una fonte sconosciuta', () => {
    expect(() => newDraft('telegram', null)).toThrow(/source/i);
  });
});

describe('validateDraft', () => {
  it('richiede nome e prezzo', () => {
    expect(validateDraft({}).missing).toEqual(['name', 'price']);
  });

  it('accetta una bozza completa', () => {
    expect(validateDraft({ name: 'Arance', price: 250 })).toEqual({
      ok: true,
      missing: [],
      invalid: [],
    });
  });

  it('rifiuta centesimi non interi o non positivi', () => {
    expect(validateDraft({ name: 'Arance', price: 2.5 })).toEqual({
      ok: false,
      missing: [],
      invalid: ['price'],
    });
  });
});

describe('lowConfidenceFields', () => {
  it('ritorna solo i campi sotto soglia', () => {
    expect(lowConfidenceFields({ name: 0.9, price: 0.4 })).toEqual(['price']);
  });

  it('ignora valori non numerici', () => {
    expect(lowConfidenceFields({ name: null, price: '0.2' })).toEqual([]);
  });
});

describe('remote serialization', () => {
  it('non invia data URL nel JSONB remoto e incorpora la confidenza', () => {
    const draft = newDraft(
      'photo',
      null,
      {
        name: 'Pomodori',
        price: 300,
        images: [
          { kind: 'local', dataUrl: 'data:image/webp;base64,AAA' },
          'https://example.com/tomato.webp',
        ],
      },
      { name: 0.8, price: 0.5 },
    );

    expect(toRemoteParsed(draft)).toMatchObject({
      name: 'Pomodori',
      price: 300,
      images: ['https://example.com/tomato.webp'],
      confidence: { name: 0.8, price: 0.5 },
    });
  });

  it('ricostruisce la shape locale da una riga Supabase', () => {
    const local = fromRemoteDraft({
      id: 'f9144e15-4e84-4fbf-aabd-aa57599c2d5d',
      source: 'file',
      raw_input: { row: 1 },
      parsed: {
        name: 'Zucchine',
        price: 190,
        confidence: { name: 0.9 },
      },
      status: 'draft',
      created_at: '2026-07-29T08:00:00.000Z',
      updated_at: '2026-07-29T08:01:00.000Z',
    });

    expect(local.parsed.name).toBe('Zucchine');
    expect(local.confidence).toEqual({ name: 0.9 });
    expect(local.syncState).toBe('synced');
  });
});
