import DEFAULT_ERROR_CODES_INDEX from '../../contracts/scheduler_error_codes.json' with { type: 'json' };

export const PARSER_CATEGORIES = Object.freeze([
    'class_overload',
    'period_shortage',
    'room_capacity_shortage',
    'alternating_conflict',
    'swimming_resource_pressure',
    'generic_infeasible',
    'generic_warning',
    'report_alert',
]);

export const LOCATABLE_WARNING_CODES = Object.freeze([
    'SCHE_WARN_CLASS_PERIOD_OVERLOAD',
    'SCHE_WARN_PERIOD_SHORTAGE',
    'SCHE_WARN_ROOM_CAPACITY_SHORTAGE',
    'SCHE_WARN_TEACHER_LOAD_PRESSURE',
    'SCHE_WARN_TEACHER_QUOTA_EXCEEDED',
    'SCHE_WARN_ALTERNATING_LOAD_PRESSURE',
    'SCHE_WARN_SWIMMING_PRESSURE',
    'SCHE_WARN_HOMEROOM_TRACE_MISMATCH',
]);

const WARNING_FIELD_SCHEMAS = Object.freeze({
    SCHE_WARN_CLASS_PERIOD_OVERLOAD: Object.freeze({
        className: 'string',
        needed: 'number',
        limit: 'number',
        label: 'string',
    }),
    SCHE_WARN_PERIOD_SHORTAGE: Object.freeze({
        className: 'string',
        needed: 'number',
        available: 'number',
    }),
    SCHE_WARN_ROOM_CAPACITY_SHORTAGE: Object.freeze({
        subject: 'string',
        roomCount: 'number',
        weeklyCapacity: 'number',
        needed: 'number',
    }),
    SCHE_WARN_TEACHER_LOAD_PRESSURE: Object.freeze({
        teacher: 'string',
        load: 'number',
    }),
    SCHE_WARN_TEACHER_QUOTA_EXCEEDED: Object.freeze({
        teacher: 'string',
        actual: 'number',
        safeMax: 'number',
    }),
    SCHE_WARN_ALTERNATING_LOAD_PRESSURE: Object.freeze({
        teacher: 'string',
        classCount: 'number',
        classNames: 'string[]',
    }),
    SCHE_WARN_SWIMMING_PRESSURE: Object.freeze({
        classCount: 'number',
        poolCount: 'number',
    }),
    SCHE_WARN_HOMEROOM_TRACE_MISMATCH: Object.freeze({
        className: 'string',
        blockCandidatePeriods: 'number',
        mergedPeriods: 'number',
        existingHomeroomBlockPeriods: 'number',
        finalHomeroomBlockPeriods: 'number',
    }),
    SCHE_WARN_UNCLASSIFIED: Object.freeze({}),
});

const STRICT_FINITE_NUMBER_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

const ALTERNATING_INFO_LINE_REGEX = /^-\s*\[INFO\]\s*([^:]+):\s*負責\s*(\S+)\s*個交替班級\s*\(([^()]+)\)；此為總量提示，不代表同一時段衝突。$/;
const SWIMMING_INFO_LINE_REGEX = /^\[INFO\]\s*游泳班數\((\S+)\)\s*>\s*泳池數\((\S+)\)，屬於總量壓力提示，不直接代表同一時段無解。$/;
const CURRENT_CLASS_OVERLOAD_REGEX = /^-\s*([^:]+):\s*共需排\s*(\S+)\s*節課\s*\(正式可用上限:\s*(\S+)\s*節,\s*([^()]+?)\)\s*\[ERROR\](?:\s*.*)?$/i;
const PERIOD_SHORTAGE_REGEX = /^-\s*([^:]+):\s*科任需求\s*(\S+)\s*節\s*\/\s*有效時段\s*(\S+)\s*節\s*\[(WARN|ERROR)\](?:\s*.*)?$/i;
const ROOM_CAPACITY_SHORTAGE_REGEX = /^-\s*([^:]+):\s*容量\s*(\S+)\s*間\s*\(週容量=?\s*(\S+?)節\)\s*\/\s*總需求\s*(\S+)\s*節\s*\[(WARN|ERROR)\](?:\s*.*)?$/i;
const TEACHER_LOAD_WARN_REGEX = /^\[WARN\]\s*警告：該教師超鐘點過多，可能導致空堂不足！$/i;
const TEACHER_LOAD_CONTEXT_REGEX = /^-\s*([^:]+):\s*被分配了\s*(\S+)\s*節課$/;
const TEACHER_QUOTA_WARN_REGEX = /^-\s*([^:]+):\s*需求\s*(\S+)\s*節\s*\/\s*配額\s*(\S+)\s*節\s*\[WARN\](?:\s*.*)?$/i;
const HOMEROOM_TRACE_WARN_REGEX = /^-\s*([^:]+):\s*前端\s*block\s*候選\s*(\S+)\s*節\s*\/\s*preprocess\s*合併\s*(\S+)\s*節\s*\/\s*現成導師區塊\s*(\S+)\s*節\s*\/\s*最終導師區塊\s*(\S+)\s*節\s*\[WARN\](?:\s*.*)?$/i;

