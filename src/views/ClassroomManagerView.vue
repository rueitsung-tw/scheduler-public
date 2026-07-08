<template>
  <div class="classroom-container">
    <h2>🏫 專科教室與教學空間管理</h2>
    <p class="desc">設定各科專屬教室、主要負責人。建議先完成科任配課，再回頭設定主場教室以避免邏輯衝突。</p>

    <div v-if="!isEditing" class="form-card">
      <h3>➕ 新增專科教室</h3>
      <div class="form-grid">
        <div class="form-group">
          <label>教室名稱：</label>
          <input v-model="newRoom.name" type="text" placeholder="例如：自然教室一" />
        </div>
        <div class="form-group">
          <label>所屬科目：</label>
          <select v-model="newRoom.subject">
            <option disabled value="">請選擇科目</option>
            <option v-for="sub in availableSubjects" :key="sub" :value="sub">{{ sub }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>主要負責教師 (主場)：</label>
          <select v-model="newRoom.primaryTeacher">
            <option value="">無 (完全共享)</option>
            <option v-for="t in getFilteredTeachers(newRoom.subject)" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
        <!-- 🆕 [gradePreferences] 優先年級選單 -->
        <div class="form-group">
          <label>優先年級</label>
          <select v-model="newRoom.gradePreferencesRaw">
            <option value="shared">共享（所有年級皆可）</option>
            <option value="1">1 年級優先</option>
            <option value="2">2 年級優先</option>
            <option value="3">3 年級優先</option>
            <option value="4">4 年級優先</option>
            <option value="5">5 年級優先</option>
            <option value="6">6 年級優先</option>
          </select>
        </div>
      </div>
      <button @click="saveRoom" class="save-btn">新增專科教室</button>
    </div>

    <div v-else class="form-card edit-mode">
      <h3>📝 編輯專科教室：{{ editForm.name }}</h3>
      <div class="form-grid">
        <div class="form-group">
          <label>教室名稱：</label>
          <input v-model="editForm.name" type="text" />
        </div>
        <div class="form-group">
          <label>修改負責教師：</label>
          <select v-model="editForm.primaryTeacher">
            <option value="">無 (完全共享)</option>
            <option v-for="t in getFilteredTeachers(editForm.subject)" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>所屬科目 (唯讀)：</label>
          <input :value="editForm.subject" disabled class="disabled-input" />
        </div>
        <!-- 🆕 [gradePreferences] 優先年級選單 -->
        <div class="form-group">
          <label>優先年級</label>
          <select v-model="editForm.gradePreferencesRaw">
            <option value="shared">共享（所有年級皆可）</option>
            <option value="1">1 年級優先</option>
            <option value="2">2 年級優先</option>
            <option value="3">3 年級優先</option>
            <option value="4">4 年級優先</option>
            <option value="5">5 年級優先</option>
            <option value="6">6 年級優先</option>
          </select>
        </div>
      </div>
      <div class="edit-actions">
        <button @click="updateRoom" class="update-btn">💾 儲存修改</button>
        <button @click="cancelEdit" class="cancel-btn">取消</button>
      </div>
    </div>

    <div class="list-card">
      <div class="list-header">
        <h3>🏢 已建檔之專科教室</h3>
        <div class="ei-buttons">
          <button @click="handleExportClassrooms" class="ei-btn export-btn">📤 匯出教室資料</button>
          <button @click="triggerImportClassrooms" class="ei-btn import-btn">📥 匯入教室資料</button>
          <input
            ref="classroomFileInput"
            type="file"
            accept=".json,application/json"
            style="display: none"
            @change="handleImportClassrooms"
          />
        </div>
      </div>
      <p v-if="eiMessage" :class="['ei-message', eiType]">{{ eiMessage }}</p>
      <table class="room-table">
        <thead>
          <tr>
            <th>教室名稱</th>
            <th>對應科目</th>
            <th>負責教師</th>
            <!-- 🆕 [gradePreferences] 優先年級標籤 -->
            <th>優先年級</th>
            <th>操作與課表</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="room in scheduleStore.classrooms" :key="room.id">
            <td class="font-bold">{{ room.name }}</td>
            <td><span class="tag">{{ room.subject }}</span></td>
            <td>
              <span v-if="room.primaryTeacher" class="teacher-badge">👨‍🏫 {{ room.primaryTeacher }}</span>
              <span v-else class="shared-badge">🤝 共享</span>
            </td>
            <!-- 🆕 [gradePreferences] 優先年級標籤 -->
            <td>
              <span v-if="room.gradePreferences && room.gradePreferences.length > 0"
                    class="badge badge-grade">
                {{ room.gradePreferences[0] }} 年級優先
              </span>
              <span v-else class="badge badge-shared">共享</span>
            </td>
            <td>
              <div class="action-buttons">
                <button @click="openTimetable(room)" class="view-btn">📅 課表</button>
                <button @click="startEdit(room)" class="edit-btn">✏️ 編輯</button>
                <button v-if="room.primaryTeacher" @click="clearTeacher(room)" class="clear-btn" title="清空負責老師">🧹</button>
                <button @click="deleteRoom(room.id)" class="del-btn">刪除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="selectedRoom" class="modal-overlay" @click.self="selectedRoom = null">
      <div class="modal-content timetable-modal">

        <div class="print-header">
          <div class="school-info">臺北市中正區<br>東門國民小學</div>
          <div class="room-title-area">
            <h1 class="room-title">{{ selectedRoom.name }}</h1>
          </div>
          <div class="teacher-info">
            {{ scheduleStore.schoolInfo?.academic_year || '114' }}學年度<br>
            教師：<strong>{{ selectedRoom.primaryTeacher || '共享教室' }}</strong>
          </div>
        </div>

        <table class="classic-timetable">
          <thead>
            <tr>
              <th class="narrow-col">午別</th>
              <th class="narrow-col">節次</th>
              <th class="time-col">
                <div class="diagonal-header">
                  <span class="day-text">星期</span>
                  <span class="time-text">時間</span>
                </div>
              </th>
              <th>一</th>
              <th>二</th>
              <th>三</th>
              <th>四</th>
              <th>五</th>
            </tr>
          </thead>
          <tbody>
            <!-- --- 上午節次區塊 --- -->
            <tr>
              <td rowspan="6" class="vertical-text">上<br><br>午</td>
              <td>晨</td>
              <td class="time-cell">08:00<br>08:40</td>
              <td colspan="5" class="morning-time">晨光時間</td>
            </tr>
            <tr>
              <td>1</td>
              <td class="time-cell">08:45<br>09:25</td>
              <td v-for="d in 5" :key="'am1-'+d" class="class-cell font-bold" :class="{'conflict-cell': getRoomClasses(d, 1).includes('⚠️')}">
                {{ getRoomClasses(d, 1) }}
              </td>
            </tr>
            <tr>
              <td>2</td>
              <td class="time-cell">09:35<br>10:15</td>
              <td v-for="d in 5" :key="'am2-'+d" class="class-cell font-bold" :class="{'conflict-cell': getRoomClasses(d, 2).includes('⚠️')}">
                {{ getRoomClasses(d, 2) }}
              </td>
            </tr>
            <tr>
              <td></td>
              <td class="time-cell">10:15<br>10:30</td>
              <td colspan="5" class="break-time">課間活動</td>
            </tr>
            <tr>
              <td>3</td>
              <td class="time-cell">10:30<br>11:10</td>
              <td v-for="d in 5" :key="'am3-'+d" class="class-cell font-bold" :class="{'conflict-cell': getRoomClasses(d, 3).includes('⚠️')}">
                {{ getRoomClasses(d, 3) }}
              </td>
            </tr>
            <!-- 👑 關鍵修復：單獨抽出第 4 節。此時「上午」大欄位已被第一行的 rowspan=5 包含，因此這一行不需要排第一個 td，直接從節次欄 td 開始，總格數完美對齊！ -->
            <tr>
              <td>4</td>
              <td class="time-cell">11:10<br>11:50</td>
              <td v-for="d in 5" :key="'am4-'+d" class="class-cell font-bold" :class="{'conflict-cell': getRoomClasses(d, 4).includes('⚠️')}">
                {{ getRoomClasses(d, 4) }}
              </td>
            </tr>

            <!-- --- 中午休息區塊 --- -->
            <tr class="lunch-row">
              <td colspan="3">12:00<br>13:15</td>
              <td colspan="5" class="lunch-time">午 餐 、 口 腔 清 潔 活 動 、 午 休</td>
            </tr>

            <!-- --- 下午節次區塊 --- -->
            <tr>
              <td rowspan="3" class="vertical-text">下<br><br>午</td>
              <td>5</td>
              <td class="time-cell">13:15<br>13:55</td>
              <td v-for="d in 5" :key="'pm5-'+d" class="class-cell font-bold" :class="{'conflict-cell': d !== 3 && getRoomClasses(d, 5).includes('⚠️')}">
                <template v-if="d === 3"><span class="vertical-text meeting" style="letter-spacing:2px; font-size:0.85em;">教師進修<br>研習活動</span></template>
                <template v-else>{{ getRoomClasses(d, 5) }}</template>
              </td>
            </tr>
            <tr>
              <td>6</td>
              <td class="time-cell">14:05<br>14:45</td>
              <td v-for="d in 5" :key="'pm6-'+d" class="class-cell font-bold" :class="{'hide-cell': d === 3, 'conflict-cell': d !== 3 && getRoomClasses(d, 6).includes('⚠️')}">
                <template v-if="d !== 3">{{ getRoomClasses(d, 6) }}</template>
              </td>
            </tr>
            <tr>
              <td>7</td>
              <td class="time-cell">14:55<br>15:35</td>
              <td v-for="d in 5" :key="'pm7-'+d" class="class-cell font-bold" :class="{'hide-cell': d === 3, 'conflict-cell': d !== 3 && getRoomClasses(d, 7).includes('⚠️')}">
                <template v-if="d !== 3">{{ getRoomClasses(d, 7) }}</template>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="modal-actions print-hide">
          <button @click="printTimetable" class="print-btn">🖨️ 列印課表</button>
          <button @click="selectedRoom = null" class="close-btn">關閉</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useScheduleStore } from '../stores/schedule'
