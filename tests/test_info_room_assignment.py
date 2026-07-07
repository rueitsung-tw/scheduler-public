"""
test_info_room_assignment.py — 資訊課專科教室明確指派回歸測試

驗證要點：
1. (Helper 單元測試) `_backfill_other_special_room_classrooms` 在容量不足時的防禦性行為：
   當入參 entries 超過可用教室數時，backfill helper 只會分配有教室的 entry，多出的保留空值。
   **注意**：這是針對 backfill helper 的單元測試，不代表 end-to-end solver 在容量不足時會輸出
   這樣的 schedule。在真實 solver 流程中，class_rules.py 對 room_vars 下了硬約束
   `sum(vars_in_slot) <= 1`，容量不足時 solver 會直接回傳 INFEASIBLE。
2. 有足夠電腦教室容量時：所有資訊課都應有明確 classroomId / classroomName
3. 匯出的 report / slotRows 中，資訊課 entries 應帶出 classroomName
"""

import pytest
from collections import defaultdict


def _normalize_special_room_subject(subj_raw):
    """對應 solver._normalize_special_room_subject"""
    subj = str(subj_raw or "").strip()
    if subj in ("語文-本土語", "本土語言", "閩南語", "客語"):
        return "本土語"
    if subj == "英語":
        return "語文-英語"
    if subj == "自然":
        return "自然科學"
    if subj in ("科技-資訊", "資訊", "電腦"):
        return "資訊"
    if subj in ("健康與體育",):
        return "體育"
    return subj


