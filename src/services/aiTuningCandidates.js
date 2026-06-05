const DAY_LABELS = {
  1: '週一',
  2: '週二',
  3: '週三',
  4: '週四',
  5: '週五',
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

function uniqueValues(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean))];
}

function slotKey(day, period) {
  return `${Number(day) || 0}-${Number(period) || 0}`;
}

function formatDayLabel(day) {
  return DAY_LABELS[Number(day)] || `週${Number(day) || ''}`;
}

function formatSlotLabel(day, period) {
  return `${formatDayLabel(day)}第${Number(period) || 0}節`;
}

function getEntryTeachers(entry) {
  if (Array.isArray(entry?.teacherNames) && entry.teacherNames.length > 0) {
    return uniqueValues(entry.teacherNames);
  }
  const teacher = normalizeText(entry?.teacherName || entry?.teacher);
  return teacher ? [teacher] : [];
}

function getEntrySubjects(entry) {
  const subject = normalizeText(entry?.subject || entry?.course || entry?.name);
  return subject ? [subject] : [];
}

function formatEntriesLabel(entries) {
  const subjects = uniqueValues(
    (Array.isArray(entries) ? entries : []).flatMap((entry) => getEntrySubjects(entry))
  );
  const teachers = uniqueValues(
    (Array.isArray(entries) ? entries : []).flatMap((entry) => getEntryTeachers(entry))
  );
  const subjectLabel = subjects.length > 0 ? subjects.join(' / ') : '--';
  const teacherLabel = teachers.length > 0 ? ` (${teachers.join(' / ')})` : '';
  return `${subjectLabel}${teacherLabel}`;
}

function summarizeSlot(slot) {
  const entries = Array.isArray(slot?.entries) ? slot.entries : [];
  const issues = Array.isArray(slot?.issues) ? slot.issues : [];
  const issueTypes = uniqueValues(issues.map((issue) => issue?.type));
  const hardIssueCount = issues.filter((issue) => String(issue?.severity || '').trim() === 'hard').length;
  const subjects = uniqueValues(entries.flatMap((entry) => getEntrySubjects(entry)));
  const teachers = uniqueValues(entries.flatMap((entry) => getEntryTeachers(entry)));

  return {
    day: Number(slot?.day) || 0,
    period: Number(slot?.period) || 0,
    slotKey: slotKey(slot?.day, slot?.period),
    label: formatSlotLabel(slot?.day, slot?.period),
    subjectLabel: subjects.length > 0 ? subjects.join(' / ') : '--',
    teacherLabel: teachers.length > 0 ? teachers.join(' / ') : '',
    display: formatEntriesLabel(entries),
    entries,
    issues,
    issueCount: issues.length,
    hardIssueCount,
    issueTypes,
    teachable: Boolean(slot?.teachable),
  };
}

function compareSlotPriority(a, b) {
  return (
    (b.hardIssueCount - a.hardIssueCount)
    || (b.issueCount - a.issueCount)
    || (Number(b.teachable) - Number(a.teachable))
    || (a.day - b.day)
    || (a.period - b.period)
  );
}

function compareCandidatePriority(a, b) {
  return (
    (b.score - a.score)
    || (b.from.hardIssueCount - a.from.hardIssueCount)
    || (b.from.issueCount - a.from.issueCount)
    || (b.to.teachable - a.to.teachable)
    || (a.className.localeCompare(b.className, 'zh-Hant'))
    || (a.from.day - b.from.day)
    || (a.from.period - b.from.period)
    || (a.to.day - b.to.day)
    || (a.to.period - b.to.period)
  );
}

function buildCandidateId(className, fromSlot, toSlot) {
  return `CAND-${normalizeText(className)}-D${fromSlot.day}P${fromSlot.period}-D${toSlot.day}P${toSlot.period}`;
}

function buildPairKey(className, slotA, slotB) {
  const keyA = slotKey(slotA.day, slotA.period);
  const keyB = slotKey(slotB.day, slotB.period);
  const [first, second] = [keyA, keyB].sort();
  return `${normalizeText(className)}|${first}|${second}`;
}

function buildCandidateSummary(className, fromSlot, toSlot) {
  return `${normalizeText(className)}｜${fromSlot.label} ${fromSlot.subjectLabel} ↔ ${toSlot.label} ${toSlot.subjectLabel}`;
}

function buildCandidateReason(fromSlot, toSlot) {
  const fromIssueText = fromSlot.issueTypes.length > 0 ? fromSlot.issueTypes.join('、') : '問題時段';
  const toIssueText = toSlot.issueTypes.length > 0 ? toSlot.issueTypes.join('、') : '較穩定時段';
  return `優先處理 ${fromIssueText}，與 ${toIssueText} 進行同班交換`;
}

function buildCandidateImpactSummary(classReport, fromSlot, toSlot) {
  return {
    className: normalizeText(classReport?.className),
    grade: classReport?.grade ?? null,
    fromIssueCount: fromSlot.issueCount,
    toIssueCount: toSlot.issueCount,
    fromIssueTypes: fromSlot.issueTypes,
    toIssueTypes: toSlot.issueTypes,
    fromTeachable: fromSlot.teachable,
    toTeachable: toSlot.teachable,
    hasIssueAnchor: fromSlot.issueCount > 0,
  };
}