import { formatRoomSlotAssignments } from '../utils/classroomTimetable'

const scheduleStore = useScheduleStore()

// 🆕 專科教室獨立匯出/匯入
const classroomFileInput = ref(null)
const eiMessage = ref('')
const eiType = ref('success')

// 基礎資料狀態
const newRoom = ref({ name: '', subject: '', primaryTeacher: '', allowSharing: true, gradePreferencesRaw: 'shared' })
const isEditing = ref(false)
const editForm = ref({ id: '', name: '', subject: '', primaryTeacher: '', gradePreferencesRaw: 'shared' })

const availableSubjects = computed(() => {
  // Canonical classroom subject keys — 與系統標準領域設定一致
  // 不再出現課程科目名稱（如「英語」），只顯示教室分類 key
  return ['自然科學', '語文-英語', '音樂', '美勞', '資訊', '體育', '本土語', '閱讀']
})

const subjectToExpertiseMap = {
  '自然科學': ['自然', '自然科學'],
  '語文-英語': ['英語', '英文', '語文-英語'],
  '音樂': ['音樂', '藝術'],
  '美勞': ['美勞', '藝術', '美術'],
  '資訊': ['資訊', '科技', '科技-資訊'],
  '體育': ['體育', '健康與體育', '健康'],
  '本土語': ['本土語', '本土語言', '語文-本土語'],
  '閱讀': ['閱讀'],
}

