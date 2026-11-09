import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LOCATABLE_WARNING_CODES } from './diagnosticWarningParser.js';
import {
    renderGtrIssuePresentation,
    renderGtrIssuesToErrorCodes
} from '../utils/gtrIssuePresentation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');

export const DEFAULT_SCHEDULER_ERROR_CODES_PATH = path.join(
    DEFAULT_CONTRACTS_DIR,
    'scheduler_error_codes.json'
);
export const DEFAULT_GTR_PRESENTATIONS_PATH = path.join(
    DEFAULT_CONTRACTS_DIR,
    'grade_time_rule_issue_presentations.json'
);
export const DEFAULT_GTR_AUTHORITY_PATH = path.join(
    DEFAULT_CONTRACTS_DIR,
    'grade_time_rule_issue_codes.json'
);

export const SOFT_ROOM_CAPACITY_REASON = 'specialty room capacity relaxed to soft penalty';

export const VALIDATION_SECTION_CODE_MAP = Object.freeze({
    class_slot_conflicts: 'SCHE_VAL_CLASS_SLOT',
    teacher_conflicts: 'SCHE_VAL_TEACHER_CONFLICT',
    room_conflicts: 'SCHE_VAL_ROOM_CONFLICT',
    room_overloads: 'SCHE_VAL_ROOM_OVERLOAD',
    unassigned_special_rooms: 'SCHE_VAL_UNASSIGNED_SPECIAL_ROOM',
    grade_subject_issues: 'SCHE_VAL_GRADE_SUBJECT',
    special_course_overlap_conflicts: 'SCHE_VAL_SPECIAL_COURSE_OVERLAP',
    science_same_day_shape_issues: 'SCHE_VAL_SCIENCE_SAME_DAY',
    subject_day_spread_issues: 'SCHE_VAL_SUBJECT_DAY_SPREAD',
    special_course_input_errors: 'SCHE_VAL_SPECIAL_COURSE_INPUT_ERROR'
});

export const SOLVER_STATUS_TO_ERROR_CODE = Object.freeze({
    INFEASIBLE: 'SCHE_INFEASIBLE',
    INVALID_INPUT: 'SCHE_INVALID_INPUT',
    INVALID_VALIDATION: 'SCHE_INVALID_VALIDATION',
    INVALID_GRADE_TIME_RULE_CONFIGURATION: 'SCHE_INVALID_GRADE_TIME_RULE',
    UNKNOWN_TIMEOUT: 'SCHE_UNKNOWN_TIMEOUT',
    TIMEOUT_NO_SOLUTION: 'SCHE_TIMEOUT_NO_SOLUTION',
    MODEL_INVALID: 'SCHE_MODEL_INVALID',
    MODEL_EVALUATOR_MISMATCH: 'SCHE_MODEL_EVALUATOR_MISMATCH',
    ERROR: 'SCHE_ENGINE_ERROR'
});

const ALLOWED_CATEGORIES = new Set(['status', 'input', 'validation', 'warning', 'fallback']);
const ALLOWED_SEVERITIES = new Set(['blocking', 'warning']);
const ALLOWED_CONFIDENCES = new Set(['determined', 'possible', 'unknown']);
const ALLOWED_GTR_FIELDS = new Set(['ruleIds', 'grade', 'day', 'period']);
const LOCATABLE_WARNING_CODE_SET = new Set(LOCATABLE_WARNING_CODES);

function isNonEmptyString(val) {
    return typeof val === 'string' && val.trim() !== '';
}

function isNonEmptyStringArray(val) {
    return Array.isArray(val) && val.length > 0 && val.every((item) => isNonEmptyString(item));
}