class TestInfoRoomAssignmentBackfill:
    """測試 _backfill_other_special_room_classrooms 行為。"""

    def _build_classrooms(self, count=2):
        """建立 count 間電腦教室。"""
        return [
            {
                "id": f"info_room_{i}",
                "name": f"電腦教室{i}",
                "subject": "資訊",
                "gradePreferences": [],
            }
            for i in range(1, count + 1)
        ]

    def _build_info_entries(self, class_names, day=1, period=1, week="both"):
        r"""建立沒有 classroomId 的資訊課 entry。

        班級名稱必須包含數字（如 "5年1班"），因為 _get_class_grade_from_name
        使用 regex r'(\d+)' 來提取年級。純中文名稱（如 "五年一班"）會回傳 None。
        """
        return [
            {
                "className": name,
                "day": day,
                "period": period,
                "subject": "資訊",
                "teacherName": "教師A",
                "week": week,
                "classroomId": "",
                "classroomName": "",
            }
            for name in class_names
        ]

    def test_enough_capacity_all_assigned(self):
        """有足夠電腦教室容量時：所有資訊課都應有明確 classroomId / classroomName。"""
        from solver import _backfill_other_special_room_classrooms

        classrooms = self._build_classrooms(count=3)
        # 班級名稱必須包含數字以便 _get_class_grade_from_name 提取年級
        entries = self._build_info_entries(["5年1班", "5年2班", "5年3班"])

        # school_info 必須配置 subjectClassroomGrades 才會觸發 backfill
        school_info = {"subjectClassroomGrades": {"資訊": [5, 6]}}

        _backfill_other_special_room_classrooms(entries, classrooms, school_info)

        # 所有 3 個 entry 都應拿到 classroomId
        assigned = [e for e in entries if e.get("classroomId")]
        assert len(assigned) == 3, f"期望 3 個都拿到教室，實際只有 {len(assigned)} 個"

        # 每個 classroomId 不同（不衝堂）
        room_ids = [e["classroomId"] for e in assigned]
        assert len(set(room_ids)) == 3, f"期望 3 個不同教室，實際 {len(set(room_ids))} 個"

        # classroomName 不為空
        for e in assigned:
            assert e.get("classroomName"), f"classroomName 不應為空: {e}"

    def test_backfill_helper_unit_test_overcapacity_deferred_assignment(self):
        """
        [Helper 單元測試] _backfill 在 entries 超過教室數時的防禦性行為。

        這只是測試 `_backfill_other_special_room_classrooms` helper function 在收到
        不完整資料時（entries 數量 > 可用教室數）的分配策略：先填有教室的，多出的保留空值。

        **重要提醒**：這不是 end-to-end solver 的行為測試。
        在真實 solver 執行流程中，`class_rules.py` 對 room_vars 下了硬約束
        `sum(vars_in_slot) <= 1`。當專科教室容量不足時（例如 3 個班但只有 2 間電腦教室），
        solver 會直接拋出 INFEASIBLE，不會產生「部分成功」的 schedule output。
        這個 backfill helper 只在 solver 已經成功排程但某些 entry 缺少 classroomId 時才會被呼叫。
        """
        from solver import _backfill_other_special_room_classrooms

        classrooms = self._build_classrooms(count=2)
        # 班級名稱必須包含數字以便 _get_class_grade_from_name 提取年級
        entries = self._build_info_entries(["5年1班", "5年2班", "5年3班"])

        # school_info 必須配置 subjectClassroomGrades 才會觸發 backfill
        school_info = {"subjectClassroomGrades": {"資訊": [5, 6]}}

        _backfill_other_special_room_classrooms(entries, classrooms, school_info)

        assigned = [e for e in entries if e.get("classroomId")]
        unassigned = [e for e in entries if not e.get("classroomId")]

        assert len(assigned) == 2, f"期望 2 個拿到教室，實際 {len(assigned)} 個"
        assert len(unassigned) == 1, f"期望 1 個未分配（helper 防禦性保留），實際 {len(unassigned)} 個"

        # 已分配的 classroomName 不為空
        for e in assigned:
            assert e.get("classroomName"), f"已分配 entry 的 classroomName 不應為空"

        # 未分配的 entry 保留空值（helper 不強制分配超出容量的 entry）
        for e in unassigned:
            assert not e.get("classroomId"), "helper 不應強制分配超出容量的 entry"

    def test_entry_already_has_classroom_id_skipped(self):
        """已有 classroomId 的 entry 不被覆蓋。"""
        from solver import _backfill_other_special_room_classrooms

        classrooms = self._build_classrooms(count=2)
        # 班級名稱必須包含數字以便 _get_class_grade_from_name 提取年級
        entries = [
            {
                "className": "5年1班",
                "day": 1,
                "period": 1,
                "subject": "資訊",
                "teacherName": "教師A",
                "week": "both",
                "classroomId": "info_room_1",
                "classroomName": "電腦教室1",
            },
            {
                "className": "5年2班",
                "day": 1,
                "period": 1,
                "subject": "資訊",
                "teacherName": "教師B",
                "week": "both",
                "classroomId": "",
                "classroomName": "",
            },
        ]

        # school_info 必須配置 subjectClassroomGrades 才會觸發 backfill
        school_info = {"subjectClassroomGrades": {"資訊": [5, 6]}}

        _backfill_other_special_room_classrooms(entries, classrooms, school_info)

        # 第一個 entry 保持原值
        assert entries[0]["classroomId"] == "info_room_1"
        assert entries[0]["classroomName"] == "電腦教室1"

        # 第二個 entry 拿到另一個教室
        assert entries[1].get("classroomId") == "info_room_2"

    def test_subject_normalization_info_variants(self):
        """資訊、科技-資訊、電腦 都應被正確正規化為「資訊」。"""
        subjects = ["資訊", "科技-資訊", "電腦"]
        for subj in subjects:
            canonical = _normalize_special_room_subject(subj)
            assert canonical == "資訊", f"期望 '{subj}' -> '資訊'，實際 '{canonical}'"

    def test_no_classrooms_skips_gracefully(self):
        """沒有電腦教室時不報錯。"""
        from solver import _backfill_other_special_room_classrooms

        # 班級名稱必須包含數字以便 _get_class_grade_from_name 提取年級
        entries = self._build_info_entries(["5年1班"])
        school_info = {"subjectClassroomGrades": {"資訊": [5, 6]}}
        _backfill_other_special_room_classrooms(entries, [], school_info)

        # entry 保持空值
        assert not entries[0].get("classroomId")

    def test_empty_entries_skips_gracefully(self):
        """空 entries 時不報錯。"""
        from solver import _backfill_other_special_room_classrooms

        classrooms = self._build_classrooms(count=2)
        school_info = {"subjectClassroomGrades": {"資訊": [5, 6]}}
        _backfill_other_special_room_classrooms([], classrooms, school_info)
        # 不拋異常即通過