function getCodeMap(errorCodesIndex = DEFAULT_ERROR_CODES_INDEX) {
    const entries = Array.isArray(errorCodesIndex?.codes) ? errorCodesIndex.codes : [];
    return new Map(entries.map((entry) => [entry.code, entry]));
}

export function normalizeDiagnosticReportLine(line) {
    return String(line || '').replace(/\r/g, '').trim();
}

export function extractDiagnosticSectionKey(line) {
    const normalized = normalizeDiagnosticReportLine(line);
    const match = normalized.match(/^\[DEBUG\]\s*([1-8])\.\s*/);
    return match ? match[1] : null;
}

export function normalizeSectionKey(section) {
    if (section === null || section === undefined || section === '') return null;
    const str = String(section).trim();
    return /^[1-8]$/.test(str) ? str : null;
}

export function normalizeDiagnosticSourceRef(sourceRef) {
    if (!sourceRef || typeof sourceRef !== 'object') return null;
    const index = sourceRef.index;
    if (!Number.isInteger(index) || index < 0) return null;
    return {
        kind: 'report_line',
        section: normalizeSectionKey(sourceRef.section),
        index,
    };
}

export function parseStrictFiniteNumberToken(token) {
    if (typeof token === 'number') {
        return Number.isFinite(token) ? token : null;
    }
    if (typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed || !STRICT_FINITE_NUMBER_TOKEN.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

export function parseStrictNonNegativeIntegerToken(token) {
    const parsed = parseStrictFiniteNumberToken(token);
    if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return null;
    return parsed;
}

export function sanitizeParsedFieldsForCode(code, fields) {
    const schema = WARNING_FIELD_SCHEMAS[code];
    if (!schema) return null;
    const keys = Object.keys(schema);
    if (keys.length === 0) {
        return {};
    }
    if (!fields || typeof fields !== 'object') return null;
    const sanitized = {};
    for (const key of keys) {
        const expectedType = schema[key];
        const rawValue = fields[key];
        if (expectedType === 'string') {
            if (typeof rawValue !== 'string') return null;
            const trimmed = normalizeDiagnosticReportLine(rawValue);
            if (!trimmed) return null;
            sanitized[key] = trimmed;
        } else if (expectedType === 'number') {
            const num = parseStrictFiniteNumberToken(rawValue);
            if (num === null) return null;
            sanitized[key] = num;
        } else if (expectedType === 'string[]') {
            if (!Array.isArray(rawValue) || rawValue.length === 0) return null;
            const items = [];
            for (const item of rawValue) {
                if (typeof item !== 'string') return null;
                const trimmed = normalizeDiagnosticReportLine(item);
                if (!trimmed) return null;
                items.push(trimmed);
            }
            sanitized[key] = items;
        } else {
            return null;
        }
    }
    return sanitized;
}

function formatTemplateValue(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : null;
    }
    if (typeof value === 'string') {
        const trimmed = normalizeDiagnosticReportLine(value);
        return trimmed ? trimmed : null;
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return null;
        const items = [];
        for (const item of value) {
            if (typeof item !== 'string') return null;
            const trimmed = normalizeDiagnosticReportLine(item);
            if (!trimmed) return null;
            items.push(trimmed);
        }
        return items.join('、');
    }
    return null;
}

export function resolveTemplate(template, vars = {}, {
    fallbackMessage = '',
    nextSteps = [],
    fallbackNextSteps = [],
} = {}) {
    const normalizedTemplate = typeof template === 'string' ? normalizeDiagnosticReportLine(template) : '';
    const safeVars = vars && typeof vars === 'object' ? vars : {};
    let unresolved = !normalizedTemplate;

    const rendered = normalizedTemplate.replace(/\{([^{}]+)\}/g, (match, rawKey) => {
        const key = String(rawKey || '').trim();
        if (!key || !Object.prototype.hasOwnProperty.call(safeVars, key)) {
            unresolved = true;
            return match;
        }
        const formatted = formatTemplateValue(safeVars[key]);
        if (formatted === null) {
            unresolved = true;
            return match;
        }
        return formatted;
    });

    if (unresolved || /\{[^{}]*\}/.test(rendered) || /[{}]/.test(rendered)) {
        const resolvedFallbackMessage = normalizeDiagnosticReportLine(fallbackMessage);
        const resolvedFallbackSteps = Array.isArray(fallbackNextSteps)
            ? fallbackNextSteps.map((step) => normalizeDiagnosticReportLine(step)).filter(Boolean)
            : [];
        return {
            usedFallback: true,
            userMessage: resolvedFallbackMessage,
            nextSteps: resolvedFallbackSteps,
        };
    }

    const resolvedSteps = Array.isArray(nextSteps) && nextSteps.length > 0
        ? nextSteps.map((step) => normalizeDiagnosticReportLine(step)).filter(Boolean)
        : (Array.isArray(fallbackNextSteps)
            ? fallbackNextSteps.map((step) => normalizeDiagnosticReportLine(step)).filter(Boolean)
            : []);

    return {
        usedFallback: false,
        userMessage: rendered,
        nextSteps: resolvedSteps,
    };
}

export function resolveWarningPresentation(code, parsedFields = {}, {
    errorCodesIndex = DEFAULT_ERROR_CODES_INDEX,
} = {}) {
    const codeMap = getCodeMap(errorCodesIndex);
    const entry = codeMap.get(code);
    const unknownFallback = errorCodesIndex?.unknownCodeFallback || DEFAULT_ERROR_CODES_INDEX.unknownCodeFallback;

    if (!entry) {
        return {
            usedFallback: true,
            userMessage: normalizeDiagnosticReportLine(unknownFallback?.userMessage),
            nextSteps: Array.isArray(unknownFallback?.nextSteps)
                ? unknownFallback.nextSteps.map((s) => normalizeDiagnosticReportLine(s)).filter(Boolean)
                : [],
            parsedFields: {},
        };
    }

    const sanitizedFields = sanitizeParsedFieldsForCode(code, parsedFields);
    if (!sanitizedFields) {
        return {
            usedFallback: true,
            userMessage: normalizeDiagnosticReportLine(entry.fallbackMessage || entry.userMessage),
            nextSteps: Array.isArray(entry.fallbackNextSteps) && entry.fallbackNextSteps.length > 0
                ? entry.fallbackNextSteps.map((s) => normalizeDiagnosticReportLine(s)).filter(Boolean)
                : (Array.isArray(entry.nextSteps)
                    ? entry.nextSteps.map((s) => normalizeDiagnosticReportLine(s)).filter(Boolean)
                    : []),
            parsedFields: {},
        };
    }

    const resolved = resolveTemplate(entry.userMessage, sanitizedFields, {
        fallbackMessage: entry.fallbackMessage,
        nextSteps: entry.nextSteps,
        fallbackNextSteps: entry.fallbackNextSteps,
    });

    return {
        ...resolved,
        parsedFields: resolved.usedFallback ? {} : sanitizedFields,
    };
}

export function createDiagnosticWarning({
    level = 'WARN',
    category = 'generic_infeasible',
    code = '',
    message = '',
    userMessage = '',
    nextSteps = undefined,
    rawLine = '',
    contextLine = '',
    sourceRef = undefined,
    parsedFields = undefined,
} = {}) {
    const normalizedLevel = String(level || 'WARN').trim().toLowerCase();
    const resolvedMessage = normalizeDiagnosticReportLine(message || userMessage);
    const resolvedUserMessage = normalizeDiagnosticReportLine(userMessage || message);
    const detail = {
        level: normalizedLevel || 'warn',
        category: String(category || 'generic_infeasible').trim() || 'generic_infeasible',
        message: resolvedMessage,
        displayText: `[${(normalizedLevel || 'warn').toUpperCase()}] ${resolvedMessage}`,
    };

    const normalizedCode = normalizeDiagnosticReportLine(code);
    if (normalizedCode) {
        detail.code = normalizedCode;
        detail.userMessage = resolvedUserMessage;
    } else if (userMessage) {
        detail.userMessage = resolvedUserMessage;
    }

    if (Array.isArray(nextSteps)) {
        const cleanedSteps = nextSteps.map((s) => normalizeDiagnosticReportLine(s)).filter(Boolean);
        if (cleanedSteps.length > 0) {
            detail.nextSteps = cleanedSteps;
        }
    }

    const normalizedRawLine = normalizeDiagnosticReportLine(rawLine);
    const normalizedContextLine = normalizeDiagnosticReportLine(contextLine);
    if (normalizedRawLine) detail.rawLine = normalizedRawLine;
    if (normalizedContextLine) detail.contextLine = normalizedContextLine;

    const normalizedSourceRef = normalizeDiagnosticSourceRef(sourceRef);
    if (normalizedSourceRef) {
        detail.sourceRef = normalizedSourceRef;
    }

    if (parsedFields && typeof parsedFields === 'object' && !Array.isArray(parsedFields)) {
        detail.parsedFields = { ...parsedFields };
    }

    return detail;
}

function matchAlternatingPressureInfo(normalizedLine) {
    const match = normalizedLine.match(ALTERNATING_INFO_LINE_REGEX);
    if (!match) return null;
    const [, rawTeacher, rawCount, rawClassList] = match;
    const teacher = normalizeDiagnosticReportLine(rawTeacher);
    const classCount = parseStrictNonNegativeIntegerToken(rawCount);
    const classNames = String(rawClassList || '')
        .split(',')
        .map((name) => normalizeDiagnosticReportLine(name));
    if (!teacher || classCount === null || classCount <= 0) return null;
    if (classNames.length === 0 || classNames.some((name) => !name)) return null;
    if (classNames.length !== classCount) return null;
    return {
        teacher,
        classCount,
        classNames,
    };
}

function matchSwimmingPressureInfo(normalizedLine) {
    const match = normalizedLine.match(SWIMMING_INFO_LINE_REGEX);
    if (!match) return null;
    const [, rawClassCount, rawPoolCount] = match;
    const classCount = parseStrictNonNegativeIntegerToken(rawClassCount);
    const poolCount = parseStrictNonNegativeIntegerToken(rawPoolCount);
    if (classCount === null || poolCount === null || classCount <= 0 || poolCount <= 0) return null;
    return {
        classCount,
        poolCount,
    };
}

export function getDiagnosticReportLevel(line, { section = null } = {}) {
    const normalized = normalizeDiagnosticReportLine(line);
    if (!normalized || /^\[DEBUG\]/i.test(normalized)) return '';

    const normalizedSection = normalizeSectionKey(section);
    if (normalizedSection === '3' && matchAlternatingPressureInfo(normalized)) {
        return 'WARN';
    }
    if (normalizedSection === '5' && matchSwimmingPressureInfo(normalized)) {
        return 'WARN';
    }

    const match = normalized.match(/\[(WARN|ERROR|ALERT)\]/i);
    if (match) return match[1].toUpperCase();
    if (normalized.includes('❌')) return 'ERROR';
    if (normalized.includes('⚠️')) return 'WARN';
    return '';
}

export function findPreviousDiagnosticContext(lines, index, { section = undefined } = {}) {
    if (!Array.isArray(lines) || !Number.isInteger(index) || index <= 0) return '';
    const expectedSection = section === undefined ? undefined : normalizeSectionKey(section);

    if (expectedSection !== undefined) {
        let activeSection = null;
        for (let i = 0; i < index && i < lines.length; i += 1) {
            const headerKey = extractDiagnosticSectionKey(lines[i]);
            if (headerKey !== null) {
                activeSection = headerKey;
            }
        }
        if (activeSection !== expectedSection) {
            return '';
        }
    }

    for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = normalizeDiagnosticReportLine(lines[i]);
        if (!candidate) continue;
        if (candidate.startsWith('[DEBUG]')) break;
        if (candidate.startsWith('===') && candidate.includes('診斷報告')) break;
        return candidate;
    }
    return '';
}