function isPlainObject(val) {
    return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function isFiniteNumber(val) {
    return typeof val === 'number' && Number.isFinite(val);
}

export function validateSchedulerErrorCodesIndex(data) {
    if (!isPlainObject(data)) {
        throw new Error('Invalid scheduler_error_codes index: root must be a plain object');
    }
    if (data.schemaVersion !== 1) {
        throw new Error(
            `Unsupported scheduler_error_codes schemaVersion: expected 1, got ${String(data.schemaVersion)}`
        );
    }
    if (!Array.isArray(data.codes) || data.codes.length === 0) {
        throw new Error('Invalid scheduler_error_codes index: codes must be a non-empty array');
    }
    if (!isPlainObject(data.parserCategoryMap)) {
        throw new Error('Invalid scheduler_error_codes index: parserCategoryMap is required');
    }
    for (const [catKey, mappedCodes] of Object.entries(data.parserCategoryMap)) {
        if (!isNonEmptyString(catKey) || !Array.isArray(mappedCodes)) {
            throw new Error(
                `Invalid scheduler_error_codes index: parserCategoryMap["${catKey}"] must be an array`
            );
        }
    }
    if (
        !isPlainObject(data.unknownCodeFallback) ||
        !isNonEmptyString(data.unknownCodeFallback.userMessage) ||
        !isNonEmptyStringArray(data.unknownCodeFallback.nextSteps)
    ) {
        throw new Error(
            'Invalid scheduler_error_codes index: unknownCodeFallback requires userMessage and nextSteps'
        );
    }

    const seenCodes = new Set();
    for (const entry of data.codes) {
        if (!isPlainObject(entry)) {
            throw new Error('Invalid scheduler_error_codes index: code entry must be an object');
        }
        if (!isNonEmptyString(entry.code) || !/^SCHE_[A-Z0-9_]+$/.test(entry.code)) {
            throw new Error(
                `Invalid scheduler_error_codes index: invalid or missing code "${String(entry.code)}"`
            );
        }
        if (seenCodes.has(entry.code)) {
            throw new Error(`Invalid scheduler_error_codes index: duplicate code "${entry.code}"`);
        }
        seenCodes.add(entry.code);

        if (!ALLOWED_CATEGORIES.has(entry.category)) {
            throw new Error(
                `Invalid scheduler_error_codes index: invalid category "${String(entry.category)}" for ${entry.code}`
            );
        }
        if (!ALLOWED_SEVERITIES.has(entry.severity)) {
            throw new Error(
                `Invalid scheduler_error_codes index: invalid severity "${String(entry.severity)}" for ${entry.code}`
            );
        }
        if (!ALLOWED_CONFIDENCES.has(entry.confidence)) {
            throw new Error(
                `Invalid scheduler_error_codes index: invalid confidence "${String(entry.confidence)}" for ${entry.code}`
            );
        }
        if (!isNonEmptyString(entry.userMessage)) {
            throw new Error(
                `Invalid scheduler_error_codes index: missing userMessage for ${entry.code}`
            );
        }
        if (!isNonEmptyStringArray(entry.nextSteps)) {
            throw new Error(
                `Invalid scheduler_error_codes index: missing or invalid nextSteps for ${entry.code}`
            );
        }
        if (!isNonEmptyString(entry.fallbackMessage)) {
            throw new Error(
                `Invalid scheduler_error_codes index: missing fallbackMessage for ${entry.code}`
            );
        }
        if (!isNonEmptyStringArray(entry.fallbackNextSteps)) {
            throw new Error(
                `Invalid scheduler_error_codes index: missing or invalid fallbackNextSteps for ${entry.code}`
            );
        }
        if (!isNonEmptyStringArray(entry.testRef)) {
            throw new Error(
                `Invalid scheduler_error_codes index: missing or invalid testRef for ${entry.code}`
            );
        }
    }

    return data;
}

export function validateGtrPresentationsIndex(data) {
    if (!isPlainObject(data)) {
        throw new Error('Invalid grade_time_rule_issue_presentations: root must be a plain object');
    }
    if (data.schemaVersion !== 1) {
        throw new Error(
            `Unsupported grade_time_rule_issue_presentations schemaVersion: expected 1, got ${String(data.schemaVersion)}`
        );
    }
    if (
        !isPlainObject(data.unknownCodeFallback) ||
        !isNonEmptyString(data.unknownCodeFallback.userMessage) ||
        !isNonEmptyStringArray(data.unknownCodeFallback.nextSteps)
    ) {
        throw new Error(
            'Invalid grade_time_rule_issue_presentations: unknownCodeFallback requires userMessage and nextSteps'
        );
    }
    if (!isPlainObject(data.presentations) || Object.keys(data.presentations).length === 0) {
        throw new Error(
            'Invalid grade_time_rule_issue_presentations: presentations must be a non-empty object'
        );
    }
    for (const [key, entry] of Object.entries(data.presentations)) {
        if (!isPlainObject(entry)) {
            throw new Error(`Invalid GTR presentation entry for "${key}"`);
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'severity')) {
            throw new Error(`GTR presentation "${key}" must not define severity`);
        }
        if (
            !isNonEmptyString(entry.userMessage) ||
            !isNonEmptyStringArray(entry.nextSteps) ||
            !isNonEmptyString(entry.fallbackMessage) ||
            !isNonEmptyStringArray(entry.fallbackNextSteps)
        ) {
            throw new Error(`Missing required message/nextSteps fields in GTR presentation "${key}"`);
        }
        if (
            !Array.isArray(entry.allowedFields) ||
            entry.allowedFields.length === 0 ||
            !entry.allowedFields.every((f) => ALLOWED_GTR_FIELDS.has(f))
        ) {
            throw new Error(`Invalid allowedFields in GTR presentation "${key}"`);
        }
    }
    return data;
}

export function validateGtrAuthorityIndex(data) {
    if (!isPlainObject(data)) {
        throw new Error('Invalid grade_time_rule_issue_codes: root must be a plain object');
    }
    const codesObj = isPlainObject(data.codes) ? data.codes : data;
    if (Object.keys(codesObj).length === 0) {
        throw new Error('Invalid grade_time_rule_issue_codes: codes must be a non-empty object');
    }
    for (const [code, severity] of Object.entries(codesObj)) {
        if (code === 'schemaVersion') continue;
        if (!isNonEmptyString(code) || !ALLOWED_SEVERITIES.has(severity)) {
            throw new Error(`Invalid GTR authority entry "${code}": "${String(severity)}"`);
        }
    }
    return data;
}

function readAndParseJsonFile(filePath, label) {
    if (!isNonEmptyString(filePath)) {
        throw new Error(`Missing file path for ${label}`);
    }
    if (!fs.existsSync(filePath)) {
        throw new Error(`Contract file not found for ${label}: ${filePath}`);
    }
    const rawText = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (err) {
        throw new Error(`Failed to parse JSON for ${label} (${filePath}): ${err.message}`);
    }
    return parsed;
}

export function loadSchedulerErrorCodesIndex(filePath = DEFAULT_SCHEDULER_ERROR_CODES_PATH) {
    const parsed = readAndParseJsonFile(filePath, 'scheduler_error_codes');
    validateSchedulerErrorCodesIndex(parsed);
    const codesByCode = new Map();
    const statusBySolverStatus = new Map();
    for (const entry of parsed.codes) {
        codesByCode.set(entry.code, entry);
        if (entry.category === 'status' && isNonEmptyString(entry.solverStatus)) {
            statusBySolverStatus.set(entry.solverStatus, entry);
        }
    }
    return {
        raw: parsed,
        codesByCode,
        statusBySolverStatus,
        unknownCodeFallback: parsed.unknownCodeFallback
    };
}

export function loadGtrPresentationsIndex(filePath = DEFAULT_GTR_PRESENTATIONS_PATH) {
    const parsed = readAndParseJsonFile(filePath, 'grade_time_rule_issue_presentations');
    return validateGtrPresentationsIndex(parsed);
}

export function loadGtrAuthorityIndex(filePath = DEFAULT_GTR_AUTHORITY_PATH) {
    const parsed = readAndParseJsonFile(filePath, 'grade_time_rule_issue_codes');
    return validateGtrAuthorityIndex(parsed);
}

// Fail-fast load at module initialization
const DEFAULT_INDEX = loadSchedulerErrorCodesIndex(DEFAULT_SCHEDULER_ERROR_CODES_PATH);
const DEFAULT_GTR_PRESENTATIONS = loadGtrPresentationsIndex(DEFAULT_GTR_PRESENTATIONS_PATH);
const DEFAULT_GTR_AUTHORITY = loadGtrAuthorityIndex(DEFAULT_GTR_AUTHORITY_PATH);

export function getLoadedSchedulerErrorCodesIndex() {
    return DEFAULT_INDEX;
}

export function getLoadedGtrContracts() {
    return {
        authorityData: DEFAULT_GTR_AUTHORITY,
        presentationsData: DEFAULT_GTR_PRESENTATIONS
    };
}

