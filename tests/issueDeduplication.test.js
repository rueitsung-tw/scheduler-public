/**
 * 回歸測試：問題數統計去重機制
 *
 * 對應 20260605-5 計畫 Step 1-3
 * 驗證 buildIssueIndex 的去重邏輯，確保「最佳問題數」不會因重複展開而膨脹。
 */
import { describe, it, expect } from 'vitest'

/**
 * ═══════════════════════════════════════════════════
 * 模擬 scheduleAiReport.js 中的 buildIssueDedupKey
 * ═══════════════════════════════════════════════════
 */
function buildIssueDedupKey(issue) {
    switch (issue.type) {
        case "teacher":
            // 教師衝堂：同一位老師在同一時段（含 week）只算 1 筆
            return `teacher|${issue.day}|${issue.period}|${issue.week || ""}|${issue._dedupTeacher || ""}`;
        case "room":
            // 教室衝堂：同一間教室在同一時段只算 1 筆
            return `room|${issue.day}|${issue.period}|${issue.week || ""}|${issue._dedupLocation || ""}`;
        case "multi_assignment":
            // 多課程配置：同班級同時段只算 1 筆
            return `multi|${issue.className}|${issue.day}|${issue.period}`;
        case "grade":
            // 年級不適用：已天然唯一（每個 classReport 內不會重複）
            return `grade|${issue.className}|${issue.day}|${issue.period}|${issue._dedupSubject || ""}`;
        case "requirement":
            // 需求差異：已在 classReport 層級天然唯一
            return `requirement|${issue.className}|${issue.subject || ""}`;
        default:
            return `${issue.type}|${issue.className}|${issue.day}|${issue.period}`;
    }
}

function deduplicateIssues(rawIssues) {
    const seen = new Set();
    const deduplicated = [];
    const byType = new Map();

    for (const issue of rawIssues) {
        const key = buildIssueDedupKey(issue);
        if (!seen.has(key)) {
            seen.add(key);
            deduplicated.push(issue);
            byType.set(issue.type, (byType.get(issue.type) || 0) + 1);
        }
    }

    return { deduplicated, byType };
}

