import pytest
import json
import subprocess
import tempfile
import os
import sys

def run_solver(payload):
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json', encoding='utf-8') as f_in:
        json.dump(payload, f_in)
        in_path = f_in.name
    out_path = in_path + ".out.json"

    try:
        # We need to run solver.py
        cmd = [sys.executable, "solver.py", in_path, out_path]
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding='utf-8')

        with open(out_path, 'r', encoding='utf-8') as f_out:
            res = json.load(f_out)
            res["_stdout"] = proc.stdout
            if res.get("solverStatus") != "INFEASIBLE" and res.get("solverStatus") != "OPTIMAL":
                print(f"Solver Status: {res.get('solverStatus')}")
            return res
    finally:
        if os.path.exists(in_path):
            os.remove(in_path)
        if os.path.exists(out_path):
            os.remove(out_path)

def create_base_payload():
    return {
        "classes": [
            {
                "name": "3年1班",
                "course_requirements": [
                    {"subject": "語文-英語", "periods": 1, "teacher_name": "英師A"}
                ],
                "timetable": [
                    # Day 0
                    [
                        {"subject": "", "isLocked": False}, # Period 0
                        {"subject": "語文-英語", "teacher": "英師A", "isLocked": True}, # Period 1
                    ]
                ]
            }
        ],
        "teachers": [{"name": "英師A", "max_periods": 20}],
        "classrooms": [],
        "schoolInfo": {},
        "specialCourses": [],
        "aiSettings": {"artsClassEnabled": False},
        "engineMeta": {},
        "movableLocksEnabled": False,
        "movableLocksPolicy": {
            "movableLocksEnabled": False,
            "movableSubjects": ["語文-英語"],
            "moveWindow": {
                "scope": "same_day",
                "allowCrossMorningAfternoon": False,
                "maxPeriodDistance": 2
            },
            "maxMovesTotal": 3,
            "maxMovesPerClass": 1,
            "maxMovesPerSubject": 2
        }
    }

def test_movable_lock_disabled():
    payload = create_base_payload()
    # Add pressure: teacher unavailable at the locked period
    payload["teachers"][0]["unavailable_slots"] = [{"day": 1, "period": 2}]

    result = run_solver(payload)
    print("test_movable_lock_disabled status:", result.get("solverStatus"))
    # Since movable locks are disabled, the lock is hard and the teacher is unavailable -> INFEASIBLE
    assert result.get("solverStatus") == "INFEASIBLE"

def test_whitelist_gating():
    payload = create_base_payload()
    payload["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableLocksEnabled"] = True
    # Subject not in whitelist
    payload["movableLocksPolicy"]["movableSubjects"] = ["數學"]
    payload["teachers"][0]["unavailable_slots"] = [{"day": 1, "period": 2}]

    result = run_solver(payload)
    assert result.get("solverStatus") == "INFEASIBLE"

def test_no_pressure_no_move():
    payload = create_base_payload()
    payload["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableLocksEnabled"] = True
    # No pressure (teacher is available at period 1)

    result = run_solver(payload)
    assert result.get("solverStatus") == "OPTIMAL"
    # Should not move
    moves = result.get("movedLockedLessons", [])
    assert len(moves) == 0

def test_moved_requires_user_review():
    payload = create_base_payload()
    payload["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableLocksEnabled"] = True
    # Add pressure
    payload["teachers"][0]["unavailable_slots"] = [{"day": 1, "period": 2}]

    result = run_solver(payload)
    print("test_moved_requires_user_review result:", json.dumps(result.get("movableLockSummary", {})))
    print("test_moved_requires_user_review moved:", result.get("movedLockedLessons", []))
    assert result.get("solverStatus") == "OPTIMAL"

    summary = result.get("movableLockSummary", {})
    assert summary.get("totalMoved", 0) > 0
    assert result.get("requiresUserReview") is True

    moves = result.get("movedLockedLessons", [])
    assert len(moves) == 1
    move = moves[0]
    assert move["subject"] == "語文-英語"
    assert move["originalPeriod"]["day"] == 1 and move["originalPeriod"]["period"] == 2
    # period should be within distance 2, e.g., period 0, 2, or 3