export function resolveStatusDetail(solverStatus, { index = DEFAULT_INDEX } = {}) {
    const normalizedStatus = isNonEmptyString(solverStatus) ? solverStatus.trim() : 'ERROR';
    const mappedCode = Object.prototype.hasOwnProperty.call(
        SOLVER_STATUS_TO_ERROR_CODE,
        normalizedStatus
    )
        ? SOLVER_STATUS_TO_ERROR_CODE[normalizedStatus]
        : 'SCHE_ENGINE_ERROR';

    const entry =
        index.codesByCode.get(mappedCode) || index.codesByCode.get('SCHE_ENGINE_ERROR');

    const confidence = entry.code === 'SCHE_ENGINE_ERROR' ? 'unknown' : 'determined';

    return {
        errorCode: entry.code,
        statusDetail: {
            code: entry.code,
            severity: entry.severity,
            confidence,
            userMessage: entry.userMessage,
            nextSteps: [...entry.nextSteps]
        }
    };
}

export function buildUnknownErrorCodeItem(
    rawCode,
    {
        source = null,
        sourceRef = null,
        index = DEFAULT_INDEX
    } = {}
) {
    const codeStr = isNonEmptyString(rawCode) ? rawCode.trim() : 'UNKNOWN_ERROR_CODE';
    const fallback = index.unknownCodeFallback;
    const normalizedSource =
        typeof source === 'string' &&
        ['job_output', 'report_file', 'shared_file', 'server_fallback', 'server_internal'].includes(source)
            ? source
            : null;
    const normalizedSourceRef =
        isPlainObject(sourceRef) &&
        typeof sourceRef.index === 'number' &&
        Number.isInteger(sourceRef.index) &&
        sourceRef.index >= 0
            ? {
                kind: 'unknown',
                section: isNonEmptyString(sourceRef.section) ? sourceRef.section : null,
                index: sourceRef.index
            }
            : { kind: 'unknown', section: null, index: 0 };

    return {
        code: codeStr,
        severity: 'unknown',
        confidence: 'unknown',
        source: normalizedSource,
        sourceRef: normalizedSourceRef,
        userMessage: fallback.userMessage,
        evidence: [],
        nextSteps: [...fallback.nextSteps]
    };
}

export function buildInputErrorCodes(options = {}) {
    const {
        solverStatus,
        classLoadTrace = null,
        invalidClasses = null,
        isJobIdentityVerified = true,
        index = DEFAULT_INDEX
    } = options || {};
    const outputSchemaVersion =
        options && Object.prototype.hasOwnProperty.call(options, 'outputSchemaVersion')
            ? options.outputSchemaVersion
            : 1;
    if (solverStatus !== 'INVALID_INPUT' || !isJobIdentityVerified) {
        return [];
    }

    let sourceList = null;
    let sectionName = null;
    if (Array.isArray(classLoadTrace) && classLoadTrace.length > 0) {
        sourceList = classLoadTrace;
        sectionName = 'classLoadTrace';
    } else if (Array.isArray(invalidClasses) && invalidClasses.length > 0) {
        sourceList = invalidClasses;
        sectionName = 'invalidClasses';
    }

    if (!sourceList) {
        return [];
    }

    const items = [];
    const baseConfidence = outputSchemaVersion === 1 && isJobIdentityVerified ? 'determined' : 'unknown';

    sourceList.forEach((record, idx) => {
        if (!isPlainObject(record)) {
            return;
        }
        const validationError = isNonEmptyString(record.validationError)
            ? record.validationError.trim()
            : '';

        if (validationError === 'INVALID_INPUT_CLASS_LOAD') {
            const totalPeriods = record.totalPeriods;
            const capacity = isFiniteNumber(record.capacity)
                ? record.capacity
                : isFiniteNumber(record.gradeMaxPeriods)
                    ? record.gradeMaxPeriods
                    : null;

            if (!isFiniteNumber(totalPeriods) || !isFiniteNumber(capacity) || totalPeriods <= capacity) {
                return;
            }

            const entry = index.codesByCode.get('SCHE_INPUT_CLASS_LOAD_OVER_CAPACITY');
            const evidence = [];
            if (isNonEmptyString(record.className)) {
                evidence.push(`班級：${record.className.trim()}`);
            }
            evidence.push(`需求節數：${totalPeriods} 節`);
            evidence.push(`可用容量：${capacity} 節`);
            if (isFiniteNumber(record.periodExcess) && record.periodExcess > 0) {
                evidence.push(`超出節數：${record.periodExcess} 節`);
            }

            items.push({
                code: entry.code,
                severity: entry.severity,
                confidence: baseConfidence,
                source: 'job_output',
                sourceRef: {
                    kind: 'input_issue',
                    section: sectionName,
                    index: idx
                },
                userMessage: entry.userMessage,
                evidence,
                nextSteps: [...entry.nextSteps]
            });
        } else if (validationError === 'INVALID_INPUT_LOCK_CONSERVATION') {
            if (!isNonEmptyString(record.conservationError)) {
                return;
            }

            const entry = index.codesByCode.get('SCHE_INPUT_LOCKED_PERIODS_EXCEED_REQUIREMENT');
            const evidence = [];
            if (isNonEmptyString(record.className)) {
                evidence.push(`班級：${record.className.trim()}`);
            }
            evidence.push(`鎖定檢查：${record.conservationError.trim()}`);

            items.push({
                code: entry.code,
                severity: entry.severity,
                confidence: baseConfidence,
                source: 'job_output',
                sourceRef: {
                    kind: 'input_issue',
                    section: sectionName,
                    index: idx
                },
                userMessage: entry.userMessage,
                evidence,
                nextSteps: [...entry.nextSteps]
            });
        }
    });

    return items;
}

function formatValidDayPeriodSlot(item) {
    if (!isPlainObject(item)) return null;
    const weekPrefix = isNonEmptyString(item.week) ? `${item.week.trim()}週 ` : '';
    const hasDay = typeof item.day === 'number' && Number.isInteger(item.day) && item.day >= 1 && item.day <= 7;
    const hasPeriod =
        typeof item.period === 'number' && Number.isInteger(item.period) && item.period >= 1 && item.period <= 12;

    if (hasDay && hasPeriod) {
        return `時段：${weekPrefix}星期${item.day}第${item.period}節`;
    }
    if (hasDay) {
        return `日期：${weekPrefix}星期${item.day}`;
    }
    if (hasPeriod) {
        return `節次：${weekPrefix}第${item.period}節`;
    }
    if (weekPrefix) {
        return `週別：${item.week.trim()}`;
    }
    return null;
}

function filterValidStrings(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((v) => isNonEmptyString(v)).map((v) => v.trim());
}

function filterValidIntegers(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((v) => typeof v === 'number' && Number.isInteger(v));
}

