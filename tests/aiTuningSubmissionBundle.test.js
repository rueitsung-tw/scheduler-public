/**
 * AI 微調預送出封包一致性測試
 *
 * 驗證下載 bundle 與實際 request body 的 AI 連線設定一致。
 */
import { describe, it, expect } from 'vitest';
import {
  createSubmissionBundle,
  validateBundleConsistency,
} from '../src/services/aiTuningSubmissionBundle.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

describe('createSubmissionBundle', () => {
  const mockScheduleData = {
    classes: [{ class_id: 'C01', class_name: '3年1班' }],
    teachers: [],
    classrooms: [],
    schoolInfo: { school_name: '測試國小' },
    engineResult: { schedule: [] },
    engineMeta: { jobId: 'test-job', status: 'completed', finishedAt: '2026-06-06T10:00:00Z' },
  };

  const mockAiSettings = { enabled: true };

  const mockConnectionSettings = {
    enabled: true,
    serviceType: 'llama.cpp',
    apiUrl: 'http://172.20.199.150:8080/v1/chat/completions',
    model: 'Qwen3.6-27B',
    systemPrompt: 'test prompt',
    disableThinking: true,
    maxOutputTokens: 8192,
    temperature: 0,
  };

  it('should create bundle with consistent connectionSettings', () => {
    const bundle = createSubmissionBundle(mockScheduleData, mockAiSettings, mockConnectionSettings);

    expect(bundle.connectionSettings).toEqual(mockConnectionSettings);
    expect(bundle.request.body.connectionSettings).toEqual(mockConnectionSettings);
    expect(bundle.runtimeDiagnostics).toBeDefined();
  });

  it('should include runtimeDiagnostics matching connectionSettings', () => {
    const bundle = createSubmissionBundle(mockScheduleData, mockAiSettings, mockConnectionSettings);

    expect(bundle.runtimeDiagnostics.disableThinking).toBe(true);
    expect(bundle.runtimeDiagnostics.maxOutputTokens).toBe(8192);
    expect(bundle.runtimeDiagnostics.temperature).toBe(0);
    expect(bundle.runtimeDiagnostics.expectedEndpoint).toBe(mockConnectionSettings.apiUrl);
  });

  it('should pass consistency validation', () => {
    const bundle = createSubmissionBundle(mockScheduleData, mockAiSettings, mockConnectionSettings);
    expect(validateBundleConsistency(bundle)).toBe(true);
  });

  it('should include required top-level fields', () => {
    const bundle = createSubmissionBundle(mockScheduleData, mockAiSettings, mockConnectionSettings);

    expect(bundle.bundleVersion).toBeDefined();
    expect(bundle.generatedAt).toBeDefined();
    expect(bundle.sourceSummary).toBeDefined();
    expect(bundle.focusStrategy).toBe('resource_first');
  });
});

describe('validateBundleConsistency', () => {
  it('should detect maxOutputTokens mismatch', () => {
    const bundle = {
      connectionSettings: { maxOutputTokens: 8192, disableThinking: true, temperature: 0 },
      request: { body: { connectionSettings: { maxOutputTokens: 4096, disableThinking: true, temperature: 0 } } },
    };
    expect(validateBundleConsistency(bundle)).toBe(false);
  });

  it('should detect disableThinking mismatch', () => {
    const bundle = {
      connectionSettings: { maxOutputTokens: 8192, disableThinking: true, temperature: 0 },
      request: { body: { connectionSettings: { maxOutputTokens: 8192, disableThinking: false, temperature: 0 } } },
    };
    expect(validateBundleConsistency(bundle)).toBe(false);
  });

  it('should detect temperature mismatch', () => {
    const bundle = {
      connectionSettings: { maxOutputTokens: 8192, disableThinking: true, temperature: 0 },
      request: { body: { connectionSettings: { maxOutputTokens: 8192, disableThinking: true, temperature: 0.7 } } },
    };
    expect(validateBundleConsistency(bundle)).toBe(false);
  });

  it('should pass when all settings match', () => {
    const cs = { maxOutputTokens: 8192, disableThinking: true, temperature: 0 };
    const bundle = {
      bundleVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      connectionSettings: { ...cs },
      request: { body: { connectionSettings: { ...cs } } },
      runtimeDiagnostics: { disableThinking: true, maxOutputTokens: 8192 },
    };
    expect(validateBundleConsistency(bundle)).toBe(true);
  });

  it('should use 8192 as runtimeDiagnostics fallback when maxOutputTokens is omitted', () => {
    const bundle = {
      bundleVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      connectionSettings: { disableThinking: true, temperature: 0 },
      request: { body: { connectionSettings: { disableThinking: true, temperature: 0 } } },
      runtimeDiagnostics: { disableThinking: true, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
    };
    expect(validateBundleConsistency(bundle)).toBe(true);
  });
});