export function buildGenericInfeasibleWarnings() {
    return [
        createDiagnosticWarning({
            level: 'WARN',
            category: 'generic_infeasible',
            message: '排課引擎無法找到可行解，建議檢查班級課程需求、教師配額、教室容量是否平衡。',
        }),
    ];
}

export function diagnosticWarningsToAiAnalysis(diagnosticWarnings) {
    return (Array.isArray(diagnosticWarnings) ? diagnosticWarnings : [])
        .map((warning) => normalizeDiagnosticReportLine(
            warning?.displayText
            || (warning?.message ? `[${String(warning.level || 'warn').toUpperCase()}] ${warning.message}` : '')
        ))
        .filter(Boolean);
}

export function formatGenericDiagnosticAnalysisLine(level, line) {
    const normalized = normalizeDiagnosticReportLine(line);
    const withoutBullet = normalized.replace(/^-\s*/, '');
    const withoutLevelTag = withoutBullet.replace(/\[(WARN|ERROR|ALERT)\]\s*/i, '').trim();
    return `[${level}] ${withoutLevelTag || withoutBullet}`;
}

function buildCodedWarningDetail({
    level,
    category,
    code,
    parsedFields,
    rawLine,
    contextLine,
    sourceRef,
    errorCodesIndex = DEFAULT_ERROR_CODES_INDEX,
}) {
    const resolved = resolveWarningPresentation(code, parsedFields, { errorCodesIndex });
    return createDiagnosticWarning({
        level,
        category,
        code,
        message: resolved.userMessage,
        userMessage: resolved.userMessage,
        nextSteps: resolved.nextSteps,
        rawLine,
        contextLine,
        sourceRef,
        parsedFields: resolved.parsedFields,
    });
}