function applyProvenanceConfidenceCap(baseConfidence, validationReportSource, outputSchemaVersion, isJobIdentityVerified) {
    if (!validationReportSource) {
        return 'unknown';
    }
    if (validationReportSource === 'shared_file') {
        return baseConfidence === 'unknown' ? 'unknown' : 'possible';
    }
    if (validationReportSource === 'job_output') {
        if (!isJobIdentityVerified || outputSchemaVersion !== 1) {
            return baseConfidence === 'determined' ? 'possible' : baseConfidence;
        }
        return baseConfidence;
    }
    return 'unknown';
}

function resolveRoomOverloadDecision({
    validationReportSource,
    outputSchemaVersion,
    isJobIdentityVerified,
    solverStatus,
    outputStatus,
    outputSolverStatus,
    degradationReasons
}) {
    if (validationReportSource === 'shared_file') {
        return {
            confidence: 'unknown',
            source: 'shared_file',
            reasonEvidence: '判定依據：驗證報告來自共用檔案 fallback，無法確認與本任務同源'
        };
    }
    if (validationReportSource !== 'job_output') {
        return {
            confidence: 'unknown',
            source: null,
            reasonEvidence: '判定依據：驗證報告來源未確認，無法判別硬性超額或軟降級'
        };
    }
    if (!isJobIdentityVerified || outputSchemaVersion !== 1) {
        return {
            confidence: 'unknown',
            source: 'job_output',
            reasonEvidence: '判定依據：輸出結構版本未確認，無法確認硬性或軟降級'
        };
    }

    if (outputStatus !== 'INVALID_VALIDATION' || outputSolverStatus !== 'INVALID_VALIDATION') {
        return {
            confidence: 'unknown',
            source: 'job_output',
            reasonEvidence: '判定依據：輸出狀態欄位缺失或不一致，無法確認驗證失敗契約'
        };
    }

    const isValidReasonArray =
        Array.isArray(degradationReasons) &&
        degradationReasons.every((item) => typeof item === 'string');

    if (!isValidReasonArray) {
        return {
            confidence: 'possible',
            source: 'job_output',
            reasonEvidence: '判定依據：降級紀錄缺失或格式無效，無法區分硬性超額或軟降級'
        };
    }

    if (degradationReasons.includes(SOFT_ROOM_CAPACITY_REASON)) {
        return {
            confidence: 'possible',
            source: 'job_output',
            reasonEvidence: '判定依據：已啟用教室容量軟降級（可能相關，非單一硬性失敗根因）'
        };
    }

    if (solverStatus === 'INVALID_VALIDATION') {
        return {
            confidence: 'determined',
            source: 'job_output',
            reasonEvidence: '判定依據：有效 reason 陣列未命中 soft reason（硬性教室容量超額）'
        };
    }

    return {
        confidence: 'possible',
        source: 'job_output',
        reasonEvidence: '判定依據：非驗證失敗狀態下之教室容量紀錄'
    };
}

