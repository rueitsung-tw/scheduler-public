
// eslint-disable-next-line no-undef
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import bcrypt from 'bcryptjs';

// 👇 這是為 Prisma 7 準備的正確 SQLite 驅動引入方式
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildScheduleAiReport } from './src/utils/scheduleAiReport.js';
import { buildAiTuningPromptBundle } from './src/services/aiTuningPrompt.js';

/**
 * Runtime contract:
 * - This backend is meant to run on the current remote Linux host.
 * - Do not reuse `node_modules` from Windows, WSL, or another machine.
 * - If native dependencies fail, reinstall on this host with `npm install`.
 * - Supported Node.js version follows package.json: ^20.19.0 || >=22.12.0.
 */
const RUNTIME_CONTRACT = Object.freeze({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cwd: process.cwd(),
    nodeModulesNote: 'Keep installs host-local; native bindings are platform-specific.',
});

function assertSupportedNodeVersion() {
    const [major, minor, patch] = process.versions.node.split('.').map(Number);
    const isSupported =
        (major === 20 && (minor > 19 || (minor === 19 && patch >= 0))) ||
        major >= 22;

    if (!isSupported) {
        throw new Error(
            `Unsupported Node.js version ${process.version}. Use Node 20.19.0+ or 22.12.0+ on this host.`
        );
    }
}

function getExpectedRolldownBindingPackage() {
    if (process.platform === 'win32') {
        if (process.arch !== 'x64' && process.arch !== 'arm64') return null;
        return `@rolldown/binding-win32-${process.arch}-msvc`;
    }

    if (process.platform === 'darwin') {
        if (process.arch !== 'x64' && process.arch !== 'arm64') return null;
        return `@rolldown/binding-darwin-${process.arch}`;
    }

    if (process.platform === 'linux') {
        if (process.arch !== 'x64' && process.arch !== 'arm64') return null;
        const glibcVersion = process.report?.getReport?.()?.header?.glibcVersionRuntime;
        const libcVariant = glibcVersion ? 'gnu' : 'musl';
        return `@rolldown/binding-linux-${process.arch}-${libcVariant}`;
    }

    return null;
}

function assertPlatformStartupEnvironment() {
    const nodeModulesDir = path.join(process.cwd(), 'node_modules');
    const expectedRolldownBinding = getExpectedRolldownBindingPackage();
    const issues = [];
    const hints = [];

    if (!fs.existsSync(nodeModulesDir)) {
        issues.push('`node_modules/` is missing.');
        hints.push('Run `npm install` on this machine or this Ubuntu host.');
    }

    if (expectedRolldownBinding) {
        const bindingDir = path.join(nodeModulesDir, expectedRolldownBinding);
        if (!fs.existsSync(bindingDir)) {
            issues.push(`Missing native binding package: ${expectedRolldownBinding}`);
            hints.push('This usually means `node_modules` was copied from another OS or the install was incomplete.');
            hints.push('Fix: delete `node_modules/` and `package-lock.json`, then run `npm install` again on the current OS.');
        }
    } else {
        hints.push(`Unsupported platform/architecture combination: ${process.platform} ${process.arch}.`);
    }

    const pythonVenvPath = process.platform === 'win32'
        ? path.join(process.cwd(), 'venv', 'Scripts', 'python.exe')
        : path.join(process.cwd(), 'venv', 'bin', 'python');

    if (!fs.existsSync(pythonVenvPath)) {
        console.warn(
            `[Startup Warning] Python venv not found at ${pythonVenvPath}. The server will fall back to system Python if available.`
        );
        console.warn(
            '[Startup Warning] If Python scripts fail, recreate the venv on this machine: `python -m venv venv` (Windows) or `python3 -m venv venv` (Ubuntu).'
        );
    }

    if (issues.length > 0) {
        const message = [
            '[Startup Check Failed]',
            `platform=${process.platform} arch=${process.arch} node=${process.version}`,
            ...issues.map((line) => `- ${line}`),
            ...hints.map((line) => `- ${line}`),
            '',
            'Expected reinstall targets:',
            '- `npm install`',
            '- If Python environment is broken, recreate `venv/` and reinstall `ortools numpy pandas`',
        ].join('\n');

        throw new Error(message);
    }
}

assertSupportedNodeVersion();
assertPlatformStartupEnvironment();

console.log(
    `[Runtime] platform=${RUNTIME_CONTRACT.platform} arch=${RUNTIME_CONTRACT.arch} node=${RUNTIME_CONTRACT.nodeVersion}`
);
console.log(`[Runtime] cwd=${RUNTIME_CONTRACT.cwd}`);
console.log(`[Runtime] ${RUNTIME_CONTRACT.nodeModulesNote}`);

const app = express();

// ==========================================
// Python Resolver：跨平台 Python 執行器偵測
// 解析順序：
//   1. 環境變數 SCHEDULER_PYTHON
//   2. 專案 venv（Linux/WSL: venv/bin/python, Windows: venv/Scripts/python.exe）
//   3. 系統 Python（python3 / python / py -3）
// ==========================================
function resolvePythonExecutable() {
    // 1. 優先使用環境變數指定
    // eslint-disable-next-line no-undef
    const envPython = process.env.SCHEDULER_PYTHON;
    if (envPython) {
        console.log(`[INFO] Python Resolver: 使用 SCHEDULER_PYTHON=${envPython}`);
        return envPython;
    }

    const platform = os.platform(); // 'linux', 'win32', 'darwin'
    const isWindows = platform === 'win32';

    // 2. 嘗試專案 venv
    const venvCandidates = isWindows
        ? ['venv/Scripts/python.exe', 'venv/scripts/python.exe']
        : ['venv/bin/python'];

    for (const candidate of venvCandidates) {
        const venvPath = path.join(__dirname, candidate);
        if (fs.existsSync(venvPath)) {
            console.log(`[INFO] Python Resolver: 使用 venv ${venvPath}`);
            return venvPath;
        }
    }

    // 3. 嘗試系統 Python
    const systemCandidates = isWindows
        ? ['python', 'py']
        : ['python3', 'python'];

    for (const cmd of systemCandidates) {
        try {
            const testCmd = cmd === 'py' ? '"py" -3 --version' : `"${cmd}" --version`;
            execSync(testCmd, { stdio: 'ignore', timeout: 5000 });
            console.log(`[INFO] Python Resolver: 使用系統 ${cmd}`);
            return cmd;
        } catch {
            // 繼續嘗試下一個
        }
    }

    // 全部失敗
    return null;
}

// 取得 Python 腳本的絕對路徑
function getScriptAbsolutePath(scriptName) {
    return path.join(__dirname, scriptName);
}