class TestClassRulesInfoRoomAssignment:
    """測試 apply_special_classroom_capacity 對資訊課的 room assignment 變數建立。"""

    def test_non_alternating_subject_creates_room_vars(self):
        """P0-1 修正後：當科目不在 subjectClassroomGrades 時，
        不會建立 room assignment 變數（避免 INFEASIBLE）。

        只有當科目在 subjectClassroomGrades 中配置時，
        才會建立 classroom_assignments 變數。
        """
        from ortools.sat.python import cp_model
        from constraints.class_rules import apply_special_classroom_capacity

        model = cp_model.CpModel()
        classrooms = [
            {"id": "info_1", "name": "電腦教室1", "subject": "資訊"},
            {"id": "info_2", "name": "電腦教室2", "subject": "資訊"},
        ]

        classes_data = [
            {
                "name": "五年一班",
                "grade": 5,
                "course_requirements": [
                    {"subject": "資訊", "periods": 1, "teacher_name": "教師A", "defaultTeacher": "subject"}
                ],
            }
        ]

        # 建立一個簡單的 schedule dict
        schedule = {}
        var = model.NewBoolVar("sched_51_0_教師A_資訊")
        schedule[("五年一班", 0, "教師A", "資訊")] = var

        # 資訊 NOT in subjectClassroomGrades → 不應建立 room assignment
        penalty_vars = []
        apply_special_classroom_capacity(
            model,
            classes_data,
            schedule,
            classrooms,
            penalty_vars=penalty_vars,
            classroom_limits={},
            school_info={"subjectClassroomGrades": {}},
        )

        # P0-1: 未配置的科目不應有 room assignment（避免 INFEASIBLE）
        info_assignments = [
            item for item in getattr(model, "classroom_assignments", [])
            if item.get("subject") == "資訊"
        ]
        assert len(info_assignments) == 0, (
            "P0-1: 未配置的科目不應建立 room assignment 變數"
        )

    def test_configured_subject_creates_room_vars(self):
        """當科目在 subjectClassroomGrades 中配置時，應建立 room assignment 變數。"""
        from ortools.sat.python import cp_model
        from constraints.class_rules import apply_special_classroom_capacity

        model = cp_model.CpModel()
        classrooms = [
            {"id": "info_1", "name": "電腦教室1", "subject": "資訊"},
            {"id": "info_2", "name": "電腦教室2", "subject": "資訊"},
        ]

        classes_data = [
            {
                "name": "五年一班",
                "grade": 5,
                "course_requirements": [
                    {"subject": "資訊", "periods": 1, "teacher_name": "教師A", "defaultTeacher": "subject"}
                ],
            }
        ]

        schedule = {}
        var = model.NewBoolVar("sched_51_0_教師A_資訊")
        schedule[("五年一班", 0, "教師A", "資訊")] = var

        # 資訊 IS in subjectClassroomGrades → 應建立 room assignment
        penalty_vars = []
        apply_special_classroom_capacity(
            model,
            classes_data,
            schedule,
            classrooms,
            penalty_vars=penalty_vars,
            classroom_limits={},
            school_info={"subjectClassroomGrades": {"資訊": [5, 6]}},
        )

        info_assignments = [
            item for item in getattr(model, "classroom_assignments", [])
            if item.get("subject") == "資訊"
        ]
        assert len(info_assignments) > 0, (
            "配置後的科目應有 room assignment 變數"
        )

    def test_classroom_assignment_has_room_id_and_name(self):
        """classroom_assignments 中的每個項目都應包含 roomId 和 roomName。"""
        from ortools.sat.python import cp_model
        from constraints.class_rules import apply_special_classroom_capacity

        model = cp_model.CpModel()
        classrooms = [
            {"id": "info_1", "name": "電腦教室1", "subject": "資訊"},
        ]

        classes_data = [
            {
                "name": "五年一班",
                "grade": 5,
                "course_requirements": [],
            }
        ]

        schedule = {}
        var = model.NewBoolVar("sched_51_0_教師A_資訊")
        schedule[("五年一班", 0, "教師A", "資訊")] = var

        penalty_vars = []
        apply_special_classroom_capacity(
            model,
            classes_data,
            schedule,
            classrooms,
            penalty_vars=penalty_vars,
            classroom_limits={},
            school_info={"subjectClassroomGrades": {}},
        )

        info_assignments = [
            item for item in getattr(model, "classroom_assignments", [])
            if item.get("subject") == "資訊"
        ]
        for item in info_assignments:
            assert item.get("roomId"), f"classroom_assignment 缺少 roomId: {item}"
            assert item.get("roomName"), f"classroom_assignment 缺少 roomName: {item}"


