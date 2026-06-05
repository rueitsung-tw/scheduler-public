/**
 * 交替課工具函式庫
 * 用於識別、拆分、合併音樂/美勞交替課的排課資料
 */

/**
 * 判斷科目是否為交替課
 * @param {string} subjectName - 科目名稱
 * @returns {boolean}
 */
export function isAlternatingSubject(subjectName) {
  if (!subjectName) return false
  return subjectName.includes('_交替') || subjectName.includes('交替') || subjectName.includes('/')
}

/**
 * 判斷科目是否為音樂/美勞相關（含交替與固定）
 * @param {string} subjectName
 * @returns {boolean}
 */
export function isMusicArtSubject(subjectName) {
  if (!subjectName) return false
  return subjectName.includes('音樂') || subjectName.includes('美勞')
}

/**
 * 從班級列表中識別所有交替課組
 * @param {Array} classes - 班級資料陣列
 * @returns {Array<Object>} 交替課組列表
 */
export function identifyAlternatingGroups(classes) {
  const groups = []

  for (const cls of classes) {
    const cname = cls.name
    const requirements = cls.course_requirements || cls.courseRequirements || []

    // 找出該班的音樂/美勞相關課程
    const musicReq = requirements.find(r =>
      r.subject.includes('音樂') && !isAlternatingSubject(r.subject)
    )
    const artReq = requirements.find(r =>
      r.subject.includes('美勞') && !isAlternatingSubject(r.subject)
    )
    const altReq = requirements.find(r => isAlternatingSubject(r.subject))

    // 只有當同時有固定部分和交替部分時才構成交替課組
    if (altReq && (musicReq || artReq)) {
      groups.push({
        class_name: cname,
        class_grade: cls.grade,
        music_teacher: musicReq ? (musicReq.teacher_name || musicReq.teacher || '') : '',
        art_teacher: artReq ? (artReq.teacher_name || artReq.teacher || '') : '',
        fixed_music_periods: musicReq ? (Number(musicReq.periods) || 0) : 0,
        fixed_art_periods: artReq ? (Number(artReq.periods) || 0) : 0,
        alternating_periods: altReq ? (Number(altReq.periods) || 1) : 1,
        alternating_subject: altReq ? altReq.subject : '音樂美勞_交替',
      })
    } else if (altReq) {
      // 只有交替部分，沒有固定部分
      groups.push({
        class_name: cname,
        class_grade: cls.grade,
        music_teacher: altReq.teacher_name || altReq.teacher || '',
        art_teacher: '',
        fixed_music_periods: 0,
        fixed_art_periods: 0,
        alternating_periods: altReq ? (Number(altReq.periods) || 1) : 1,
        alternating_subject: altReq ? altReq.subject : '音樂美勞_交替',
      })
    }
  }

  return groups
}

/**
 * 將交替課需求拆分為奇數週和偶數週的具體科目
 * @param {Object} req - 課程需求
 * @param {'odd' | 'even'} week - 週次類型
 * @returns {Object} 拆分後的課程需求
 */
export function splitAlternatingRequirement(req, week) {
  if (!isAlternatingSubject(req.subject)) {
    return { ...req }
  }

  // 奇數週: 音樂, 偶數週: 美勞 (或反之，根據 alternating_week 標記)
  const isMusicWeek = (week === 'odd' && !req.alternating_week) ||
                      (week === 'even' && req.alternating_week === 'even')

  return {
    ...req,
    subject: isMusicWeek ? '音樂' : '美勞',
    periods: 1, // 每周固定 1 節
    _alternatingInfo: {
      originalSubject: req.subject,
      week: week,
      display: isMusicWeek ? '音樂(單)' : '美勞(單)',
    },
  }
}

/**
 * 合併奇偶週排課結果
 * @param {Object} oddSchedule - 奇數週課表
 * @param {Object} evenSchedule - 偶數週課表
 * @param {Array} alternatingGroups - 交替課組列表
 * @returns {Object} 合併後的課表
 */