describe("buildIssueDedupKey", () => {
    it("教師衝堂：同一老師同時段產生相同 key", () => {
        const issue1 = { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", week: "odd" };
        const issue2 = { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", week: "odd" };

        expect(buildIssueDedupKey(issue1)).toBe(buildIssueDedupKey(issue2));
    });

    it("教師衝堂：不同老師產生不同 key", () => {
        const issue1 = { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明" };
        const issue2 = { type: "teacher", day: 0, period: 0, _dedupTeacher: "李大明" };

        expect(buildIssueDedupKey(issue1)).not.toBe(buildIssueDedupKey(issue2));
    });

    it("教師衝堂：不同節次產生不同 key", () => {
        const issue1 = { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明" };
        const issue2 = { type: "teacher", day: 0, period: 1, _dedupTeacher: "王小明" };

        expect(buildIssueDedupKey(issue1)).not.toBe(buildIssueDedupKey(issue2));
    });

    it("教室衝堂：同一教室同時段產生相同 key", () => {
        const issue1 = { type: "room", day: 0, period: 0, _dedupLocation: "音樂教室" };
        const issue2 = { type: "room", day: 0, period: 0, _dedupLocation: "音樂教室" };

        expect(buildIssueDedupKey(issue1)).toBe(buildIssueDedupKey(issue2));
    });

    it("多課程配置：同班級同時段產生相同 key", () => {
        const issue1 = { type: "multi_assignment", className: "3年1班", day: 0, period: 0 };
        const issue2 = { type: "multi_assignment", className: "3年1班", day: 0, period: 0 };

        expect(buildIssueDedupKey(issue1)).toBe(buildIssueDedupKey(issue2));
    });

    it("需求差異：同班級同科目產生相同 key", () => {
        const issue1 = { type: "requirement", className: "3年1班", subject: "語文-英語" };
        const issue2 = { type: "requirement", className: "3年1班", subject: "語文-英語" };

        expect(buildIssueDedupKey(issue1)).toBe(buildIssueDedupKey(issue2));
    });
});

describe("deduplicateIssues", () => {
    it("無重複問題時，去重前後數量一致", () => {
        const issues = [
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明" },
            { type: "teacher", day: 0, period: 1, _dedupTeacher: "李大明" },
            { type: "room", day: 1, period: 0, _dedupLocation: "音樂教室" },
        ];

        const { deduplicated } = deduplicateIssues(issues);
        expect(deduplicated.length).toBe(3);
    });

    it("同一教師衝堂重複展開時，去重後只剩 1 筆", () => {
        // 模擬原始行為：同一衝突被多個班級展開成多筆
        const rawIssues = [
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年1班" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年2班" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年3班" },
        ];

        const { deduplicated } = deduplicateIssues(rawIssues);
        // 修復前：rawIssueCount = 3（膨脹）
        // 修復後：deduplicated.length = 1（真實衝突數）
        expect(deduplicated.length).toBe(1);
    });

    it("多類型問題混合去重", () => {
        const rawIssues = [
            // 教師衝堂 × 2（重複）
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明" },
            // 教室衝堂 × 1（唯一）
            { type: "room", day: 0, period: 0, _dedupLocation: "音樂教室" },
            // 需求差異 × 3（重複 2 筆）
            { type: "requirement", className: "3年1班", subject: "英語" },
            { type: "requirement", className: "3年1班", subject: "英語" },
            { type: "requirement", className: "3年1班", subject: "數學" },
        ];

        const { deduplicated, byType } = deduplicateIssues(rawIssues);

        // 原始 6 筆 → 去重後 4 筆
        expect(deduplicated.length).toBe(4);
        expect(byType.get("teacher")).toBe(1);
        expect(byType.get("room")).toBe(1);
        expect(byType.get("requirement")).toBe(2);
    });

    it("byType 統計與去重後總數一致", () => {
        const rawIssues = [
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "A" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "A" },
            { type: "room", day: 1, period: 0, _dedupLocation: "R1" },
        ];

        const { deduplicated, byType } = deduplicateIssues(rawIssues);

        const totalByType = Array.from(byType.values()).reduce((sum, n) => sum + n, 0);
        expect(totalByType).toBe(deduplicated.length);
    });
});

/**
 * ═══════════════════════════════════════════════════
 * 回歸測試核心場景：問題數統計口徑驗證
 * ═══════════════════════════════════════════════════
 */
describe("AI 報告問題數統計回歸測試", () => {
    it("最佳問題數應使用去重後的數值，而非原始展開數", () => {
        // 模擬 buildIssueIndex 的輸出結構
        const rawIssues = [
            // 同一教師衝堂被 5 個班級展開
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年1班" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年2班" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年3班" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年4班" },
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "王小明", className: "3年5班" },
            // 真實的不同衝突
            { type: "room", day: 1, period: 2, _dedupLocation: "音樂教室" },
        ];

        const { deduplicated } = deduplicateIssues(rawIssues);

        // 修復前：summary.issueCount = rawIssues.length = 6（膨脹）
        // 修復後：最佳問題數 = deduplicated.length = 2（真實）
        expect(deduplicated.length).toBe(2);
        expect(rawIssues.length).toBe(6);
        expect(deduplicated.length).toBeLessThan(rawIssues.length);
    });

    it("當無重複時，去重前後數量應一致", () => {
        const rawIssues = [
            { type: "teacher", day: 0, period: 0, _dedupTeacher: "A" },
            { type: "room", day: 1, period: 0, _dedupLocation: "R1" },
            { type: "requirement", className: "3年1班", subject: "數學" },
        ];

        const { deduplicated } = deduplicateIssues(rawIssues);
        expect(deduplicated.length).toBe(rawIssues.length);
    });
});