export function buildValidationErrorCodes(options = {}) {
    const {
        validationReport,
        validationReportSource = null,
        solverStatus = 'INVALID_VALIDATION',
        outputStatus,
        outputSolverStatus,
        degradationReasons = undefined,
        isJobIdentityVerified = true,
        index = DEFAULT_INDEX
    } = options || {};
    const outputSchemaVersion =
        options && Object.prototype.hasOwnProperty.call(options, 'outputSchemaVersion')
            ? options.outputSchemaVersion
            : 1;
    if (!isPlainObject(validationReport) || !isJobIdentityVerified) {
        return [];
    }

    const normalizedSource =
        validationReportSource === 'job_output' || validationReportSource === 'shared_file'
            ? validationReportSource
            : null;

    const results = [];

    // 1. class_slot_conflicts
    if (Array.isArray(validationReport.class_slot_conflicts)) {
        const entry = index.codesByCode.get('SCHE_VAL_CLASS_SLOT');
        validationReport.class_slot_conflicts.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            const className = isNonEmptyString(item.className)
                ? item.className.trim()
                : isNonEmptyString(item.classId)
                    ? item.classId.trim()
                    : null;
            if (className) evidence.push(`班級：${className}`);
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);
            const subjects = filterValidStrings(item.subjects);
            if (subjects.length > 0) evidence.push(`課程：${subjects.join('、')}`);

            const hasEnoughEvidence = Boolean(className && (slotStr || subjects.length > 0));
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'class_slot_conflicts', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 2. teacher_conflicts
    if (Array.isArray(validationReport.teacher_conflicts)) {
        const entry = index.codesByCode.get('SCHE_VAL_TEACHER_CONFLICT');
        validationReport.teacher_conflicts.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            const teacherName = isNonEmptyString(item.teacherName)
                ? item.teacherName.trim()
                : isNonEmptyString(item.teacherId)
                    ? item.teacherId.trim()
                    : null;
            if (teacherName) evidence.push(`教師：${teacherName}`);
            const classes = filterValidStrings(item.classes);
            if (classes.length > 0) evidence.push(`班級：${classes.join('、')}`);
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);

            const hasEnoughEvidence = Boolean(teacherName && (classes.length > 0 || slotStr));
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'teacher_conflicts', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 3. room_conflicts
    if (Array.isArray(validationReport.room_conflicts)) {
        const entry = index.codesByCode.get('SCHE_VAL_ROOM_CONFLICT');
        validationReport.room_conflicts.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            if (isNonEmptyString(item.classroomName)) {
                evidence.push(`教室：${item.classroomName.trim()}`);
            } else if (isNonEmptyString(item.classroomId)) {
                evidence.push(`教室識別：${item.classroomId.trim()}`);
            }
            const classes = filterValidStrings(item.classes);
            if (classes.length > 0) evidence.push(`班級：${classes.join('、')}`);
            const subjects = filterValidStrings(item.subjects);
            if (subjects.length > 0) evidence.push(`科目：${subjects.join('、')}`);
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);

            const hasRoom = isNonEmptyString(item.classroomName) || isNonEmptyString(item.classroomId);
            const hasEnoughEvidence = Boolean(hasRoom && (classes.length > 0 || subjects.length > 0 || slotStr));
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'room_conflicts', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 4. room_overloads (10-group / 13-fixture matrix)
    if (Array.isArray(validationReport.room_overloads) && validationReport.room_overloads.length > 0) {
        const entry = index.codesByCode.get('SCHE_VAL_ROOM_OVERLOAD');
        const decision = resolveRoomOverloadDecision({
            validationReportSource: normalizedSource,
            outputSchemaVersion,
            isJobIdentityVerified,
            solverStatus,
            outputStatus,
            outputSolverStatus,
            degradationReasons
        });

        validationReport.room_overloads.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const itemEvidence = [];
            if (isNonEmptyString(item.subject)) {
                itemEvidence.push(`科目：${item.subject.trim()}`);
            }
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) itemEvidence.push(slotStr);
            if (isFiniteNumber(item.used) && isFiniteNumber(item.capacity)) {
                itemEvidence.push(`使用量／容量：${item.used}／${item.capacity}`);
            } else if (isFiniteNumber(item.used)) {
                itemEvidence.push(`使用量：${item.used}`);
            } else if (isFiniteNumber(item.capacity)) {
                itemEvidence.push(`容量：${item.capacity}`);
            }

            const hasItemDetails = itemEvidence.length > 0;
            const evidence = [...itemEvidence, decision.reasonEvidence];
            const finalConfidence = hasItemDetails ? decision.confidence : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence: finalConfidence,
                source: decision.source,
                sourceRef: { kind: 'validation_entry', section: 'room_overloads', index: idx },
                userMessage: hasItemDetails ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasItemDetails ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 5. unassigned_special_rooms
    if (Array.isArray(validationReport.unassigned_special_rooms)) {
        const entry = index.codesByCode.get('SCHE_VAL_UNASSIGNED_SPECIAL_ROOM');
        validationReport.unassigned_special_rooms.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            const className = isNonEmptyString(item.className)
                ? item.className.trim()
                : isNonEmptyString(item.classId)
                    ? item.classId.trim()
                    : null;
            if (className) evidence.push(`班級：${className}`);
            if (isNonEmptyString(item.subject)) {
                evidence.push(`科目：${item.subject.trim()}`);
            }
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);

            const hasEnoughEvidence = Boolean(className || isNonEmptyString(item.subject));
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'unassigned_special_rooms', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 6. grade_subject_issues
    if (Array.isArray(validationReport.grade_subject_issues)) {
        const entry = index.codesByCode.get('SCHE_VAL_GRADE_SUBJECT');
        validationReport.grade_subject_issues.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            const className = isNonEmptyString(item.className)
                ? item.className.trim()
                : isNonEmptyString(item.classId)
                    ? item.classId.trim()
                    : null;
            if (className) evidence.push(`班級：${className}`);
            if (typeof item.grade === 'number' && Number.isInteger(item.grade)) {
                evidence.push(`年級：${item.grade}年級`);
            }
            if (isNonEmptyString(item.subject)) {
                evidence.push(`科目：${item.subject.trim()}`);
            }
            const allowedGrades = filterValidIntegers(item.allowedGrades);
            if (allowedGrades.length > 0) {
                evidence.push(`允許年級：${allowedGrades.map((g) => `${g}年級`).join('、')}`);
            }
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);

            const hasEnoughEvidence = Boolean(isNonEmptyString(item.subject) && (className || typeof item.grade === 'number'));
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'grade_subject_issues', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 7. special_course_overlap_conflicts
    if (Array.isArray(validationReport.special_course_overlap_conflicts)) {
        const entry = index.codesByCode.get('SCHE_VAL_SPECIAL_COURSE_OVERLAP');
        validationReport.special_course_overlap_conflicts.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            const className = isNonEmptyString(item.className)
                ? item.className.trim()
                : isNonEmptyString(item.classId)
                    ? item.classId.trim()
                    : null;
            if (className) evidence.push(`班級：${className}`);
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);

            const entrySummaries = [];
            if (Array.isArray(item.entries)) {
                for (const sc of item.entries) {
                    if (!isPlainObject(sc)) continue;
                    const parts = [];
                    if (isNonEmptyString(sc.scName)) parts.push(sc.scName.trim());
                    if (isNonEmptyString(sc.teacher)) parts.push(`教師：${sc.teacher.trim()}`);
                    if (isNonEmptyString(sc.originalTargetSubject)) {
                        parts.push(`原科目：${sc.originalTargetSubject.trim()}`);
                    }
                    if (isNonEmptyString(sc.effectiveScheduleSubject)) {
                        parts.push(`有效科目：${sc.effectiveScheduleSubject.trim()}`);
                    }
                    if (parts.length > 0) {
                        entrySummaries.push(parts.join('（') + (parts.length > 1 ? '）'.repeat(parts.length - 1) : ''));
                    }
                }
            }
            if (entrySummaries.length > 0) {
                evidence.push(`涉及特殊課：${entrySummaries.join('、')}`);
            }
            if (isNonEmptyString(item.disposition)) {
                evidence.push(`處置分類：${item.disposition.trim()}`);
            }

            const hasEnoughEvidence = Boolean((className || slotStr) && entrySummaries.length > 0);
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'special_course_overlap_conflicts', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 8. science_same_day_shape_issues
    if (Array.isArray(validationReport.science_same_day_shape_issues)) {
        const entry = index.codesByCode.get('SCHE_VAL_SCIENCE_SAME_DAY');
        validationReport.science_same_day_shape_issues.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            const className = isNonEmptyString(item.className)
                ? item.className.trim()
                : isNonEmptyString(item.classId)
                    ? item.classId.trim()
                    : null;
            if (className) evidence.push(`班級：${className}`);
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);
            const validPeriods = filterValidIntegers(item.periods);
            if (validPeriods.length > 0) {
                evidence.push(`節次：第${validPeriods.join('、')}節`);
            }
            if (typeof item.count === 'number' && Number.isInteger(item.count) && item.count >= 0) {
                evidence.push(`同日節數：${item.count} 節`);
            }
            const subjects = filterValidStrings(item.subjects);
            if (subjects.length > 0) evidence.push(`科目：${subjects.join('、')}`);
            const teachers = filterValidStrings(item.teacherNames);
            if (teachers.length > 0) evidence.push(`教師：${teachers.join('、')}`);

            const hasEnoughEvidence = Boolean(className && (slotStr || validPeriods.length > 0 || typeof item.count === 'number'));
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'science_same_day_shape_issues', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 9. subject_day_spread_issues
    if (Array.isArray(validationReport.subject_day_spread_issues)) {
        const entry = index.codesByCode.get('SCHE_VAL_SUBJECT_DAY_SPREAD');
        validationReport.subject_day_spread_issues.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const evidence = [];
            const canonicalSubject = isNonEmptyString(item.canonicalSubject)
                ? item.canonicalSubject.trim()
                : null;
            if (canonicalSubject) {
                evidence.push(`科目：${canonicalSubject}`);
            }
            const className = isNonEmptyString(item.className)
                ? item.className.trim()
                : isNonEmptyString(item.classId)
                    ? item.classId.trim()
                    : null;
            if (className) evidence.push(`班級：${className}`);
            const slotStr = formatValidDayPeriodSlot(item);
            if (slotStr) evidence.push(slotStr);
            const validPeriods = filterValidIntegers(item.periods);
            if (validPeriods.length > 0) {
                evidence.push(`節次：第${validPeriods.join('、')}節`);
            }
            if (typeof item.count === 'number' && Number.isInteger(item.count) && item.count >= 0) {
                evidence.push(`同日節數：${item.count} 節`);
            }
            const subjects = filterValidStrings(item.subjects);
            if (subjects.length > 0 && (!canonicalSubject || subjects.join('、') !== canonicalSubject)) {
                evidence.push(`科目明細：${subjects.join('、')}`);
            }
            const teachers = filterValidStrings(item.teacherNames);
            if (teachers.length > 0) evidence.push(`教師：${teachers.join('、')}`);

            const isNativeLanguageHard = canonicalSubject === '本土語';
            if (isNativeLanguageHard) {
                evidence.push('檢查性質：本土語同日分布硬性檢查');
            } else if (canonicalSubject) {
                evidence.push('檢查性質：一般科目同日分布提示（可能相關）');
            }

            const hasEnoughEvidence = Boolean((canonicalSubject || subjects.length > 0) && className);
            const rawBaseConfidence = isNativeLanguageHard ? 'determined' : 'possible';
            const confidence = hasEnoughEvidence
                ? applyProvenanceConfidenceCap(rawBaseConfidence, normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'subject_day_spread_issues', index: idx },
                userMessage: hasEnoughEvidence ? entry.userMessage : entry.fallbackMessage,
                evidence,
                nextSteps: [...(hasEnoughEvidence ? entry.nextSteps : entry.fallbackNextSteps)]
            });
        });
    }

    // 10. special_course_input_errors
    if (Array.isArray(validationReport.special_course_input_errors)) {
        const entry = index.codesByCode.get('SCHE_VAL_SPECIAL_COURSE_INPUT_ERROR');
        validationReport.special_course_input_errors.forEach((item, idx) => {
            if (!isPlainObject(item)) return;
            const innerCode = isNonEmptyString(item.code) ? item.code.trim() : '';

            if (innerCode !== 'INVALID_SHARED_EVENT_MIXED_ENTITIES') {
                // Unknown or missing inner code: must use neutral fallback and confidence=unknown
                results.push({
                    code: entry.code,
                    severity: entry.severity,
                    confidence: 'unknown',
                    source: normalizedSource,
                    sourceRef: { kind: 'validation_entry', section: 'special_course_input_errors', index: idx },
                    userMessage: entry.fallbackMessage,
                    evidence: [],
                    nextSteps: [...entry.fallbackNextSteps]
                });
                return;
            }

            const sharedEventId = isNonEmptyString(item.sharedEventId)
                ? item.sharedEventId.trim()
                : null;
            const entities = filterValidStrings(item.entities);
            const evidence = [];
            if (sharedEventId) {
                evidence.push(`共同事件識別：${sharedEventId}`);
            }
            if (entities.length > 0) {
                evidence.push(`涉及實體：${entities.join('、')}`);
            }

            const hasCompleteFields = Boolean(sharedEventId && entities.length > 0);
            const confidence = hasCompleteFields
                ? applyProvenanceConfidenceCap('determined', normalizedSource, outputSchemaVersion, isJobIdentityVerified)
                : 'unknown';

            results.push({
                code: entry.code,
                severity: entry.severity,
                confidence,
                source: normalizedSource,
                sourceRef: { kind: 'validation_entry', section: 'special_course_input_errors', index: idx },
                userMessage: entry.userMessage,
                evidence,
                nextSteps: [...entry.nextSteps]
            });
        });
    }

    return results;
}

