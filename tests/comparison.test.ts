import { describe, expect, it } from 'vitest';
import { compareRecognitionText, normalizeTextForComparison, parseKeywordsInput } from '../src/services/text-compare';

describe('text comparison', () => {
  it('normalizes accents, case and spacing', () => {
    expect(normalizeTextForComparison('  Áviso\n   Urgente  ')).toBe('aviso urgente');
  });

  it('parses keyword lists from commas, semicolons and new lines', () => {
    expect(parseKeywordsInput('um, dois; três\nquatro')).toEqual(['um', 'dois', 'tres', 'quatro']);
  });

  it('matches when all configured keywords are present', () => {
    const result = compareRecognitionText('Alerta novo urgente erro', {
      expectedText: 'alerta novo',
      keywords: ['urgente', 'erro'],
      keywordMode: 'all',
    });

    expect(result.matched).toBe(true);
    expect(result.mainTextMatched).toBe(true);
    expect(result.matchedKeywords).toEqual(['urgente', 'erro']);
  });

  it('matches when any configured keyword is present', () => {
    const result = compareRecognitionText('Mensagem de teste com prioridade', {
      expectedText: 'mensagem de teste',
      keywords: ['urgente', 'prioridade'],
      keywordMode: 'any',
    });

    expect(result.matched).toBe(true);
    expect(result.matchedKeywords).toEqual(['prioridade']);
  });

  it('reports empty configuration as a non-match', () => {
    const result = compareRecognitionText('qualquer texto', {
      expectedText: '',
      keywords: [],
      keywordMode: 'all',
    });

    expect(result.matched).toBe(false);
    expect(result.reason).toBe('config-empty');
  });
});