def test_multi_class_movable_special_course_sync_move():
    payload = create_base_payload()
    payload["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableSpecialCourseTypes"] = ["學習中心"]

    # 3年1班, 3年2班, 3年3班
    payload["classes"] = [
        {
            "name": "3年1班",
            "course_requirements": [
                {"subject": "語文-國語", "periods": 1, "teacher_name": "導師1"},
                {"subject": "特殊需求", "periods": 1, "teacher_name": "特教A"}
            ],
            "timetable": []
        },
        {
            "name": "3年2班",
            "course_requirements": [
                {"subject": "語文-國語", "periods": 1, "teacher_name": "導師2"},
                {"subject": "特殊需求", "periods": 1, "teacher_name": "特教A"}
            ],
            "timetable": []
        },
        {
            "name": "3年3班",
            "course_requirements": [
                {"subject": "語文-本土語", "periods": 1, "teacher_name": "台語師"},
                {"subject": "特殊需求", "periods": 1, "teacher_name": "特教A"}
            ],
            "timetable": [
                [
                    {"subject": "", "isLocked": False}, # Period 1
                    {"subject": "語文-本土語", "teacher": "台語師", "isLocked": True, "lockMode": "hard", "protectedByPullout": True, "lockOrigin": "native-language-import"}, # Period 2 (Mon P2 hard lock)
                ]
            ]
        },
        {
            "name": "4年1班",
            "course_requirements": [
                {"subject": "資源課", "periods": 1, "teacher_name": "特教B"}
            ],
            "timetable": []
        },
        {
            "name": "4年2班",
            "course_requirements": [
                {"subject": "資源課", "periods": 1, "teacher_name": "特教B"}
            ],
            "timetable": []
        }
    ]

    payload["teachers"] = [
        {"name": "台語師", "max_periods": 20},
        {"name": "特教A", "max_periods": 20},
        {"name": "特教B", "max_periods": 20}
    ]

    # 學習中心多班抽離課原鎖週一第 2 節
    payload["specialCourses"] = [
        {
            "name": "學習中心",
            "targetClasses": ["3年1班", "3年2班", "3年3班"],
            "targetSubject": "特殊需求",
            "teacher": "特教A",
            "lockedSlots": [{"day": 1, "period": 2}],
            "periods": 1
        },
        {
            "name": "資源班",
            "targetClasses": ["4年1班", "4年2班"],
            "targetSubject": "資源課",
            "teacher": "特教B",
            "lockedSlots": [{"day": 1, "period": 4}],
            "periods": 1
        }
    ]

    result = run_solver(payload)

    if result.get("solverStatus") != "FEASIBLE" and result.get("solverStatus") != "OPTIMAL":
        print("STDOUT:", result.get("_stdout"))
    # Assert 1: Solver status must be OPTIMAL / FEASIBLE
    assert result.get("solverStatus") in ["OPTIMAL", "FEASIBLE"], f"Expected FEASIBLE but got {result.get('solverStatus')}"

    schedule = result.get("schedule", [])

    # Assert 2: 台語 protected hard lock stays at Day 1 Period 2 for 3年3班
    lang_cell = next((e for e in schedule if e["className"] == "3年3班" and e["day"] == 1 and e["period"] == 2), None)
    assert lang_cell is not None, "3年3班 Day 1 Period 2 schedule entry missing"
    assert lang_cell["subject"] == "語文-本土語", f"Expected 台語 at Day 1 Period 2, got {lang_cell['subject']}"
    assert lang_cell["teacherName"] == "台語師", f"Expected 台語師 at Day 1 Period 2, got {lang_cell['teacherName']}"

    # Assert 3: 學習中心 3 個 targetClasses 同步移到同一新時段
    sc_entries = [e for e in schedule if e["subject"] == "特殊需求"]
    assert len(sc_entries) == 3, f"Expected 3 entries for 特殊需求, got {len(sc_entries)}"

    target_classes_found = sorted([e["className"] for e in sc_entries])
    assert target_classes_found == ["3年1班", "3年2班", "3年3班"], f"Mismatch in targetClasses: {target_classes_found}"

    sc_periods = set((e["day"], e["period"]) for e in sc_entries)
    assert len(sc_periods) == 1, f"Expected all 3 targetClasses at SAME slot, got multiple: {sc_periods}"

    new_day, new_period = next(iter(sc_periods))
    assert (new_day, new_period) != (1, 2), "學習中心 should have moved away from Day 1 Period 2"

    # Assert 4: 教師特教A無衝堂
    t_entries_at_slot = [e for e in schedule if e["teacherName"] == "特教A" and e["day"] == new_day and e["period"] == new_period]
    assert len(t_entries_at_slot) == 3, "Teacher 特教A should be teaching only this special course event at the new slot"

    # Assert 5: movedLockedLessons contains 學習中心 move
    moved = result.get("movedLockedLessons", [])
    assert len(moved) > 0, "movedLockedLessons should record the moved special course"
    sc_move = next((m for m in moved if m["subject"] == "特殊需求"), None)
    assert sc_move is not None, "movedLockedLessons missing special course entry"
    assert sc_move["originalPeriod"] == {"day": 1, "period": 2}
    assert sc_move["newPeriod"] == {"day": new_day, "period": new_period}

