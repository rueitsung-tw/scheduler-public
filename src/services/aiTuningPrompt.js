import { summarizeCandidateMoveForPrompt } from './aiTuningCandidates.js';

function normalizeName(value) {
  return String(value || '').trim();
}

function uniqueNames(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeName).filter(Boolean))];
}

function getClassReports(report) {
  return Array.isArray(report?.classes) ? report.classes : [];
}

function getTopIssueClassNames(report, limit = 2) {
  return getClassReports(report)
    .filter((item) => (item?.issueCount || 0) > 0)
    .sort((a, b) => (b.issueCount || 0) - (a.issueCount || 0) || normalizeName(a.className).localeCompare(normalizeName(b.className), 'zh-Hant'))
    .slice(0, limit)
    .map((item) => normalizeName(item.className))
    .filter(Boolean);
}

function orderClassNamesByIssueCount(report, classNames = []) {
  const rankMap = new Map();
  [...getClassReports(report)]
    .sort((a, b) => (b.issueCount || 0) - (a.issueCount || 0) || normalizeName(a.className).localeCompare(normalizeName(b.className), 'zh-Hant'))
    .forEach((classReport, index) => {
      rankMap.set(normalizeName(classReport.className), index + 1);
    });

  return uniqueNames(classNames).sort((a, b) => {
    const rankA = rankMap.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rankMap.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, 'zh-Hant');
  });
}

function summarizeIssueSlot(slot, maxIssuesPerSlot = 3) {
  return {
    day: slot?.day ?? null,
    period: slot?.period ?? null,
    issues: (Array.isArray(slot?.issues) ? slot.issues : []).slice(0, maxIssuesPerSlot).map((issue) => ({
      type: issue?.type || '',
      severity: issue?.severity || '',
      subject: normalizeName(issue?.subject),
      message: normalizeName(issue?.message),
    })),
  };
}

function summarizeClassReport(classReport, {
  maxIssueSlots = 4,
  maxRequirementIssues = 3,
  maxTopSubjects = 3,
} = {}) {
  return {
    className: normalizeName(classReport?.className),
    grade: classReport?.grade ?? null,
    issueCount: classReport?.issueCount ?? 0,
    requirementIssues: (Array.isArray(classReport?.requirementIssues) ? classReport.requirementIssues : [])
      .slice(0, maxRequirementIssues)
      .map((issue) => ({
        subject: normalizeName(issue?.subject),
        severity: issue?.severity || '',
        message: normalizeName(issue?.message),
        required: issue?.required ?? null,
        scheduled: issue?.scheduled ?? null,
        delta: issue?.delta ?? null,
      })),
    issueSlots: (Array.isArray(classReport?.issueSlots) ? classReport.issueSlots : [])
      .slice(0, maxIssueSlots)
      .map((slot) => summarizeIssueSlot(slot)),
    topSubjects: (Array.isArray(classReport?.topSubjects) ? classReport.topSubjects : [])
      .slice(0, maxTopSubjects)
      .map((item) => ({
        subject: normalizeName(item?.subject),
        count: item?.count ?? null,
      })),
  };
}

function summarizeTeacherLoads(teacherLoads, classNameSet, maxTeacherLoads = 6) {
  return (Array.isArray(teacherLoads) ? teacherLoads : [])
    .filter((item) => {
      if ((item?.overload || 0) > 0) return true;
      return Array.isArray(item?.classes) && item.classes.some((className) => classNameSet.has(normalizeName(className)));
    })
    .slice(0, maxTeacherLoads)
    .map((item) => ({
      teacherName: normalizeName(item?.teacherName || item?.name),
      overload: item?.overload ?? 0,
      assigned: item?.assigned ?? null,
      max: item?.max ?? null,
      classes: uniqueNames(item?.classes || []).filter((className) => classNameSet.has(className)),
    }));
}

function summarizeSwapCandidates(swapCandidates, classNameSet, maxCandidatesPerClass = 4) {
  return (Array.isArray(swapCandidates) ? swapCandidates : [])
    .filter((item) => classNameSet.has(normalizeName(item?.className)))
    .map((item) => ({
      className: normalizeName(item?.className),
      grade: item?.grade ?? null,
      candidates: (Array.isArray(item?.candidates) ? item.candidates : [])
        .slice(0, maxCandidatesPerClass)
        .map((slot) => ({
          day: slot?.day ?? null,
          period: slot?.period ?? null,
          teachable: Boolean(slot?.teachable),
          issue: Boolean(slot?.issue),
          subject: normalizeName(slot?.subject),
          teacher: normalizeName(slot?.teacher),
      })),
    }));
}

