const ALLOWED_GTR_SOURCES = new Set([
    'job_output',
    'client_rule_check',
    'server_internal',
    'server_fallback',
    'shared_file',
    'report_file'
]);

const DEFAULT_UNKNOWN_GTR_FALLBACK = Object.freeze({
    userMessage: '目前無法辨識這項年級時段規則診斷的具體內容。',
    nextSteps: [
        '核對本次修改的年級時段規則與輸入資料；需要協助時提供原始規則代碼給維護者。'
    ]
});

function extractAuthorityMap(authorityData) {
    if (!authorityData || typeof authorityData !== 'object' || Array.isArray(authorityData)) {
        return {};
    }
    if (
        authorityData.codes &&
        typeof authorityData.codes === 'object' &&
        !Array.isArray(authorityData.codes)
    ) {
        return authorityData.codes;
    }
    return authorityData;
}

function extractPresentationsMap(presentationsData) {
    if (!presentationsData || typeof presentationsData !== 'object' || Array.isArray(presentationsData)) {
        return {};
    }
    if (
        presentationsData.presentations &&
        typeof presentationsData.presentations === 'object' &&
        !Array.isArray(presentationsData.presentations)
    ) {
        return presentationsData.presentations;
    }
    return {};
}

function extractUnknownCodeFallback(presentationsData) {
    const raw = presentationsData?.unknownCodeFallback;
    const userMessage =
        typeof raw?.userMessage === 'string' && raw.userMessage.trim() !== ''
            ? raw.userMessage.trim()
            : DEFAULT_UNKNOWN_GTR_FALLBACK.userMessage;
    const nextSteps =
        Array.isArray(raw?.nextSteps) &&
        raw.nextSteps.length > 0 &&
        raw.nextSteps.every((step) => typeof step === 'string' && step.trim() !== '')
            ? raw.nextSteps.map((step) => step.trim())
            : [...DEFAULT_UNKNOWN_GTR_FALLBACK.nextSteps];
    return { userMessage, nextSteps };
}

function normalizeSource(source) {
    if (typeof source === 'string' && ALLOWED_GTR_SOURCES.has(source)) {
        return source;
    }
    return null;
}

function normalizeIndex(index) {
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0) {
        return index;
    }
    return 0;
}

function extractGtrIssueFields(issue) {
    const evidence = [];
    const resolvedVars = {};
    let hasInvalidField = false;

    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
        return { evidence, resolvedVars, hasInvalidField: true };
    }

    // 1. ruleIds (non-empty string[])
    if (issue.ruleIds !== undefined && issue.ruleIds !== null) {
        if (Array.isArray(issue.ruleIds)) {
            const validRuleIds = [];
            let allValid = true;
            for (const item of issue.ruleIds) {
                if (typeof item === 'string' && item.trim() !== '') {
                    validRuleIds.push(item.trim());
                } else {
                    allValid = false;
                }
            }
            if (!allValid || (issue.ruleIds.length > 0 && validRuleIds.length === 0)) {
                hasInvalidField = true;
            }
            if (validRuleIds.length > 0) {
                const joined = validRuleIds.join('、');
                evidence.push(`規則：${joined}`);
                resolvedVars.ruleIds = joined;
            }
        } else {
            hasInvalidField = true;
        }
    }

    // 2. grade (finite integer; 1..6 valid grade, other finite integer shown as out-of-range raw value)
    if (issue.grade !== undefined && issue.grade !== null) {
        if (typeof issue.grade === 'number' && Number.isInteger(issue.grade)) {
            if (issue.grade >= 1 && issue.grade <= 6) {
                evidence.push(`年級：${issue.grade}年級`);
                resolvedVars.grade = `${issue.grade}年級`;
            } else {
                evidence.push(`年級數值：${issue.grade}（不在有效範圍）`);
                resolvedVars.grade = `${issue.grade}`;
            }
        } else {
            hasInvalidField = true;
        }
    }

    // 3. day (finite integer; 1..5 valid day, other finite integer shown as out-of-range raw value)
    if (issue.day !== undefined && issue.day !== null) {
        if (typeof issue.day === 'number' && Number.isInteger(issue.day)) {
            if (issue.day >= 1 && issue.day <= 5) {
                evidence.push(`星期：星期${issue.day}`);
                resolvedVars.day = `星期${issue.day}`;
            } else {
                evidence.push(`星期數值：${issue.day}（不在有效範圍）`);
                resolvedVars.day = `${issue.day}`;
            }
        } else {
            hasInvalidField = true;
        }
    }

    // 4. period (finite integer; 1..7 valid period, other finite integer shown as out-of-range raw value)
    if (issue.period !== undefined && issue.period !== null) {
        if (typeof issue.period === 'number' && Number.isInteger(issue.period)) {
            if (issue.period >= 1 && issue.period <= 7) {
                evidence.push(`節次：第${issue.period}節`);
                resolvedVars.period = `第${issue.period}節`;
            } else {
                evidence.push(`節次數值：${issue.period}（不在有效範圍）`);
                resolvedVars.period = `${issue.period}`;
            }
        } else {
            hasInvalidField = true;
        }
    }

    return { evidence, resolvedVars, hasInvalidField };
}

