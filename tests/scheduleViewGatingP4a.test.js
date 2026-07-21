import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ScheduleView from '../src/views/ScheduleView.vue';
import { useScheduleStore } from '../src/stores/schedule';
import { createSubmissionBundle } from '../src/services/aiTuningSubmissionBundle';

// Mock vue-router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock aiTuningSubmissionBundle
vi.mock('../src/services/aiTuningSubmissionBundle', async () => {
  const actual = await vi.importActual('../src/services/aiTuningSubmissionBundle');
  return {
    ...actual,
    createSubmissionBundle: vi.fn((...args) => actual.createSubmissionBundle(...args)),
    downloadJson: vi.fn(),
  };
});

describe('ScheduleView P4a Decision-Aware Gating (tests/scheduleViewGatingP4a.test.js)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function setupCompletedEngine(store, reviewData = null) {
    store.engineStatus = 'COMPLETED';
    store.classes = [
      { name: '3年1班', grade: 3, course_requirements: [] },
    ];
    store.engineResult = {
      status: 'OPTIMAL',
      schedule: [
        { className: '3年1班', day: 1, period: 1, subject: '國語', teacher: '王老師' },
      ],
    };
    if (reviewData) {
      store.movableLocksReviewData = reviewData;
      store.syncMovableLockDecisionsWithResult(reviewData);
    } else {
      store.movableLocksReviewData = null;
      store.resetMovableLockReviewDecisions();
    }
  }

  function getApplyBtn(wrapper) {
    return wrapper.find('button.apply-btn');
  }

  function getBundleBtn(wrapper) {
    const buttons = wrapper.findAll('button.secondary-btn');
    return buttons.find((btn) => btn.text().includes('封包') || btn.text().includes('產生中…'));
  }

  it('1. Pending decisions -> apply disabled, bundle disabled, pending text & title visible', async () => {
    const store = useScheduleStore();
    setupCompletedEngine(store, {
      requiresUserReview: true,
      movedLockedLessons: [
        { moveId: 'm1', className: '3年1班', subject: '英語' },
      ],
    });

    const wrapper = mount(ScheduleView);

    const applyBtn = getApplyBtn(wrapper);
    expect(applyBtn.exists()).toBe(true);
    expect(applyBtn.attributes('disabled')).toBeDefined();
    expect(applyBtn.text()).toContain('🔒 待審核微調鎖定課（暫無法直接套用）');
    expect(applyBtn.attributes('title')).toContain('包含待審核的鎖定課微調建議，需完成審核後才能套用');

    const bundleBtn = getBundleBtn(wrapper);
    expect(bundleBtn.exists()).toBe(true);
    expect(bundleBtn.attributes('disabled')).toBeDefined();
    expect(bundleBtn.text()).toContain('🔒 待審核微調鎖定課（暫無法下載預送出封包）');
    expect(bundleBtn.attributes('title')).toContain('包含待審核的鎖定課微調建議，需完成審核後才能下載');
  });

  it('2. Rejected decision -> apply disabled, bundle disabled, rejected text & title visible', async () => {
    const store = useScheduleStore();
    setupCompletedEngine(store, {
      requiresUserReview: true,
      movedLockedLessons: [
        { moveId: 'm1', className: '3年1班', subject: '英語' },
      ],
    });
    store.rejectMovableLockMove('m1', '拒絕移位');

    const wrapper = mount(ScheduleView);

    const applyBtn = getApplyBtn(wrapper);
    expect(applyBtn.attributes('disabled')).toBeDefined();
    expect(applyBtn.text()).toContain('⛔ 微調審核已拒絕（不可直接套用）');
    expect(applyBtn.attributes('title')).toContain('包含已拒絕的鎖定課微調建議，此排課結果不可直接套用');

    const bundleBtn = getBundleBtn(wrapper);
    expect(bundleBtn.attributes('disabled')).toBeDefined();
    expect(bundleBtn.text()).toContain('⛔ 微調審核已拒絕（不可下載預送出封包）');
    expect(bundleBtn.attributes('title')).toContain('包含已拒絕的鎖定課微調建議，此排課結果不可直接下載');
  });

  it('3. All accepted -> apply enabled, bundle enabled, original labels & titles restored', async () => {
    const store = useScheduleStore();
    setupCompletedEngine(store, {
      requiresUserReview: true,
      movedLockedLessons: [
        { moveId: 'm1', className: '3年1班', subject: '英語' },
      ],
    });
    store.acceptMovableLockMove('m1');

    const wrapper = mount(ScheduleView);

    const applyBtn = getApplyBtn(wrapper);
    expect(applyBtn.attributes('disabled')).toBeUndefined();
    expect(applyBtn.text()).toBe('套用此課表並前往編輯器');
    expect(applyBtn.attributes('title') || '').toBe('');

    const bundleBtn = getBundleBtn(wrapper);
    expect(bundleBtn.attributes('disabled')).toBeUndefined();
    expect(bundleBtn.text()).toBe('下載預送出封包');
    expect(bundleBtn.attributes('title') || '').toBe('');
  });

  it('4. No moved lessons / no decisions -> apply enabled and not blocked by movable locks', async () => {
    const store = useScheduleStore();
    setupCompletedEngine(store, null);

    const wrapper = mount(ScheduleView);

    const applyBtn = getApplyBtn(wrapper);
    expect(applyBtn.attributes('disabled')).toBeUndefined();
    expect(applyBtn.text()).toBe('套用此課表並前往編輯器');

    const bundleBtn = getBundleBtn(wrapper);
    expect(bundleBtn.attributes('disabled')).toBeUndefined();
    expect(bundleBtn.text()).toBe('下載預送出封包');
  });

  it('5. isGeneratingBundle=true keeps bundle disabled even when all accepted', async () => {
    const store = useScheduleStore();
    setupCompletedEngine(store, {
      requiresUserReview: true,
      movedLockedLessons: [
        { moveId: 'm1', className: '3年1班', subject: '英語' },
      ],
    });
    store.acceptMovableLockMove('m1');

    let resolveBundlePromise;
    vi.mocked(createSubmissionBundle).mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveBundlePromise = resolve;
      });
    });

    const wrapper = mount(ScheduleView);

    // Verify store state is unblocked for bundle
    expect(store.canDownloadSubmissionBundle).toBe(true);

    const bundleBtn = getBundleBtn(wrapper);
    expect(bundleBtn.attributes('disabled')).toBeUndefined();
    expect(bundleBtn.text()).toBe('下載預送出封包');

    // Trigger bundle generation
    const clickPromise = bundleBtn.trigger('click');
    await wrapper.vm.$nextTick();

    // Button should now be disabled and display "產生中…"
    const generatingBundleBtn = getBundleBtn(wrapper);
    expect(generatingBundleBtn.attributes('disabled')).toBeDefined();
    expect(generatingBundleBtn.text()).toBe('產生中…');

    // Clean up pending promise
    if (resolveBundlePromise) {
      resolveBundlePromise({ bundleVersion: '1.0.0' });
    }
    await clickPromise;
    await wrapper.vm.$nextTick();
  });

  it('6. Component uses store computed canApplyScheduleResult directly', async () => {
    const store = useScheduleStore();
    setupCompletedEngine(store, {
      requiresUserReview: true,
      movedLockedLessons: [
        { moveId: 'm1', className: '3年1班', subject: '英語' },
      ],
    });

    const wrapper = mount(ScheduleView);
    expect(wrapper.vm.dataStore.canApplyScheduleResult).toBe(false);

    store.acceptMovableLockMove('m1');
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.dataStore.canApplyScheduleResult).toBe(true);
    expect(getApplyBtn(wrapper).attributes('disabled')).toBeUndefined();
  });
});