export function buildDiagnosticWarningDetail({
    level,
    line,
    contextLine = '',
    section = null,
    index = undefined,
    sourceRef = undefined,
    errorCodesIndex = DEFAULT_ERROR_CODES_INDEX,
} = {}) {
    const normalized = normalizeDiagnosticReportLine(line);
    const normalizedSection = normalizeSectionKey(
        section !== null && section !== undefined ? section : sourceRef?.section
    );
    const resolvedSourceRef = normalizeDiagnosticSourceRef(
        sourceRef || (Number.isInteger(index) && index >= 0
            ? { kind: 'report_line', section: normalizedSection, index }
            : null)
    );
    const effectiveSection = resolvedSourceRef ? resolvedSourceRef.section : normalizedSection;

    if (level === 'ALERT' && normalized.includes('診斷報告')) {
        return null;
    }

    if (level === 'ALERT') {
        return buildCodedWarningDetail({
            level,
            category: 'generic_warning',
            code: 'SCHE_WARN_UNCLASSIFIED',
            parsedFields: {},
            rawLine: normalized,
            contextLine,
            sourceRef: resolvedSourceRef,
            errorCodesIndex,
        });
    }

    // §3 交替課 INFO 壓力行（單行辨識，僅限 section '3'）
    if (effectiveSection === '3') {
        const altFields = matchAlternatingPressureInfo(normalized);
        if (altFields) {
            return buildCodedWarningDetail({
                level: 'WARN',
                category: 'alternating_conflict',
                code: 'SCHE_WARN_ALTERNATING_LOAD_PRESSURE',
                parsedFields: altFields,
                rawLine: normalized,
                contextLine: '',
                sourceRef: resolvedSourceRef,
                errorCodesIndex,
            });
        }
    }

    // §5 游泳 INFO 壓力行（單行辨識，僅限 section '5'）
    if (effectiveSection === '5') {
        const swimFields = matchSwimmingPressureInfo(normalized);
        if (swimFields) {
            return buildCodedWarningDetail({
                level: 'WARN',
                category: 'swimming_resource_pressure',
                code: 'SCHE_WARN_SWIMMING_PRESSURE',
                parsedFields: swimFields,
                rawLine: normalized,
                contextLine: '',
                sourceRef: resolvedSourceRef,
                errorCodesIndex,
            });
        }
    }

    // 若為其他 [INFO] 行但因直接呼叫 buildDiagnosticWarningDetail 進入，不得誤分類為專屬警示
    if (/\[INFO\]/i.test(normalized)) {
        return null;
    }

    // §1 班級超載（現行格式：正式可用上限: N 節, {label}）
    if (effectiveSection === '1' || effectiveSection === null) {
        const classOverloadMatch = normalized.match(CURRENT_CLASS_OVERLOAD_REGEX);
        if (classOverloadMatch) {
            const [, rawClassName, rawNeeded, rawLimit, rawLabel] = classOverloadMatch;
            const parsedFields = sanitizeParsedFieldsForCode('SCHE_WARN_CLASS_PERIOD_OVERLOAD', {
                className: rawClassName,
                needed: rawNeeded,
                limit: rawLimit,
                label: rawLabel,
            });
            if (parsedFields) {
                return buildCodedWarningDetail({
                    level: 'ERROR',
                    category: 'class_overload',
                    code: 'SCHE_WARN_CLASS_PERIOD_OVERLOAD',
                    parsedFields,
                    rawLine: normalized,
                    contextLine,
                    sourceRef: resolvedSourceRef,
                    errorCodesIndex,
                });
            }
        }
    }

    // §4 有效時段不足
    if (effectiveSection === '4' || effectiveSection === null) {
        const periodMatch = normalized.match(PERIOD_SHORTAGE_REGEX);
        if (periodMatch) {
            const [, rawClassName, rawNeeded, rawAvailable] = periodMatch;
            const parsedFields = sanitizeParsedFieldsForCode('SCHE_WARN_PERIOD_SHORTAGE', {
                className: rawClassName,
                needed: rawNeeded,
                available: rawAvailable,
            });
            if (parsedFields) {
                return buildCodedWarningDetail({
                    level,
                    category: 'period_shortage',
                    code: 'SCHE_WARN_PERIOD_SHORTAGE',
                    parsedFields,
                    rawLine: normalized,
                    contextLine,
                    sourceRef: resolvedSourceRef,
                    errorCodesIndex,
                });
            }
        }
    }

    // §6 教室容量不足
    if (effectiveSection === '6' || effectiveSection === null) {
        const capacityMatch = normalized.match(ROOM_CAPACITY_SHORTAGE_REGEX);
        if (capacityMatch) {
            const [, rawSubject, rawRoomCount, rawWeeklyCapacity, rawNeeded] = capacityMatch;
            const parsedFields = sanitizeParsedFieldsForCode('SCHE_WARN_ROOM_CAPACITY_SHORTAGE', {
                subject: rawSubject,
                roomCount: rawRoomCount,
                weeklyCapacity: rawWeeklyCapacity,
                needed: rawNeeded,
            });
            if (parsedFields) {
                return buildCodedWarningDetail({
                    level,
                    category: 'room_capacity_shortage',
                    code: 'SCHE_WARN_ROOM_CAPACITY_SHORTAGE',
                    parsedFields,
                    rawLine: normalized,
                    contextLine,
                    sourceRef: resolvedSourceRef,
                    errorCodesIndex,
                });
            }
        }
    }

    // §2 教師負載偏高（必須位於 section '2' 且緊鄰同 section 教師資料行）
    if (effectiveSection === '2' && TEACHER_LOAD_WARN_REGEX.test(normalized)) {
        const normalizedContext = normalizeDiagnosticReportLine(contextLine);
        const contextMatch = normalizedContext.match(TEACHER_LOAD_CONTEXT_REGEX);
        if (contextMatch) {
            const [, rawTeacher, rawLoad] = contextMatch;
            const parsedFields = sanitizeParsedFieldsForCode('SCHE_WARN_TEACHER_LOAD_PRESSURE', {
                teacher: rawTeacher,
                load: rawLoad,
            });
            if (parsedFields) {
                return buildCodedWarningDetail({
                    level: 'WARN',
                    category: 'generic_warning',
                    code: 'SCHE_WARN_TEACHER_LOAD_PRESSURE',
                    parsedFields,
                    rawLine: normalized,
                    contextLine: normalizedContext,
                    sourceRef: resolvedSourceRef,
                    errorCodesIndex,
                });
            }
        }
    }

    // §7 教師配額超限
    if (effectiveSection === '7' || effectiveSection === null) {
        const quotaMatch = normalized.match(TEACHER_QUOTA_WARN_REGEX);
        if (quotaMatch) {
            const [, rawTeacher, rawActual, rawSafeMax] = quotaMatch;
            const parsedFields = sanitizeParsedFieldsForCode('SCHE_WARN_TEACHER_QUOTA_EXCEEDED', {
                teacher: rawTeacher,
                actual: rawActual,
                safeMax: rawSafeMax,
            });
            if (parsedFields) {
                return buildCodedWarningDetail({
                    level: 'WARN',
                    category: 'generic_warning',
                    code: 'SCHE_WARN_TEACHER_QUOTA_EXCEEDED',
                    parsedFields,
                    rawLine: normalized,
                    contextLine,
                    sourceRef: resolvedSourceRef,
                    errorCodesIndex,
                });
            }
        }
    }

    // §8 Homeroom trace 不一致（必須位於 section '8'，逐一驗證完整數值 token）
    if (effectiveSection === '8') {
        const homeroomMatch = normalized.match(HOMEROOM_TRACE_WARN_REGEX);
        if (homeroomMatch) {
            const [, rawClassName, rawCandidate, rawMerged, rawExisting, rawFinal] = homeroomMatch;
            const parsedFields = sanitizeParsedFieldsForCode('SCHE_WARN_HOMEROOM_TRACE_MISMATCH', {
                className: rawClassName,
                blockCandidatePeriods: rawCandidate,
                mergedPeriods: rawMerged,
                existingHomeroomBlockPeriods: rawExisting,
                finalHomeroomBlockPeriods: rawFinal,
            });
            if (parsedFields) {
                return buildCodedWarningDetail({
                    level: 'WARN',
                    category: 'generic_warning',
                    code: 'SCHE_WARN_HOMEROOM_TRACE_MISMATCH',
                    parsedFields,
                    rawLine: normalized,
                    contextLine,
                    sourceRef: resolvedSourceRef,
                    errorCodesIndex,
                });
            }
        }
    }

    // 未匹配的 WARN / ERROR -> SCHE_WARN_UNCLASSIFIED
    return buildCodedWarningDetail({
        level,
        category: 'generic_warning',
        code: 'SCHE_WARN_UNCLASSIFIED',
        parsedFields: {},
        rawLine: normalized,
        contextLine,
        sourceRef: resolvedSourceRef,
        errorCodesIndex,
    });
}

