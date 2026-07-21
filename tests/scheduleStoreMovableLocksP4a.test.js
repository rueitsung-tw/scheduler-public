import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useScheduleStore } from '../src/stores/schedule';

describe('Movable Locks P4a - Store Decisions & Gating Implementation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('P4A-01: Default state has empty movableLockReviewDecisions and clean computed flags', () => {
    const store = useScheduleStore();
    
    expect(store.movableLockReviewDecisions).toEqual({});
    expect(store.movableLockDecisionSummary).toEqual({
      totalCount: 0,
      pendingCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      invalidCount: 0,
    });
    expect(store.hasPendingMovableLockReviews).toBe(false);
    expect(store.hasRejectedMovableLockReviews).toBe(false);
    expect(store.areAllMovableLockReviewsAccepted).toBe(false);
    expect(store.canApplyScheduleResult).toBe(true);
    expect(store.canDownloadSubmissionBundle).toBe(true);
  });

  it('P4A-02: initializeMovableLockReviewDecisions creates pending_review decisions', () => {
    const store = useScheduleStore();
    const movedLessons = [
      { moveId: 'm1', className: '3年1班', subject: '英語', from: { day: 1, period: 2 }, to: { day: 1, period: 4 } },
      { moveId: 'm2', className: '3年2班', subject: '數學', from: { day: 2, period: 3 }, to: { day: 2, period: 5 } },
    ];

    store.initializeMovableLockReviewDecisions(movedLessons);

    expect(Object.keys(store.movableLockReviewDecisions)).toHaveLength(2);
    expect(store.movableLockReviewDecisions['m1']).toMatchObject({
      decision: 'pending_review',
      reviewedAt: null,
      reviewer: null,
      comment: '',
      originalMove: movedLessons[0],
    });
    expect(store.movableLockReviewDecisions['m2']).toMatchObject({
      decision: 'pending_review',
      reviewedAt: null,
      reviewer: null,
      comment: '',
      originalMove: movedLessons[1],
    });

    expect(store.movableLockDecisionSummary).toEqual({
      totalCount: 2,
      pendingCount: 2,
      acceptedCount: 0,
      rejectedCount: 0,
      invalidCount: 0,
    });
    expect(store.hasPendingMovableLockReviews).toBe(true);
    expect(store.canApplyScheduleResult).toBe(false);
    expect(store.canDownloadSubmissionBundle).toBe(false);
  });

  it('P4A-03: getMovableLockMoveKey prioritizes moveId and falls back to deterministic composite key', () => {
    const store = useScheduleStore();

    // Priority 1: moveId
    const keyWithId = store.getMovableLockMoveKey({ moveId: 'custom_id_123' });
    expect(keyWithId).toBe('custom_id_123');

    // Priority 2: composite key
    const keyComposite = store.getMovableLockMoveKey({
      className: '5年3班',
      subject: '自然與生活科技',
      lockType: 'manual_subject_lock',
      from: { day: 3, period: 1 },
      to: { day: 3, period: 3 },
    });
    expect(keyComposite).toBe('5年3班|自然與生活科技|manual_subject_lock|d3p1_to_d3p3');

    // Priority 3: fallback with sparse/missing fields without crashing
    const keySparse = store.getMovableLockMoveKey({}, 5);
    expect(keySparse).toBe('anon_class|anon_subject|manual|slot_null_to_slot_null');
  });

  it('P4A-04: acceptMovableLockMove updates decision, timestamp, and comment', () => {
    const store = useScheduleStore();
    const movedLessons = [{ moveId: 'm1', className: '3年1班', subject: '英語' }];

    store.initializeMovableLockReviewDecisions(movedLessons);
    store.acceptMovableLockMove('m1', '同意微調');

    const decisionObj = store.movableLockReviewDecisions['m1'];
    expect(decisionObj.decision).toBe('accepted');
    expect(decisionObj.comment).toBe('同意微調');
    expect(typeof decisionObj.reviewedAt).toBe('string');
    expect(new Date(decisionObj.reviewedAt).getTime()).not.toBeNaN();

    expect(store.movableLockDecisionSummary.acceptedCount).toBe(1);
    expect(store.movableLockDecisionSummary.pendingCount).toBe(0);
    expect(store.areAllMovableLockReviewsAccepted).toBe(true);
    expect(store.canApplyScheduleResult).toBe(true);
    expect(store.canDownloadSubmissionBundle).toBe(true);
  });

  it('P4A-05: rejectMovableLockMove updates decision, timestamp, and keeps gating blocked', () => {
    const store = useScheduleStore();
    const movedLessons = [
      { moveId: 'm1', className: '3年1班', subject: '英語' },
      { moveId: 'm2', className: '3年2班', subject: '數學' },
    ];

    store.initializeMovableLockReviewDecisions(movedLessons);
    store.acceptMovableLockMove('m1');
    store.rejectMovableLockMove('m2', '不同意移至下午');

    const m2Decision = store.movableLockReviewDecisions['m2'];
    expect(m2Decision.decision).toBe('rejected');
    expect(m2Decision.comment).toBe('不同意移至下午');
    expect(typeof m2Decision.reviewedAt).toBe('string');

    expect(store.movableLockDecisionSummary).toEqual({
      totalCount: 2,
      pendingCount: 0,
      acceptedCount: 1,
      rejectedCount: 1,
      invalidCount: 0,
    });
    expect(store.hasRejectedMovableLockReviews).toBe(true);
    expect(store.areAllMovableLockReviewsAccepted).toBe(false);
    expect(store.canApplyScheduleResult).toBe(false);
    expect(store.canDownloadSubmissionBundle).toBe(false);
  });

  it('P4A-06: acceptMovableLockMove and rejectMovableLockMove are no-op when key is unknown', () => {
    const store = useScheduleStore();
    
    expect(() => {
      store.acceptMovableLockMove('non_existent_key');
      store.rejectMovableLockMove('non_existent_key');
    }).not.toThrow();

    expect(store.movableLockReviewDecisions).toEqual({});
  });

  it('P4A-07: resetMovableLockReviewDecisions clears all decisions and restores gating when no reviewData exists', () => {
    const store = useScheduleStore();
    store.initializeMovableLockReviewDecisions([{ moveId: 'm1', className: '1年1班' }]);
    expect(store.canApplyScheduleResult).toBe(false);

    store.resetMovableLockReviewDecisions();

    expect(store.movableLockReviewDecisions).toEqual({});
    expect(store.canApplyScheduleResult).toBe(true);
    expect(store.canDownloadSubmissionBundle).toBe(true);
  });

  it('P4A-08: resetAllData clears movableLockReviewDecisions and reviewData', () => {
    const store = useScheduleStore();
    store.initializeMovableLockReviewDecisions([{ moveId: 'm1', className: '1年1班' }]);

    store.resetAllData();

    expect(store.movableLockReviewDecisions).toEqual({});
    expect(store.canApplyScheduleResult).toBe(true);
  });

  it('P4A-09: syncMovableLockDecisionsWithResult builds or clears decisions correctly', () => {
    const store = useScheduleStore();

    // Sync 1: Result requiring review
    const validResult = {
      requiresUserReview: true,
      movedLockedLessons: [{ moveId: 'm1', className: '2年1班' }],
    };
    store.syncMovableLockDecisionsWithResult(validResult);
    expect(store.movableLockReviewDecisions['m1']).toBeDefined();
    expect(store.canApplyScheduleResult).toBe(false);

    // Sync 2: Result without user review requirements
    const emptyResult = {
      requiresUserReview: false,
      movedLockedLessons: [],
    };
    store.syncMovableLockDecisionsWithResult(emptyResult);
    expect(store.movableLockReviewDecisions).toEqual({});
    expect(store.canApplyScheduleResult).toBe(true);
  });

  it('P4A-10: Result processing during runSmartEngine initializes decisions and invalidates old ones', async () => {
    const store = useScheduleStore();
    
    let mockResult = {
      schedule: [{}],
      requiresUserReview: true,
      movedLockedLessons: [{ moveId: 'run1_move' }],
    };

    vi.stubGlobal('fetch', async (url, options) => {
      if (url.includes('/schedule') && options?.method === 'POST') {
        return { ok: true, json: async () => ({ jobId: 'fake-job' }) };
      }
      if (url.includes('/schedule/fake-job')) {
        return {
          ok: true,
          json: async () => ({
            status: 'COMPLETED',
            result: mockResult,
          }),
        };
      }
      if (url.endsWith('/schedule') && (!options || options.method === 'GET')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Run 1
    await store.runSmartEngine({});
    expect(store.movableLockReviewDecisions['run1_move']).toBeDefined();
    expect(store.canApplyScheduleResult).toBe(false);

    // Run 2 with new result -> old decisions invalidated
    mockResult = {
      schedule: [{}],
      requiresUserReview: true,
      movedLockedLessons: [{ moveId: 'run2_move' }],
    };
    await store.runSmartEngine({});
    expect(store.movableLockReviewDecisions['run1_move']).toBeUndefined();
    expect(store.movableLockReviewDecisions['run2_move']).toBeDefined();
    expect(store.movableLockReviewDecisions['run2_move'].decision).toBe('pending_review');
  });

  it('P4A-11: movableLocksReviewData requires review but decisions are empty/reset -> MUST still block', () => {
    const store = useScheduleStore();
    
    store.movableLocksReviewData = {
      requiresUserReview: true,
      movedLockedLessons: [{ moveId: 'm1', className: '3年1班' }],
    };

    // Force decisions to be empty
    store.resetMovableLockReviewDecisions();

    expect(store.hasPendingMovableLockReviews).toBe(true);
    expect(store.areAllMovableLockReviewsAccepted).toBe(false);
    expect(store.canApplyScheduleResult).toBe(false);
    expect(store.canDownloadSubmissionBundle).toBe(false);
  });

  it('P4A-12: movedLockedLessons count vs decisions count mismatch -> MUST still block', () => {
    const store = useScheduleStore();
    
    store.movableLocksReviewData = {
      requiresUserReview: true,
      movedLockedLessons: [
        { moveId: 'm1', className: '3年1班' },
        { moveId: 'm2', className: '3年2班' },
      ],
    };

    // Only 1 decision exists and it is accepted
    store.movableLockReviewDecisions = {
      m1: {
        moveKey: 'm1',
        decision: 'accepted',
        reviewedAt: '2026-07-20T00:00:00.000Z',
        reviewer: null,
        comment: '',
        originalMove: { moveId: 'm1' },
      },
    };

    expect(store.hasPendingMovableLockReviews).toBe(true);
    expect(store.areAllMovableLockReviewsAccepted).toBe(false);
    expect(store.canApplyScheduleResult).toBe(false);
    expect(store.canDownloadSubmissionBundle).toBe(false);
  });

  it('P4A-13: duplicate fallback key creates unique keys with collision suffix and initializes both without overwriting', () => {
    const store = useScheduleStore();
    
    // Two sparse items that generate identical base fallback key
    const duplicateMovedLessons = [
      { className: '3年1班', subject: '英語' },
      { className: '3年1班', subject: '英語' },
    ];

    store.initializeMovableLockReviewDecisions(duplicateMovedLessons);

    const keys = Object.keys(store.movableLockReviewDecisions);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toEqual(keys[1]);
    expect(keys[1]).toContain('#1');

    expect(store.movableLockDecisionSummary.totalCount).toBe(2);
    expect(store.movableLockDecisionSummary.pendingCount).toBe(2);
  });

  it('P4A-14: getMovableLockDecisionKeyForMove returns baseKey#N for collision and moveId for moveId', () => {
    const store = useScheduleStore();
    
    const duplicateMovedLessons = [
      { className: '3年1班', subject: '英語' },
      { className: '3年1班', subject: '英語' },
      { moveId: 'unique_m1', className: '3年2班', subject: '數學' },
    ];

    store.initializeMovableLockReviewDecisions(duplicateMovedLessons);

    const key0 = store.getMovableLockDecisionKeyForMove(duplicateMovedLessons[0], 0);
    const key1 = store.getMovableLockDecisionKeyForMove(duplicateMovedLessons[1], 1);
    const key2 = store.getMovableLockDecisionKeyForMove(duplicateMovedLessons[2], 2);

    expect(key0).not.toContain('#');
    expect(key1).toContain('#1');
    expect(key2).toBe('unique_m1');
  });
});