// 共用：啟動 Python 腳本
function spawnPython(scriptName, args = [], label = 'Python Script') {
    const pythonExe = resolvePythonExecutable();
    if (!pythonExe) {
        const errorMsg = [
            `[ERROR] 找不到可用的 Python 執行器！`,
            `請確認以下任一條件：`,
            `  1. 設定環境變數 SCHEDULER_PYTHON（例如 /usr/bin/python3 或 C:\\Python39\\python.exe）`,
            `  2. 在專案根目錄建立 venv：python3 -m venv venv && source venv/bin/activate`,
            `  3. 確保系統 Python 可在 PATH 中找到（python3 或 python）`
        ].join('\n');
        console.error(errorMsg);
        throw new Error(errorMsg);
    }

    const scriptPath = getScriptAbsolutePath(scriptName);
    if (!fs.existsSync(scriptPath)) {
        const errorMsg = `[ERROR] Python 腳本不存在: ${scriptPath}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
    }

    // Windows 下 py launcher 需要特殊處理
    const spawnArgs = pythonExe === 'py'
        ? ['-3', scriptPath, ...args]
        : [scriptPath, ...args];

    // 注入 UTF-8 環境變數，避免 Windows cp950 編碼問題
    const utf8Env = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
    };

    console.log(`[INFO] Spawn ${label}: ${pythonExe} ${spawnArgs.join(' ')}`);
    const child = spawn(pythonExe, spawnArgs, { env: utf8Env });

    // 設定 stdout/stderr 為 UTF-8 文字模式，避免 buffer.toString() 使用預設編碼
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    return child;
}

// 👇 使用 Adapter 來初始化 Prisma

const adapter = new PrismaBetterSqlite3({ url: 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
}));

// 🚀 放寬傳輸容量限制 (預設為 100kb)
// 以因應 130位教師、60個班級、17間專科教室的完整 JSON 課表與設定檔儲存
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ==========================================
// 模組一：基礎資料建檔 (來自舊版 server.mjs)
// ==========================================

// 更新單一教師的減課與超鐘點
app.patch('/api/teachers/:name', async (req, res) => {
    const { name } = req.params;
    const { reduction, overtime } = req.body;
    try {
        const updated = await prisma.teacher.update({
            where: { name },
            data: { reduction: Number(reduction) || 0, overtime: Number(overtime) || 0 }
        });
        res.json(updated);
        } catch {
            res.status(500).json({ error: '更新教師失敗' });
    }
});

// 全面儲存 API (排課前的設定檔存檔)
app.post('/api/save-all', async (req, res) => {
    try {
        const { teachers, classes, schoolInfo, specialCourses, classrooms, aiSettings } = req.body;

        if (!teachers || !classes) {
            return res.status(400).json({ error: '缺少必要資料 (teachers 或 classes)' });
        }

        // 1. 老師資料儲存 (加上數字防呆)
        // 🚀 修正：比對前端與 DB 的教師名稱，只刪除前端已移除的教師，保留外鍵關聯
        const existingTeachers = await prisma.teacher.findMany({ select: { name: true } });
        const frontendNames = new Set(teachers.map(t => String(t.name)));
        const deletedNames = existingTeachers.filter(t => !frontendNames.has(t.name));

        // 清空被刪除教師的 homeroom 外鍵引用
        for (const dt of deletedNames) {
            await prisma.class.updateMany({
                where: { homeroom_teacher: { name: dt.name } },
                data: { homeroom_teacher_id: null }
            });
        }

        // 刪除前端沒傳過來的教師
        for (const dt of deletedNames) {
            await prisma.teacher.delete({ where: { name: dt.name } });
        }

        // 建立或更新前端傳過來的教師
        for (const t of teachers) {
            const safeMaxPeriods = t.max_periods !== undefined && t.max_periods !== null && t.max_periods !== ''
                                    ? Number(t.max_periods)
                                    : 20;

            await prisma.teacher.upsert({
                where: { name: String(t.name) },
                update: {
                    max_periods: safeMaxPeriods,
                    type: String(t.type || 'subject'),
                    reduction: Number(t.reduction) || 0,
                    overtime: Number(t.overtime) || 0,
                    expertise: t.expertiseSubjects ? JSON.stringify(t.expertiseSubjects) : (t.expertise || '[]'),
                    unavailable_slots: t.unavailable_slots ? JSON.stringify(t.unavailable_slots) : '[]',
                    gradePreferences: t.gradePreferences ? JSON.stringify(t.gradePreferences) : '[]',
                    assignedClass: t.assignedClass || null,
                    google_account: t.google_account || null
                },
                create: {
                    name: String(t.name),
                    max_periods: safeMaxPeriods,
                    type: String(t.type || 'subject'),
                    reduction: Number(t.reduction) || 0,
                    overtime: Number(t.overtime) || 0,
                    expertise: t.expertiseSubjects ? JSON.stringify(t.expertiseSubjects) : (t.expertise || '[]'),
                    unavailable_slots: t.unavailable_slots ? JSON.stringify(t.unavailable_slots) : '[]',
                    gradePreferences: t.gradePreferences ? JSON.stringify(t.gradePreferences) : '[]',
                    assignedClass: t.assignedClass || null,
                    google_account: t.google_account || null
                }
            });
        }

        // ==========================================
        // 2. 班級與配課資料儲存 (加上字串防呆)
        // ==========================================
        // 🚀 [homeroom_teacher_id 修復] 先建立 teacher name -> id 的查找表
        const allTeachersForLookup = await prisma.teacher.findMany({ select: { name: true, id: true } });
        const teacherNameToIdMap = {};
        allTeachersForLookup.forEach(t => { teacherNameToIdMap[String(t.name).trim()] = t.id; });

        // 🛡️ 新增防護：紀錄這次更新已經用過的導師 ID，防止同一個老師被重複綁定給多個班級
        const usedTeacherIds = new Set();

        const classUpserts = classes.map((cls) => {
            // 🚀 BugFix: 從班級名稱解析 grade
            const gradeMatch = String(cls.name).match(/(\d+)年/) || String(cls.name).match(/^(\d)/);
            const resolvedGrade = (cls.grade !== undefined && cls.grade !== null && cls.grade !== '')
                ? Number(cls.grade)
                : (gradeMatch ? parseInt(gradeMatch[1], 10) : 1);

            // 🚀 解析前端傳來的教師姓名 -> DB 數字 ID，並進行防呆
            let homeroomTeacherId = null;
            if (cls.homeroom_teacher && typeof cls.homeroom_teacher === 'string' && cls.homeroom_teacher.trim() !== '') {
                const htName = cls.homeroom_teacher.trim();
                if (teacherNameToIdMap[htName] !== undefined) {
                    const mappedId = teacherNameToIdMap[htName];
                    // 🚨 檢查是否重複綁定
                    if (!usedTeacherIds.has(mappedId)) {
                        homeroomTeacherId = mappedId;
                        usedTeacherIds.add(mappedId);
                    } else {
                        console.warn(`[WARN] [防呆攔截] 導師「${htName}」重複指派，已取消對班級「${cls.name}」的綁定以防崩潰。`);
                    }
                }
            }

            const requirements = (cls.course_requirements || []).map(req => ({
                subject: String(req.subject || '未命名科目'),
                periods: Number(req.periods) || 0,
                teacher_name: String(req.teacher_name || req.teacher || ''),
                defaultTeacher: String(req.defaultTeacher || 'subject')
            }));

            return prisma.class.upsert({
                where: { name: cls.name },
                update: {
                    isArtsClass: cls.isArtsClass || false, // 🚀 關鍵修正：確保存入藝才班標記
                    homeroom_teacher_id: homeroomTeacherId,
                    grade: resolvedGrade,
                    timetable: cls.timetable ? JSON.stringify(cls.timetable) : null,
                    conflicts: cls.conflicts ? JSON.stringify(cls.conflicts) : null,
                    course_requirements: { deleteMany: {}, create: requirements }
                },
                create: {
                    name: String(cls.name),
                    isArtsClass: cls.isArtsClass || false, // 🚀 關鍵修正：確保存入藝才班標記
                    homeroom_teacher_id: homeroomTeacherId,
                    grade: resolvedGrade,
                    timetable: cls.timetable ? JSON.stringify(cls.timetable) : null,
                    conflicts: cls.conflicts ? JSON.stringify(cls.conflicts) : null,
                    course_requirements: { create: requirements }
                },
            });
        });

        // 🚀 關鍵修復：將「解除全校舊有綁定」與「寫入新綁定」放入同一個 transaction 執行
        await prisma.$transaction([
            prisma.class.updateMany({ data: { homeroom_teacher_id: null } }),
            ...classUpserts
        ]);

// 儲存系統設定 (✅ 修正為符合 Schema 的單筆資料寫入)
         // 🛡️ 將 academic_year 統一轉為 String，避免前端傳送數字（如 114）時 Prisma 報錯
         const academicYear = schoolInfo && schoolInfo.academic_year !== undefined && schoolInfo.academic_year !== ''
             ? String(schoolInfo.academic_year)
             : "115";

         if (schoolInfo) {
             await prisma.systemSetting.upsert({
                 where: { id: 1 },
                 update: {
                     academic_year: academicYear,
                     semester: schoolInfo.semester || "上學期",
                    grade_settings: JSON.stringify(schoolInfo.gradeSettings || {}),
                    period_defaults: JSON.stringify(schoolInfo.periodDefaults || {}),
                    alternative_matrix: JSON.stringify(schoolInfo.alternativeMatrix || {}),
                    standard_domain_settings: JSON.stringify(req.body.standardDomainSettings || []),
                    class_exceptions: JSON.stringify(schoolInfo.classExceptions || []),
                    ai_settings: JSON.stringify(aiSettings || {}),
                    classroom_limits: JSON.stringify(schoolInfo.classroomLimits || {}),
                    subjectClassroomGrades: JSON.stringify(schoolInfo.subjectClassroomGrades || {})
                },
                 create: {
                     id: 1,
                     academic_year: academicYear,
                     semester: schoolInfo.semester || "上學期",
                    grade_settings: JSON.stringify(schoolInfo.gradeSettings || {}),
                    period_defaults: JSON.stringify(schoolInfo.periodDefaults || {}),
                    alternative_matrix: JSON.stringify(schoolInfo.alternativeMatrix || {}),
                    standard_domain_settings: JSON.stringify(req.body.standardDomainSettings || []),
                    class_exceptions: JSON.stringify(schoolInfo.classExceptions || []),
                    ai_settings: JSON.stringify(aiSettings || {}),
                    classroom_limits: JSON.stringify(schoolInfo.classroomLimits || {})
                }
            });
        }
        // 更新特殊課程
        if (specialCourses && Array.isArray(specialCourses)) {
            await prisma.specialCourse.deleteMany({});
            for (const sc of specialCourses) {
                await prisma.specialCourse.create({
                    data: {
                        type: sc.type,
                        name: sc.name,
                        targetSubject: sc.targetSubject || '',
                        teacher: sc.teacher || '',
                        targetClasses: JSON.stringify(sc.targetClasses || []),
                        lockedSlots: JSON.stringify(sc.lockedSlots || []),
                        isAutoTime: sc.isAutoTime || false,
                        isAutoClass: sc.isAutoClass || false,
                        autoClassConfig: JSON.stringify(sc.autoClassConfig || null)
                    }
                });
            }
        }

        // 更新教室資料
        const normalizeRoomSubject = (subj) => {
            if (!subj) return '';
            const s = String(subj).trim();
            if (s === '英語') return '語文-英語';
            if (s === '自然') return '自然科學';
            if (s === '科技-資訊' || s === '電腦') return '資訊';
            if (s === '健康與體育') return '體育';
            if (s === '本土語言' || s === '閩南語' || s === '客語') return '語文-本土語';
            return s;
        };

        if (classrooms && Array.isArray(classrooms)) {
            await prisma.classroom.deleteMany({});
            for (const room of classrooms) {
                await prisma.classroom.create({
                    data: {
                        name: String(room.name || ''),
                        subject: normalizeRoomSubject(room.subject),
                        primaryTeacher: String(room.primaryTeacher || ''),
                        allowSharing: room.allowSharing === false ? false : true,
                        gradePreferences: Array.isArray(room.gradePreferences)
                            ? JSON.stringify(room.gradePreferences)
                            : (room.gradePreferences ?? null),
                    }
                });
            }
        }

        console.log(`[OK] 全面儲存成功：${teachers.length} 位教師、${classes.length} 個班級`);
        res.json({ success: true, message: '儲存成功' });
    } catch (error) {
        console.error('[ERROR] 全面儲存失敗:', error);
        res.status(500).json({ error: '儲存失敗', details: error.message });
    }
});



// 🔧 教室科目名稱 normalization — 全鏈路單一 canonical key
const normalizeRoomSubject = (subj) => {
    if (!subj) return '';
    const s = String(subj).trim();
    if (s === '英語') return '語文-英語';
    if (s === '自然') return '自然科學';
    if (s === '科技-資訊' || s === '電腦') return '資訊';
    if (s === '健康與體育') return '體育';
    if (s === '本土語言' || s === '閩南語' || s === '客語') return '語文-本土語';
    return s;
};

// 獲取所有全域資料 (讓前端 F5 重整時可以讀取)
app.get('/api/schedule', async (req, res) => {
    try {
        const systemSetting = await prisma.systemSetting.findUnique({ where: { id: 1 } });
        const teachers = await prisma.teacher.findMany();
        const classes = await prisma.class.findMany({
            include: { course_requirements: true, homeroom_teacher: true }
        });
        const specialCourses = await prisma.specialCourse.findMany();
        const classroomsRaw = await prisma.classroom.findMany();
        // 🔧 讀出時即做 normalization，確保舊資料不會以非 canonical 名稱流出
        // 🆕 [gradePreferences] 同步解析優先年級欄位
        const classrooms = classroomsRaw.map(r => {
            let gp = r.gradePreferences;
            if (typeof gp === 'string') {
                try { gp = JSON.parse(gp); } catch { gp = []; }
            }
            return {
                ...r,
                subject: normalizeRoomSubject(r.subject),
                gradePreferences: Array.isArray(gp) ? gp : []
            };
        });

        // 🔧 [Step 3] 專科教室容量預設值（防禦性設計：確保 5 個科目不缺鍵）
        const DEFAULT_CLASSROOM_LIMITS = { 自然科學: 3, '語文-英語': 3, 音樂: 3, 美勞: 3, 體育: 6, 資訊: 1 };

        // 將資料庫格式還原回前端需要的 JSON 格式
        res.json({
            schoolInfo: systemSetting ? {
                academic_year: systemSetting.academic_year,
                semester: systemSetting.semester,
                gradeSettings: JSON.parse(systemSetting.grade_settings || '{}'),
                periodDefaults: JSON.parse(systemSetting.period_defaults || '{}'),
                alternativeMatrix: JSON.parse(systemSetting.alternative_matrix || '{}'),
                classExceptions: JSON.parse(systemSetting.class_exceptions || '[]'),
                classroomLimits: {
                    ...DEFAULT_CLASSROOM_LIMITS,
                    ...JSON.parse(systemSetting.classroom_limits || '{}')
                },
                ai_settings: JSON.parse(systemSetting.ai_settings || '{}'),
                subjectClassroomGrades: JSON.parse(systemSetting.subjectClassroomGrades || '{}'),
             } : null,
            standardDomainSettings: systemSetting ? JSON.parse(systemSetting.standard_domain_settings || '[]') : [],
            teachers: teachers.map(t => ({
                ...t,
                expertiseSubjects: JSON.parse(t.expertise || '[]'),
                unavailable_slots: JSON.parse(t.unavailable_slots || '[]'),
                gradePreferences: t.gradePreferences ? JSON.parse(t.gradePreferences) : []
            })),
            classes: classes.map(c => ({
                ...c,
                timetable: JSON.parse(c.timetable || 'null'),
                conflicts: JSON.parse(c.conflicts || '{}'),
                homeroom_teacher: c.homeroom_teacher ? c.homeroom_teacher.name : null,
                // ↓ 關鍵修正：把 DB 的 teacher_name 對應回前端期待的 teacher 欄位
                course_requirements: (c.course_requirements || []).map(req => ({
                ...req,
                teacher: req.teacher_name || ''
                }))
            })),
            specialCourses: specialCourses.map(sc => ({
                ...sc,
                targetClasses: JSON.parse(sc.targetClasses || '[]'),
                lockedSlots: JSON.parse(sc.lockedSlots || '[]'),
                autoClassConfig: JSON.parse(sc.autoClassConfig || 'null')
            })),
            classrooms
        });
    } catch (error) {
        console.error("讀取資料庫失敗:", error);
        res.status(500).json({ error: '讀取資料庫失敗' });
    }
});



// ==========================================
// 模組三：系統初始化 (Setup Wizard)
// ==========================================

// 獲取系統初始化狀態
app.get('/api/system/status', async (req, res) => {
    try {
        const status = await prisma.systemStatus.findUnique({ where: { id: 1 } });
        res.json({
            isSetupComplete: status ? status.isSetupComplete : false,
            schoolName: status ? status.schoolName : ''
        });
    } catch {
        res.status(500).json({ error: '讀取系統狀態失敗' });
    }
});

// 系統初始化 API
app.post('/api/system/setup', async (req, res) => {
    const { schoolName, username, password } = req.body;

    // 驗證必填欄位
    if (!schoolName || !username || !password) {
        return res.status(400).json({ error: '請填寫所有必填欄位' });
    }

    try {
        // 檢查是否已經初始化過
        const existingStatus = await prisma.systemStatus.findUnique({ where: { id: 1 } });
        if (existingStatus && existingStatus.isSetupComplete) {
            return res.status(400).json({ error: '系統已完成初始化，無法重複設定' });
        }

        // 使用 transaction 確保原子性
        await prisma.$transaction(async (tx) => {
            // 1. 加密密碼
            const hashedPassword = await bcrypt.hash(password, 10);

            // 2. 建立管理員帳戶
            await tx.adminUser.create({
                data: {
                    username,
                    password: hashedPassword,
                    role: 'admin'
                }
            });

            // 3. 更新系統狀態
            if (existingStatus) {
                await tx.systemStatus.update({
                    where: { id: 1 },
                    data: {
                        isSetupComplete: true,
                        schoolName
                    }
                });
            } else {
                await tx.systemStatus.create({
                    data: {
                        id: 1,
                        isSetupComplete: true,
                        schoolName
                    }
                });
            }
        });

        console.log(`[OK] 系統初始化成功：學校=${schoolName}, 管理員=${username}`);
        res.json({ success: true, message: '系統初始化成功' });
    } catch (error) {
        console.error('[ERROR] 系統初始化失敗:', error);
        res.status(500).json({ error: '初始化失敗', details: error.message });
    }
});

// ==========================================
// 模組三點五：AI 系統設定管理
// ==========================================

// 獲取 AI 系統設定 (Ollama 連線等)
app.get('/api/ai-system-settings', async (req, res) => {
    try {
        const systemSetting = await prisma.systemSetting.findUnique({ where: { id: 1 } });
        const aiSystemSettings = systemSetting && systemSetting.aiSystemSettings
            ? JSON.parse(systemSetting.aiSystemSettings)
            : { enabled: false, serviceType: 'ollama', apiUrl: '', model: '', systemPrompt: '' };
        res.json(aiSystemSettings);
    } catch (error) {
        console.error('[ERROR] 讀取 AI 系統設定失敗:', error);
        res.status(500).json({ error: '讀取 AI 系統設定失敗' });
    }
});

// 儲存 AI 系統設定
app.put('/api/ai-system-settings', async (req, res) => {
    try {
        const aiData = req.body;
        // 先檢查是否存在既有紀錄
        const existing = await prisma.systemSetting.findUnique({ where: { id: 1 } });

        if (existing) {
            // 存在則只更新 aiSystemSettings 欄位，保留其他欄位不變
            await prisma.systemSetting.update({
                where: { id: 1 },
                data: {
                    aiSystemSettings: JSON.stringify(aiData),
                }
            });
        } else {
            // 不存在則建立完整紀錄
            await prisma.systemSetting.create({
                data: {
                    id: 1,
                    academic_year: '115',
                    semester: '上學期',
                    grade_settings: '{}',
                    period_defaults: '{}',
                    alternative_matrix: '{}',
                    standard_domain_settings: '[]',
                    class_exceptions: '[]',
                    ai_settings: '{}',
                    classroom_limits: '{}',
                    aiSystemSettings: JSON.stringify(aiData),
                }
            });
        }

        console.log('[OK] AI 系統設定已儲存');
        res.json({ success: true, message: 'AI 系統設定已儲存' });
    } catch (error) {
        console.error('[ERROR] 儲存 AI 系統設定失敗:', error);
        res.status(500).json({ error: '儲存 AI 系統設定失敗', details: error.message });
    }
});

// 測試 AI 連線（由後端代轉，避免瀏覽器直接跨域打 llama.cpp / Ollama / LM Studio）
app.post('/api/ai-test-connection', async (req, res) => {
    try {
        const { serviceType, apiUrl, model } = req.body || {};
        const normalizedServiceType = ['ollama', 'llama.cpp', 'lmstudio'].includes(serviceType)
            ? serviceType
            : 'ollama';
        const targetUrl = String(apiUrl || '').trim();

        if (!targetUrl) {
            return res.status(400).json({ error: 'apiUrl is required' });
        }

        const prompt = '請用一句話回覆：連線測試成功。';
        const payload = normalizedServiceType === 'llama.cpp'
            ? {
                model: model || 'llama',
                messages: [{ role: 'user', content: prompt }],
                stream: false,
            }
            : normalizedServiceType === 'lmstudio'
                ? {
                    model: model || 'lmstudio',
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                }
                : {
                    model: model || 'ollama',
                    prompt,
                    stream: false,
                };

        const upstreamResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const rawText = await upstreamResponse.text();
        let data = {};
        if (rawText) {
            try {
                data = JSON.parse(rawText);
            } catch {
                data = { rawText };
            }
        }

        res.status(upstreamResponse.status).json({
            ok: upstreamResponse.ok,
            status: upstreamResponse.status,
            source: 'upstream',
            targetUrl,
            data,
        });
    } catch (error) {
        console.error('[ERROR] AI 連線測試失敗:', error);
        res.status(502).json({
            error: 'AI 連線測試失敗',
            details: error.message,
            source: 'server',
        });
    }
});

// ==========================================
// 模組三點六：調試報告 API
// ==========================================

// 讀取 debug_infeasible_report.txt 內容
function normalizeAiServiceType(serviceType) {
    return ['ollama', 'llama.cpp', 'lmstudio'].includes(serviceType) ? serviceType : 'ollama';
}

function extractAssistantText(data) {
    return data?.choices?.[0]?.message?.content
        || data?.choices?.[0]?.text
        || data?.message?.content
        || data?.message
        || data?.content
        || data?.response
        || data?.rawText
        || '';
}

function parseStrictJsonFromText(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('AI 回應為空');

    try {
        return JSON.parse(raw);
    } catch {
        // keep trying
    }

    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    if (fencedMatch) {
        try {
            return JSON.parse(fencedMatch[1]);
        } catch {
            // keep trying
        }
    }

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
            return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
        } catch {
            // keep trying
        }
    }

    throw new Error('AI 回傳不是有效 JSON');
}

const aiTuningSessions = new Map();
const AI_TUNING_TIMEOUT_MS = 600000;
const aiTuningBackgroundJobs = new Map();

function cloneScheduleEntries(entries = []) {
    return JSON.parse(JSON.stringify(entries || []));
}

function createAiHttpError(status, code, message, details = '') {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    error.details = details;
    return error;
}

function resolveScheduleContext(scheduleContext = {}, fallback = {}) {
    return {
        classes: Array.isArray(scheduleContext?.classes) ? scheduleContext.classes : (Array.isArray(fallback?.classes) ? fallback.classes : []),
        teachers: Array.isArray(scheduleContext?.teachers) ? scheduleContext.teachers : (Array.isArray(fallback?.teachers) ? fallback.teachers : []),
        classrooms: Array.isArray(scheduleContext?.classrooms) ? scheduleContext.classrooms : (Array.isArray(fallback?.classrooms) ? fallback.classrooms : []),
        schoolInfo: scheduleContext?.schoolInfo && typeof scheduleContext.schoolInfo === 'object'
            ? scheduleContext.schoolInfo
            : (fallback?.schoolInfo && typeof fallback.schoolInfo === 'object' ? fallback.schoolInfo : {}),
        engineMeta: scheduleContext?.engineMeta && typeof scheduleContext.engineMeta === 'object'
            ? scheduleContext.engineMeta
            : (fallback?.engineMeta && typeof fallback.engineMeta === 'object' ? fallback.engineMeta : {}),
    };
}

function buildScheduleReportFromContext({ scheduleEntries = [], scheduleContext = {}, aiSettings = {}, engineMeta = {} } = {}) {
    const resolvedContext = resolveScheduleContext(scheduleContext, {});
    return buildScheduleAiReport({
        scheduleEntries,
        classes: resolvedContext.classes,
        teachers: resolvedContext.teachers,
        classrooms: resolvedContext.classrooms,
        schoolInfo: resolvedContext.schoolInfo,
        aiSettings,
        engineMeta: Object.keys(resolvedContext.engineMeta || {}).length > 0 ? resolvedContext.engineMeta : engineMeta,
    });
}

function buildAiTimetablePrompt(reportMarkdown, report, clientAiSettings = {}, tuningContext = {}) {
    const summary = report?.summary || {};
    const issues = Array.isArray(report?.issues) ? report.issues.slice(0, 80) : [];
    const swapCandidates = Array.isArray(report?.swapCandidates) ? report.swapCandidates : [];
    const candidateMoves = Array.isArray(report?.candidateMoves) ? report.candidateMoves.slice(0, 24) : [];
    const promptScope = tuningContext?.promptScope || null;

    const compactContext = {
        summary,
        promptScope,
        issueClasses: (report?.classes || []).filter((item) => item.issueCount > 0).map((item) => ({
            className: item.className,
            grade: item.grade,
            issueCount: item.issueCount,
            requirementIssues: item.requirementIssues,
            issueSlots: item.issueSlots.map((slot) => ({
                day: slot.day,
                period: slot.period,
                issues: slot.issues,
            })),
            topSubjects: item.topSubjects,
        })),
        teacherLoads: Array.isArray(report?.teacherLoads) ? report.teacherLoads : [],
        swapCandidates: swapCandidates.map((item) => ({
            className: item.className,
            grade: item.grade,
            candidates: item.candidates.slice(0, 14).map((slot) => ({
                day: slot.day,
                period: slot.period,
                issue: slot.issue,
                teachable: slot.teachable,
                subject: slot.subject,
                teacher: slot.teacher,
            })),
        })),
        candidateMoves: candidateMoves.map((item) => ({
            candidateId: item.candidateId,
            className: item.className,
            grade: item.grade,
            summaryText: item.summaryText,
            reason: item.reason,
            from: item.from,
            to: item.to,
            score: item.score,
        })),
        clientAiSettings,
    };

    const focusLines = [];
    if (promptScope) {
        focusLines.push('這是本輪的焦點片段，不是全校完整報告。請只根據此焦點提出建議。');
        if (promptScope.focusType) {
            focusLines.push(`焦點類型：${promptScope.focusType}`);
        }
        if (promptScope.subject) {
            focusLines.push(`專科資源：${promptScope.subject}`);
        }
        if (promptScope.className) {
            focusLines.push(`主要班級：${promptScope.className}`);
        }
        if (Array.isArray(promptScope.classNames) && promptScope.classNames.length > 0) {
            focusLines.push(`涉及班級：${promptScope.classNames.join('、')}`);
        }
    }

    if (candidateMoves.length > 0) {
        focusLines.push(`合法候選池：共有 ${candidateMoves.length} 個候選交換。請只從 candidateMoves 中挑選，勿自行發明候選池外的座標。`);
    }

    return [
        '你是學校課表微調引擎，只能回傳嚴格 JSON，不要 Markdown，不要解釋文字。',
        '目標：優先降低硬約束衝突，其次改善明顯的軟約束問題。',
        '限制：只允許同一班內的 swap moves，且每個 move 必須維持總節數不變。',
        '若提供 candidateMoves，請只從合法候選池中挑選，回傳 selectedMoves，且每筆只能包含 candidateId 與 reason，不可自行發明新的座標。',
        '輸出格式必須符合：',
        '{',
        '  "summary": { "text": "一句話摘要", "confidence": 0.0 },',
        '  "issues": [{ "className": "3年1班", "day": 1, "period": 2, "type": "teacher|room|requirement", "severity": "hard|soft", "message": "..." }],',
        '  "selectedMoves": [{ "candidateId": "CAND-..." , "reason": "..." }],',
        '  "warnings": ["..."],',
        '  "nextFocus": "class|resource|teacher|room|stop",',
        '  "stopReason": "..."',
        '}',
        '',
        ...focusLines,
        focusLines.length > 0 ? '' : '',
        '以下是報表：',
        reportMarkdown || '',
        '',
        '以下是結構化上下文：',
        JSON.stringify(compactContext, null, 2),
        '',
        tuningContext && Object.keys(tuningContext).length > 0
            ? [
                '以下是本輪閉環控制資訊：',
                JSON.stringify(tuningContext, null, 2),
            ].join('\n')
            : '',
    ].join('\n');
}

function buildScheduleIndex(scheduleEntries) {
    const byClassSlot = new Map();

    for (const entry of scheduleEntries || []) {
        const className = String(entry.className || entry.class || '').trim();
        const day = Number(entry.day);
        const period = Number(entry.period);
        if (!className || !day || !period) continue;

        const key = `${className}|${day}|${period}`;
        if (!byClassSlot.has(key)) byClassSlot.set(key, []);
        byClassSlot.get(key).push({
            ...entry,
            className,
            day,
            period,
        });
    }

    return byClassSlot;
}

function validateAiSwapMoves(report, swapMoves) {
    const scheduleEntries = Array.isArray(report?.rawSchedule) ? report.rawSchedule : [];
    const byClassSlot = buildScheduleIndex(scheduleEntries);
    const errors = [];
    const validMoves = [];

    for (const move of swapMoves || []) {
        const className = String(move?.className || '').trim();
        const fromDay = Number(move?.from?.day);
        const fromPeriod = Number(move?.from?.period);
        const toDay = Number(move?.to?.day);
        const toPeriod = Number(move?.to?.period);

        if (!className || !fromDay || !fromPeriod || !toDay || !toPeriod) {
            errors.push({ move, reason: '缺少 className / from / to' });
            continue;
        }

        if (fromDay === toDay && fromPeriod === toPeriod) {
            errors.push({ move, reason: '來源與目標相同' });
            continue;
        }

        const fromKey = `${className}|${fromDay}|${fromPeriod}`;
        const toKey = `${className}|${toDay}|${toPeriod}`;
        const fromEntries = byClassSlot.get(fromKey) || [];
        const toEntries = byClassSlot.get(toKey) || [];

        if (fromEntries.length === 0 || toEntries.length === 0) {
            errors.push({ move, reason: '交換位置必須同時已有課程' });
            continue;
        }

        validMoves.push({
            className,
            from: { day: fromDay, period: fromPeriod },
            to: { day: toDay, period: toPeriod },
            reason: String(move?.reason || '').trim(),
        });
    }

    return { errors, validMoves, byClassSlot };
}

function buildAiCandidateMoveIndex(report) {
    const candidateMoves = Array.isArray(report?.candidateMoves) ? report.candidateMoves : [];
    const byId = new Map();

    for (const candidate of candidateMoves) {
        const candidateId = String(candidate?.candidateId || '').trim();
        if (!candidateId) continue;
        byId.set(candidateId, candidate);
    }

    return { byId };
}

function validateAiCandidateSelections(report, selectedMoves) {
    const { byId } = buildAiCandidateMoveIndex(report);
    const errors = [];
    const validMoves = [];
    const seenCandidateIds = new Set();

    for (const move of selectedMoves || []) {
        const candidateId = String(move?.candidateId || move?.id || move?.candidate || move || '').trim();
        if (!candidateId) {
            errors.push({ move, reason: '缺少 candidateId' });
            continue;
        }

        const candidate = byId.get(candidateId);
        if (!candidate) {
            errors.push({ move, reason: `候選池中找不到 candidateId: ${candidateId}` });
            continue;
        }

        if (seenCandidateIds.has(candidateId)) {
            continue;
        }
        seenCandidateIds.add(candidateId);

        validMoves.push({
            candidateId,
            className: String(candidate.className || '').trim(),
            from: {
                day: Number(candidate?.from?.day),
                period: Number(candidate?.from?.period),
            },
            to: {
                day: Number(candidate?.to?.day),
                period: Number(candidate?.to?.period),
            },
            reason: String(move?.reason || candidate?.reason || '').trim(),
            summaryText: String(candidate?.summaryText || '').trim(),
            impactSummary: candidate?.impactSummary || null,
        });
    }

    return { errors, validMoves, byId };
}

function applyAiSwapMoves(scheduleEntries, swapMoves) {
    const cloned = JSON.parse(JSON.stringify(scheduleEntries || []));

    for (const move of swapMoves || []) {
        const className = String(move.className || '').trim();
        const fromDay = Number(move.from?.day);
        const fromPeriod = Number(move.from?.period);
        const toDay = Number(move.to?.day);
        const toPeriod = Number(move.to?.period);

        const fromEntries = cloned.filter((entry) =>
            String(entry.className || entry.class || '').trim() === className
            && Number(entry.day) === fromDay
            && Number(entry.period) === fromPeriod
        );
        const toEntries = cloned.filter((entry) =>
            String(entry.className || entry.class || '').trim() === className
            && Number(entry.day) === toDay
            && Number(entry.period) === toPeriod
        );

        for (const entry of fromEntries) {
            entry.day = toDay;
            entry.period = toPeriod;
        }
        for (const entry of toEntries) {
            entry.day = fromDay;
            entry.period = fromPeriod;
        }
    }

    return cloned;
}

function normalizeAiTuningFocusStrategy(strategy) {
    return String(strategy || '').trim() === 'class_first' ? 'class_first' : 'resource_first';
}

function buildAiTuningFocusKey(focus) {
    if (!focus || typeof focus !== 'object') return '';
    if (focus.focusType === 'resource' && focus.subject) {
        return `resource:${String(focus.subject).trim()}`;
    }
    if (focus.focusType === 'class' && focus.className) {
        return `class:${String(focus.className).trim()}`;
    }
    return '';
}

function buildAiTuningClassFocusCandidates(report) {
    return (Array.isArray(report?.classes) ? report.classes : [])
        .map((classReport) => ({
            focusType: 'class',
            className: classReport.className,
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
}

function buildAiTuningResourceFocusCandidates(report, scheduleContext = {}) {
    const classroomCapacityMap = new Map();
    for (const room of Array.isArray(scheduleContext?.classrooms) ? scheduleContext.classrooms : []) {
        const subject = normalizeRoomSubject(room.subject);
        if (!subject) continue;
        classroomCapacityMap.set(subject, (classroomCapacityMap.get(subject) || 0) + 1);
    }

    const subjectStats = new Map();

    for (const classReport of Array.isArray(report?.classes) ? report.classes : []) {
        for (const slot of Array.isArray(classReport.issueSlots) ? classReport.issueSlots : []) {
            const slotSubjects = new Set(
                (Array.isArray(slot.entries) ? slot.entries : [])
                    .map((entry) => normalizeRoomSubject(entry.subject))
                    .filter(Boolean)
            );
            const issueTypes = new Set((Array.isArray(slot.issues) ? slot.issues : []).map((issue) => issue.type).filter(Boolean));
            if (slotSubjects.size === 0 || !issueTypes.has('room')) continue;

            for (const subject of slotSubjects) {
                const normalizedSubject = normalizeRoomSubject(subject);
                if (!normalizedSubject) continue;
                const current = subjectStats.get(normalizedSubject) || {
                    focusType: 'resource',
                    subject: normalizedSubject,
                    capacity: classroomCapacityMap.get(normalizedSubject) || 0,
                    roomIssueCount: 0,
                    teacherIssueCount: 0,
                    gradeIssueCount: 0,
                    issueCount: 0,
                    classes: new Set(),
                    reason: '',
                };

                current.capacity = classroomCapacityMap.get(normalizedSubject) || current.capacity || 0;
                current.roomIssueCount += 1;
                current.issueCount += Array.isArray(slot.issues) ? slot.issues.length : 0;
                if (issueTypes.has('teacher')) current.teacherIssueCount += 1;
                if (issueTypes.has('grade')) current.gradeIssueCount += 1;
                current.classes.add(classReport.className);
                subjectStats.set(normalizedSubject, current);
            }
        }
    }

    const candidates = [...subjectStats.values()]
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

    return candidates;
}

function selectAiTuningFocus({
    report,
    scheduleContext = {},
    focusStrategy = 'resource_first',
    history = [],
} = {}) {
    const normalizedStrategy = normalizeAiTuningFocusStrategy(focusStrategy);
    const recentFocusKeys = new Set(
        (Array.isArray(history) ? history : [])
            .slice(-2)
            .map((item) => buildAiTuningFocusKey(item?.focus))
            .filter(Boolean)
    );

    const classCandidates = buildAiTuningClassFocusCandidates(report);
    const resourceCandidates = buildAiTuningResourceFocusCandidates(report, scheduleContext);

    const pickBest = (candidates) => {
        const filtered = candidates.filter((candidate) => !recentFocusKeys.has(buildAiTuningFocusKey(candidate)));
        return (filtered.length > 0 ? filtered : candidates)[0] || null;
    };

    if (normalizedStrategy === 'class_first') {
        const bestClass = pickBest(classCandidates);
        if (bestClass) {
            return bestClass;
        }
    } else {
        const bestResource = pickBest(resourceCandidates);
        if (bestResource) {
            const relatedClasses = [...bestResource.classes];
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
                linkedClasses: relatedClasses,
                reason: bestRelatedClass
                    ? `先修最稀缺的 ${bestResource.subject} 資源，再從 ${bestRelatedClass.className} 追蹤連鎖衝突。`
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

async function executeAiTimetableAnalysis({
    report,
    reportMarkdown,
    scheduleEntries,
    scheduleContext = null,
    aiSettings: clientAiSettings = {},
    connectionSettings: clientConnectionSettings = {},
    tuningContext = {},
    abortSignal = null,
}) {
    const sourceEntries = Array.isArray(scheduleEntries)
        ? scheduleEntries
        : Array.isArray(report?.rawSchedule)
            ? report.rawSchedule
            : [];

    if (!report || !Array.isArray(report.rawSchedule)) {
        throw createAiHttpError(400, 'AI_REPORT_MISSING', '缺少 report 或 rawSchedule');
    }

    const hasScheduleContext = scheduleContext && (
        Array.isArray(scheduleContext.classes)
        || Array.isArray(scheduleContext.teachers)
        || Array.isArray(scheduleContext.classrooms)
    );

    const effectiveReport = hasScheduleContext
        ? buildScheduleReportFromContext({
            scheduleEntries: sourceEntries,
            scheduleContext,
            aiSettings: report?.aiSettings || clientAiSettings,
            engineMeta: report?.engineMeta || scheduleContext?.engineMeta || {},
        })
        : report;

    const promptReport = tuningContext?.promptReport || effectiveReport;
    const effectiveReportMarkdown = tuningContext?.promptMarkdown
        || (hasScheduleContext ? effectiveReport.promptMarkdown : (reportMarkdown || ''));

    const systemSetting = await prisma.systemSetting.findUnique({ where: { id: 1 } });
    const aiSystemSettings = systemSetting && systemSetting.aiSystemSettings
        ? JSON.parse(systemSetting.aiSystemSettings)
        : { enabled: false, serviceType: 'ollama', apiUrl: '', model: '', systemPrompt: '' };

    const resolvedAiSettings = {
        ...aiSystemSettings,
        ...(clientConnectionSettings && typeof clientConnectionSettings === 'object' ? {
            enabled: clientConnectionSettings.enabled ?? aiSystemSettings.enabled,
            serviceType: clientConnectionSettings.serviceType ?? aiSystemSettings.serviceType,
            apiUrl: clientConnectionSettings.apiUrl ?? aiSystemSettings.apiUrl,
            model: clientConnectionSettings.model ?? aiSystemSettings.model,
            systemPrompt: clientConnectionSettings.systemPrompt ?? aiSystemSettings.systemPrompt,
        } : {}),
    };

    if (!resolvedAiSettings.enabled) {
        throw createAiHttpError(400, 'AI_DISABLED', 'AI 功能尚未啟用');
    }

    const serviceType = normalizeAiServiceType(resolvedAiSettings.serviceType);
    const targetUrl = String(resolvedAiSettings.apiUrl || '').trim();
    const model = String(resolvedAiSettings.model || '').trim() || 'qwen3.6:27b';
    if (!targetUrl) {
        throw createAiHttpError(400, 'AI_API_URL_MISSING', 'AI API URL 尚未設定');
    }

    const systemPrompt = [
        resolvedAiSettings.systemPrompt,
        '你是學校課表微調引擎，請只回傳 JSON。',
        '若提供 candidateMoves，請只從候選池選擇 candidateId，不可自行發明座標。',
        '只能提出同一班內的 swap moves，不能改變各班總節數。',
        '優先處理教師衝堂、教室容量超額、需求節數不符。',
    ].filter(Boolean).join('\n\n');

    const promptFocus = tuningContext?.focus || selectAiTuningFocus({
        report: effectiveReport,
        scheduleContext,
        focusStrategy: tuningContext?.focusStrategy || 'resource_first',
        history: tuningContext?.recentHistory || [],
    });
    const promptBundle = buildAiTuningPromptBundle({
        report: promptReport,
        focus: promptFocus,
        tuningContext,
        maxPromptChars: Number.isFinite(Number(tuningContext?.maxPromptChars))
            ? Number(tuningContext.maxPromptChars)
            : 100000,
    });
    if (promptBundle?.promptBudget && promptBundle.promptBudget.estimatedChars > promptBundle.promptBudget.maxPromptChars) {
        throw createAiHttpError(
            413,
            'AI_TUNING_PROMPT_TOO_LARGE',
            '本輪焦點摘要仍過大，請縮小修復範圍後再試',
            `estimatedChars=${promptBundle.promptBudget.estimatedChars}, maxPromptChars=${promptBundle.promptBudget.maxPromptChars}`
        );
    }
    const userPrompt = buildAiTimetablePrompt(
        promptBundle.promptMarkdown || effectiveReportMarkdown,
        promptBundle.promptReport || promptReport,
        clientAiSettings,
        {
            ...tuningContext,
            focus: promptFocus,
            promptScope: promptBundle.promptScope,
        },
    );

    const upstreamPayload = serviceType === 'ollama'
        ? {
            model,
            prompt: `${systemPrompt}\n\n${userPrompt}`,
            stream: false,
        }
        : {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            stream: false,
        };

    const upstreamController = new AbortController();
    if (abortSignal) {
        if (abortSignal.aborted) {
            upstreamController.abort();
        } else {
            abortSignal.addEventListener('abort', () => upstreamController.abort(), { once: true });
        }
    }
    const upstreamTimer = setTimeout(() => upstreamController.abort(), AI_TUNING_TIMEOUT_MS);
    let upstreamResponse;
    try {
        upstreamResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(upstreamPayload),
            signal: upstreamController.signal,
        });
    } finally {
        clearTimeout(upstreamTimer);
    }

    const rawText = await upstreamResponse.text();
    let upstreamData = {};
    if (rawText) {
        try {
            upstreamData = JSON.parse(rawText);
        } catch {
            upstreamData = { rawText };
        }
    }

    if (!upstreamResponse.ok) {
        throw createAiHttpError(
            upstreamResponse.status,
            'AI_UPSTREAM_ERROR',
            'AI 上游回應失敗',
            extractAssistantText(upstreamData) || rawText || `HTTP ${upstreamResponse.status}`,
        );
    }

    const assistantText = extractAssistantText(upstreamData);
    const parsed = parseStrictJsonFromText(assistantText);
    const maxMovesPerRound = Number.parseInt(tuningContext?.maxMovesPerRound, 10);
    const parsedMoves = Array.isArray(parsed.selectedMoves) ? parsed.selectedMoves : [];
    const limitedSelectedMoves = Number.isFinite(maxMovesPerRound) && maxMovesPerRound > 0
        ? parsedMoves.slice(0, maxMovesPerRound)
        : parsedMoves;
    const normalizedAnalysis = {
        summary: parsed.summary || { text: '', confidence: 0 },
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        selectedMoves: limitedSelectedMoves,
        swapMoves: [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        confidence: parsed.confidence ?? parsed.summary?.confidence ?? 0,
        nextFocus: parsed.nextFocus || '',
        stopReason: parsed.stopReason || '',
        expectedImpact: parsed.expectedImpact ?? null,
        riskLevel: parsed.riskLevel ?? null,
    };

    if (parsedMoves.length > limitedSelectedMoves.length) {
        normalizedAnalysis.warnings = [
            ...normalizedAnalysis.warnings,
            `selectedMoves 已截斷為最多 ${limitedSelectedMoves.length} 筆，以符合單輪修復限制。`,
        ];
    }

    const validation = validateAiCandidateSelections(effectiveReport, normalizedAnalysis.selectedMoves);
    if (validation.errors.length > 0) {
        throw createAiHttpError(
            400,
            'AI_INVALID_CANDIDATE_MOVE',
            'AI 交換建議包含無效 candidateId',
            validation.errors[0].reason,
        );
    }

    const previewSchedule = applyAiSwapMoves(sourceEntries, validation.validMoves);
    const previewReport = hasScheduleContext
        ? buildScheduleReportFromContext({
            scheduleEntries: previewSchedule,
            scheduleContext,
            aiSettings: report?.aiSettings || clientAiSettings,
            engineMeta: report?.engineMeta || scheduleContext?.engineMeta || {},
        })
        : null;

    return {
        ok: true,
        report: effectiveReport,
        previewReport,
        analysis: {
            ...normalizedAnalysis,
            selectedMoves: validation.validMoves.map((move) => ({
                candidateId: move.candidateId,
                reason: move.reason,
                className: move.className,
                from: move.from,
                to: move.to,
                summaryText: move.summaryText,
                impactSummary: move.impactSummary,
            })),
            swapMoves: validation.validMoves,
        },
        previewSchedule,
        resolvedAiSettings,
        upstreamData,
    };
}

async function handleAiTimetableAnalysis(req, res) {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const result = await executeAiTimetableAnalysis(req.body || {});
        return res.json({
            ok: true,
            analysis: result.analysis,
            previewSchedule: result.previewSchedule,
            report: result.previewReport || result.report,
        });
    } catch (error) {
        console.error('AI 課表分析/微調失敗:', error);
        const status = error?.status || (error?.name === 'AbortError' ? 502 : 502);
        const code = error?.code || (error?.name === 'AbortError' ? 'AI_UPSTREAM_TIMEOUT' : 'AI_ANALYSIS_FAILED');
        const message = error?.name === 'AbortError'
            ? 'AI 課表分析逾時'
            : error?.message || 'AI 課表分析失敗';
        res.status(status).json({
            code,
            error: message,
            details: error?.details || error?.message || '',
        });
    }
}

function normalizeAiTuningLimit(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAiTuningSessionOrThrow(sessionId) {
    const session = aiTuningSessions.get(String(sessionId || '').trim());
    if (!session) {
        throw createAiHttpError(404, 'AI_TUNING_SESSION_NOT_FOUND', '找不到 AI 微調 session');
    }
    return session;
}

function buildAiTuningLoopState({
    session,
    beforeIssueCount,
    afterIssueCount,
    progress,
    shouldContinue,
    focus = null,
}) {
    return {
        sessionId: session.id,
        iteration: session.iteration,
        beforeIssueCount,
        afterIssueCount,
        progress,
        shouldContinue,
        focusStrategy: session.focusStrategy,
        maxIterations: session.maxIterations,
        remainingIterations: Math.max(0, session.maxIterations - session.iteration),
        bestIssueCount: session.bestIssueCount,
        bestIteration: session.bestIteration,
        focus,
    };
}

function isAiTuningTimeoutLikeError(error) {
    const message = String(error?.message || '').toLowerCase();
    return Boolean(
        error?.code === 'AI_UPSTREAM_TIMEOUT'
        || error?.code === 'AI_UPSTREAM_ERROR'
        || error?.code === 'upstream_timeout'
        || error?.name === 'AbortError'
        || message.includes('aborted without reason')
        || message.includes('this operation was aborted')
        || message.includes('the operation was aborted')
        || message.includes('timeout')
        || message.includes('逾時')
    );
}

function isAiTuningPromptTooLargeError(error) {
    const message = String(error?.message || '').toLowerCase();
    return Boolean(
        error?.code === 'AI_TUNING_PROMPT_TOO_LARGE'
        || error?.code === 'AI_UPSTREAM_CONTEXT_OVERFLOW'
        || error?.code === 'upstream_context_overflow'
        || message.includes('context size')
        || message.includes('available context size')
        || message.includes('tokens exceeds')
    );
}

function getAiTuningJobRuntime(jobId) {
    const jobKey = String(jobId || '').trim();
    if (!jobKey) return null;
    if (!aiTuningBackgroundJobs.has(jobKey)) {
        aiTuningBackgroundJobs.set(jobKey, {
            jobId: jobKey,
            cancelRequested: false,
            currentAbortController: null,
            updatedAt: new Date().toISOString(),
        });
    }
    return aiTuningBackgroundJobs.get(jobKey);
}

function requestAiTuningJobCancel(jobId) {
    const runtime = aiTuningBackgroundJobs.get(String(jobId || '').trim());
    if (!runtime) return false;
    runtime.cancelRequested = true;
    runtime.updatedAt = new Date().toISOString();
    if (runtime.currentAbortController) {
        try {
            runtime.currentAbortController.abort();
        } catch {
            // ignore
        }
    }
    return true;
}

function clearAiTuningJobRuntime(jobId) {
    aiTuningBackgroundJobs.delete(String(jobId || '').trim());
}

async function updateAiTuningJobRecord(jobId, data = {}) {
    return prisma.scheduleJob.update({
        where: { id: jobId },
        data: {
            ...data,
            updatedAt: new Date(),
        },
    });
}

function getAiTuningJobPayload(jobRecord) {
    if (!jobRecord?.payload) return {};
    try {
        return JSON.parse(jobRecord.payload);
    } catch {
        return {};
    }
}

function getAiTuningJobResult(jobRecord) {
    if (!jobRecord?.result) return null;
    try {
        return JSON.parse(jobRecord.result);
    } catch {
        return { rawText: jobRecord.result };
    }
}

function buildAiTuningJobHistoryItem(jobRecord) {
    const payload = getAiTuningJobPayload(jobRecord);
    const result = getAiTuningJobResult(jobRecord) || {};
    const loopState = result.loopState || {};
    const fallbackState = result.fallbackState || null;
    const analysis = result.analysis || null;
    const history = Array.isArray(result.history) ? result.history : [];
    const historyTail = history.slice(-3);
    const reportSummary = result.report?.summary || null;
    const bestIssueCount = loopState.bestIssueCount ?? result.bestIssueCount ?? reportSummary?.issueCount ?? null;
    const totalIterations = loopState.totalIterations ?? loopState.iteration ?? history.length ?? 0;

    return {
        jobId: jobRecord.id,
        status: jobRecord.status,
        progressPhase: jobRecord.progressPhase,
        progressMessage: jobRecord.progressMessage,
        createdAt: jobRecord.createdAt,
        startedAt: jobRecord.startedAt,
        finishedAt: jobRecord.finishedAt,
        updatedAt: jobRecord.updatedAt,
        payload: {
            focusStrategy: payload.focusStrategy || 'resource_first',
            maxIterations: normalizeAiTuningLimit(payload.maxIterations, 3),
            maxMovesPerRound: normalizeAiTuningLimit(payload.maxMovesPerRound, 3),
            maxPromptChars: normalizeAiTuningLimit(payload.tuningContext?.maxPromptChars, 100000),
        },
        summary: {
            focusStrategy: loopState.focusStrategy || payload.focusStrategy || 'resource_first',
            fallbackFromStrategy: loopState.fallbackFromStrategy || fallbackState?.from || null,
            fallbackToStrategy: fallbackState?.to || null,
            bestIssueCount,
            bestIteration: loopState.bestIteration ?? result.bestIteration ?? 0,
            totalIterations,
            issueCount: reportSummary?.issueCount ?? null,
            warningsCount: Array.isArray(analysis?.warnings) ? analysis.warnings.length : Array.isArray(result.warnings) ? result.warnings.length : 0,
            swapMoveCount: Array.isArray(analysis?.swapMoves) ? analysis.swapMoves.length : 0,
            lastFocus: historyTail[historyTail.length - 1]?.focus || loopState.focus || null,
        },
        resultSummary: {
            analysisSummary: analysis?.summary || null,
            fallbackState,
            loopState,
            historyTail,
            status: result.status || jobRecord.status,
        },
    };
}

async function handleAiTimetableTuningStart(req, res) {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const {
            report,
            scheduleEntries,
            scheduleContext,
            aiSettings: clientAiSettings,
            connectionSettings: clientConnectionSettings,
            focusStrategy,
            maxIterations,
            maxMovesPerRound,
            tuningContext = {},
        } = req.body || {};

        if (!report || !Array.isArray(report.rawSchedule)) {
            return res.status(400).json({ code: 'AI_REPORT_MISSING', error: '缺少 report 或 rawSchedule' });
        }
        if (!scheduleContext || (!Array.isArray(scheduleContext.classes) && !Array.isArray(scheduleContext.teachers) && !Array.isArray(scheduleContext.classrooms))) {
            return res.status(400).json({ code: 'AI_TUNING_CONTEXT_MISSING', error: '缺少 scheduleContext，無法建立閉環 session' });
        }

        const effectiveScheduleEntries = Array.isArray(scheduleEntries) ? scheduleEntries : report.rawSchedule;
        const initialReportBundle = buildScheduleReportFromContext({
            scheduleEntries: effectiveScheduleEntries,
            scheduleContext,
            aiSettings: report?.aiSettings || clientAiSettings || {},
            engineMeta: report?.engineMeta || scheduleContext?.engineMeta || {},
        });

        const sessionId = randomUUID();
        const now = new Date().toISOString();
        const maxIterationsValue = normalizeAiTuningLimit(maxIterations, 3);
        const maxMovesPerRoundValue = normalizeAiTuningLimit(maxMovesPerRound, 3);
        const resolvedScheduleContext = resolveScheduleContext(scheduleContext, {});

        const session = {
            id: sessionId,
            status: 'running',
            createdAt: now,
            updatedAt: now,
            iteration: 0,
            focusStrategy: String(focusStrategy || 'resource_first').trim() || 'resource_first',
            maxIterations: maxIterationsValue,
            maxMovesPerRound: maxMovesPerRoundValue,
            scheduleContext: resolvedScheduleContext,
            aiSettings: report?.aiSettings || clientAiSettings || {},
            connectionSettings: clientConnectionSettings || {},
            currentScheduleEntries: cloneScheduleEntries(effectiveScheduleEntries),
            currentReportBundle: initialReportBundle,
            bestScheduleEntries: cloneScheduleEntries(effectiveScheduleEntries),
            bestReportBundle: initialReportBundle,
            bestIssueCount: initialReportBundle.report?.summary?.issueCount ?? Number.MAX_SAFE_INTEGER,
            bestIteration: 0,
            history: [],
        };

        const initialFocus = selectAiTuningFocus({
            report: initialReportBundle.report,
            scheduleContext: resolvedScheduleContext,
            focusStrategy: session.focusStrategy,
            history: [],
        });

        aiTuningSessions.set(sessionId, session);

        return res.json({
            ok: true,
            sessionId,
            status: session.status,
            iteration: session.iteration,
            focusStrategy: session.focusStrategy,
            limits: {
                maxIterations: session.maxIterations,
                maxMovesPerRound: session.maxMovesPerRound,
            },
            reportSummary: initialReportBundle.report?.summary || {},
            shouldContinue: (initialReportBundle.report?.summary?.issueCount || 0) > 0,
            focus: initialFocus,
        });
    } catch (error) {
        console.error('AI 微調 session 建立失敗:', error);
        const status = error?.status || 500;
        res.status(status).json({
            code: error?.code || 'AI_TUNING_START_FAILED',
            error: error?.message || '建立 AI 微調 session 失敗',
            details: error?.details || error?.message || '',
        });
    }
}

async function handleAiTimetableTuningStep(req, res) {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const {
            sessionId,
            tuningContext = {},
        } = req.body || {};
        const session = getAiTuningSessionOrThrow(sessionId);
        if (session.status !== 'running') {
            return res.status(409).json({ code: 'AI_TUNING_SESSION_NOT_RUNNING', error: 'AI 微調 session 目前不可執行' });
        }
        if (session.iteration >= session.maxIterations) {
            return res.status(409).json({ code: 'AI_TUNING_MAX_ITERATIONS_REACHED', error: '已達到 AI 微調最大輪次' });
        }

        const beforeIssueCount = session.currentReportBundle.report?.summary?.issueCount || 0;
        const focus = selectAiTuningFocus({
            report: session.currentReportBundle.report,
            scheduleContext: session.scheduleContext,
            focusStrategy: session.focusStrategy,
            history: session.history,
        });
        const mergedTuningContext = {
            sessionId: session.id,
            iteration: session.iteration + 1,
            maxIterations: session.maxIterations,
            maxMovesPerRound: session.maxMovesPerRound,
            focusStrategy: session.focusStrategy,
            focus,
            beforeIssueCount,
            bestIssueCount: session.bestIssueCount,
            recentHistory: session.history.slice(-3),
            ...tuningContext,
        };

    const result = await executeAiTimetableAnalysis({
            report: session.currentReportBundle.report,
            reportMarkdown: session.currentReportBundle.promptMarkdown,
            scheduleEntries: session.currentScheduleEntries,
            scheduleContext: session.scheduleContext,
            aiSettings: session.aiSettings,
            connectionSettings: session.connectionSettings,
            tuningContext: mergedTuningContext,
        });

        const afterIssueCount = result.previewReport?.report?.summary?.issueCount
            ?? result.analysis?.issues?.length
            ?? beforeIssueCount;
        const progress = afterIssueCount < beforeIssueCount
            ? 'improved'
            : afterIssueCount === beforeIssueCount
                ? 'stagnated'
                : 'worse';

        session.iteration += 1;
        session.updatedAt = new Date().toISOString();
        session.currentScheduleEntries = cloneScheduleEntries(result.previewSchedule);
        session.currentReportBundle = result.previewReport || buildScheduleReportFromContext({
            scheduleEntries: session.currentScheduleEntries,
            scheduleContext: session.scheduleContext,
            aiSettings: session.aiSettings,
            engineMeta: session.currentReportBundle.report?.engineMeta || {},
        });
        session.history.push({
            iteration: session.iteration,
            timestamp: session.updatedAt,
            beforeIssueCount,
            afterIssueCount,
            progress,
            focus,
            analysis: result.analysis,
        });

        if (afterIssueCount < session.bestIssueCount) {
            session.bestIssueCount = afterIssueCount;
            session.bestIteration = session.iteration;
            session.bestScheduleEntries = cloneScheduleEntries(session.currentScheduleEntries);
            session.bestReportBundle = session.currentReportBundle;
        }

        const shouldContinue = session.iteration < session.maxIterations
            && afterIssueCount > 0
            && progress === 'improved';

        return res.json({
            ok: true,
            sessionId: session.id,
            iteration: session.iteration,
            analysis: result.analysis,
            previewSchedule: result.previewSchedule,
            report: result.previewReport?.report || session.currentReportBundle.report,
            reportMarkdown: result.previewReport?.promptMarkdown || session.currentReportBundle.promptMarkdown,
            loopState: buildAiTuningLoopState({
                session,
                beforeIssueCount,
                afterIssueCount,
                progress,
                shouldContinue,
                focus,
            }),
            historyTail: session.history.slice(-3),
            focus,
        });
    } catch (error) {
        console.error('AI 微調 step 失敗:', error);
        const status = error?.status || (error?.code === 'AI_TUNING_SESSION_NOT_FOUND' ? 404 : 502);
        res.status(status).json({
            code: error?.code || 'AI_TUNING_STEP_FAILED',
            error: error?.message || 'AI 微調 step 失敗',
            details: error?.details || error?.message || '',
        });
    }
}

async function handleAiTimetableTuningFinalize(req, res) {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const { sessionId } = req.body || {};
        const session = getAiTuningSessionOrThrow(sessionId);
        const finalSchedule = cloneScheduleEntries(session.bestScheduleEntries || session.currentScheduleEntries || []);
        const finalReportBundle = session.bestReportBundle || session.currentReportBundle;

        aiTuningSessions.delete(session.id);

        return res.json({
            ok: true,
            sessionId: session.id,
            status: 'finalized',
            finalSchedule,
            report: finalReportBundle?.report || null,
            reportMarkdown: finalReportBundle?.promptMarkdown || '',
            history: session.history,
            loopState: {
                sessionId: session.id,
                iteration: session.iteration,
                bestIssueCount: session.bestIssueCount,
                bestIteration: session.bestIteration,
                totalIterations: session.iteration,
                focusStrategy: session.focusStrategy,
            },
        });
    } catch (error) {
        console.error('AI 微調 finalize 失敗:', error);
        const status = error?.status || (error?.code === 'AI_TUNING_SESSION_NOT_FOUND' ? 404 : 502);
        res.status(status).json({
            code: error?.code || 'AI_TUNING_FINALIZE_FAILED',
            error: error?.message || 'AI 微調 finalize 失敗',
            details: error?.details || error?.message || '',
        });
    }
}

async function handleAiTimetableTuningCancel(req, res) {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const { sessionId } = req.body || {};
        const sessionKey = String(sessionId || '').trim();
        if (!sessionKey) {
            return res.status(400).json({ code: 'AI_TUNING_SESSION_ID_MISSING', error: '缺少 sessionId' });
        }
        const existed = aiTuningSessions.delete(sessionKey);
        return res.json({
            ok: true,
            sessionId: sessionKey,
            cancelled: existed,
        });
    } catch (error) {
        console.error('AI 微調 cancel 失敗:', error);
        res.status(500).json({
            code: 'AI_TUNING_CANCEL_FAILED',
            error: error?.message || 'AI 微調 cancel 失敗',
            details: error?.message || '',
        });
    }
}

function buildAiTuningJobStateSnapshot({
    jobRecord,
    result = null,
}) {
    const parsedPayload = getAiTuningJobPayload(jobRecord);
    return {
        jobId: jobRecord.id,
        status: jobRecord.status,
        progressPhase: jobRecord.progressPhase,
        progressMessage: jobRecord.progressMessage,
        startedAt: jobRecord.startedAt,
        finishedAt: jobRecord.finishedAt,
        createdAt: jobRecord.createdAt,
        updatedAt: jobRecord.updatedAt,
        payload: {
            focusStrategy: parsedPayload.focusStrategy || 'resource_first',
            maxIterations: parsedPayload.maxIterations || 3,
            maxMovesPerRound: parsedPayload.maxMovesPerRound || 3,
            maxPromptChars: normalizeAiTuningLimit(parsedPayload.tuningContext?.maxPromptChars, 100000),
        },
        result,
    };
}

async function runAiTuningBackgroundWorker(jobId) {
    const runtime = getAiTuningJobRuntime(jobId);
    if (!runtime) return;

    const jobRecord = await prisma.scheduleJob.findUnique({ where: { id: jobId } });
    if (!jobRecord) {
        clearAiTuningJobRuntime(jobId);
        return;
    }

    const payload = getAiTuningJobPayload(jobRecord);
    const report = payload.report;
    const scheduleEntries = Array.isArray(payload.scheduleEntries) ? payload.scheduleEntries : (Array.isArray(report?.rawSchedule) ? report.rawSchedule : []);
    const scheduleContext = resolveScheduleContext(payload.scheduleContext, {});
    const aiSettings = report?.aiSettings || payload.aiSettings || {};
    const connectionSettings = payload.connectionSettings || {};
    const tuningContext = payload.tuningContext || {};
    const normalizedFocusStrategy = normalizeAiTuningFocusStrategy(payload.focusStrategy);
    const maxIterations = normalizeAiTuningLimit(payload.maxIterations, 3);
    const maxMovesPerRound = normalizeAiTuningLimit(payload.maxMovesPerRound, 3);

    if (!report || !Array.isArray(report.rawSchedule)) {
        await updateAiTuningJobRecord(jobId, {
            status: 'FAILED',
            progressPhase: 'FAILED',
            progressMessage: 'AI 微調任務缺少 report 或 rawSchedule',
            result: JSON.stringify({ ok: false, code: 'AI_REPORT_MISSING', error: '缺少 report 或 rawSchedule' }),
            finishedAt: new Date(),
        });
        clearAiTuningJobRuntime(jobId);
        return;
    }

    if (!scheduleContext || (!Array.isArray(scheduleContext.classes) && !Array.isArray(scheduleContext.teachers) && !Array.isArray(scheduleContext.classrooms))) {
        await updateAiTuningJobRecord(jobId, {
            status: 'FAILED',
            progressPhase: 'FAILED',
            progressMessage: 'AI 微調任務缺少 scheduleContext',
            result: JSON.stringify({ ok: false, code: 'AI_TUNING_CONTEXT_MISSING', error: '缺少 scheduleContext，無法建立背景 job' }),
            finishedAt: new Date(),
        });
        clearAiTuningJobRuntime(jobId);
        return;
    }

    let currentScheduleEntries = cloneScheduleEntries(scheduleEntries);
    let currentReportBundle = buildScheduleReportFromContext({
        scheduleEntries: currentScheduleEntries,
        scheduleContext,
        aiSettings,
        engineMeta: report?.engineMeta || scheduleContext?.engineMeta || {},
    });
    let currentStrategy = normalizedFocusStrategy;
    let fallbackState = null;
    let history = [];
    let steps = [];
    let latestResult = null;
    let bestIssueCount = currentReportBundle.report?.summary?.issueCount ?? Number.MAX_SAFE_INTEGER;
    let bestIteration = 0;
    let bestScheduleEntries = cloneScheduleEntries(currentScheduleEntries);
    let bestReportBundle = currentReportBundle;

    try {
        await updateAiTuningJobRecord(jobId, {
            status: 'PROCESSING',
            progressPhase: 'PROCESSING',
            progressMessage: `AI 微調背景任務已啟動，策略：${currentStrategy === 'resource_first' ? '專科教室優先' : '單班優先'}`,
            startedAt: new Date(),
            result: JSON.stringify({
                ok: true,
                jobId,
                status: 'running',
                loopState: {
                    iteration: 0,
                    focusStrategy: currentStrategy,
                    bestIssueCount,
                    bestIteration,
                    fallbackFromStrategy: null,
                },
            }),
        });

        const strategyOrder = currentStrategy === 'resource_first'
            ? ['resource_first', 'class_first']
            : ['class_first'];

        for (let strategyIndex = 0; strategyIndex < strategyOrder.length; strategyIndex += 1) {
            currentStrategy = strategyOrder[strategyIndex];
            if (strategyIndex > 0) {
                fallbackState = {
                    from: strategyOrder[0],
                    to: currentStrategy,
                    reason: 'resource_first timeout',
                };
                await updateAiTuningJobRecord(jobId, {
                    progressPhase: 'FALLBACKING',
                    progressMessage: '專科教室優先逾時，改以單班優先繼續修復...',
                    result: JSON.stringify({
                        ok: true,
                        jobId,
                        status: 'running',
                        fallbackState,
                        loopState: {
                            iteration: history.length,
                            focusStrategy: currentStrategy,
                            bestIssueCount,
                            bestIteration,
                            fallbackFromStrategy: fallbackState.from,
                        },
                    }),
                });
            }

            for (let roundIndex = 0; roundIndex < maxIterations; roundIndex += 1) {
                if (runtime.cancelRequested) {
                    throw createAiHttpError(499, 'AI_TUNING_CANCELLED', 'AI 微調背景任務已取消');
                }

                const beforeIssueCount = currentReportBundle.report?.summary?.issueCount || 0;
                const focus = selectAiTuningFocus({
                    report: currentReportBundle.report,
                    scheduleContext,
                    focusStrategy: currentStrategy,
                    history,
                });
                const promptBundle = buildAiTuningPromptBundle({
                    report: currentReportBundle.report,
                    focus,
                    tuningContext: {
                        roundIndex: roundIndex + 1,
                        focusStrategy: currentStrategy,
                        maxIterations,
                        maxMovesPerRound,
                        previousIssueCount: beforeIssueCount,
                        bestIssueCount,
                        maxPromptChars: Number.isFinite(Number(tuningContext?.maxPromptChars))
                            ? Number(tuningContext.maxPromptChars)
                            : 100000,
                    },
                    maxPromptChars: Number.isFinite(Number(tuningContext?.maxPromptChars))
                        ? Number(tuningContext.maxPromptChars)
                        : 100000,
                });

                const currentAbortController = new AbortController();
                runtime.currentAbortController = currentAbortController;

                await updateAiTuningJobRecord(jobId, {
                    progressPhase: 'ANALYZING',
                    progressMessage: `第 ${roundIndex + 1} 輪（${currentStrategy === 'resource_first' ? '專科教室優先' : '單班優先'}）分析中...`,
                    result: JSON.stringify({
                        ok: true,
                        jobId,
                        status: 'running',
                        fallbackState,
                        loopState: {
                            iteration: history.length,
                            focusStrategy: currentStrategy,
                            beforeIssueCount,
                            bestIssueCount,
                            bestIteration,
                            focus,
                            fallbackFromStrategy: fallbackState?.from || null,
                        },
                    }),
                });

                let stepResult;
                try {
                    stepResult = await executeAiTimetableAnalysis({
                        report: currentReportBundle.report,
                        reportMarkdown: currentReportBundle.promptMarkdown,
                        scheduleEntries: currentScheduleEntries,
                        scheduleContext,
                        aiSettings,
                        connectionSettings,
                        tuningContext: {
                            sessionId: jobId,
                            iteration: roundIndex + 1,
                            maxIterations,
                            maxMovesPerRound,
                            focusStrategy: currentStrategy,
                            focus,
                            beforeIssueCount,
                            bestIssueCount,
                            recentHistory: history.slice(-3),
                            promptReport: promptBundle.promptReport,
                            promptMarkdown: promptBundle.promptMarkdown,
                            promptScope: promptBundle.promptScope,
                        },
                        abortSignal: currentAbortController.signal,
                    });
                } catch (error) {
                    runtime.currentAbortController = null;
                    if (currentStrategy === 'resource_first' && (isAiTuningTimeoutLikeError(error) || isAiTuningPromptTooLargeError(error))) {
                        fallbackState = {
                            from: 'resource_first',
                            to: 'class_first',
                            reason: error?.message || 'resource_first prompt too large',
                        };
                        break;
                    }
                    throw error;
                } finally {
                    runtime.currentAbortController = null;
                }

                steps.push(stepResult);
                latestResult = stepResult;

                const afterIssueCount = stepResult.previewReport?.report?.summary?.issueCount
                    ?? stepResult.analysis?.issues?.length
                    ?? beforeIssueCount;
                const progress = afterIssueCount < beforeIssueCount
                    ? 'improved'
                    : afterIssueCount === beforeIssueCount
                        ? 'stagnated'
                        : 'worse';

                history.push({
                    iteration: history.length + 1,
                    timestamp: new Date().toISOString(),
                    beforeIssueCount,
                    afterIssueCount,
                    progress,
                    focus,
                    analysis: stepResult.analysis,
                    strategy: currentStrategy,
                });

                currentScheduleEntries = cloneScheduleEntries(stepResult.previewSchedule);
                currentReportBundle = stepResult.previewReport || buildScheduleReportFromContext({
                    scheduleEntries: currentScheduleEntries,
                    scheduleContext,
                    aiSettings,
                    engineMeta: currentReportBundle.report?.engineMeta || {},
                });

                if (afterIssueCount < bestIssueCount) {
                    bestIssueCount = afterIssueCount;
                    bestIteration = history.length;
                    bestScheduleEntries = cloneScheduleEntries(currentScheduleEntries);
                    bestReportBundle = currentReportBundle;
                }

                await updateAiTuningJobRecord(jobId, {
                    progressPhase: 'PROCESSING',
                    progressMessage: `第 ${history.length} 輪完成：${progress === 'improved' ? '有改善' : progress === 'stagnated' ? '持平' : '變差'}，剩餘 ${Math.max(0, maxIterations - history.length)} 輪`,
                    result: JSON.stringify({
                        ok: true,
                        jobId,
                        status: 'running',
                        analysis: stepResult.analysis,
                        previewSchedule: stepResult.previewSchedule,
                        report: stepResult.previewReport?.report || currentReportBundle.report,
                        reportMarkdown: stepResult.previewReport?.promptMarkdown || currentReportBundle.promptMarkdown,
                        history,
                        steps,
                        fallbackState,
                        loopState: {
                            sessionId: jobId,
                            iteration: history.length,
                            beforeIssueCount,
                            afterIssueCount,
                            progress,
                            shouldContinue: history.length < maxIterations && afterIssueCount > 0 && progress === 'improved',
                            focusStrategy: currentStrategy,
                            remainingIterations: Math.max(0, maxIterations - history.length),
                            bestIssueCount,
                            bestIteration,
                            focus,
                            fallbackFromStrategy: fallbackState?.from || null,
                        },
                    }),
                });

                if (afterIssueCount <= 0 || progress !== 'improved') {
                    break;
                }
            }

            if (fallbackState && currentStrategy === 'resource_first') {
                continue;
            }
            break;
        }

        const finalSchedule = cloneScheduleEntries(bestScheduleEntries || currentScheduleEntries || []);
        const finalReportBundle = bestReportBundle || currentReportBundle;
        const finalResult = {
            ok: true,
            jobId,
            status: 'completed',
            finalSchedule,
            analysis: latestResult?.analysis || null,
            report: finalReportBundle?.report || null,
            reportMarkdown: finalReportBundle?.promptMarkdown || '',
            history,
            steps,
            fallbackState,
            loopState: {
                sessionId: jobId,
                iteration: history.length,
                bestIssueCount,
                bestIteration,
                totalIterations: history.length,
                focusStrategy: currentStrategy,
                fallbackFromStrategy: fallbackState?.from || null,
            },
        };

        await updateAiTuningJobRecord(jobId, {
            status: 'COMPLETED',
            result: JSON.stringify(finalResult),
            progressPhase: 'COMPLETED',
            progressMessage: fallbackState
                ? `AI 微調完成，已從 ${fallbackState.from === 'resource_first' ? '專科教室優先' : fallbackState.from} 逾時後切換策略完成。`
                : 'AI 微調完成！',
            finishedAt: new Date(),
        });
    } catch (error) {
        const isCancelled = runtime.cancelRequested || error?.code === 'AI_TUNING_CANCELLED';
        const status = isCancelled ? 'CANCELLED' : 'FAILED';
        const progressPhase = isCancelled ? 'CANCELLED' : 'FAILED';
        const progressMessage = isCancelled
            ? 'AI 微調已取消'
            : `AI 微調失敗：${error?.message || '未知錯誤'}`;
        const resultPayload = {
            ok: false,
            jobId,
            code: error?.code || (isCancelled ? 'AI_TUNING_CANCELLED' : 'AI_TUNING_FAILED'),
            error: error?.message || progressMessage,
            details: error?.details || error?.message || '',
            fallbackState,
            history,
        };

        await updateAiTuningJobRecord(jobId, {
            status,
            result: JSON.stringify(resultPayload),
            progressPhase,
            progressMessage,
            finishedAt: new Date(),
        }).catch(() => {});
    } finally {
        clearAiTuningJobRuntime(jobId);
    }
}

app.post('/api/ai-generate', handleAiTimetableAnalysis);
app.post('/api/ai-timetable-analysis', handleAiTimetableAnalysis);
app.post('/api/ai-timetable-tuning/start', handleAiTimetableTuningStart);
app.post('/api/ai-timetable-tuning/step', handleAiTimetableTuningStep);
app.post('/api/ai-timetable-tuning/finalize', handleAiTimetableTuningFinalize);
app.post('/api/ai-timetable-tuning/cancel', handleAiTimetableTuningCancel);
app.post('/api/ai-timetable-tuning/jobs', async (req, res) => {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const {
            report,
            scheduleEntries,
            scheduleContext,
            aiSettings: clientAiSettings,
            connectionSettings: clientConnectionSettings,
            focusStrategy,
            maxIterations,
            maxMovesPerRound,
            tuningContext = {},
        } = req.body || {};

        if (!report || !Array.isArray(report.rawSchedule)) {
            return res.status(400).json({ code: 'AI_REPORT_MISSING', error: '缺少 report 或 rawSchedule' });
        }
        if (!scheduleContext || (!Array.isArray(scheduleContext.classes) && !Array.isArray(scheduleContext.teachers) && !Array.isArray(scheduleContext.classrooms))) {
            return res.status(400).json({ code: 'AI_TUNING_CONTEXT_MISSING', error: '缺少 scheduleContext，無法建立背景 job' });
        }

        const job = await prisma.scheduleJob.create({
            data: {
                payload: JSON.stringify({
                    type: 'ai_tuning',
                    report,
                    scheduleEntries,
                    scheduleContext,
                    aiSettings: clientAiSettings || report?.aiSettings || {},
                    connectionSettings: clientConnectionSettings || {},
                    focusStrategy,
                    maxIterations,
                    maxMovesPerRound,
                    tuningContext,
                }),
                status: 'PENDING',
                progressPhase: 'QUEUED',
                progressMessage: 'AI 微調任務已排入背景佇列',
            },
        });

        getAiTuningJobRuntime(job.id);
        setImmediate(() => {
            runAiTuningBackgroundWorker(job.id).catch((error) => {
                console.error(`[AI Tuning Job ${job.id}] 背景 worker 失敗:`, error);
            });
        });

        return res.status(202).json({
            ok: true,
            jobId: job.id,
            status: job.status,
            progressPhase: job.progressPhase,
            progressMessage: job.progressMessage,
        });
    } catch (error) {
        console.error('AI 微調背景 job 建立失敗:', error);
        return res.status(500).json({
            code: 'AI_TUNING_JOB_START_FAILED',
            error: error?.message || '建立 AI 微調背景 job 失敗',
        });
    }
});

app.get('/api/ai-timetable-tuning/jobs', async (req, res) => {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const limit = normalizeAiTuningLimit(req.query?.limit, 12);
        const jobs = await prisma.scheduleJob.findMany({
            orderBy: [{ createdAt: 'desc' }],
            take: limit,
        });

        return res.json({
            ok: true,
            limit,
            jobs: jobs.map((job) => buildAiTuningJobHistoryItem(job)),
        });
    } catch (error) {
        console.error('讀取 AI 微調背景 job 歷史失敗:', error);
        return res.status(500).json({
            code: 'AI_TUNING_JOB_HISTORY_FAILED',
            error: error?.message || '讀取 AI 微調背景 job 歷史失敗',
        });
    }
});

app.get('/api/ai-timetable-tuning/jobs/:jobId', async (req, res) => {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const { jobId } = req.params;
        const job = await prisma.scheduleJob.findUnique({ where: { id: jobId } });
        if (!job) {
            return res.status(404).json({ code: 'AI_TUNING_JOB_NOT_FOUND', error: '找不到 AI 微調背景 job' });
        }

        return res.json({
            ok: true,
            ...buildAiTuningJobStateSnapshot({
                jobRecord: job,
                result: getAiTuningJobResult(job),
            }),
        });
    } catch (error) {
        console.error('讀取 AI 微調背景 job 失敗:', error);
        return res.status(500).json({
            code: 'AI_TUNING_JOB_STATUS_FAILED',
            error: error?.message || '讀取 AI 微調背景 job 失敗',
        });
    }
});

app.post('/api/ai-timetable-tuning/jobs/:jobId/cancel', async (req, res) => {
    req.setTimeout(AI_TUNING_TIMEOUT_MS);
    res.setTimeout(AI_TUNING_TIMEOUT_MS);

    try {
        const { jobId } = req.params;
        const job = await prisma.scheduleJob.findUnique({ where: { id: jobId } });
        if (!job) {
            return res.status(404).json({ code: 'AI_TUNING_JOB_NOT_FOUND', error: '找不到 AI 微調背景 job' });
        }

        requestAiTuningJobCancel(jobId);
        await updateAiTuningJobRecord(jobId, {
            status: 'CANCELLED',
            progressPhase: 'CANCELLED',
            progressMessage: 'AI 微調任務取消中...',
            finishedAt: new Date(),
            result: JSON.stringify({
                ok: false,
                jobId,
                code: 'AI_TUNING_CANCELLED',
                error: 'AI 微調背景 job 已取消',
            }),
        });

        return res.json({
            ok: true,
            jobId,
            cancelled: true,
        });
    } catch (error) {
        console.error('取消 AI 微調背景 job 失敗:', error);
        return res.status(500).json({
            code: 'AI_TUNING_JOB_CANCEL_FAILED',
            error: error?.message || '取消 AI 微調背景 job 失敗',
        });
    }
});
app.get('/api/debug-infeasible-report', async (req, res) => {
    try {
        const reportPath = path.join(__dirname, 'debug_infeasible_report.txt');
        if (fs.existsSync(reportPath)) {
            const content = fs.readFileSync(reportPath, 'utf-8');
            res.json({ success: true, content });
        } else {
            res.json({ success: false, content: '暫無調試報告' });
        }
    } catch (error) {
        res.status(500).json({ error: '讀取調試報告失敗', details: error.message });
    }
});

// ==========================================
// 模組四：OR-Tools 引擎橋接 (新架構)
// ==========================================


/**
 * 執行診斷統計：呼叫 diagnostic_stats.py 計算命中率與容量超載
 * @param {string} inputPath - payload JSON 路徑
 * @param {string} resultPath - schedule result JSON 路徑
 * @returns {object|null} 統計結果物件
 */
async function runDiagnosticStats(inputPath, resultPath) {
    return new Promise((resolve, _reject) => {
        const diag = spawnPython('diagnostic_stats.py', [inputPath, resultPath], 'Diagnostic Stats');
        let output = '';
        diag.stdout.on('data', (d) => output += d);
        diag.stderr.on('data', (d) => console.error(`[Diagnostic Error]: ${d}`));
        diag.on('close', (code) => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(output));
                } catch (e) {
                    console.error('診斷統計 JSON 解析失敗:', e);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * 根據 pre/post 診斷數據生成調整建議
 */
function generateRecommendation(pre, post) {
    const tips = [];
    if ((post.primaryTeacherHitRate || 0) < 0.7)
        tips.push('primaryTeacher 命中率偏低 (<70%)，建議提升 PRIMARY_TEACHER_MISS_PENALTY');
    else if ((post.primaryTeacherHitRate || 0) < 0.85)
        tips.push('primaryTeacher 命中率中等 (70-85%)，可觀察');
    else
        tips.push('primaryTeacher 命中率良好 (>=85%)');

    if ((post.gradePreferenceHitRate || 0) < 0.7)
        tips.push('gradePreferences 命中率偏低 (<70%)，建議提升 GRADE_AFFINITY_MISS_PENALTY');
    else if ((post.gradePreferenceHitRate || 0) < 0.85)
        tips.push('gradePreferences 命中率中等 (70-85%)');
    else
        tips.push('gradePreferences 命中率良好 (>=85%)');

    if ((post.capacityOverloadCount || 0) > (pre.capacityOverloadCount || 0))
        tips.push('[WARN] Repair 後容量超載惡化，請檢查 Repair Agent');
    else if ((post.capacityOverloadCount || 0) === 0)
        tips.push('容量超載已完全消除');
    else
        tips.push(`仍有 ${post.capacityOverloadCount} 次容量超載`);

    return tips.join(' | ');
}

async function runSchedulingWorker(jobId, payload) {
    try {
        await prisma.scheduleJob.update({
            where: { id: jobId },
            data: {
              status: 'PROCESSING',
              progressPhase: 'PROCESSING',
              progressMessage: '準備輸入資料...',
              startedAt: new Date()
            }
        });

        const inputPath = path.join(__dirname, `input_${jobId}.json`);
        const outputPath = path.join(__dirname, `output_${jobId}.json`);
        fs.writeFileSync(inputPath, JSON.stringify(payload, null, 2));

        // 寫入完成，進入求解階段
        await prisma.scheduleJob.update({
            where: { id: jobId },
            data: {
              progressPhase: 'SOLVING',
              progressMessage: 'Python OR-Tools 引擎求解中...'
            }
        });

        const pythonProcess = spawnPython('solver.py', [inputPath, outputPath], 'Solver');
        pythonProcess.stdout.on('data', (data) => console.log(`[Python 輸出]: ${data}`));
        pythonProcess.stderr.on('data', (data) => console.error(`[Python 錯誤]: ${data}`));

        pythonProcess.on('close', async (code) => {
            try {
                // 進入最終化階段
                await prisma.scheduleJob.update({
                    where: { id: jobId },
                    data: {
                      progressPhase: 'FINALIZING',
                      progressMessage: '讀取排課結果...'
                    }
                });

                if (code === 0 && fs.existsSync(outputPath)) {
                    // [Diagnostic] Step 1: 對 solver 原始結果做診斷統計 (pre-repair)
                    let preRepairStats = null;
                    try {
                        preRepairStats = await runDiagnosticStats(inputPath, outputPath);
                        console.log(`[Diagnostic] preRepair stats:`, JSON.stringify(preRepairStats));
                    } catch (e) {
                        console.error(`[Diagnostic] preRepair 統計失敗:`, e);
                    }

                    // [Repair Agent] 在 solver 成功后，自動啟動模擬退火後處理優化
                    await prisma.scheduleJob.update({
                        where: { id: jobId },
                        data: {
                          progressPhase: 'REPAIRING',
                          progressMessage: '模擬退火優化中... (Repair Agent)'
                        }
                    });

                    const repairOutputPath = path.join(__dirname, `output_repaired_${jobId}.json`);
                    const repairResult = new Promise((resolve, _reject) => {
                        const repair = spawnPython('repair_agent.py', [inputPath, outputPath, repairOutputPath], 'Repair Agent');
                        let repairLog = '';
                        repair.stdout.on('data', (d) => {
                            const msg = d;
                            console.log(`[Repair Agent]: ${msg}`);
                            repairLog += msg;
                        });
                        repair.stderr.on('data', (d) => console.error(`[Repair Error]: ${d}`));
                        repair.on('close', (rc) => {
                            if (rc === 0 && fs.existsSync(repairOutputPath)) {
                                resolve('repaired');
                            } else {
                                resolve('original');
                            }
                        });
                    });

                    const repairStatus = await repairResult;

                    let postRepairStats = null;
                    let resultData;
                    if (repairStatus === 'repaired') {
                        resultData = fs.readFileSync(repairOutputPath, 'utf-8');
                        console.log(`[OK] [Repair Agent] 優化成功，使用修復後結果`);
                        try {
                            postRepairStats = await runDiagnosticStats(inputPath, repairOutputPath);
                            console.log(`[Diagnostic] postRepair stats:`, JSON.stringify(postRepairStats));
                        } catch (e) {
                            console.error(`[Diagnostic] postRepair 統計失敗:`, e);
                        }
                        if (fs.existsSync(repairOutputPath)) fs.unlinkSync(repairOutputPath);
                    } else {
                        resultData = fs.readFileSync(outputPath, 'utf-8');
                        console.log(`[WARN] [Repair Agent] 優化失敗或跳過，使用原始結果`);
                        postRepairStats = preRepairStats;
                    }

                    // [Diagnostic] Step 3: 組合報表並儲存
                    try {
                        if (preRepairStats && postRepairStats) {
                            const round2 = (v) => Math.round(v * 100) / 100;
                            const delta = {
                                primaryTeacherHitRateDiff: round2(postRepairStats.primaryTeacherHitRate - preRepairStats.primaryTeacherHitRate),
                                gradePreferenceHitRateDiff: round2(postRepairStats.gradePreferenceHitRate - preRepairStats.gradePreferenceHitRate),
                                capacityOverloadDiff: postRepairStats.capacityOverloadCount - preRepairStats.capacityOverloadCount,
                            };
                            const recommendation = generateRecommendation(preRepairStats, postRepairStats);
                            const diagnosticReport = {
                                jobId,
                                status: 'COMPLETED',
                                preRepair: preRepairStats,
                                postRepair: postRepairStats,
                                delta,
                                recommendation,
                            };
                            const diagFileName = `debug_schedule_diagnostic_${jobId}.json`;
                            const diagFilePath = path.join(__dirname, diagFileName);
                            fs.writeFileSync(diagFilePath, JSON.stringify(diagnosticReport, null, 2), 'utf-8');
                            console.log(`[Diagnostic] 報表已儲存至 ${diagFilePath}`);
                        }
                    } catch (diagErr) {
                        console.error(`[Diagnostic] 報表儲存失敗:`, diagErr);
                    }

                    await prisma.scheduleJob.update({
                        where: { id: jobId },
                        data: {
                          status: 'COMPLETED',
                          result: resultData,
                          progressPhase: 'COMPLETED',
                          progressMessage: '排課完成！',
                          finishedAt: new Date()
                        }
                    });
                    fs.unlinkSync(outputPath);
                } else {
                    const errorMsg = code === null ? 'Python 進程被強制終止' : `Exit code ${code}`;

                    // AI 診斷分析：讀取 debug_infeasible_report.txt 並萃取建議
                    let aiAnalysis = [];
                    try {
                        const systemSetting = await prisma.systemSetting.findUnique({ where: { id: 1 } });
                        const aiSysSettings = systemSetting && systemSetting.aiSystemSettings
                            ? JSON.parse(systemSetting.aiSystemSettings)
                            : { enabled: false };

                        if (aiSysSettings.enabled) {
                            const reportPath = path.join(__dirname, 'debug_infeasible_report.txt');
                            if (fs.existsSync(reportPath)) {
                                const reportContent = fs.readFileSync(reportPath, 'utf-8');
                                const lines = reportContent.split('\n');

                                // 聚合統計
                                const capacityErrors = [];       // 教室容量不足
                                const periodGradeCount = {};     // 按年級統計時段不足班級數
                                // const periodTotalCount = 0;      // 時段不足總班數
                                let periodTotalCountNum = 0;
                                const alternatingWarnings = [];  // 交替課警告
                                const swimmingWarnings = [];     // 游泳資源警告


                                for (const line of lines) {
                                    if (line.includes('❌')) {
                                        // 教室容量不足
                                        const capacityMatch = line.match(/(.+?):\s*容量.*總需求\s*(\d+).*/);
                                        if (capacityMatch) {
                                            capacityErrors.push({
                                                subject: capacityMatch[1].trim(),
                                                needed: capacityMatch[2]
                                            });
                                            continue;
                                        }
                                        // 有效時段不足（按年級聚合）
                                        const periodMatch = line.match(/(\d+)年.+?:\s*科任需求\s*(\d+).*有效時段\s*(\d+)/);
                                        if (periodMatch) {
                                            const grade = periodMatch[1];
                                            const needed = parseInt(periodMatch[2]);
                                            const available = parseInt(periodMatch[3]);
                                            periodTotalCountNum++;
                                            if (!periodGradeCount[grade]) {
                                                periodGradeCount[grade] = { count: 0, needed, available, shortage: needed - available };
                                            }
                                            periodGradeCount[grade].count++;
                                            continue;
                                        }
                                    } else if (line.includes('⚠️')) {
                                        const warnMatch = line.match(/⚠️\s*(.+)/);
                                        if (warnMatch) {
                                            const msg = warnMatch[1];
                                            // 交替課警告：提取教師名稱（從前一行獲取）
                                            if (msg.includes('交替班級')) {
                                                // 從上一行提取教師名稱
                                                const lineIdx = lines.indexOf(line);
                                                if (lineIdx > 0) {
                                                    const prevLine = lines[lineIdx - 1];
                                                    const teacherMatch = prevLine.match(/-\s*(.+?):\s*負責/);
                                                    const teacher = teacherMatch ? teacherMatch[1] : '某教師';
                                                    alternatingWarnings.push({ teacher, message: msg });
                                                }
                                            } else if (msg.includes('游泳')) {
                                                swimmingWarnings.push(msg);
                                            }
                                        }
                                    }
                                }

                                // 匯總輸出
                                if (capacityErrors.length > 0) {
                                    capacityErrors.forEach(err => {
                                        aiAnalysis.push(`[INFO] 【教室容量不足】${err.subject} 總需求 ${err.needed} 節超過現有教室容量，請考慮新增教室或減少課程需求。`);
                                    });
                                }

                                if (periodTotalCountNum > 0) {
                                    const gradeDetails = Object.entries(periodGradeCount)
                                        .map(([grade, data]) => `${grade}年級${data.count}班（需求${data.needed}節/可用${data.available}節，差${data.shortage}節）`)
                                        .join('、');
                                    aiAnalysis.push(`[WARN] 【有效時段不足】共 ${periodTotalCountNum} 個班級的科任需求超過有效時段：${gradeDetails}。請檢查排課時段設定或減少科任節數。`);
                                }

                                alternatingWarnings.forEach(w => {
                                    aiAnalysis.push(`[WARN] 【交替課衝突】${w.teacher}：${w.message}`);
                                });

                                swimmingWarnings.forEach(w => {
                                    aiAnalysis.push(`[WARN] 【游泳資源】${w}`);
                                });

                                // 若未萃取出任何錯誤，給一個通用提示
                                if (aiAnalysis.length === 0) {
                                    aiAnalysis.push('[WARN] 排課引擎無法找到可行解，建議檢查班級課程需求、教師配額、教室容量是否平衡。');
                                }
                            }
                        }
                    } catch (parseError) {
                        console.error('AI 診斷解析失敗:', parseError);
                    }

                    await prisma.scheduleJob.update({
                        where: { id: jobId },
                        data: {
                          status: 'FAILED',
                          result: JSON.stringify({ error: errorMsg, aiAnalysis }),
                          progressPhase: 'FAILED',
                          progressMessage: `排課失敗：${errorMsg}`,
                          finishedAt: new Date()
                        }
                    });
                }
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            } catch (error) {
                console.error("排課任務處理失敗:", error);
                await prisma.scheduleJob.update({
                    where: { id: jobId },
                    data: {
                      status: 'FAILED',
                      progressPhase: 'FAILED',
                      progressMessage: `後端處理錯誤：${error.message}`,
                      finishedAt: new Date()
                    }
                }).catch(() => {});
            }
        });

    } catch (error) {
        console.error(`[Worker Error Job ${jobId}]:`, error);
        await prisma.scheduleJob.update({
            where: { id: jobId },
            data: {
                status: 'FAILED',
                result: JSON.stringify({ error: error.message }),
                progressPhase: 'FAILED',
                progressMessage: `排課失敗：${error.message}`,
                finishedAt: new Date()
            }
        });
    }
}

// [Phase_ExtendTimeout Phase 4] 提交排課任務
// [Blueprint_Extend_Timeout] 延長 req.setTimeout 至 1800000ms (30 分鐘)
app.post('/api/schedule', async (req, res) => {
    req.setTimeout(1800000); // 30 分鐘超時
    try {
        const payload = req.body;
        const job = await prisma.scheduleJob.create({
            data: { payload: JSON.stringify(payload) }
        });

        runSchedulingWorker(job.id, payload);

        res.status(202).json({ message: "排課任務已進入排程", jobId: job.id });
    } catch (error) {
        console.error("[ERROR] 排課 API 發生錯誤：", error);
 	res.status(500).json({ error: error.message });
    }
});

// [Phase_ExtendTimeout Phase 4] 查詢任務進度
// [Blueprint_Extend_Timeout] 延長 req.setTimeout 至 1800000ms (30 分鐘)
app.get('/api/schedule/:jobId', async (req, res) => {
    req.setTimeout(1800000); // 30 分鐘超時
    try {
        const { jobId } = req.params;
        const job = await prisma.scheduleJob.findUnique({ where: { id: jobId } });

        if (!job) return res.status(404).json({ error: "找不到該任務" });

        let parsedResult = null;
        if (job.result) parsedResult = JSON.parse(job.result);

        res.json({
            jobId: job.id,
            status: job.status,
            result: parsedResult,
            progressPhase: job.progressPhase,
            progressMessage: job.progressMessage,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// eslint-disable-next-line no-undef
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`[INFO] 智慧排課引擎 (API + OR-Tools) 已啟動於 http://localhost:${PORT}`);
});
// [Blueprint_Extend_Timeout] 設定 Server 層級超時為 1800000ms (30 分鐘)，防止 HTTP 連線中斷
server.setTimeout(1800000);

