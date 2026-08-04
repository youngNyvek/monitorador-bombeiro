import type { DetectionComparisonConfig, DetectionComparisonResult, KeywordMode } from '../types';

export function normalizeTextForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\r\n?/g, '\n')
    .replace(/[^\p{L}\p{N}\n]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseKeywordsInput(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((keyword) => keyword.trim())
    .map((keyword) => normalizeTextForComparison(keyword))
    .filter(Boolean)
    .filter((keyword, index, array) => array.indexOf(keyword) === index);
}

export function compareRecognitionText(
  recognizedText: string,
  config: DetectionComparisonConfig,
): DetectionComparisonResult {
  const normalizedText = normalizeTextForComparison(recognizedText);
  const normalizedExpectedText = normalizeTextForComparison(config.expectedText);
  const normalizedKeywords = config.keywords
    .map((keyword) => normalizeTextForComparison(keyword))
    .filter(Boolean)
    .filter((keyword, index, array) => array.indexOf(keyword) === index);

  const hasCriteria = normalizedExpectedText.length > 0 || normalizedKeywords.length > 0;
  if (!hasCriteria) {
    return {
      matched: false,
      mainTextMatched: false,
      matchedKeywords: [],
      missingKeywords: [],
      normalizedText,
      reason: 'config-empty',
    };
  }

  const mainTextMatched =
    normalizedExpectedText.length === 0 || normalizedText.includes(normalizedExpectedText);

  const matchedKeywords = normalizedKeywords.filter((keyword) => normalizedText.includes(keyword));

  const missingKeywords = normalizedKeywords.filter((keyword) => !normalizedText.includes(keyword));

  const keywordsMatched =
    normalizedKeywords.length === 0
      ? true
      : config.keywordMode === 'all'
        ? missingKeywords.length === 0
        : matchedKeywords.length > 0;

  const matched = mainTextMatched && keywordsMatched;

  return {
    matched,
    mainTextMatched,
    matchedKeywords,
    missingKeywords,
    normalizedText,
    reason: matched ? 'matched' : !mainTextMatched ? 'missing-main-text' : 'missing-keywords',
  };
}

export function buildComparisonConfig(expectedText: string, keywords: string[], keywordMode: KeywordMode): DetectionComparisonConfig {
  return {
    expectedText,
    keywords,
    keywordMode,
  };
}