function resolveGtrMessageAndNextSteps(entry, resolvedVars, hasInvalidField, evidenceCount) {
    const fallbackMessage =
        typeof entry?.fallbackMessage === 'string' && entry.fallbackMessage.trim() !== ''
            ? entry.fallbackMessage.trim()
            : typeof entry?.userMessage === 'string'
                ? entry.userMessage.trim()
                : DEFAULT_UNKNOWN_GTR_FALLBACK.userMessage;
    const fallbackNextSteps =
        Array.isArray(entry?.fallbackNextSteps) &&
        entry.fallbackNextSteps.length > 0 &&
        entry.fallbackNextSteps.every((s) => typeof s === 'string' && s.trim() !== '')
            ? entry.fallbackNextSteps.map((s) => s.trim())
            : Array.isArray(entry?.nextSteps) && entry.nextSteps.length > 0
                ? entry.nextSteps.map((s) => String(s).trim())
                : [...DEFAULT_UNKNOWN_GTR_FALLBACK.nextSteps];

    if (hasInvalidField || evidenceCount === 0) {
        return {
            userMessage: fallbackMessage,
            nextSteps: fallbackNextSteps,
            usedFallback: true
        };
    }

    const rawTemplate =
        typeof entry?.userMessage === 'string' && entry.userMessage.trim() !== ''
            ? entry.userMessage.trim()
            : fallbackMessage;

    let unresolvedPlaceholder = false;
    const rendered = rawTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
        if (
            Object.prototype.hasOwnProperty.call(resolvedVars, key) &&
            typeof resolvedVars[key] === 'string' &&
            resolvedVars[key].trim() !== ''
        ) {
            return resolvedVars[key];
        }
        unresolvedPlaceholder = true;
        return '';
    });

    if (unresolvedPlaceholder || /\{[a-zA-Z0-9_]+\}/.test(rendered)) {
        return {
            userMessage: fallbackMessage,
            nextSteps: fallbackNextSteps,
            usedFallback: true
        };
    }

    const nextSteps =
        Array.isArray(entry?.nextSteps) &&
        entry.nextSteps.length > 0 &&
        entry.nextSteps.every((s) => typeof s === 'string' && s.trim() !== '')
            ? entry.nextSteps.map((s) => s.trim())
            : fallbackNextSteps;

    return {
        userMessage: rendered,
        nextSteps,
        usedFallback: false
    };
}

