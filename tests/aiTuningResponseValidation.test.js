/**
 * AI 回應驗證純函式單元測試
 *
 * 覆蓋：空 content、截斷、invalid JSON、合法/非法 candidateId、部分合法降級
 */
import { describe, it, expect } from 'vitest';
import {
  extractAssistantPayload,
  parseAiJsonContent,
  buildCandidateMoveIndex,
  getReportCandidateIds,
  validateAiCandidateSelections,
  validateCandidatePoolConsistency,
  buildAiErrorDetails,
} from '../src/services/aiTuningResponseValidation.js';

describe('extractAssistantPayload', () => {
  it('should extract from standard OpenAI message structure', () => {
    const data = {
      choices: [
        {
          message: {
            content: '{"summary":{"text":"test"}}',
            reasoning_content: 'thinking...',
          },
          finish_reason: 'stop',
        },
      ],
    };
    const result = extractAssistantPayload(data);
    expect(result.content).toBe('{"summary":{"text":"test"}}');
    expect(result.reasoningContent).toBe('thinking...');
    expect(result.finishReason).toBe('stop');
  });

  it('should handle empty content', () => {
    const data = {
      choices: [
        {
          message: { content: '', reasoning_content: 'very long reasoning' },
          finish_reason: 'length',
        },
      ],
    };
    const result = extractAssistantPayload(data);
    expect(result.content).toBe('');
    expect(result.reasoningContent).toBe('very long reasoning');
    expect(result.finishReason).toBe('length');
  });

  it('should fallback to alternative fields', () => {
    const data = { message: 'fallback text' };
    const result = extractAssistantPayload(data);
    expect(result.content).toBe('fallback text');
    expect(result.reasoningContent).toBe('');
    expect(result.finishReason).toBe('');
  });

  it('should handle null/undefined input', () => {
    expect(extractAssistantPayload(null).content).toBe('');
    expect(extractAssistantPayload(undefined).content).toBe('');
    expect(extractAssistantPayload({}).content).toBe('');
  });
});

describe('parseAiJsonContent', () => {
  it('should parse valid JSON string', () => {
    const json = '{"summary":{"text":"test"},"selectedMoves":[]}';
    const result = parseAiJsonContent(json);
    expect(result.ok).toBe(true);
    expect(result.value.summary.text).toBe('test');
  });

  it('should return error for empty content', () => {
    const result = parseAiJsonContent('');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AI_UPSTREAM_OUTPUT_EMPTY');
  });

  it('should return error for invalid JSON', () => {
    const result = parseAiJsonContent('{invalid json}');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AI_UPSTREAM_INVALID_JSON');
    expect(result.preview).toBeDefined();
  });

  it('should handle whitespace-only content', () => {
    const result = parseAiJsonContent('   \n\n  ');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AI_UPSTREAM_OUTPUT_EMPTY');
  });

  it('should trim whitespace before parsing', () => {
    const json = '  {"key": "value"}  ';
    const result = parseAiJsonContent(json);
    expect(result.ok).toBe(true);
    expect(result.value.key).toBe('value');
  });
});

describe('buildCandidateMoveIndex', () => {
  it('should build index from candidateMoves array', () => {
    const report = {
      candidateMoves: [
        { candidateId: 'M-000001', className: '3年1班' },
        { candidateId: 'M-000002', className: '3年2班' },
        { candidateId: 'M-000003', className: '4年1班' },
      ],
    };
    const { byId } = buildCandidateMoveIndex(report);
    expect(byId.size).toBe(3);
    expect(byId.get('M-000001').className).toBe('3年1班');
  });

  it('should skip entries without candidateId', () => {
    const report = {
      candidateMoves: [
        { candidateId: 'M-000001' },
        { candidateId: '' },
        { candidateId: null },
        { className: 'no-id-class' },
      ],
    };
    const { byId } = buildCandidateMoveIndex(report);
    expect(byId.size).toBe(1);
    expect(byId.has('M-000001')).toBe(true);
  });

  it('should handle missing candidateMoves', () => {
    const { byId } = buildCandidateMoveIndex({});
    expect(byId.size).toBe(0);
  });
});