export function deduplicateDiagnosticWarningsBySourceRef(warnings) {
    if (!Array.isArray(warnings)) return [];
    const deduplicated = [];
    const seenSourceRefs = new Set();

    for (const warning of warnings) {
        if (!warning || typeof warning !== 'object') continue;
        const normalizedRef = normalizeDiagnosticSourceRef(warning.sourceRef);
        if (normalizedRef) {
            const refKey = `${normalizedRef.kind}|${normalizedRef.section ?? 'null'}|${normalizedRef.index}`;
            if (seenSourceRefs.has(refKey)) continue;
            seenSourceRefs.add(refKey);
        }
        deduplicated.push(warning);
    }

    return deduplicated;
}

export function parseInfeasibleDiagnosticReport(reportContent, {
    errorCodesIndex = DEFAULT_ERROR_CODES_INDEX,
} = {}) {
    const rawLines = String(reportContent || '').split('\n');
    const collectedWarnings = [];
    let currentSection = null;

    rawLines.forEach((line, index) => {
        const normalized = normalizeDiagnosticReportLine(line);
        if (!normalized) return;

        if (/^\[DEBUG\]/i.test(normalized)) {
            currentSection = extractDiagnosticSectionKey(normalized);
            return;
        }

        const level = getDiagnosticReportLevel(normalized, { section: currentSection });
        if (!level) return;

        const contextLine = (currentSection === '3' || currentSection === '5')
            ? ''
            : findPreviousDiagnosticContext(rawLines, index, { section: currentSection });

        const detail = buildDiagnosticWarningDetail({
            level,
            line: normalized,
            contextLine,
            section: currentSection,
            index,
            sourceRef: {
                kind: 'report_line',
                section: currentSection,
                index,
            },
            errorCodesIndex,
        });
        if (!detail) return;
        collectedWarnings.push(detail);
    });

    const diagnosticWarnings = deduplicateDiagnosticWarningsBySourceRef(collectedWarnings);
    const finalizedWarnings = diagnosticWarnings.length > 0 ? diagnosticWarnings : buildGenericInfeasibleWarnings();
    return {
        diagnosticWarnings: finalizedWarnings,
        aiAnalysis: diagnosticWarningsToAiAnalysis(finalizedWarnings),
    };
}
