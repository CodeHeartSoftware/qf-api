import { describe, expect, it } from 'vitest';
import { parseResearchQuestion } from '../../src/question/question.js';

function baseQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'question-rq-elmt-001',
    code: 'RQ-ELMT-001',
    question: 'What was the historical revenue of the Schwabmünchen metal operation?',
    status: 'open',
    createdAt: '2026-09-08T00:00:00Z',
    ...overrides,
  };
}

describe('ResearchQuestion', () => {
  it('accepts a minimal valid question', () => {
    expect(parseResearchQuestion(baseQuestion()).ok).toBe(true);
  });

  it('accepts related entity/hypothesis ids and metadata', () => {
    const raw = baseQuestion({
      relatedEntityIds: ['entity-elmt'],
      relatedHypothesisIds: ['hypothesis-h-elmt-001'],
      metadata: { category: 'financial' },
    });
    expect(parseResearchQuestion(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty question and a valid status', () => {
    expect(parseResearchQuestion(baseQuestion({ question: '' })).ok).toBe(false);
    expect(parseResearchQuestion(baseQuestion({ status: 'answered-ish' })).ok).toBe(false);
  });

  it('accepts every documented status value', () => {
    for (const status of ['open', 'answered', 'retired']) {
      expect(parseResearchQuestion(baseQuestion({ status })).ok).toBe(true);
    }
  });

  it('requires createdAt', () => {
    expect(parseResearchQuestion(baseQuestion({ createdAt: undefined })).ok).toBe(false);
  });

  it('does not require a code — it is a purely cosmetic cross-reference, not the dataset-unique id', () => {
    const withoutCode = {
      id: 'question-rq-elmt-001',
      question: 'What was the historical revenue of the Schwabmünchen metal operation?',
      status: 'open',
      createdAt: '2026-09-08T00:00:00Z',
    };
    expect(parseResearchQuestion(withoutCode).ok).toBe(true);
  });

  it('rejects unknown extra fields', () => {
    expect(parseResearchQuestion(baseQuestion({ unexpected: 'field' })).ok).toBe(false);
  });
});
