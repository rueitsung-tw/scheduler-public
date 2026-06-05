export class AutoScheduler {
  constructor(teachers, classes, schoolInfo, domainSettings) {
    this.teachers = teachers || [];
    this.classes = classes || [];
    this.schoolInfo = schoolInfo || {};
    this.domainSettings = domainSettings || [];
    
    this.teacherMap = new Map(this.teachers.map(t => [t.name, t]));
    
    this.teacherSchedules = {};
    this.classSchedules = {};
    
    this.classes.forEach(c => {
      this.classSchedules[c.name] = this.createEmptyGrid();
    });
    this.teachers.forEach(t => {
      this.teacherSchedules[t.name] = this.createEmptyGrid();
    });

    this.deepestDepth = -1;
    this.deepestErrorLog = "";
  }

  createEmptyGrid() {
    const grid = {};
    for (let d = 1; d <= 5; d++) {
      grid[d] = {};
      for (let p = 1; p <= 7; p++) {
        grid[d][p] = null;
      }
    }
    return grid;
  }

  getConflictReason(task, day, period) {
    const tName = task.teacher;
    const cName = task.clsName;

    if (this.classSchedules[cName][day][period]) {
      return `【班級已滿】${cName} 已有課`;
    }

    if (!task.isHomeroom) {
      for (let p = 1; p <= 7; p++) {
        const existingClass = this.classSchedules[cName][day][p];
        if (existingClass && existingClass.subject === task.subject) {
          return `【單日重複】${cName} 今天已經上過 ${task.subject} 了`;
        }
      }
    }

    if (tName) {
      const teacherObj = this.teacherMap.get(tName);
      if (teacherObj) {
        // 🐛 BUG 1 修復：加上 fallback array 避免 .some() 報錯
        const unavailSlots = teacherObj.unavailable_slots || [];
        const isUnavailable = unavailSlots.some(s => s.day === day && s.period === period);
        if (isUnavailable) return `【教師禁排】${tName} 設定了此時段不排課`;
      }

      if (this.teacherSchedules[tName][day][period]) {
        return `【教師衝堂】${tName} 正在 ${this.teacherSchedules[tName][day][period]} 上課`;
      }
    }

    return null; 
  }

  run() {
    let tasks = [];

    this.classes.forEach(cls => {
      if (!cls.course_requirements) return;
      cls.course_requirements.forEach(req => {
        if (!req.teacher || req.periods <= 0) return;
        
        const isHomeroom = req.defaultTeacher === 'homeroom';
        const displaySubject = isHomeroom ? '導師區段' : req.subject;
        
        const fullPeriods = Math.floor(req.periods);
        const hasHalfPeriod = (req.periods % 1) !== 0; 

        for (let i = 0; i < fullPeriods; i++) {
          tasks.push({
            clsName: cls.name,
            subject: displaySubject,
            teacher: req.teacher,
            isHomeroom: isHomeroom,
            isBiweekly: false
          });
        }

        if (hasHalfPeriod) {
           tasks.push({
            clsName: cls.name,
            subject: displaySubject,
            teacher: req.teacher,
            isHomeroom: isHomeroom,
            isBiweekly: true
          });
        }
      });
    });

    const teacherTaskCount = {};
    tasks.forEach(t => {
      teacherTaskCount[t.teacher] = (teacherTaskCount[t.teacher] || 0) + 1;
    });

    tasks.sort((a, b) => {
      // 🐛 BUG 2 修復：導師最難排，優先排入 (-1)
      if (a.isHomeroom !== b.isHomeroom) return a.isHomeroom ? -1 : 1; 
      return teacherTaskCount[b.teacher] - teacherTaskCount[a.teacher]; 
    });

    const success = this.backtrack(tasks, 0);

    if (success) {
      return { success: true, timetables: this.classSchedules };
    } else {
      return { success: false, error: this.deepestErrorLog };
    }
  }

  backtrack(tasks, depth) {
    if (depth === tasks.length) return true; 

    const task = tasks[depth];
    let possibleSlots = [];
    let slotAnalysis = [];

    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 7; period++) {
        const conflict = this.getConflictReason(task, day, period);
        if (!conflict) {
          possibleSlots.push({ day, period });
        } else {
          slotAnalysis.push(`星期${day} 第${period}節 ❌ ${conflict}`);
        }
      }
    }

    if (possibleSlots.length === 0) {
      if (depth > this.deepestDepth) {
        this.deepestDepth = depth;
        this.deepestErrorLog = `無法為 [${task.clsName}] 安排 [${task.subject}] (教師：${task.teacher})\n` +
                               `系統在成功排入 ${depth} 堂課後卡住。該堂課 35 個時段全數衝突，原因如下：\n` +
                               slotAnalysis.join('\n');
      }
      return false; 
    }

    possibleSlots.sort(() => Math.random() - 0.5);

    for (const slot of possibleSlots) {
      this.classSchedules[task.clsName][slot.day][slot.period] = { subject: task.subject, teacher: task.teacher, isBiweekly: task.isBiweekly };
      this.teacherSchedules[task.teacher][slot.day][slot.period] = task.clsName;

      if (this.backtrack(tasks, depth + 1)) return true;

      this.classSchedules[task.clsName][slot.day][slot.period] = null;
      this.teacherSchedules[task.teacher][slot.day][slot.period] = null;
    }

    return false;
  }
}