function resolveGtrConfidence({
    code,
    authoritySeverity,
    source,
    outputSchemaVersion,
    isJobIdentityVerified = true,
    hasInvalidField = false,
    evidenceCount = 0
}) {
    if (code === 'GRADE_TIME_RULE_MIGRATION_FAILED') {
        return 'unknown';
    }
    if (!source) {
        return 'unknown';
    }
    if (source === 'job_output') {
        if (outputSchemaVersion !== 1 || !isJobIdentityVerified) {
            return 'unknown';
        }
    }
    if (hasInvalidField && evidenceCount === 0) {
        return 'unknown';
    }
    if (source === 'report_file' || source === 'shared_file') {
        return 'possible';
    }
    if (source === 'server_fallback') {
        return 'unknown';
    }
    if (authoritySeverity === 'blocking') {
        return 'determined';
    }
    if (authoritySeverity === 'warning') {
        return 'possible';
    }
    return 'unknown';
}

export function renderGtrIssuePresentation(
    issue,
    options = {}
) {
    const {
        index = 0,
        source = 'job_output',
        isJobIdentityVerified = true,
        authorityData = null,
        presentationsData = null
    } = options || {};
    const outputSchemaVersion =
        options && Object.prototype.hasOwnProperty.call(options, 'outputSchemaVersion')
            ? options.outputSchemaVersion
            : 1;
    const normalizedIndex = normalizeIndex(index);
    const normalizedSource = normalizeSource(source);
    const authorityMap = extractAuthorityMap(authorityData);
    const presentationsMap = extractPresentationsMap(presentationsData);
    const unknownFallback = extractUnknownCodeFallback(presentationsData);

    const rawCode =
        issue && typeof issue === 'object' && typeof issue.code === 'string' && issue.code.trim() !== ''
            ? issue.code.trim()
            : '';

    const authoritySeverity = rawCode && Object.prototype.hasOwnProperty.call(authorityMap, rawCode)
        ? authorityMap[rawCode]
        : null;
    const presentationEntry = rawCode && Object.prototype.hasOwnProperty.call(presentationsMap, rawCode)
        ? presentationsMap[rawCode]
        : null;

    if (!rawCode || !authoritySeverity || !presentationEntry) {
        return {
            code: rawCode || 'UNKNOWN_GTR_ISSUE_CODE',
            severity: 'unknown',
            confidence: 'unknown',
            source: normalizedSource,
            sourceRef: {
                kind: 'unknown',
                section: 'gradeTimeRuleIssues',
                index: normalizedIndex
            },
            userMessage: unknownFallback.userMessage,
            evidence: [],
            nextSteps: [...unknownFallback.nextSteps]
        };
    }

    const { evidence, resolvedVars, hasInvalidField } = extractGtrIssueFields(issue);
    const { userMessage, nextSteps } = resolveGtrMessageAndNextSteps(
        presentationEntry,
        resolvedVars,
        hasInvalidField,
        evidence.length
    );
    const confidence = resolveGtrConfidence({
        code: rawCode,
        authoritySeverity,
        source: normalizedSource,
        outputSchemaVersion,
        isJobIdentityVerified,
        hasInvalidField,
        evidenceCount: evidence.length
    });

    return {
        code: rawCode,
        severity: authoritySeverity,
        confidence,
        source: normalizedSource,
        sourceRef: {
            kind: 'gtr_issue',
            section: 'gradeTimeRuleIssues',
            index: normalizedIndex
        },
        userMessage,
        evidence,
        nextSteps
    };
}

export function renderGtrIssuesToErrorCodes(
    issues,
    options = {}
) {
    const {
        source = 'job_output',
        isJobIdentityVerified = true,
        authorityData = null,
        presentationsData = null
    } = options || {};
    const outputSchemaVersion =
        options && Object.prototype.hasOwnProperty.call(options, 'outputSchemaVersion')
            ? options.outputSchemaVersion
            : 1;
    if (!Array.isArray(issues) || issues.length === 0) {
        return [];
    }
    return issues.map((issue, index) =>
        renderGtrIssuePresentation(issue, {
            index,
            source,
            outputSchemaVersion,
            isJobIdentityVerified,
            authorityData,
            presentationsData
        })
    );
}