function buildWarningEvidenceAndCheckCompleteness(code, parsedFields, rawLine, contextLine) {
    const pf = isPlainObject(parsedFields) ? parsedFields : {};
    const evidence = [];

    switch (code) {
        case 'SCHE_WARN_CLASS_PERIOD_OVERLOAD': {
            const hasAll =
                isNonEmptyString(pf.className) &&
                isFiniteNumber(pf.needed) &&
                isFiniteNumber(pf.limit) &&
                isNonEmptyString(pf.label);
            if (isNonEmptyString(pf.className)) evidence.push(`班級：${pf.className.trim()}`);
            if (isFiniteNumber(pf.needed)) evidence.push(`需求節數：${pf.needed} 節`);
            if (isFiniteNumber(pf.limit)) evidence.push(`可用上限：${pf.limit} 節`);
            if (isNonEmptyString(pf.label)) evidence.push(`上限類別：${pf.label.trim()}`);
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_PERIOD_SHORTAGE': {
            const hasAll =
                isNonEmptyString(pf.className) &&
                isFiniteNumber(pf.needed) &&
                isFiniteNumber(pf.available);
            if (isNonEmptyString(pf.className)) evidence.push(`班級：${pf.className.trim()}`);
            if (isFiniteNumber(pf.needed)) evidence.push(`科任需求：${pf.needed} 節／週`);
            if (isFiniteNumber(pf.available)) evidence.push(`有效時段：${pf.available} 節／週`);
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_ROOM_CAPACITY_SHORTAGE': {
            const hasAll =
                isNonEmptyString(pf.subject) &&
                isFiniteNumber(pf.roomCount) &&
                isFiniteNumber(pf.needed) &&
                isFiniteNumber(pf.weeklyCapacity);
            if (isNonEmptyString(pf.subject)) evidence.push(`科目：${pf.subject.trim()}`);
            if (isFiniteNumber(pf.roomCount)) evidence.push(`教室數：${pf.roomCount} 間`);
            if (isFiniteNumber(pf.needed)) evidence.push(`全週需求：${pf.needed} 節`);
            if (isFiniteNumber(pf.weeklyCapacity)) evidence.push(`全週容量：${pf.weeklyCapacity} 節`);
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_TEACHER_LOAD_PRESSURE': {
            const hasAll = isNonEmptyString(pf.teacher) && isFiniteNumber(pf.load);
            if (isNonEmptyString(pf.teacher)) evidence.push(`教師：${pf.teacher.trim()}`);
            if (isFiniteNumber(pf.load)) evidence.push(`全週負載：${pf.load} 節`);
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_TEACHER_QUOTA_EXCEEDED': {
            const hasAll =
                isNonEmptyString(pf.teacher) &&
                isFiniteNumber(pf.actual) &&
                isFiniteNumber(pf.safeMax);
            if (isNonEmptyString(pf.teacher)) evidence.push(`教師：${pf.teacher.trim()}`);
            if (isFiniteNumber(pf.actual)) evidence.push(`配課需求：${pf.actual} 節`);
            if (isFiniteNumber(pf.safeMax)) evidence.push(`安全配額：${pf.safeMax} 節`);
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_ALTERNATING_LOAD_PRESSURE': {
            const classNamesList = Array.isArray(pf.classNames)
                ? filterValidStrings(pf.classNames)
                : isNonEmptyString(pf.classNames)
                    ? [pf.classNames.trim()]
                    : [];
            const hasAll =
                isNonEmptyString(pf.teacher) &&
                isFiniteNumber(pf.classCount) &&
                classNamesList.length > 0;
            if (isNonEmptyString(pf.teacher)) evidence.push(`教師：${pf.teacher.trim()}`);
            if (isFiniteNumber(pf.classCount)) evidence.push(`涉及班數：${pf.classCount} 班`);
            if (classNamesList.length > 0) evidence.push(`涉及班級：${classNamesList.join('、')}`);
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_SWIMMING_PRESSURE': {
            const hasAll = isFiniteNumber(pf.classCount) && isFiniteNumber(pf.poolCount);
            if (isFiniteNumber(pf.classCount)) evidence.push(`游泳班數：${pf.classCount} 班`);
            if (isFiniteNumber(pf.poolCount)) evidence.push(`泳池數量：${pf.poolCount} 個`);
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_HOMEROOM_TRACE_MISMATCH': {
            const hasAll =
                isNonEmptyString(pf.className) &&
                isFiniteNumber(pf.blockCandidatePeriods) &&
                isFiniteNumber(pf.mergedPeriods) &&
                isFiniteNumber(pf.existingHomeroomBlockPeriods) &&
                isFiniteNumber(pf.finalHomeroomBlockPeriods);
            if (isNonEmptyString(pf.className)) evidence.push(`班級：${pf.className.trim()}`);
            if (isFiniteNumber(pf.blockCandidatePeriods)) {
                evidence.push(`前端導師候選：${pf.blockCandidatePeriods} 節／週`);
            }
            if (isFiniteNumber(pf.mergedPeriods)) {
                evidence.push(`前處理合併：${pf.mergedPeriods} 節／週`);
            }
            if (isFiniteNumber(pf.existingHomeroomBlockPeriods)) {
                evidence.push(`既有導師區塊：${pf.existingHomeroomBlockPeriods} 節／週`);
            }
            if (isFiniteNumber(pf.finalHomeroomBlockPeriods)) {
                evidence.push(`最終導師區塊：${pf.finalHomeroomBlockPeriods} 節／週`);
            }
            return { evidence, isComplete: hasAll };
        }
        case 'SCHE_WARN_UNCLASSIFIED': {
            if (isNonEmptyString(rawLine)) {
                evidence.push(`原始報告行：${rawLine.trim()}`);
                if (isNonEmptyString(contextLine)) {
                    evidence.push(`相鄰脈絡：${contextLine.trim()}`);
                }
                return { evidence, isComplete: true };
            }
            evidence.push('原始警示未保存');
            return { evidence, isComplete: false };
        }
        default:
            return { evidence: [], isComplete: false };
    }
}