describe('validateAiCandidateSelections', () => {
  const validReport = {
    candidateMoves: [
      { candidateId: 'M-000001', className: '3年1班', from: { day: 1, period: 2 }, to: { day: 2, period: 3 } },
      { candidateId: 'M-000002', className: '3年2班', from: { day: 1, period: 3 }, to: { day: 3, period: 1 } },
      { candidateId: 'M-000003', className: '4年1班', from: { day: 2, period: 1 }, to: { day: 2, period: 4 } },
    ],
  };

  it('should validate all legal candidateIds', () => {
    const selectedMoves = [
      { candidateId: 'M-000001', reason: 'test' },
      { candidateId: 'M-000002', reason: 'test' },
    ];
    const result = validateAiCandidateSelections(validReport, selectedMoves);
    expect(result.ok).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.validMoves.length).toBe(2);
  });

  it('should reject all invalid candidateIds', () => {
    const selectedMoves = [
      { candidateId: 'CAND-001', reason: 'hallucination' },
      { candidateId: 'M-999999', reason: 'invented' },
    ];
    const result = validateAiCandidateSelections(validReport, selectedMoves);
    expect(result.ok).toBe(false);
    expect(result.shouldFail).toBe(true);
    expect(result.errors.length).toBe(2);
    expect(result.validMoves.length).toBe(0);
  });

  it('should allow partial valid moves when allowPartial is true', () => {
    const selectedMoves = [
      { candidateId: 'M-000001', reason: 'valid' },
      { candidateId: 'CAND-001', reason: 'invalid' },
      { candidateId: 'M-999999', reason: 'invalid' },
    ];
    const result = validateAiCandidateSelections(validReport, selectedMoves, { allowPartial: true });
    expect(result.ok).toBe(true);
    expect(result.validMoves.length).toBe(1);
    expect(result.errors.length).toBe(2);
    expect(result.warning).toContain('已忽略 2 筆');
  });

  it('should reject partial moves when allowPartial is false', () => {
    const selectedMoves = [
      { candidateId: 'M-000001', reason: 'valid' },
      { candidateId: 'CAND-001', reason: 'invalid' },
    ];
    const result = validateAiCandidateSelections(validReport, selectedMoves, { allowPartial: false });
    expect(result.ok).toBe(false);
  });

  it('should skip duplicate candidateIds', () => {
    const selectedMoves = [
      { candidateId: 'M-000001', reason: 'first' },
      { candidateId: 'M-000001', reason: 'duplicate' },
    ];
    const result = validateAiCandidateSelections(validReport, selectedMoves);
    expect(result.validMoves.length).toBe(1);
  });

  it('should handle missing candidateId in move', () => {
    const selectedMoves = [
      { reason: 'no id' },
      { candidateId: '', reason: 'empty id' },
      { candidateId: 'M-000001', reason: 'valid' },
    ];
    const result = validateAiCandidateSelections(validReport, selectedMoves);
    expect(result.errors.length).toBe(2);
    expect(result.validMoves.length).toBe(1);
  });

  it('should include invalidIds and legalIds in result', () => {
    const selectedMoves = [
      { candidateId: 'M-000001' },
      { candidateId: 'INVALID-001' },
    ];
    const result = validateAiCandidateSelections(validReport, selectedMoves);
    expect(result.invalidIds).toContain('INVALID-001');
    expect(result.legalIds).toContain('M-000001');
    expect(result.legalIds).toContain('M-000002');
    expect(result.legalIds).toContain('M-000003');
  });

  it('should handle empty selectedMoves', () => {
    const result = validateAiCandidateSelections(validReport, []);
    expect(result.ok).toBe(true);
    expect(result.validMoves.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });
});

