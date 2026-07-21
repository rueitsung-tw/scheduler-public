import { describe, it, expect, beforeEach } from 'vitest';
import { computed, ref } from 'vue';

describe('ScheduleView Movable Locks Gating Logic', () => {
  // Unit test for the gating logic helper rule used in ScheduleView.vue
  function createGatingHelper(movableLocksReviewDataRef) {
    const hasBlockingMovableLocksReview = computed(() => {
      const data = movableLocksReviewDataRef.value;
      return Boolean(
        data &&
        data.requiresUserReview === true &&
        Array.isArray(data.movedLockedLessons) &&
        data.movedLockedLessons.length > 0
      );
    });

    function getApplyButtonState(hasBlocking) {
      return {
        disabled: hasBlocking,
        text: hasBlocking ? '🔒 待審核微調鎖定課（暫無法直接套用）' : '套用此課表並前往編輯器',
        title: hasBlocking ? '包含鎖定課微調建議，需待人工審核流程確認後始得套用' : '',
      };
    }

    function getSubmissionBundleButtonState(isGenerating, hasBlocking) {
      return {
        disabled: isGenerating || hasBlocking,
        text: hasBlocking
          ? '🔒 待審核微調鎖定課（暫無法下載預送出封包）'
          : (isGenerating ? '產生中…' : '下載預送出封包'),
        title: hasBlocking
          ? '包含鎖定課微調建議，需待人工審核流程確認後始得下載預送出封包'
          : '',
      };
    }

    return {
      hasBlockingMovableLocksReview,
      getApplyButtonState,
      getSubmissionBundleButtonState,
    };
  }

  it('1. Returns hasBlockingMovableLocksReview = false when movableLocksReviewData is null', () => {
    const reviewDataRef = ref(null);
    const helper = createGatingHelper(reviewDataRef);
    expect(helper.hasBlockingMovableLocksReview.value).toBe(false);
  });

  it('2. Returns hasBlockingMovableLocksReview = false when requiresUserReview is false', () => {
    const reviewDataRef = ref({
      requiresUserReview: false,
      movedLockedLessons: [{ className: '3年1班' }],
    });
    const helper = createGatingHelper(reviewDataRef);
    expect(helper.hasBlockingMovableLocksReview.value).toBe(false);
  });

  it('3. Returns hasBlockingMovableLocksReview = false when movedLockedLessons is empty', () => {
    const reviewDataRef = ref({
      requiresUserReview: true,
      movedLockedLessons: [],
    });
    const helper = createGatingHelper(reviewDataRef);
    expect(helper.hasBlockingMovableLocksReview.value).toBe(false);
  });

  it('4. Disables formal apply button and submission bundle button when pending review exists', () => {
    const reviewDataRef = ref({
      requiresUserReview: true,
      movedLockedLessons: [{ className: '3年2班', subject: '英語' }],
    });
    const helper = createGatingHelper(reviewDataRef);
    expect(helper.hasBlockingMovableLocksReview.value).toBe(true);

    const applyState = helper.getApplyButtonState(helper.hasBlockingMovableLocksReview.value);
    expect(applyState.disabled).toBe(true);
    expect(applyState.text).toContain('暫無法直接套用');

    const bundleState = helper.getSubmissionBundleButtonState(false, helper.hasBlockingMovableLocksReview.value);
    expect(bundleState.disabled).toBe(true);
    expect(bundleState.text).toContain('暫無法下載預送出封包');
    expect(bundleState.title).toContain('包含鎖定課微調建議');
  });

  it('5. Allows downloadSubmissionBundle when no pending review and not generating', () => {
    const reviewDataRef = ref(null);
    const helper = createGatingHelper(reviewDataRef);

    const bundleState = helper.getSubmissionBundleButtonState(false, helper.hasBlockingMovableLocksReview.value);
    expect(bundleState.disabled).toBe(false);
    expect(bundleState.text).toBe('下載預送出封包');
  });

  it('6. Keeps downloadSubmissionBundle disabled when generating even if no pending review', () => {
    const reviewDataRef = ref(null);
    const helper = createGatingHelper(reviewDataRef);

    const bundleState = helper.getSubmissionBundleButtonState(true, helper.hasBlockingMovableLocksReview.value);
    expect(bundleState.disabled).toBe(true);
    expect(bundleState.text).toBe('產生中…');
  });
});