export function annotateDiagnosticWarningsWithSource(diagnosticWarnings = []) {
    if (!Array.isArray(diagnosticWarnings)) {
        return [];
    }
    return diagnosticWarnings.map((warning) => {
        if (!isPlainObject(warning)) return warning;
        const hasRawLine = isNonEmptyString(warning.rawLine);
        const source = hasRawLine ? 'report_file' : 'server_fallback';
        return {
            ...warning,
            source
        };
    });
}

export function buildWarningErrorCodes({
    solverStatus,
    diagnosticWarnings = [],
    index = DEFAULT_INDEX
} = {}) {
    if (solverStatus !== 'INFEASIBLE') {
        return {
            annotatedWarnings: [],
            warningErrorCodes: []
        };
    }

    const annotatedWarnings = annotateDiagnosticWarningsWithSource(diagnosticWarnings);
    const warningErrorCodes = [];

    annotatedWarnings.forEach((warning, idx) => {
        if (!isPlainObject(warning) || !isNonEmptyString(warning.code)) {
            return;
        }
        const code = warning.code.trim();
        const entry = index.codesByCode.get(code);
        const hasRawLine = isNonEmptyString(warning.rawLine);
        const source = hasRawLine ? 'report_file' : null;
        const sourceRef =
            isPlainObject(warning.sourceRef) &&
            typeof warning.sourceRef.index === 'number' &&
            Number.isInteger(warning.sourceRef.index) &&
            warning.sourceRef.index >= 0
                ? {
                    kind: isNonEmptyString(warning.sourceRef.kind) ? warning.sourceRef.kind : 'report_line',
                    section: isNonEmptyString(warning.sourceRef.section) ? warning.sourceRef.section : null,
                    index: warning.sourceRef.index
                }
                : { kind: 'report_line', section: null, index: idx };

        if (!entry) {
            warningErrorCodes.push(
                buildUnknownErrorCodeItem(code, {
                    source,
                    sourceRef,
                    index
                })
            );
            return;
        }

        const { evidence, isComplete } = buildWarningEvidenceAndCheckCompleteness(
            code,
            warning.parsedFields,
            warning.rawLine,
            warning.contextLine
        );

        const rawUserMessage = isNonEmptyString(warning.userMessage)
            ? warning.userMessage.trim()
            : isNonEmptyString(warning.message)
                ? warning.message.trim()
                : '';
        const hasUnresolvedPlaceholder = /\{[a-zA-Z0-9_]+\}/.test(rawUserMessage);

        const useFallback = !isComplete || !rawUserMessage || hasUnresolvedPlaceholder || !hasRawLine;
        const userMessage = useFallback ? entry.fallbackMessage : rawUserMessage;
        const nextSteps = useFallback
            ? [...entry.fallbackNextSteps]
            : isNonEmptyStringArray(warning.nextSteps)
                ? warning.nextSteps.map((s) => s.trim())
                : [...entry.nextSteps];

        // Provenance cap for report_file is <= possible; unclassified or incomplete/missing rawLine is unknown
        const confidence =
            code === 'SCHE_WARN_UNCLASSIFIED' || useFallback || !hasRawLine
                ? 'unknown'
                : 'possible';

        warningErrorCodes.push({
            code: entry.code,
            severity: entry.severity,
            confidence,
            source,
            sourceRef,
            userMessage,
            evidence,
            nextSteps
        });
    });

    const hasLocatable = annotatedWarnings.some(
        (w) => isPlainObject(w) && isNonEmptyString(w.code) && LOCATABLE_WARNING_CODE_SET.has(w.code.trim())
    );

    if (!hasLocatable) {
        const unlocatedEntry = index.codesByCode.get('SCHE_INFEASIBLE_UNLOCATED');
        warningErrorCodes.push({
            code: unlocatedEntry.code,
            severity: unlocatedEntry.severity,
            confidence: 'unknown',
            source: 'server_fallback',
            sourceRef: {
                kind: 'fallback',
                section: null,
                index: 0
            },
            userMessage: unlocatedEntry.userMessage,
            evidence: [],
            nextSteps: [...unlocatedEntry.nextSteps]
        });
    }

    return {
        annotatedWarnings,
        warningErrorCodes
    };
}