describe('getReportCandidateIds', () => {
  it('should return all candidateIds from report', () => {
    const report = {
      candidateMoves: [
        { candidateId: 'M-001' },
        { candidateId: 'M-002' },
        { candidateId: 'M-003' },
      ],
    };
    expect(getReportCandidateIds(report)).toEqual(['M-001', 'M-002', 'M-003']);
  });

  it('should return empty array for missing candidateMoves', () => {
    expect(getReportCandidateIds({})).toEqual([]);
    expect(getReportCandidateIds(null)).toEqual([]);
  });

  it('should skip entries without candidateId', () => {
    const report = {
      candidateMoves: [
        { candidateId: 'M-001' },
        { candidateId: '' },
        { className: 'no-id' },
      ],
    };
    expect(getReportCandidateIds(report)).toEqual(['M-001']);
  });
});

describe('validateCandidatePoolConsistency', () => {
  it('should pass when prompt IDs are all in validation pool', () => {
    const report = {
      candidateMoves: [
        { candidateId: 'M-001' },
        { candidateId: 'M-002' },
        { candidateId: 'M-003' },
      ],
    };
    const result = validateCandidatePoolConsistency(['M-001', 'M-002'], report);
    expect(result.ok).toBe(true);
    expect(result.missingInValidation).toEqual([]);
    expect(result.overlapCount).toBe(2);
    expect(result.promptCount).toBe(2);
    expect(result.validationCount).toBe(3);
  });

  it('should fail when prompt IDs are not in validation pool', () => {
    const report = {
      candidateMoves: [
        { candidateId: 'M-001' },
        { candidateId: 'M-002' },
      ],
    };
    const result = validateCandidatePoolConsistency(['M-001', 'CAND-999'], report);
    expect(result.ok).toBe(false);
    expect(result.missingInValidation).toEqual(['CAND-999']);
    expect(result.overlapCount).toBe(1);
  });

  it('should handle empty prompt IDs', () => {
    const report = {
      candidateMoves: [{ candidateId: 'M-001' }],
    };
    const result = validateCandidatePoolConsistency([], report);
    expect(result.ok).toBe(true);
    expect(result.missingInValidation).toEqual([]);
    expect(result.extraInValidation).toEqual(['M-001']);
  });

  it('should handle empty validation pool', () => {
    const report = {};
    const result = validateCandidatePoolConsistency(['M-001'], report);
    expect(result.ok).toBe(false);
    expect(result.missingInValidation).toEqual(['M-001']);
    expect(result.extraInValidation).toEqual([]);
  });

  it('should handle null/undefined inputs', () => {
    const result = validateCandidatePoolConsistency(null, {});
    expect(result.ok).toBe(true);
    expect(result.promptCount).toBe(0);
  });
});

describe('buildAiErrorDetails', () => {
  it('should include selectedMoves, prompt legal ids, validation legal ids, and overlap', () => {
    const details = buildAiErrorDetails({
      content: '{"selectedMoves":[{"candidateId":"CAND-001"}]}',
      reasoningContent: 'reasoning',
      finishReason: 'stop',
      selectedMoves: [{ candidateId: 'CAND-001', reason: 'invented id' }],
      invalidIds: ['CAND-001'],
      promptLegalIds: ['M-000001', 'M-000002'],
      legalIds: ['M-000001', 'M-000002', 'M-000003'],
      extraInfo: 'candidate validation failed',
    });

    expect(details).toContain('AI selectedMoves:');
    expect(details).toContain('CAND-001');
    expect(details).toContain('prompt合法候選(2): M-000001, M-000002');
    expect(details).toContain('驗證合法候選(3): M-000001, M-000002, M-000003');
    expect(details).toContain('prompt/驗證候選交集: 2/2');
    expect(details).toContain('candidate validation failed');
  });
});
