import json
import subprocess
import tempfile
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def run_solver(payload):
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json', encoding='utf-8') as f_in:
        json.dump(payload, f_in)
        in_path = f_in.name
    out_path = in_path + ".out.json"

    python_bin = sys.executable
    venv_python = os.path.join(os.path.dirname(os.path.dirname(__file__)), "venv", "Scripts", "python.exe")
    if os.path.exists(venv_python):
        python_bin = venv_python

    try:
        cmd = [python_bin, "solver.py", in_path, out_path]
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True, encoding='utf-8')
        if proc.returncode != 0:
            print("Solver Stdout:", proc.stdout)
            print("Solver Stderr:", proc.stderr)
            raise RuntimeError(f"solver.py failed with returncode {proc.returncode}")

        with open(out_path, 'r', encoding='utf-8') as f_out:
            res = json.load(f_out)
            res["_stdout"] = proc.stdout
            return res
    finally:
        if os.path.exists(in_path):
            os.remove(in_path)
        if os.path.exists(out_path):
            os.remove(out_path)

def create_base_payload(enable_learning_center_move=True):
    cell_protected = {
        "subject": "語文-本土語",
        "teacher": "張老師",
        "isLocked": True,
        "protectedByPullout": True
    }

    return {
        "classes": [
            {
                "name": "3年1班",
                "grade": 3,
                "course_requirements": [
                    {"subject": "語文-國語", "periods": 5, "teacher_name": "李導師"},
                    {"subject": "學習中心-資源", "periods": 1, "teacher_name": "特教老師"}
                ],
                "timetable": [
                    [None, None, None, None, None, None, None]
                ]
            },
            {
                "name": "3年3班",
                "grade": 3,
                "course_requirements": [
                    {"subject": "語文-本土語", "periods": 1, "teacher_name": "張老師"},
                    {"subject": "學習中心-資源", "periods": 1, "teacher_name": "特教老師"}
                ],
                "timetable": [
                    [None, cell_protected, None, None, None, None, None]  # Day 1 Period 2 (index 1)
                ]
            }
        ],
        "teachers": [
            {"name": "張老師", "max_periods": 20},
            {"name": "李導師", "max_periods": 20},
            {"name": "特教老師", "max_periods": 20}
        ],
        "classrooms": [],
        "schoolInfo": {},
        "specialCourses": [
            {
                "id": "sc_learning_center_1",
                "name": "學習中心",
                "targetSubject": "學習中心-資源",
                "teacher": "特教老師",
                "targetClasses": ["3年1班", "3年3班"],
                "isAutoTime": False,
                "lockedSlots": [{"day": 1, "period": 2}]  # 原始與 3年3班 本土語課 撞期在 Day 1 Period 2
            }
        ],
        "aiSettings": {"artsClassEnabled": False},
        "engineMeta": {},
        "movableLocksEnabled": enable_learning_center_move,
        "movableLocksPolicy": {
            "movableLocksEnabled": enable_learning_center_move,
            "movableSpecialCourseTypes": ["學習中心"] if enable_learning_center_move else [],
            "moveWindow": {
                "scope": "same_day",
                "allowCrossMorningAfternoon": True,
                "maxPeriodDistance": 6
            },
            "maxMovesTotal": 5,
            "maxMovesPerClass": 2,
            "maxMovesPerSubject": 5
        }
    }

def test_learning_center_sync_move_with_protected_native_language():
    payload = create_base_payload(enable_learning_center_move=True)
    result = run_solver(payload)
    assert result.get("solverStatus") in ("OPTIMAL", "FEASIBLE"), f"Expected OPTIMAL/FEASIBLE but got {result.get('solverStatus')}"

    # 驗證 3年3班 在 Day 1 Period 2 的保護本土語課依然留在原時段
    sched = result.get("schedule", [])
    native_entry = next((e for e in sched if e.get("className") == "3年3班" and e.get("subject") == "語文-本土語"), None)
    assert native_entry is not None, "3年3班 語文-本土語 課程不存在"
    assert native_entry.get("day") == 1 and native_entry.get("period") == 2, "保護的本土語課被誤移了"

    # 驗證 movedLockedLessons 記錄了學習中心移動
    moved = result.get("movedLockedLessons", [])
    assert len(moved) > 0, "沒有 movedLockedLessons 移動記錄"
    sc_move = next((m for m in moved if m.get("specialCourseType") == "學習中心"), None)
    assert sc_move is not None, "未找到學習中心的移動記錄"
    assert sc_move["originalPeriod"] == {"day": 1, "period": 2}
    assert sc_move["newPeriod"]["day"] == 1
    assert sc_move["newPeriod"]["period"] != 2

def test_learning_center_move_disabled_returns_infeasible():
    payload = create_base_payload(enable_learning_center_move=False)
    result = run_solver(payload)
    assert result.get("solverStatus") == "INFEASIBLE", f"Expected INFEASIBLE when learning center move disabled but got {result.get('solverStatus')}"

def test_normal_classes_without_special_courses_maintain_teacher_conflict():
    payload = {
        "classes": [
            {
                "name": "3年1班",
                "grade": 3,
                "course_requirements": [{"subject": "數學", "periods": 1, "teacher_name": "陳老師"}],
                "timetable": [[{"subject": "數學", "teacher": "陳老師", "isLocked": True}]]
            },
            {
                "name": "3年2班",
                "grade": 3,
                "course_requirements": [{"subject": "數學", "periods": 1, "teacher_name": "陳老師"}],
                "timetable": [[{"subject": "數學", "teacher": "陳老師", "isLocked": True}]]
            }
        ],
        "teachers": [{"name": "陳老師", "max_periods": 20}],
        "classrooms": [],
        "schoolInfo": {},
        "specialCourses": [],  # 沒有明確 specialCourses 定義
        "aiSettings": {},
        "engineMeta": {}
    }
    result = run_solver(payload)
    # 沒有明確 specialCourses 的普通班級，衝堂必須被檢測出 conflict 或 INFEASIBLE
    val_report = result.get("validationReport") or {}
    teacher_conflicts = val_report.get("teacher_conflicts", [])
    assert len(teacher_conflicts) > 0 or result.get("solverStatus") == "INFEASIBLE", "無 specialCourses 定義的普通班級未觸發教師衝堂"

if __name__ == "__main__":
    test_learning_center_sync_move_with_protected_native_language()
    test_learning_center_move_disabled_returns_infeasible()
    test_normal_classes_without_special_courses_maintain_teacher_conflict()
    print("ALL LEARNING CENTER PULLOUT SYNC TESTS PASSED!")