function summarizeCandidateMoves(candidateMoves, classNameSet, maxCandidates = 12) {
  return (Array.isArray(candidateMoves) ? candidateMoves : [])
    .filter((item) => {
      const className = normalizeName(item?.className);
      return classNameSet.size === 0 || classNameSet.has(className);
    })
    .slice(0, maxCandidates)
    .map((item) => summarizeCandidateMoveForPrompt(item));
}

function estimatePromptChars(promptReport, promptMarkdown) {
  return String(promptMarkdown || '').length + JSON.stringify(promptReport || {}).length;
}

function buildCompactPromptMarkdown(promptReport) {
  const lines = [];
  const scope = promptReport?.promptScope || {};
  const summary = promptReport?.summary || {};
  lines.push('# AI Timetable Tuning Focus');
  lines.push('');
  lines.push('## Scope');
  lines.push(`- focusType: ${scope.focusType || 'class'}`);
  if (scope.subject) lines.push(`- subject: ${scope.subject}`);
  if (scope.className) lines.push(`- mainClass: ${scope.className}`);
  if (Array.isArray(scope.classNames) && scope.classNames.length > 0) {
    lines.push(`- classes: ${scope.classNames.join(', ')}`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push(`- totalIssues: ${summary.issueCount ?? 0}`);
  lines.push(`- issueClasses: ${summary.issueClassCount ?? 0}`);
  lines.push(`- teacherOverloadCount: ${summary.teacherOverloadCount ?? 0}`);
  lines.push(`- teacherOverloadTotal: ${summary.teacherOverloadTotal ?? 0}`);
  lines.push('');

  if (Array.isArray(promptReport?.resourceSummary?.affectedClasses) && promptReport.resourceSummary.affectedClasses.length > 0) {
    lines.push('## Resource Summary');
    lines.push(JSON.stringify(promptReport.resourceSummary, null, 2));
    lines.push('');
  }

  if (Array.isArray(promptReport?.classes) && promptReport.classes.length > 0) {
    lines.push('## Focus Classes');
    lines.push(JSON.stringify(promptReport.classes, null, 2));
    lines.push('');
  }

  if (Array.isArray(promptReport?.issues) && promptReport.issues.length > 0) {
    lines.push('## Key Issues');
    lines.push(JSON.stringify(promptReport.issues, null, 2));
    lines.push('');
  }

  if (Array.isArray(promptReport?.teacherLoads) && promptReport.teacherLoads.length > 0) {
    lines.push('## Teacher Loads');
    lines.push(JSON.stringify(promptReport.teacherLoads, null, 2));
    lines.push('');
  }

  if (Array.isArray(promptReport?.swapCandidates) && promptReport.swapCandidates.length > 0) {
    lines.push('## Swap Candidates');
    lines.push(JSON.stringify(promptReport.swapCandidates, null, 2));
    lines.push('');
  }

  if (Array.isArray(promptReport?.candidateMoves) && promptReport.candidateMoves.length > 0) {
    lines.push('## Candidate Moves');
    lines.push(JSON.stringify(promptReport.candidateMoves, null, 2));
    lines.push('');
  }

  if (Array.isArray(promptReport?.history) && promptReport.history.length > 0) {
    lines.push('## Recent History');
    lines.push(JSON.stringify(promptReport.history, null, 2));
    lines.push('');
  }

  lines.push('## Output Contract');
  lines.push('Return strict JSON only.');
  lines.push('If candidateMoves are present, only choose moves from the candidate pool and copy their candidateId exactly.');
  lines.push('Allowed move type: same-class candidateId selection only.');
  if (Array.isArray(promptReport?.legalCandidateIds) && promptReport.legalCandidateIds.length > 0) {
    lines.push(`Legal candidateId values: ${promptReport.legalCandidateIds.join(', ')}`);
  }
  lines.push('Required keys: summary, issues, selectedMoves, warnings, nextFocus, stopReason.');
  lines.push('');
  lines.push('## Summary Format (Actionable)');
  lines.push('summary must include actionableItems array with specific problem locations:');
  lines.push('```json');
  lines.push('{"text":"...","confidence":0.0,"actionableItems":[{"className":"3年11班","day":1,"period":3,"subject":"語文-英語","location":"英語專科教室","problem":"容量超額","suggestedAction":"檢查科任科目年級專科教室使用設定"}]}');
  lines.push('```');
  lines.push('');
  lines.push('## No Guess IDs Rule');
  lines.push('如果無法從 legalCandidateIds 中選出有把握的 candidateId，selectedMoves 必須回傳 []。');
  lines.push('禁止輸出 CAND-*、座標物件、或任何 legalCandidateIds 以外的值。');
  lines.push('若本輪無合法調課選項，請在 summary.actionableItems 說明需人工處理的具體班級/節次/場域。');
  return lines.join('\n');
}

function buildPromptScope(focus, focusedClassNames, maxMovesPerRound, maxPromptChars, compacted = false) {
  return {
    focusType: focus?.focusType || 'class',
    className: normalizeName(focus?.className),
    subject: normalizeName(focus?.subject),
    linkedClasses: uniqueNames(focus?.linkedClasses || []),
    classNames: focusedClassNames,
    maxMovesPerRound: maxMovesPerRound ?? null,
    maxPromptChars,
    compacted,
  };
}

function buildPromptBudget(promptReport, promptMarkdown, maxPromptChars, targetPromptChars) {
  const estimatedChars = estimatePromptChars(promptReport, promptMarkdown);
  return {
    estimatedChars,
    maxPromptChars,
    targetPromptChars,
    withinBudget: estimatedChars <= maxPromptChars,
    withinTarget: estimatedChars <= targetPromptChars,
  };
}

function buildPromptWarnings(promptBudget) {
  const warnings = [];
  if (promptBudget.estimatedChars > promptBudget.targetPromptChars) {
    warnings.push(`本輪封包約 ${promptBudget.estimatedChars} chars，超過建議目標 ${promptBudget.targetPromptChars}。`);
  }
  if (promptBudget.estimatedChars > promptBudget.maxPromptChars) {
    warnings.push(`本輪封包約 ${promptBudget.estimatedChars} chars，超過硬上限 ${promptBudget.maxPromptChars}。`);
  }
  return warnings;
}

function buildCompactResourcePromptReport({
  report,
  focus,
  tuningContext,
  limits,
}) {
  const subject = normalizeName(focus?.subject);
  const linkedClasses = uniqueNames(focus?.linkedClasses || []);
  const baseClasses = uniqueNames([
    normalizeName(focus?.className),
    ...linkedClasses,
    ...getTopIssueClassNames(report, limits.maxFocusClasses),
  ]);
  const focusedClassNames = orderClassNamesByIssueCount(report, baseClasses).slice(0, limits.maxFocusClasses);
  const classNameSet = new Set(focusedClassNames);
  const classMap = new Map(getClassReports(report).map((item) => [normalizeName(item.className), item]));
  const classSnapshots = focusedClassNames
    .map((name) => classMap.get(name))
    .filter(Boolean)
    .map((classReport) => summarizeClassReport(classReport, {
      maxIssueSlots: limits.maxIssueSlots,
      maxRequirementIssues: limits.maxRequirementIssues,
      maxTopSubjects: limits.maxTopSubjects,
    }));

  const teacherLoads = summarizeTeacherLoads(report?.teacherLoads, classNameSet, limits.maxTeacherLoads);
  const swapCandidates = summarizeSwapCandidates(report?.swapCandidates, classNameSet, limits.maxCandidatesPerClass);
  const candidateMoves = summarizeCandidateMoves(report?.candidateMoves, classNameSet, limits.maxCandidatesPerClass * 2);
  const resourceSummary = {
    focusType: 'resource',
    subject,
    resourceName: normalizeName(focus?.resourceName || focus?.classroomName || focus?.className),
    impactedClassCount: classSnapshots.length,
    impactedClasses: classSnapshots.map((item) => item.className),
    issueCount: report?.summary?.issueCount ?? 0,
    issueClassCount: report?.summary?.issueClassCount ?? 0,
    teacherOverloadCount: report?.summary?.teacherOverloadCount ?? 0,
    teacherOverloadTotal: report?.summary?.teacherOverloadTotal ?? 0,
  };

  return {
    summary: report?.summary || {},
    promptScope: buildPromptScope(focus, focusedClassNames, tuningContext?.maxMovesPerRound, limits.maxPromptChars, limits.compacted),
    resourceSummary: {
      ...resourceSummary,
      affectedClasses: classSnapshots,
    },
    classes: classSnapshots,
    issues: classSnapshots.flatMap((item) => item.issueSlots.flatMap((slot) => slot.issues.map((issue) => ({
      className: item.className,
      day: slot.day,
      period: slot.period,
      type: issue.type,
      severity: issue.severity,
      subject: issue.subject,
      message: issue.message,
    })))).slice(0, limits.maxIssues),
    teacherLoads,
    swapCandidates,
    candidateMoves,
    legalCandidateIds: candidateMoves.map((candidate) => candidate.candidateId),
    history: (Array.isArray(tuningContext?.recentHistory) ? tuningContext.recentHistory : []).slice(-limits.maxHistoryEntries),
    limits: {
      maxFocusClasses: limits.maxFocusClasses,
      maxIssueSlots: limits.maxIssueSlots,
      maxRequirementIssues: limits.maxRequirementIssues,
      maxTopSubjects: limits.maxTopSubjects,
      maxTeacherLoads: limits.maxTeacherLoads,
      maxCandidatesPerClass: limits.maxCandidatesPerClass,
      maxHistoryEntries: limits.maxHistoryEntries,
    },
  };
}

function buildCompactClassPromptReport({
  report,
  focus,
  tuningContext,
  limits,
}) {
  const className = normalizeName(focus?.className) || getTopIssueClassNames(report, 1)[0] || '';
  const classMap = new Map(getClassReports(report).map((item) => [normalizeName(item.className), item]));
  const classReport = classMap.get(className) || getClassReports(report)[0] || null;
  const classSnapshot = classReport
    ? summarizeClassReport(classReport, {
      maxIssueSlots: limits.maxIssueSlots,
      maxRequirementIssues: limits.maxRequirementIssues,
      maxTopSubjects: limits.maxTopSubjects,
    })
    : {
      className,
      grade: null,
      issueCount: 0,
      requirementIssues: [],
      issueSlots: [],
      topSubjects: [],
    };

  const classNameSet = new Set([classSnapshot.className]);
  const teacherLoads = summarizeTeacherLoads(report?.teacherLoads, classNameSet, limits.maxTeacherLoads);
  const swapCandidates = summarizeSwapCandidates(report?.swapCandidates, classNameSet, limits.maxCandidatesPerClass);
  const candidateMoves = summarizeCandidateMoves(report?.candidateMoves, classNameSet, limits.maxCandidatesPerClass * 2);

  return {
    summary: report?.summary || {},
    promptScope: buildPromptScope({ ...focus, className: classSnapshot.className }, [classSnapshot.className], tuningContext?.maxMovesPerRound, limits.maxPromptChars, limits.compacted),
    classes: [classSnapshot],
    issues: classSnapshot.issueSlots.flatMap((slot) => slot.issues.map((issue) => ({
      className: classSnapshot.className,
      day: slot.day,
      period: slot.period,
      type: issue.type,
      severity: issue.severity,
      subject: issue.subject,
      message: issue.message,
    }))).slice(0, limits.maxIssues),
    teacherLoads,
    swapCandidates,
    candidateMoves,
    legalCandidateIds: candidateMoves.map((candidate) => candidate.candidateId),
    history: (Array.isArray(tuningContext?.recentHistory) ? tuningContext.recentHistory : []).slice(-limits.maxHistoryEntries),
    resourceSummary: null,
    limits: {
      maxFocusClasses: 1,
      maxIssueSlots: limits.maxIssueSlots,
      maxRequirementIssues: limits.maxRequirementIssues,
      maxTopSubjects: limits.maxTopSubjects,
      maxTeacherLoads: limits.maxTeacherLoads,
      maxCandidatesPerClass: limits.maxCandidatesPerClass,
      maxHistoryEntries: limits.maxHistoryEntries,
    },
  };
}

function buildBundleFromReport({
  report,
  focus,
  tuningContext,
  limits,
}) {
  if (focus?.focusType === 'resource') {
    return buildCompactResourcePromptReport({ report, focus, tuningContext, limits });
  }
  return buildCompactClassPromptReport({ report, focus, tuningContext, limits });
}

export function selectAiTuningFocusPreview({
  report,
  scheduleContext = {},
  focusStrategy = 'resource_first',
  history = [],
} = {}) {
  const normalizedStrategy = String(focusStrategy || '').trim() === 'class_first' ? 'class_first' : 'resource_first';
  const recentFocusKeys = new Set(
    (Array.isArray(history) ? history : [])
      .slice(-2)
      .map((item) => {
        const focus = item?.focus || {};
        if (focus.focusType === 'resource' && focus.subject) return `resource:${normalizeName(focus.subject)}`;
        if (focus.focusType === 'class' && focus.className) return `class:${normalizeName(focus.className)}`;
        return '';
      })
      .filter(Boolean)
  );

  const classCandidates = getClassReports(report)
    .map((classReport) => ({
      focusType: 'class',
      className: normalizeName(classReport.className),
      grade: classReport.grade,
      issueCount: classReport.issueCount || 0,
      requirementIssueCount: Array.isArray(classReport.requirementIssues) ? classReport.requirementIssues.length : 0,
      roomIssueCount: Array.isArray(classReport.issueSlots)
        ? classReport.issueSlots.reduce((count, slot) => count + slot.issues.filter((issue) => issue.type === 'room').length, 0)
        : 0,
      teacherIssueCount: Array.isArray(classReport.issueSlots)
        ? classReport.issueSlots.reduce((count, slot) => count + slot.issues.filter((issue) => issue.type === 'teacher').length, 0)
        : 0,
      gradeIssueCount: Array.isArray(classReport.issueSlots)
        ? classReport.issueSlots.reduce((count, slot) => count + slot.issues.filter((issue) => issue.type === 'grade').length, 0)
        : 0,
      reason: `班級 ${classReport.className} 目前總問題數為 ${classReport.issueCount || 0}。`,
    }))
    .sort((a, b) =>
      b.issueCount - a.issueCount
      || b.roomIssueCount - a.roomIssueCount
      || b.requirementIssueCount - a.requirementIssueCount
      || b.teacherIssueCount - a.teacherIssueCount
      || a.className.localeCompare(b.className, 'zh-Hant')
    );

  const classroomCapacityMap = new Map();
  for (const room of Array.isArray(scheduleContext?.classrooms) ? scheduleContext.classrooms : []) {
    const subject = normalizeName(room.subject);
    if (!subject) continue;
    classroomCapacityMap.set(subject, (classroomCapacityMap.get(subject) || 0) + 1);
  }

  const subjectStats = new Map();
  for (const classReport of getClassReports(report)) {
    for (const slot of Array.isArray(classReport.issueSlots) ? classReport.issueSlots : []) {
      const slotSubjects = new Set(
        (Array.isArray(slot.entries) ? slot.entries : [])
          .map((entry) => normalizeName(entry.subject))
          .filter(Boolean)
      );
      const issueTypes = new Set((Array.isArray(slot.issues) ? slot.issues : []).map((issue) => issue.type).filter(Boolean));
      if (slotSubjects.size === 0 || !issueTypes.has('room')) continue;

      for (const subject of slotSubjects) {
        const current = subjectStats.get(subject) || {
          focusType: 'resource',
          subject,
          capacity: classroomCapacityMap.get(subject) || 0,
          roomIssueCount: 0,
          teacherIssueCount: 0,
          gradeIssueCount: 0,
          issueCount: 0,
          classes: new Set(),
          reason: '',
        };

        current.capacity = classroomCapacityMap.get(subject) || current.capacity || 0;
        current.roomIssueCount += 1;
        current.issueCount += Array.isArray(slot.issues) ? slot.issues.length : 0;
        if (issueTypes.has('teacher')) current.teacherIssueCount += 1;
        if (issueTypes.has('grade')) current.gradeIssueCount += 1;
        current.classes.add(normalizeName(classReport.className));
        subjectStats.set(subject, current);
      }
    }
  }

  const resourceCandidates = [...subjectStats.values()]
    .map((item) => ({
      ...item,
      classes: [...item.classes].sort(),
      score:
        item.roomIssueCount * 1000
        + item.classes.length * 50
        + item.teacherIssueCount * 25
        + item.gradeIssueCount * 15
        + Math.max(0, 10 - Math.min(item.capacity || 0, 10)) * 10,
    }))
    .sort((a, b) =>
      b.score - a.score
      || b.roomIssueCount - a.roomIssueCount
      || b.classes.length - a.classes.length
      || String(a.subject).localeCompare(String(b.subject), 'zh-Hant')
    );

  const pickBest = (candidates) => {
    const filtered = candidates.filter((candidate) => !recentFocusKeys.has(
      candidate.focusType === 'resource'
        ? `resource:${normalizeName(candidate.subject)}`
        : `class:${normalizeName(candidate.className)}`
    ));
    return (filtered.length > 0 ? filtered : candidates)[0] || null;
  };

  if (normalizedStrategy === 'class_first') {
    const bestClass = pickBest(classCandidates);
    if (bestClass) {
      return {
        ...bestClass,
        reason: `先從問題最多的班級 ${bestClass.className} 開始。`,
      };
    }
  } else {
    const bestResource = pickBest(resourceCandidates);
    if (bestResource) {
      const relatedClasses = uniqueNames(bestResource.classes);
      const bestRelatedClass = relatedClasses.length > 0
        ? classCandidates
            .filter((candidate) => relatedClasses.includes(candidate.className))
            .sort((a, b) =>
              b.issueCount - a.issueCount
              || b.roomIssueCount - a.roomIssueCount
              || a.className.localeCompare(b.className, 'zh-Hant')
            )[0] || null
        : null;

      return {
        ...bestResource,
        className: bestRelatedClass?.className || relatedClasses[0] || '',
        linkedClasses: relatedClasses.slice(0, 3),
        reason: bestRelatedClass
          ? `先修最稀缺的 ${bestResource.subject} 資源，再追蹤 ${bestRelatedClass.className} 的連鎖衝突。`
          : `先修最稀缺的 ${bestResource.subject} 資源。`,
      };
    }
  }

  const fallbackClass = pickBest(classCandidates);
  if (fallbackClass) {
    return {
      ...fallbackClass,
      reason: `找不到明確的專科資源焦點，先從問題最多的班級 ${fallbackClass.className} 開始。`,
    };
  }

  return {
    focusType: 'class',
    className: '',
    reason: '目前沒有可辨識的修復焦點。',
  };
}

export function buildAiTuningPromptBundle({
  report,
  focus = null,
  tuningContext = {},
  maxPromptChars = 100000,
} = {}) {
  const strategy = focus?.focusType === 'resource' ? 'resource_first' : 'class_first';
  const attemptPlans = strategy === 'resource_first'
    ? [
        { maxFocusClasses: 3, maxIssueSlots: 4, maxRequirementIssues: 3, maxTopSubjects: 2, maxTeacherLoads: 5, maxCandidatesPerClass: 4, maxIssues: 20, maxHistoryEntries: 2, targetPromptChars: 60000 },
        { maxFocusClasses: 2, maxIssueSlots: 3, maxRequirementIssues: 2, maxTopSubjects: 2, maxTeacherLoads: 4, maxCandidatesPerClass: 3, maxIssues: 12, maxHistoryEntries: 2, targetPromptChars: 45000 },
        { maxFocusClasses: 1, maxIssueSlots: 2, maxRequirementIssues: 2, maxTopSubjects: 1, maxTeacherLoads: 3, maxCandidatesPerClass: 2, maxIssues: 8, maxHistoryEntries: 1, targetPromptChars: 30000 },
      ]
    : [
        { maxFocusClasses: 1, maxIssueSlots: 4, maxRequirementIssues: 3, maxTopSubjects: 2, maxTeacherLoads: 4, maxCandidatesPerClass: 4, maxIssues: 16, maxHistoryEntries: 2, targetPromptChars: 40000 },
        { maxFocusClasses: 1, maxIssueSlots: 3, maxRequirementIssues: 2, maxTopSubjects: 2, maxTeacherLoads: 3, maxCandidatesPerClass: 3, maxIssues: 10, maxHistoryEntries: 2, targetPromptChars: 30000 },
        { maxFocusClasses: 1, maxIssueSlots: 2, maxRequirementIssues: 2, maxTopSubjects: 1, maxTeacherLoads: 2, maxCandidatesPerClass: 2, maxIssues: 8, maxHistoryEntries: 1, targetPromptChars: 24000 },
      ];

  let bestBundle = null;
  for (const limits of attemptPlans) {
    const promptReport = buildBundleFromReport({
      report,
      focus,
      tuningContext,
      limits: {
        ...limits,
        maxPromptChars,
        compacted: limits.targetPromptChars < maxPromptChars,
      },
    });
    const promptMarkdown = buildCompactPromptMarkdown(promptReport);
    const promptBudget = buildPromptBudget(promptReport, promptMarkdown, maxPromptChars, limits.targetPromptChars);
    const promptWarnings = buildPromptWarnings(promptBudget);
    const bundle = {
      promptReport,
      promptMarkdown,
      promptScope: promptReport.promptScope,
      promptBudget: {
        ...promptBudget,
        strategy,
      },
      promptWarnings,
    };
    bestBundle = bundle;
    if (promptBudget.withinBudget && promptBudget.withinTarget) {
      return bundle;
    }
  }

  return bestBundle;
}