function buildCandidateObject(classReport, fromSlot, toSlot) {
  const className = normalizeText(classReport?.className);
  const candidateId = buildCandidateId(className, fromSlot, toSlot);
  return {
    candidateId,
    className,
    grade: classReport?.grade ?? null,
    from: {
      day: fromSlot.day,
      period: fromSlot.period,
      label: fromSlot.label,
      subjectLabel: fromSlot.subjectLabel,
      teacherLabel: fromSlot.teacherLabel,
      display: fromSlot.display,
      issueCount: fromSlot.issueCount,
      hardIssueCount: fromSlot.hardIssueCount,
      issueTypes: fromSlot.issueTypes,
      teachable: fromSlot.teachable,
    },
    to: {
      day: toSlot.day,
      period: toSlot.period,
      label: toSlot.label,
      subjectLabel: toSlot.subjectLabel,
      teacherLabel: toSlot.teacherLabel,
      display: toSlot.display,
      issueCount: toSlot.issueCount,
      hardIssueCount: toSlot.hardIssueCount,
      issueTypes: toSlot.issueTypes,
      teachable: toSlot.teachable,
    },
    summaryText: buildCandidateSummary(className, fromSlot, toSlot),
    reason: buildCandidateReason(fromSlot, toSlot),
    impactSummary: buildCandidateImpactSummary(classReport, fromSlot, toSlot),
    score: (
      (fromSlot.hardIssueCount * 20)
      + (fromSlot.issueCount * 10)
      + (fromSlot.teachable ? 2 : 0)
      - (toSlot.issueCount * 3)
      - (toSlot.hardIssueCount * 5)
      + (toSlot.teachable ? 1 : 0)
    ),
    pairKey: buildPairKey(className, fromSlot, toSlot),
  };
}

export function buildAiTuningCandidatePool(report, options = {}) {
  const classReports = Array.isArray(report?.classes) ? report.classes : [];
  const maxClasses = Number.isFinite(Number(options.maxClasses)) ? Number(options.maxClasses) : 3;
  const maxAnchorsPerClass = Number.isFinite(Number(options.maxAnchorsPerClass)) ? Number(options.maxAnchorsPerClass) : 4;
  const maxCandidatesPerAnchor = Number.isFinite(Number(options.maxCandidatesPerAnchor)) ? Number(options.maxCandidatesPerAnchor) : 4;
  const maxCandidatesPerClass = Number.isFinite(Number(options.maxCandidatesPerClass)) ? Number(options.maxCandidatesPerClass) : 12;

  const focusClassReports = classReports
    .filter((classReport) => (classReport?.issueCount || 0) > 0)
    .sort((a, b) => {
      const issueDiff = (b.issueCount || 0) - (a.issueCount || 0);
      if (issueDiff !== 0) return issueDiff;
      const roomDiff = (Array.isArray(b.issueSlots) ? b.issueSlots.length : 0) - (Array.isArray(a.issueSlots) ? a.issueSlots.length : 0);
      if (roomDiff !== 0) return roomDiff;
      return normalizeText(a.className).localeCompare(normalizeText(b.className), 'zh-Hant');
    })
    .slice(0, maxClasses);

  const candidatePool = [];
  const candidateMoves = [];

  for (const classReport of focusClassReports) {
    const slotRows = Array.isArray(classReport?.slotRows) ? classReport.slotRows : [];
    const occupiedSlots = slotRows
      .filter((slot) => Array.isArray(slot?.entries) && slot.entries.length > 0)
      .map((slot) => summarizeSlot(slot))
      .filter((slot) => slot.entries.length > 0);

    const issueSlots = occupiedSlots
      .filter((slot) => slot.issueCount > 0)
      .sort(compareSlotPriority)
      .slice(0, maxAnchorsPerClass);

    if (issueSlots.length === 0) {
      continue;
    }

    const classCandidates = [];
    const seenPairs = new Set();

    for (const anchor of issueSlots) {
      const partnerSlots = occupiedSlots
        .filter((slot) => slot.slotKey !== anchor.slotKey)
        .sort((a, b) => {
          const issuePref = (a.issueCount > 0 ? 1 : 0) - (b.issueCount > 0 ? 1 : 0);
          if (issuePref !== 0) return issuePref;
          const hardDiff = a.hardIssueCount - b.hardIssueCount;
          if (hardDiff !== 0) return hardDiff;
          const issueDiff = a.issueCount - b.issueCount;
          if (issueDiff !== 0) return issueDiff;
          const teachableDiff = Number(b.teachable) - Number(a.teachable);
          if (teachableDiff !== 0) return teachableDiff;
          return a.day - b.day || a.period - b.period;
        })
        .slice(0, maxCandidatesPerAnchor);

      for (const partner of partnerSlots) {
        const pairKey = buildPairKey(classReport.className, anchor, partner);
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const candidate = buildCandidateObject(classReport, anchor, partner);
        classCandidates.push(candidate);
      }
    }

    classCandidates.sort(compareCandidatePriority);
    const limitedCandidates = classCandidates.slice(0, maxCandidatesPerClass);

    if (limitedCandidates.length === 0) {
      continue;
    }

    candidatePool.push({
      className: normalizeText(classReport.className),
      grade: classReport?.grade ?? null,
      issueCount: classReport?.issueCount ?? 0,
      candidateCount: limitedCandidates.length,
      candidates: limitedCandidates,
    });
    candidateMoves.push(...limitedCandidates);
  }

  return {
    candidatePool,
    candidateMoves,
  };
}

export function summarizeCandidateMoveForPrompt(candidate) {
  return {
    candidateId: candidate?.candidateId || '',
    className: normalizeText(candidate?.className),
    grade: candidate?.grade ?? null,
    summaryText: normalizeText(candidate?.summaryText),
    reason: normalizeText(candidate?.reason),
    from: candidate?.from || null,
    to: candidate?.to || null,
    score: candidate?.score ?? 0,
  };
}