export function mergeAlternatingResults(oddSchedule, evenSchedule, alternatingGroups) {
  const merged = JSON.parse(JSON.stringify(oddSchedule))

  for (const group of alternatingGroups) {
    const className = group.class_name

    if (!merged[className]) continue

    // 遍歷每天每節
    for (let day = 0; day < 6; day++) {
      for (let period = 0; period < 10; period++) {
        const oddCell = oddSchedule[className]?.[day]?.[period]
        const evenCell = evenSchedule[className]?.[day]?.[period]

        if (oddCell && evenCell && oddCell.subject !== evenCell.subject) {
          // 同一格在奇偶週不同科目 → 標記為交替
          merged[className][day][period] = {
            ...oddCell,
            is_alternating: true,
            odd_subject: oddCell.subject,
            even_subject: evenCell.subject,
            display: `${oddCell.subject}/${evenCell.subject}`,
          }
        }
      }
    }
  }

  return merged
}

/**
 * 產生用於顯示的交替課標記
 * @param {Object} cell - 課表格子資料
 * @returns {string} 顯示文字
 */
export function formatAlternatingCell(entry) {
  if (!entry) return ''
  const subj = entry.subject || ''
  // 若已經被後端格式化為 "X(單)/Y(雙)"，直接回傳
  if (subj.includes('(單)') || subj.includes('(雙)')) {
    return subj
  }
  if (subj.includes('音樂') || subj.includes('美勞')) {
    return '音樂/美勞(交替)'
  }
  // 泛型斜線科目（如 健/s, s/社）
  if (subj.includes('/')) {
    return `${subj}(交替)`
  }
  if (entry.is_alternating) {
    return `${entry.odd_subject}(單)/${entry.even_subject}(雙)`
  }
  return subj
}

/**
 * 計算班級音樂/美勞總節數（含固定 + 交替）
 * @param {Array} requirements - 課程需求列表
 * @returns {{ music: number, art: number, total: number }}
 */
export function calculateMusicArtPeriods(requirements) {
  let music = 0
  let art = 0

  for (const req of requirements) {
    const subj = req.subject || ''
    const periods = Number(req.periods) || 0

    if (subj.includes('音樂') && !isAlternatingSubject(subj)) {
      music += periods
    } else if (subj.includes('美勞') && !isAlternatingSubject(subj)) {
      art += periods
    } else if (isAlternatingSubject(subj)) {
      // 交替課每周上1節，平均分配
      music += periods / 2
      art += periods / 2
    }
  }

  return { music, art, total: music + art }
}

/**
 * 驗證交替課組資料完整性
 * @param {Array} alternatingGroups - 交替課組列表
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAlternatingGroups(alternatingGroups) {
  const errors = []

  for (const group of alternatingGroups) {
    if (!group.class_name) {
      errors.push('交替課組缺少班級名稱')
    }
    if (!group.music_teacher && !group.art_teacher) {
      errors.push(`班級 ${group.class_name} 的交替課組缺少老師配置`)
    }
    if (group.fixed_music_periods < 0 || group.fixed_art_periods < 0) {
      errors.push(`班級 ${group.class_name} 的固定節數為負數`)
    }
    if (group.alternating_periods < 1) {
      errors.push(`班級 ${group.class_name} 的交替節數應至少為 1`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 將 timetable cell 格式化成可顯示的 pair 資訊。
 * 優先使用 pair 欄位，沒有時 fallback 到 oddWeek/evenWeek。
 *
 * @param {Object} cell - timetable[d][p] cell
 * @returns {{ subject: string, pairLabel: string|null, roleLabel: string|null }}
 */