def test_multi_class_unmovable_special_course_remains_hard():
    payload = create_base_payload()
    payload["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableSpecialCourseTypes"] = ["學習中心"] # Does NOT include 資源班

    payload["classes"] = [
        {
            "name": "4年1班",
            "course_requirements": [{"subject": "資源課", "periods": 1, "teacher_name": "特教B"}],
            "timetable": []
        },
        {
            "name": "4年2班",
            "course_requirements": [{"subject": "資源課", "periods": 1, "teacher_name": "特教B"}],
            "timetable": []
        }
    ]
    payload["teachers"] = [{"name": "特教B", "max_periods": 20, "unavailable_slots": [{"day": 1, "period": 4}]}] # Conflict at lock
    payload["specialCourses"] = [
        {
            "name": "資源班",
            "targetClasses": ["4年1班", "4年2班"],
            "targetSubject": "資源課",
            "teacher": "特教B",
            "lockedSlots": [{"day": 1, "period": 4}],
            "periods": 1
        }
    ]

    result = run_solver(payload)
    # Since 資源班 is NOT enabled, it remains hard lock. Pressure at lock slot -> INFEASIBLE
    assert result.get("solverStatus") == "INFEASIBLE"

def test_learning_center_without_movable_policy_remains_infeasible():
    payload = create_base_payload()
    payload["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableSpecialCourseTypes"] = []

    payload["classes"] = [
        {
            "name": "3年1班",
            "course_requirements": [
                {"subject": "特殊需求", "periods": 1, "teacher_name": "特教A"}
            ],
            "timetable": [],
        },
        {
            "name": "3年2班",
            "course_requirements": [
                {"subject": "特殊需求", "periods": 1, "teacher_name": "特教A"}
            ],
            "timetable": [],
        },
        {
            "name": "3年3班",
            "course_requirements": [
                {"subject": "語文-本土語", "periods": 1, "teacher_name": "台語師"},
                {"subject": "特殊需求", "periods": 1, "teacher_name": "特教A"},
            ],
            "timetable": [[
                {"subject": "", "isLocked": False},
                {
                    "subject": "語文-本土語",
                    "teacher": "台語師",
                    "isLocked": True,
                    "lockMode": "hard",
                    "protectedByPullout": True,
                    "lockOrigin": "native-language-import",
                },
            ]],
        },
    ]
    payload["teachers"] = [
        {"name": "台語師", "max_periods": 20},
        {"name": "特教A", "max_periods": 20},
    ]
    payload["specialCourses"] = [
        {
            "name": "學習中心",
            "targetClasses": ["3年1班", "3年2班", "3年3班"],
            "targetSubject": "特殊需求",
            "teacher": "特教A",
            "lockedSlots": [{"day": 1, "period": 2}],
            "periods": 1,
        }
    ]

    result = run_solver(payload)

    assert result.get("solverStatus") == "INFEASIBLE"

def test_ordinary_same_teacher_subject_collision_without_special_courses():
    payload = create_base_payload()
    payload["classes"] = [
        {
            "name": "3年1班",
            "course_requirements": [
                {"subject": "語文-國語", "periods": 1, "teacher_name": "國語師"}
            ],
            "timetable": [[
                {"subject": "", "isLocked": False},
                {"subject": "語文-國語", "teacher": "國語師", "isLocked": True, "lockMode": "hard"},
            ]],
        },
        {
            "name": "3年2班",
            "course_requirements": [
                {"subject": "語文-國語", "periods": 1, "teacher_name": "國語師"}
            ],
            "timetable": [[
                {"subject": "", "isLocked": False},
                {"subject": "語文-國語", "teacher": "國語師", "isLocked": True, "lockMode": "hard"},
            ]],
        },
    ]
    payload["teachers"] = [{"name": "國語師", "max_periods": 20}]
    payload["specialCourses"] = []

    result = run_solver(payload)

    assert result.get("solverStatus") == "INFEASIBLE"

if __name__ == '__main__':
    test_movable_lock_disabled()
    test_whitelist_gating()
    test_no_pressure_no_move()
    test_moved_requires_user_review()
    test_multi_class_movable_special_course_sync_move()
    test_multi_class_unmovable_special_course_remains_hard()
    test_learning_center_without_movable_policy_remains_infeasible()
    test_ordinary_same_teacher_subject_collision_without_special_courses()
    print('ALL TESTS PASSED')