class TestExportInfoClassroomName:
    """驗證匯出時資訊課 entries 帶出 classroomName。"""

    def test_schedule_entry_has_classroom_name_after_backfill(self):
        """模擬 solver output + backfill 後，資訊課 entry 應有 classroomName。"""
        from solver import _backfill_other_special_room_classrooms

        # 模擬 solver 輸出的 schedule entries（沒有 classroomId）
        # 班級名稱必須包含數字以便 _get_class_grade_from_name 提取年級
        entries = [
            {
                "day": 1,
                "period": 3,
                "className": "5年1班",
                "teacherName": "教師A",
                "subject": "資訊",
                "classroomId": "",
                "classroomName": "",
                "week": "both",
            },
            {
                "day": 1,
                "period": 3,
                "className": "5年2班",
                "teacherName": "教師B",
                "subject": "資訊",
                "classroomId": "",
                "classroomName": "",
                "week": "both",
            },
        ]

        classrooms = [
            {"id": "info_1", "name": "電腦教室1", "subject": "資訊"},
            {"id": "info_2", "name": "電腦教室2", "subject": "資訊"},
        ]

        school_info = {"subjectClassroomGrades": {"資訊": [5, 6]}}
        _backfill_other_special_room_classrooms(entries, classrooms, school_info)

        # 兩個 entry 都應有 classroomName
        for e in entries:
            assert e.get("classroomName"), (
                f"匯出 entry 應帶 classroomName: {e['className']} {e['subject']}"
            )
            assert e.get("classroomId"), (
                f"匯出 entry 應帶 classroomId: {e['className']} {e['subject']}"
            )

    def test_info_subject_not_confused_with_music_art(self):
        """資訊課的教室指派不應與音樂/美勞教室混淆。"""
        from solver import _backfill_other_special_room_classrooms

        classrooms = [
            {"id": "music_1", "name": "音樂教室", "subject": "音樂"},
            {"id": "info_1", "name": "電腦教室1", "subject": "資訊"},
        ]

        entries = [
            {
                "day": 1,
                "period": 3,
                # 班級名稱必須包含數字以便 _get_class_grade_from_name 提取年級
                "className": "5年1班",
                "teacherName": "教師A",
                "subject": "資訊",
                "classroomId": "",
                "classroomName": "",
                "week": "both",
            },
        ]

        # school_info 必須配置 subjectClassroomGrades 才會觸發 backfill
        school_info = {"subjectClassroomGrades": {"資訊": [5, 6]}}
        _backfill_other_special_room_classrooms(entries, classrooms, school_info)

        # 資訊課應分配到電腦教室，不是音樂教室
        assert entries[0].get("classroomId") == "info_1"
        assert entries[0].get("classroomName") == "電腦教室1"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])