export function formatCellForDisplay(cell) {
  if (!cell) return { subject: '', pairLabel: null, roleLabel: null }

  let subject = cell.subject || ''

  // Pair-aware 顯示
  if (cell.pairPartnerClass) {
    const partner = cell.pairPartnerClass
    const role = cell.pairRole || ''
    const dir = cell.pairDirection || ''

    let pairText = `${subject}  ↔ ${partner}`
    if (cell.oddWeek?.subject && cell.evenWeek?.subject) {
      pairText = `${cell.oddWeek.subject}(單)/${cell.evenWeek.subject}(雙)  ↔ ${partner}`
    }

    let roleText = null
    if (role === 'A') roleText = 'A'
    else if (role === 'B') roleText = 'B'
    if (dir) {
      roleText = roleText ? `${roleText} / ${dir}` : dir
    }

    return { subject, pairLabel: pairText, roleLabel: roleText }
  }

  // Fallback: 舊格式 oddWeek/evenWeek
  if (cell.isAlternating || cell.oddWeek || cell.evenWeek) {
    if (cell.oddWeek?.subject && cell.evenWeek?.subject) {
      subject = `${cell.oddWeek.subject}(單)/${cell.evenWeek.subject}(雙)`
    }
    return { subject, pairLabel: null, roleLabel: null }
  }

  return { subject, pairLabel: null, roleLabel: null }
}

// ============================================================
// Pair-aware 補充函式（班對班互補配對顯示）
// ============================================================

/**
 * 從 solver 輸出的 schedule 陣列建立 pair 查找 Map。
 * key  : `${pairGroupId}_${day}_${period}`
 * value: 該 slot 所有交替課 entry 陣列
 *
 * @param {Array} scheduleEntries - solver result.schedule
 * @returns {Map}
 */
export function buildPairMap(scheduleEntries) {
  const pairMap = new Map()
  for (const entry of scheduleEntries) {
    if (!entry.pairGroupId) continue
    const k = `${entry.pairGroupId}_${entry.day}_${entry.period}`
    if (!pairMap.has(k)) pairMap.set(k, [])
    pairMap.get(k).push(entry)
  }
  return pairMap
}

/**
 * 給定一個交替課 entry，找出其配對班的 entry。
 * @param {Object} entry
 * @param {Array}  scheduleEntries
 * @returns {Object|null}
 */
export function findPairPartner(entry, scheduleEntries) {
  if (!entry.pairPartnerClass) return null
  return (
    scheduleEntries.find(
      e =>
        e.className   === entry.pairPartnerClass &&
        e.day         === entry.day &&
        e.period      === entry.period &&
        e.pairGroupId === entry.pairGroupId
    ) ?? null
  )
}

/**
 * 格式化交替課格子，含配對班資訊。
 * 例：「音(單)/美(雙)  ↔ 502」
 *
 * @param {Object} entry
 * @param {Array}  scheduleEntries
 * @returns {string}
 */
export function formatAlternatingPairCell(entry, scheduleEntries) {
  if (!entry?.pairGroupId) return formatAlternatingCell(entry)
  const base    = entry.subject || formatAlternatingCell(entry)
  const partner = findPairPartner(entry, scheduleEntries)
  return partner ? `${base}  ↔ ${partner.className}` : `${base}  ⚠️無配對`
}

/**
 * 驗證 pair 互補性（測試用）。
 * 同一 (pairGroupId, day, period) 的兩班必須一個 music-first 一個 art-first。
 *
 * @param {Array} scheduleEntries
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePairComplement(scheduleEntries) {
  const errors  = []
  const pairMap = buildPairMap(scheduleEntries)

  for (const [slotKey, members] of pairMap.entries()) {
    if (members.length < 2) continue
    if (members.length > 2) {
      errors.push(`[${slotKey}] 同時段出現 ${members.length} 個交替班（期望最多 2）`)
    }
    const dirs = members.map(m => m.pairDirection)
    if (!(dirs.includes('music-first') && dirs.includes('art-first'))) {
      errors.push(
        `[${slotKey}] 方向未互補：` +
        members.map(m => `${m.className}(${m.pairDirection})`).join(', ')
      )
    }
  }
  return { valid: errors.length === 0, errors }
}