export function buildGtrErrorCodes(options = {}) {
    const {
        solverStatus,
        gradeTimeRuleIssues = [],
        source = 'job_output',
        isJobIdentityVerified = true,
        authorityData = DEFAULT_GTR_AUTHORITY,
        presentationsData = DEFAULT_GTR_PRESENTATIONS
    } = options || {};
    const outputSchemaVersion =
        options && Object.prototype.hasOwnProperty.call(options, 'outputSchemaVersion')
            ? options.outputSchemaVersion
            : 1;
    if (
        solverStatus !== 'INVALID_GRADE_TIME_RULE_CONFIGURATION' ||
        !isJobIdentityVerified ||
        !Array.isArray(gradeTimeRuleIssues) ||
        gradeTimeRuleIssues.length === 0
    ) {
        return [];
    }
    return renderGtrIssuesToErrorCodes(gradeTimeRuleIssues, {
        source,
        outputSchemaVersion,
        isJobIdentityVerified,
        authorityData,
        presentationsData
    });
}

function deduplicateByExactSourceRef(errorCodes) {
    const seen = new Set();
    const result = [];
    for (const item of errorCodes) {
        if (!isPlainObject(item) || !isPlainObject(item.sourceRef)) {
            result.push(item);
            continue;
        }
        const { kind, section, index } = item.sourceRef;
        const key = `${String(kind)}|${section === null ? 'null' : String(section)}|${String(index)}|${String(item.code)}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
    }
    return result;
}

export function assembleFailedSolverResult(options = {}) {
    const {
        solverStatus,
        outputStatus,
        outputSolverStatus,
        outputIdentityRejected = false,
        diagnosticWarnings = [],
        classLoadTrace = null,
        invalidClasses = null,
        validationReport = null,
        validationReportSource = null,
        degradationReasons = undefined,
        gradeTimeRuleIssues = null,
        index = DEFAULT_INDEX,
        authorityData = DEFAULT_GTR_AUTHORITY,
        presentationsData = DEFAULT_GTR_PRESENTATIONS
    } = options || {};
    const outputSchemaVersion =
        options && Object.prototype.hasOwnProperty.call(options, 'outputSchemaVersion')
            ? options.outputSchemaVersion
            : 1;
    const effectiveStatus = outputIdentityRejected
        ? 'ERROR'
        : isNonEmptyString(solverStatus)
            ? solverStatus.trim()
            : 'ERROR';

    const { errorCode, statusDetail } = resolveStatusDetail(effectiveStatus, { index });

    if (outputIdentityRejected) {
        return {
            effectiveSolverStatus: 'ERROR',
            errorCode,
            statusDetail,
            errorCodes: [],
            diagnosticWarnings: [],
            validationReport: null,
            validationReportSource: null,
            gradeTimeRuleIssues: []
        };
    }

    const isJobIdentityVerified = true;
    const rawErrorCodes = [];

    if (effectiveStatus === 'INVALID_INPUT') {
        rawErrorCodes.push(
            ...buildInputErrorCodes({
                solverStatus: effectiveStatus,
                classLoadTrace,
                invalidClasses,
                outputSchemaVersion,
                isJobIdentityVerified,
                index
            })
        );
    }

    if (effectiveStatus === 'INVALID_VALIDATION' && isPlainObject(validationReport)) {
        rawErrorCodes.push(
            ...buildValidationErrorCodes({
                validationReport,
                validationReportSource,
                solverStatus: effectiveStatus,
                outputStatus,
                outputSolverStatus,
                degradationReasons,
                outputSchemaVersion,
                isJobIdentityVerified,
                index
            })
        );
    }

    if (effectiveStatus === 'INVALID_GRADE_TIME_RULE_CONFIGURATION' && Array.isArray(gradeTimeRuleIssues)) {
        rawErrorCodes.push(
            ...buildGtrErrorCodes({
                solverStatus: effectiveStatus,
                gradeTimeRuleIssues,
                source: 'job_output',
                outputSchemaVersion,
                isJobIdentityVerified,
                authorityData,
                presentationsData
            })
        );
    }

    let annotatedWarnings = [];
    if (effectiveStatus === 'INFEASIBLE') {
        const warningResult = buildWarningErrorCodes({
            solverStatus: effectiveStatus,
            diagnosticWarnings,
            index
        });
        annotatedWarnings = warningResult.annotatedWarnings;
        rawErrorCodes.push(...warningResult.warningErrorCodes);
    }

    const errorCodes = deduplicateByExactSourceRef(rawErrorCodes);

    return {
        effectiveSolverStatus: effectiveStatus,
        errorCode,
        statusDetail,
        errorCodes,
        diagnosticWarnings: annotatedWarnings,
        validationReport: isPlainObject(validationReport) ? validationReport : null,
        validationReportSource:
            isPlainObject(validationReport) &&
            (validationReportSource === 'job_output' || validationReportSource === 'shared_file')
                ? validationReportSource
                : null,
        gradeTimeRuleIssues:
            effectiveStatus === 'INVALID_GRADE_TIME_RULE_CONFIGURATION' && Array.isArray(gradeTimeRuleIssues)
                ? gradeTimeRuleIssues
                : []
    };
}

export { renderGtrIssuePresentation, renderGtrIssuesToErrorCodes };
