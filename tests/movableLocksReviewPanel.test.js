import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MovableLocksReviewPanel from '../src/components/MovableLocksReviewPanel.vue';

describe('MovableLocksReviewPanel.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('1. Does NOT render when reviewData is missing or has no moved lessons', () => {
    const wrapper = mount(MovableLocksReviewPanel, {
      props: {
        reviewData: null,
      },
    });
    expect(wrapper.find('[data-testid="movable-locks-review-panel"]').exists()).toBe(false);
  });

  it('2. Does NOT render when requiresUserReview is false even if movedLockedLessons exists', () => {
    const wrapper = mount(MovableLocksReviewPanel, {
      props: {
        reviewData: {
          requiresUserReview: false,
          movedLockedLessons: [{ className: '3年1班', subject: '英語' }],
        },
      },
    });
    expect(wrapper.find('[data-testid="movable-locks-review-panel"]').exists()).toBe(false);
  });

  it('3. Renders panel and displays className, subject, period from-to when valid moved lessons exist', () => {
    const mockReviewData = {
      requiresUserReview: true,
      movableLockSummary: {
        enabled: true,
        moveCount: 1,
        totalMoved: 1,
        maxMovesTotal: 3,
        moveScope: 'same_day',
      },
      movedLockedLessons: [
        {
          className: '3年2班',
          subject: '語文-英語',
          lockType: 'manual_subject_lock',
          from: { day: 2, period: 3 },
          to: { day: 2, period: 4 },
          moveScope: 'same_day',
          periodDistance: 1,
          totalPenalty: 11000,
          reason: 'relieved_structural_schedule_pressure',
          requiresUserReview: true,
        },
      ],
    };

    const wrapper = mount(MovableLocksReviewPanel, {
      props: {
        reviewData: mockReviewData,
      },
    });

    expect(wrapper.find('[data-testid="movable-locks-review-panel"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('鎖定課微調審核');
    expect(wrapper.text()).toContain('3年2班');
    expect(wrapper.text()).toContain('語文-英語');
    expect(wrapper.text()).toContain('星期二 第 3 節');
    expect(wrapper.text()).toContain('星期二 第 4 節');
  });

  it('4. Renders blocking warning text prominently', () => {
    const mockReviewData = {
      requiresUserReview: true,
      movedLockedLessons: [
        { className: '4年1班', subject: '體育' },
      ],
    };

    const wrapper = mount(MovableLocksReviewPanel, {
      props: {
        reviewData: mockReviewData,
      },
    });

    const warningBox = wrapper.find('.blocking-warning-box');
    expect(warningBox.exists()).toBe(true);
    expect(warningBox.text()).toContain('系統提出了鎖定課微調建議，需人工審核後才能視為正式安排');
    expect(warningBox.text()).toContain('在進行人工審核確認前，不可將此結果視為正式排課版本');
  });

  it('5. Handles missing optional fields gracefully without crashing and displays fallbacks', () => {
    const mockSparseReviewData = {
      requiresUserReview: true,
      movedLockedLessons: [
        {
          // All fields omitted or empty
        },
      ],
    };

    const wrapper = mount(MovableLocksReviewPanel, {
      props: {
        reviewData: mockSparseReviewData,
      },
    });

    expect(wrapper.find('[data-testid="movable-locks-review-panel"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('未提供');
  });
});