// 🌟 封裝過濾邏輯，供新增與編輯同時使用
const getFilteredTeachers = (subject) => {
  if (!subject || !scheduleStore.teachers) return []
  const mapped = subjectToExpertiseMap[subject] || [subject]
  return scheduleStore.teachers.filter(t => {
    const raw = t.expertiseSubjects || t.expertise || ''
    const exps = Array.isArray(raw) ? raw : String(raw).split(/[,/、]/)
    return exps.some(e => {
      const c = e.trim()
      return c === subject || c.includes(subject) || mapped.some(m => c.includes(m) || m.includes(c))
    })
  })
}

// 🚀 編輯邏輯
const startEdit = (room) => {
  isEditing.value = true
  // 🆕 反向轉換：gradePreferences 陣列 → UI 用的 gradePreferencesRaw
  const gp = room.gradePreferences;
  const gradePreferencesRaw = (Array.isArray(gp) && gp.length > 0)
    ? String(gp[0])
    : 'shared';
  editForm.value = {
    ...room,
    gradePreferencesRaw
  }
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const cancelEdit = () => {
  isEditing.value = false
}

// 🆕 [gradePreferences] 轉換 UI 用的 gradePreferencesRaw → 陣列格式
const updateRoom = async () => {
  const gradePreferences = editForm.value.gradePreferencesRaw === 'shared'
    ? []
    : [parseInt(editForm.value.gradePreferencesRaw, 10)];

  const updates = {
    name: editForm.value.name,
    primaryTeacher: editForm.value.primaryTeacher,
    gradePreferences,
  };
  const success = await scheduleStore.updateClassroom(editForm.value.id, updates);
  if (success) {
    isEditing.value = false
    alert('✅ 教室資料已更新！')
  }
}

// 🚀 清空老師邏輯
const clearTeacher = async (room) => {
  if (confirm(`確定要取消「${room.name}」的負責老師嗎？(教室資料會保留)`)) {
    // 🐛 修復：使用 store 的 clearTeacher 方法(保留 allowSharing 等欄位)
    // 而不是直接突變 classrooms[idx].primaryTeacher 導致 Vue reactivity 追蹤不完整
    const success = await scheduleStore.clearTeacher(room.id);
    if (success) {
      alert('🧹 已清空該教室的負責老師。')
    }
  }
}

const saveRoom = async () => {
  if (!newRoom.value.name || !newRoom.value.subject) return alert('請填寫完整')
  // 🆕 [gradePreferences] 轉換 UI 用的 gradePreferencesRaw → 陣列格式
  const gradePreferences = newRoom.value.gradePreferencesRaw === 'shared'
    ? []
    : [parseInt(newRoom.value.gradePreferencesRaw, 10)];

  await scheduleStore.addClassroom({
    name: newRoom.value.name,
    subject: newRoom.value.subject,
    primaryTeacher: newRoom.value.primaryTeacher,
    allowSharing: newRoom.value.allowSharing,
    gradePreferences,
  })
  newRoom.value = { name: '', subject: '', primaryTeacher: '', allowSharing: true, gradePreferencesRaw: 'shared' }
}

const deleteRoom = async (id) => {
  if (confirm('確定刪除？')) {
    await scheduleStore.deleteClassroom(id)
  }
}

// 🌟 完整的專科教室課表邏輯
const selectedRoom = ref(null)

const openTimetable = (room) => {
  selectedRoom.value = room;
}

const printTimetable = () => {
  window.print();
}

// ==========================================
// 🚀 核心重構：全域視野 (Global View) 教室分流器 + 中年級自然科例外規則 (Qwen 優化版)
// ==========================================
const getRoomClassesLegacy = (day, period) => {
  if (!selectedRoom.value) return '';

  // 1. 檢查是否有任何班級在此時段擁有明確的 classroomName
  let hasExplicitAssignment = false;
  scheduleStore.classes.forEach(cls => {
    const course = cls.timetable?.[day]?.[period];
    if (course && course.classroomName) {
      hasExplicitAssignment = true;
    }
  });

  // 2. 如果有明確指派，直接以具體指派的教室名稱進行精確匹配 (Layer 1)
  if (hasExplicitAssignment) {
    const matches = [];
    scheduleStore.classes.forEach(cls => {
      const course = cls.timetable?.[day]?.[period];
      if (!course) return;

      const isAssigned = course.classroomName === selectedRoom.value.name;

      if (isAssigned) {
        let label = String(cls.name).replace('年', '0').replace('班', '');

        // 針對交替課 (如 "音樂(單)/美勞(雙)") 做人性化後綴顯示
        if (course.subject.includes('單') || course.subject.includes('雙')) {
          const matchesSubj = course.subject.match(/([^\(/]+)\((單|雙)\)/g);
          if (matchesSubj) {
            const matchedPart = matchesSubj.find(p => p.includes(selectedRoom.value.subject));
            if (matchedPart) {
              label += `(${matchedPart})`; // 顯示如 "201(音樂(單))"
            }
          }
        }
        matches.push(label);
      }
    });

    return matches.join(', ');
  }

  // 3. 如果沒有明確指派，回退到原本的模糊分流反推邏輯
  const targetSubj = selectedRoom.value.subject;

  // 找出全校所有該科目的專科教室 (包含自己)
  const availableRooms = scheduleStore.classrooms.filter(r => r.subject === targetSubj);

  // 找出全校在該時段，所有正在上該科目的班級與老師
  const concurrentClasses = [];
  scheduleStore.classes.forEach(cls => {
    const course = cls.timetable?.[day]?.[period];
    if (!course) return;

    // 檢查一般科目匹配
    let subjectMatch = course.subject && (course.subject.includes(targetSubj) || targetSubj.includes(course.subject));

    // 🌟 檢查單雙週交替課程 (音樂/美勞共用時段)
    let alternatingInfo = null;
    if (course.isAlternating) {
      if (targetSubj === '音樂' && course.oddWeek?.subject === '音樂') {
        subjectMatch = true;
        alternatingInfo = { week: '單週', subject: course.oddWeek.subject, teacher: course.oddWeek.teacher };
      } else if (targetSubj === '美勞' && course.evenWeek?.subject === '美勞') {
        subjectMatch = true;
        alternatingInfo = { week: '雙週', subject: course.evenWeek.subject, teacher: course.evenWeek.teacher };
      } else if (targetSubj === '音樂' && course.evenWeek?.subject === '音樂') {
        subjectMatch = true;
        alternatingInfo = { week: '雙週', subject: course.evenWeek.subject, teacher: course.evenWeek.teacher };
      } else if (targetSubj === '美勞' && course.oddWeek?.subject === '美勞') {
        subjectMatch = true;
        alternatingInfo = { week: '單週', subject: course.oddWeek.subject, teacher: course.oddWeek.teacher };
      }
    }

    if (subjectMatch) {
      // 🌟 判斷機制 A：偵測是否為連堂 (檢查前一節或後一節是否也是同科目)
      const prevCourse = cls.timetable?.[day]?.[period - 1];
      const nextCourse = cls.timetable?.[day]?.[period + 1];
      const isConsecutive =
        (prevCourse && (prevCourse.subject.includes(targetSubj) || targetSubj.includes(prevCourse.subject))) ||
        (nextCourse && (nextCourse.subject.includes(targetSubj) || targetSubj.includes(nextCourse.subject)));

       // 🌟 判斷機制 B：精準萃取該班級的年級
       const gradeMatch = String(cls.name).match(/(\d+)年/) || String(cls.name).match(/^(\d)/);
       const parsedGrade = gradeMatch ? parseInt(gradeMatch[1], 10) : 0;
       const grade = isNaN(parsedGrade) ? 0 : parsedGrade;

       // 🛡️ [Bug Fix] 1、2 年級的英語課直接留在原班上課，不進入專科教室分配名單
       const isLowerGradeEnglish = (grade === 1 || grade === 2) && (course.subject.includes('英語') || course.subject.includes('英文'));

       // 🔄 收集該班級整份 schedule 用來做 pair partner 查找
       const allEntries = [];
       if (cls.timetable) {
         for (const dd in cls.timetable) {
           for (const pp in cls.timetable[dd]) {
             const e = cls.timetable[dd][pp];
             if (e && e.subject) {
               allEntries.push({ ...e, _day: parseInt(dd), _period: parseInt(pp) });
             }
           }
         }
       }

       if (!isLowerGradeEnglish) {
         concurrentClasses.push({
           className: String(cls.name).replace('年', '0').replace('班', ''),
           teacher: alternatingInfo ? alternatingInfo.teacher : (course.teacher || ''),
           isConsecutive,
           grade,
           alternating: alternatingInfo,
           pairInfo: course.pairPartnerClass ? {
             pairGroupId: course.pairGroupId,
             pairPartnerClass: course.pairPartnerClass,
             pairRole: course.pairRole,
             pairDirection: course.pairDirection,
           } : null,
           allEntries: allEntries
         });
       }
     }
   });

  if (concurrentClasses.length === 0) return '';

  // 初始化分流對應表 RoomAssignedMap: { roomId: [] }
  const roomAssignments = {};
  availableRooms.forEach(r => roomAssignments[r.id] = []);

  let remainingClasses = [...concurrentClasses];

  // 階段一：主場教師絕對優先 (鎖定)
  availableRooms.forEach(room => {
    if (room.primaryTeacher) {
      const myClasses = remainingClasses.filter(c => c.teacher.includes(room.primaryTeacher));
      if (myClasses.length > 0) {
        roomAssignments[room.id].push(...myClasses);
        remainingClasses = remainingClasses.filter(c => !c.teacher.includes(room.primaryTeacher));
      }
    }
  });

  // 階段二與三：剩餘空室填補 (處理借用與溢位)
  const classesByTeacher = {};
  remainingClasses.forEach(c => {
    if (!classesByTeacher[c.teacher]) classesByTeacher[c.teacher] = [];
    classesByTeacher[c.teacher].push(c);
  });

  Object.keys(classesByTeacher).forEach(teacherName => {
    const classesToAssign = classesByTeacher[teacherName];
    // 找一間目前完全沒人用的同科教室
    const emptyRoom = availableRooms.find(r => roomAssignments[r.id].length === 0);

    if (emptyRoom) {
      // ✅ 空間足夠：優先排入專科教室 (無論是不是連堂)
      roomAssignments[emptyRoom.id].push(...classesToAssign);
    } else {
      // ⚠️ 找不到空教室了！處理溢位邏輯
      classesToAssign.forEach(c => {
        const isMiddleGradeNatureFallback =
          (c.grade === 3 || c.grade === 4) &&
          !c.isConsecutive &&
          targetSubj.includes('自然');

        if (isMiddleGradeNatureFallback) {
          // 🛡️ 啟動退回機制：默默讓它留在原班級上課
        } else {
          // 🚨 強制衝突機制：高年級，或是連堂實驗課，無論如何都必須在專科教室！
          if (roomAssignments[selectedRoom.value.id]) {
            roomAssignments[selectedRoom.value.id].push(c);
          }
        }
      });
    }
  });

  // 提取當前正在查看的這間教室的分派結果
  const myAssignedClasses = roomAssignments[selectedRoom.value.id];

  if (!myAssignedClasses || myAssignedClasses.length === 0) return '';

  // 格式化輸出字串 (加入借用標記與衝堂警告)
  const uniqueTeachers = [...new Set(myAssignedClasses.map(c => c.teacher))];
  const isConflict = uniqueTeachers.length > 1;

  const resultStrings = myAssignedClasses.map(c => {
    const isBorrowing = selectedRoom.value.primaryTeacher && !c.teacher.includes(selectedRoom.value.primaryTeacher);
    let base = isBorrowing ? `${c.className}(借-${c.teacher})` : c.className;
    // Pair 資訊標註
    if (c.pairInfo && c.pairInfo.pairPartnerClass) {
      const roleMark = c.pairInfo.pairRole === 'A' ? '[A]' : c.pairInfo.pairRole === 'B' ? '[B]' : '';
      const partner = c.pairInfo.pairPartnerClass.replace('年', '0').replace('班', '');
      const direction = c.pairInfo.pairDirection || '';
      base += ` ↖${partner}${roleMark}${direction ? '(' + direction + ')' : ''}`;
    }
    // 交替課程標註
    if (c.alternating) {
      base += `(${c.alternating.week})`;
    }
    return base;
  });

  if (isConflict) {
    return `⚠️衝堂: ${resultStrings.join(', ')}`;
  }

  return resultStrings.join(', ');
}

void getRoomClassesLegacy

// ==========================================
// 🆕 專科教室獨立匯出 / 匯入
// ==========================================
function handleExportClassrooms() {
  const payload = {
    type: 'classrooms_backup',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    classrooms: (scheduleStore.classrooms || []).map((r) => ({
      id: r.id,
      name: r.name,
      subject: r.subject,
      primaryTeacher: r.primaryTeacher || '',
      allowSharing: r.allowSharing !== undefined ? r.allowSharing : true,
      gradePreferences: Array.isArray(r.gradePreferences) ? [...r.gradePreferences] : [],
    })),
  }

  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const dateStr = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `專科教室備份_${dateStr}.json`
  a.click()
  URL.revokeObjectURL(url)

  eiMessage.value = '✅ 教室資料已匯出'
  eiType.value = 'success'
}

function triggerImportClassrooms() {
  classroomFileInput.value?.click()
}

async function handleImportClassrooms(event) {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    let parsed = JSON.parse(text)

    // 支援兩種格式：
    // 1. 有 type 封裝的物件 {type: 'classrooms_backup', classrooms: [...]}
    // 2. 根層直接是陣列 [...]
    let rooms
    if (parsed.type === 'classrooms_backup' && Array.isArray(parsed.classrooms)) {
      rooms = parsed.classrooms
    } else if (Array.isArray(parsed)) {
      rooms = parsed
    } else {
      throw new Error('檔案格式不正確：缺少 classrooms 陣列')
    }

    if (!confirm(`確定匯入 ${rooms.length} 筆教室資料？這將覆蓋現有的專科教室設定。`)) {
      event.target.value = ''
      return
    }

    // Canonical subject map (與 settingsBackup.js 一致)
    const CANONICAL_SUBJECT_MAP = {
      '英語': '語文-英語',
      '自然': '自然科學',
      '科技-資訊': '資訊',
      '電腦': '資訊',
      '健康與體育': '體育',
      '本土語言': '本土語',
      '閩南語': '本土語',
      '客語': '本土語',
    }

    const normalized = rooms.map((room) => ({
      id: room.id || `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: room.name || '未命名教室',
      subject: (() => {
        const s = String(room.subject || '').trim()
        return CANONICAL_SUBJECT_MAP[s] || s
      })(),
      primaryTeacher: room.primaryTeacher || '',
      allowSharing: room.allowSharing !== undefined ? room.allowSharing : true,
      gradePreferences: Array.isArray(room.gradePreferences)
        ? room.gradePreferences.map((g) => Number(g) > 0 ? Number(g) : 0).filter((g) => g > 0)
        : [],
    }))

    // 覆蓋 store 中的 classrooms
    scheduleStore.classrooms.splice(0, scheduleStore.classrooms.length, ...normalized)

    // 立即同步到後端
    await scheduleStore.syncToCloud()

    eiMessage.value = `✅ 已匯入 ${normalized.length} 筆教室資料並同步到後端`
    eiType.value = 'success'
  } catch (e) {
    eiMessage.value = `❌ 匯入失敗：${e.message}`
    eiType.value = 'error'
  } finally {
    event.target.value = ''
  }
}

// 重新定義房間對照邏輯：以實際教室占用與週別為準
const getRoomClasses = (day, period) => {
  if (!selectedRoom.value) return ''
  const raw = formatRoomSlotAssignments(
    scheduleStore.classes,
    selectedRoom.value,
    day,
    period,
    {
      conflictPrefix: '⚠衝堂：',
      separator: ', ',
      fallbackToParentheses: true,
    },
  )

  return raw.replaceAll('年', '0').replaceAll('班', '')
}

</script>

<style scoped>
.classroom-container { padding: 20px; max-width: 1000px; margin: 0 auto; }
.desc { color: #64748b; margin-bottom: 25px; }
.form-card, .list-card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 25px; border-top: 4px solid #8b5cf6; }
.form-card h3, .list-card h3 { margin-top: 0; color: #1e293b; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px; }
.edit-mode { border-top-color: #f59e0b; background: #fffcf0; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
.form-group { display: flex; flex-direction: column; gap: 5px; }
.form-group label { font-weight: bold; color: #475569; font-size: 0.95em;}
.form-group input, .form-group select { padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; outline: none; }
.form-group input:focus, .form-group select:focus { border-color: #8b5cf6; }
.disabled-input { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }

.save-btn { background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; width: 100%; font-size: 16px; font-weight: bold; transition: 0.3s; box-shadow: 0 4px 6px rgba(139, 92, 246, 0.3); }
.save-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(139, 92, 246, 0.4); }

.edit-actions { display: flex; gap: 10px; margin-top: 15px; }
.update-btn { flex: 1; background: #f59e0b; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px; }
.cancel-btn { background: #f1f5f9; color: #475569; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold; }

.room-table { width: 100%; border-collapse: collapse; }
.room-table th, .room-table td { border-bottom: 1px solid #f1f5f9; padding: 15px 10px; text-align: left; }
/* 🆕 list-header layout */
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.list-header h3 {
  margin: 0;
}

/* 🆕 匯出/匯入按鈕 */
.ei-buttons {
  display: flex;
  gap: 8px;
}
.ei-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s, box-shadow 0.2s;
}
.ei-btn.export-btn {
  background: #6366f1;
  color: white;
}
.ei-btn.export-btn:hover {
  background: #4f46e5;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}
.ei-btn.import-btn {
  background: #8b5cf6;
  color: white;
}
.ei-btn.import-btn:hover {
  background: #7c3aed;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}
.ei-message {
  margin-top: 8px;
  font-size: 0.9rem;
  text-align: center;
}
.ei-message.success {
  color: #10b981;
}
.ei-message.error {
  color: #ef4444;
}

.room-table th { background-color: #f8fafc; color: #475569; font-weight: bold; }
.font-bold { font-weight: bold; color: #1e293b; font-size: 1.1em;}
.tag { background: #e0e7ff; color: #4338ca; padding: 6px 10px; border-radius: 6px; font-size: 0.85em; font-weight: bold; border: 1px solid #c7d2fe;}
.teacher-badge { background: #fef3c7; color: #92400e; padding: 6px 10px; border-radius: 6px; font-size: 0.9em; font-weight: bold; border: 1px solid #fde68a;}
.shared-badge { background: #f1f5f9; color: #64748b; padding: 6px 10px; border-radius: 6px; font-size: 0.9em; border: 1px solid #cbd5e1;}

.action-buttons { display: flex; gap: 5px; }
.view-btn { background: #3b82f6; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: bold; }
.view-btn:hover { background: #2563eb; }
.edit-btn { background: #f59e0b; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9em; }
.clear-btn { background: #e2e8f0; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 1.1em; }
.clear-btn:hover { background: #cbd5e1; }
.del-btn { background: #fee2e2; color: #dc2626; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: bold; }
.del-btn:hover { background: #fecaca; }

/* 🌟 真實紙本課表彈窗設計 */
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 1000; backdrop-filter: blur(2px); }
.timetable-modal { background: white; width: 900px; max-width: 95vw; max-height: 90vh; border-radius: 4px; padding: 30px; overflow-y: auto; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); }

.print-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 3px solid #000; padding-bottom: 15px; }
.school-info { text-align: center; font-size: 1.1em; line-height: 1.4; }
.room-title-area { flex: 1; text-align: center; }
.room-title { margin: 0; font-size: 2.2em; letter-spacing: 2px; }
.teacher-info { text-align: right; font-size: 1.1em; line-height: 1.4; }

.classic-timetable { width: 100%; border-collapse: collapse; border: 2px solid #000; font-family: "標楷體", "DFKai-SB", serif; font-size: 1.2em; }
.classic-timetable th, .classic-timetable td { border: 1px solid #000; text-align: center; padding: 12px; }
.narrow-col { width: 40px; }
.time-col { width: 80px; }
.class-cell { font-size: 1.4em; letter-spacing: 1px; width: 14%; transition: background-color 0.2s; }
.time-cell { font-size: 0.85em; color: #333; }
.vertical-text { writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 5px; }

/* 衝堂時背景變紅 */
.conflict-cell { background-color: #fee2e2; color: #b91c1c; }

/* 對角線表頭 (星期/時間) */
.diagonal-header { position: relative; width: 100%; height: 100%; min-height: 40px; }
.diagonal-header::before { content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-top: 1px solid transparent; border-bottom: 1px solid transparent; background: linear-gradient(to bottom right, transparent 49%, #000 50%, transparent 51%); }
.day-text { position: absolute; top: 0; right: 5px; font-size: 0.85em;}
.time-text { position: absolute; bottom: 0; left: 5px; font-size: 0.85em;}

.morning-time, .break-time { background: #f3f4f6; letter-spacing: 10px; font-weight: bold; }
.lunch-row td { border-top: 2px solid #000; border-bottom: 2px solid #000; }
.lunch-time { letter-spacing: 8px; font-size: 1.1em; font-weight: bold; }
.meeting { font-size: 1em; letter-spacing: 3px; font-weight: normal;}
.hide-cell { border-top: none !important; border-bottom: none !important; }

.modal-actions { display: flex; justify-content: center; gap: 20px; margin-top: 30px; }
.print-btn { background: #1e293b; color: white; padding: 10px 30px; border-radius: 6px; font-size: 1.1em; cursor: pointer; border: none; }
.close-btn { background: #e2e8f0; color: #334155; padding: 10px 30px; border-radius: 6px; font-size: 1.1em; cursor: pointer; border: none; }

/* 🆕 [gradePreferences] 優先年級徽章樣式 */
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.badge-grade { background: #dbeafe; color: #1e40af; }
.badge-shared { background: #d1fae5; color: #065f46; }

@media print {
  body * { visibility: hidden; }
  .timetable-modal, .timetable-modal * { visibility: visible; }
  .timetable-modal { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; padding: 0; overflow: visible;}
  .print-hide { display: none !important; }
}
</style>
