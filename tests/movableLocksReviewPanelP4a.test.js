import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MovableLocksReviewPanel from '../src/components/MovableLocksReviewPanel.vue';
import { useScheduleStore } from '../src/stores/schedule';

describe('MovableLocksReviewPanelP4a.test.js - P4a-2 ReviewPanel Buttons & Decision UI', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mockReviewData = {
    requiresUserReview: true,
    movableLockSummary: {
      enabled: true,
      moveCount: 2,
      totalMoved: 2,
      maxMovesTotal: 3,
      moveScope: 'same_day',
    },
    movedLockedLessons: [
      {
        moveId: 'move_01',
        className: '3年1班',
        subject: '語文-英語',
        lockType: 'manual_subject_lock',
        from: { day: 1, period: 2 },
        to: { day: 1, period: 4 },
        periodDistance: 2,
        totalPenalty: 1000,
        reason: 'relieved_structural_schedule_pressure',
        requiresUserReview: true,
      },
      {
        moveId: 'move_02',
        className: '3年2班',
        subject: '數學',
        lockType: 'manual_subject_lock',
        from: { day: 2, period: 3 },
        to: { day: 2, period: 5 },
        periodDistance: 2,
        totalPenalty: 1200,
        reason: 'relieved_structural_schedule_pressure',
        requiresUserReview: true,
      },
    ],
  };

  it('1. Pending row displays 待審核 badge, Accept and Reject enabled, Undo disabled/hidden', () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);

    const row0 = rows[0];
    expect(row0.text()).toContain('待審核');

    const acceptBtn = row0.find('button.btn-accept');
    const rejectBtn = row0.find('button.btn-reject');
    const undoBtn = row0.find('button.btn-undo');

    expect(acceptBtn.exists()).toBe(true);
    expect(acceptBtn.attributes('disabled')).toBeUndefined();
    expect(acceptBtn.text()).toContain('同意');

    expect(rejectBtn.exists()).toBe(true);
    expect(rejectBtn.attributes('disabled')).toBeUndefined();
    expect(rejectBtn.text()).toContain('拒絕');

    if (undoBtn.exists()) {
      expect(undoBtn.attributes('disabled')).toBeDefined();
    }
  });

  it('2. Clicking Accept calls store action acceptMovableLockMove and displays 已同意', async () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    const row0 = wrapper.findAll('tbody tr')[0];
    const acceptBtn = row0.find('button.btn-accept');

    await acceptBtn.trigger('click');

    expect(store.movableLockReviewDecisions['move_01'].decision).toBe('accepted');
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('已同意');
  });

  it('3. Clicking Reject calls store action rejectMovableLockMove and displays 已拒絕', async () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    const row1 = wrapper.findAll('tbody tr')[1];
    const rejectBtn = row1.find('button.btn-reject');

    await rejectBtn.trigger('click');

    expect(store.movableLockReviewDecisions['move_02'].decision).toBe('rejected');
    expect(wrapper.findAll('tbody tr')[1].text()).toContain('已拒絕');
  });

  it('4. Conservative semantics: accepted/rejected row has Undo enabled, Accept and Reject disabled', async () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);
    store.acceptMovableLockMove('move_01');
    store.rejectMovableLockMove('move_02');

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    const rows = wrapper.findAll('tbody tr');

    // Row 0 (accepted)
    const row0Accept = rows[0].find('button.btn-accept');
    const row0Reject = rows[0].find('button.btn-reject');
    const row0Undo = rows[0].find('button.btn-undo');

    expect(row0Accept.attributes('disabled')).toBeDefined();
    expect(row0Reject.attributes('disabled')).toBeDefined();
    expect(row0Undo.exists()).toBe(true);
    expect(row0Undo.attributes('disabled')).toBeUndefined();

    // Row 1 (rejected)
    const row1Accept = rows[1].find('button.btn-accept');
    const row1Reject = rows[1].find('button.btn-reject');
    const row1Undo = rows[1].find('button.btn-undo');

    expect(row1Accept.attributes('disabled')).toBeDefined();
    expect(row1Reject.attributes('disabled')).toBeDefined();
    expect(row1Undo.exists()).toBe(true);
    expect(row1Undo.attributes('disabled')).toBeUndefined();
  });

  it('5. Clicking Undo calls resetMovableLockMoveDecision and restores decision back to pending', async () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);
    store.acceptMovableLockMove('move_01');

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    const row0Undo = wrapper.findAll('tbody tr')[0].find('button.btn-undo');
    await row0Undo.trigger('click');

    expect(store.movableLockReviewDecisions['move_01'].decision).toBe('pending_review');
    expect(wrapper.findAll('tbody tr')[0].text()).toContain('待審核');
  });

  it('6. All accepted panel displays 「已完成所有微調審核」', () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);
    store.acceptMovableLockMove('move_01');
    store.acceptMovableLockMove('move_02');

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    expect(wrapper.text()).toContain('已完成所有微調審核');
  });

  it('7. Any rejected panel displays 「此排課結果不可直接套用」', () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);
    store.acceptMovableLockMove('move_01');
    store.rejectMovableLockMove('move_02');

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    expect(wrapper.text()).toContain('此排課結果不可直接套用');
  });

  it('8. Missing decision entry in store defaults to pending_review', () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.movableLockReviewDecisions = {}; // Empty decisions map

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    const rows = wrapper.findAll('tbody tr');
    expect(rows[0].text()).toContain('待審核');
    expect(rows[1].text()).toContain('待審核');
  });

  it('9. Component does NOT mutate movedLockedLessons item properties or from/to slots', async () => {
    const store = useScheduleStore();
    store.movableLocksReviewData = mockReviewData;
    store.initializeMovableLockReviewDecisions(mockReviewData.movedLockedLessons);

    const originalLesson = { ...mockReviewData.movedLockedLessons[0] };

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: mockReviewData },
    });

    const acceptBtn = wrapper.findAll('tbody tr')[0].find('button.btn-accept');
    await acceptBtn.trigger('click');

    expect(mockReviewData.movedLockedLessons[0].from).toEqual(originalLesson.from);
    expect(mockReviewData.movedLockedLessons[0].to).toEqual(originalLesson.to);
    expect(mockReviewData.movedLockedLessons[0].subject).toBe(originalLesson.subject);
  });

  it('10. Row actions and decision lookup use actual decision key for duplicate fallback keys without overwriting', async () => {
    const store = useScheduleStore();
    const duplicateReviewData = {
      requiresUserReview: true,
      movedLockedLessons: [
        { className: '3年1班', subject: '英語', from: { day: 1, period: 1 }, to: { day: 1, period: 2 } },
        { className: '3年1班', subject: '英語', from: { day: 1, period: 1 }, to: { day: 1, period: 2 } },
      ],
    };

    store.movableLocksReviewData = duplicateReviewData;
    store.initializeMovableLockReviewDecisions(duplicateReviewData.movedLockedLessons);

    const wrapper = mount(MovableLocksReviewPanel, {
      props: { reviewData: duplicateReviewData },
    });

    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);

    // Accept row 0
    await rows[0].find('button.btn-accept').trigger('click');

    // Reject row 1
    await rows[1].find('button.btn-reject').trigger('click');

    const updatedRows = wrapper.findAll('tbody tr');
    expect(updatedRows[0].text()).toContain('已同意');
    expect(updatedRows[1].text()).toContain('已拒絕');

    const keys = Object.keys(store.movableLockReviewDecisions);
    expect(store.movableLockReviewDecisions[keys[0]].decision).toBe('accepted');
    expect(store.movableLockReviewDecisions[keys[1]].decision).toBe('rejected');
  });
});
