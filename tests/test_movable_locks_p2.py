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
    
def test_multi_class_explicit_skip():
    payload = create_base_payload()
    payload["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableLocksEnabled"] = True
    payload["movableLocksPolicy"]["movableSpecialCourseTypes"] = ["學習中心"]
    
    # Remove manual locks but add the course requirements for the special course so variables are created
    payload["classes"][0]["timetable"] = []
    payload["classes"][0]["course_requirements"].append({
        "subject": "特殊需求", "periods": 1, "teacher_name": "特教A"
    })
    payload["classes"].append({
        "name": "3年2班",
        "course_requirements": [
            {"subject": "特殊需求", "periods": 1, "teacher_name": "特教A"}
        ],
        "timetable": []
    })
    
    # Add multi-class special course lock at the root
    payload["specialCourses"] = [
        {
            "name": "學習中心",
            "targetClasses": ["3年1班", "3年2班"],
            "targetSubject": "特殊需求",
            "teacher": "特教A",
            "lockedSlots": [{"day": 1, "period": 2}],
            "periods": 1
        }
    ]
    payload["teachers"].append({"name": "特教A", "max_periods": 20})
    payload["teachers"][-1]["unavailable_slots"] = [{"day": 1, "period": 2}] # Pressure
    
    result = run_solver(payload)
    # Because multi-class is skipped by our semantic fix, it should fall back to hard lock
    # And since there is pressure (teacher unavailable at that lock slot), it MUST return INFEASIBLE.
    print("test_multi_class_explicit_skip status:", result.get("solverStatus"))
    if result.get("solverStatus") != "INFEASIBLE":
        print("STDOUT:", result.get("_stdout"))
    assert result.get("solverStatus") == "INFEASIBLE"

if __name__ == '__main__':
    test_movable_lock_disabled()
    test_whitelist_gating()
    test_no_pressure_no_move()
    test_moved_requires_user_review()
    test_multi_class_explicit_skip()
    print('ALL TESTS PASSED')
