#!/usr/bin/env python
# -*- coding: utf-8 -*-

import importlib.util
import sys
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parent.parent
MODULE_PATH = WORKSPACE / "scripts" / "generate_phase2_payloads.py"


def load_generator_module():
    spec = importlib.util.spec_from_file_location("generate_phase2_payloads", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def collect_locked_subjects(payload, targets):
    rows = []
    for class_name, day, period in targets:
        cls = next(c for c in payload["classes"] if c["name"] == class_name)
        cell = cls["timetable"][str(day)][str(period)]
        rows.append((class_name, cell["subject"], cell.get("isLocked")))
    return rows


def test_room_pressure_only_uses_canonical_music_art_subjects():
    mod = load_generator_module()
    payload = mod.clone_payload(mod.load_json(mod.BASELINE_PATH))
    mod.apply_room_pressure_only(payload)

    targets = [
        ("3年1班", 2, 1),
        ("4年1班", 2, 1),
        ("5年1班", 2, 1),
        ("6年1班", 2, 1),
        ("3年3班", 3, 1),
        ("4年2班", 3, 1),
        ("6年2班", 3, 1),
    ]
    locked = collect_locked_subjects(payload, targets)

    for class_name, subject, is_locked in locked[:4]:
        assert subject == "音樂_固定", f"{class_name} should lock 音樂_固定, got {subject!r}"
        assert is_locked is True

    for class_name, subject, is_locked in locked[4:]:
        assert subject == "美勞_固定", f"{class_name} should lock 美勞_固定, got {subject!r}"
        assert is_locked is True


def test_manual_locks_plus_room_pressure_preserves_canonical_music_art_subjects():
    mod = load_generator_module()
    payload = mod.clone_payload(mod.load_json(mod.BASELINE_PATH))
    mod.apply_manual_locks_plus_room_pressure(payload)

    targets = [
        ("3年1班", 2, 1),
        ("4年1班", 2, 1),
        ("5年1班", 2, 1),
        ("6年1班", 2, 1),
        ("3年3班", 3, 1),
        ("4年2班", 3, 1),
        ("6年2班", 3, 1),
    ]
    locked = collect_locked_subjects(payload, targets)

    bad = [row for row in locked if row[1] in {"音樂", "美勞"}]
    assert not bad, f"raw music/art subjects would fail lock conservation: {bad}"

    extra_targets = [
        ("5年1班", 2, 3),
        ("3年3班", 3, 3),
    ]
    extra_locked = collect_locked_subjects(payload, extra_targets)
    composite = [row for row in extra_locked if "/" in row[1] or "(單)" in row[1] or "(雙)" in row[1]]
    assert not composite, f"extra locks must not target alternating composite subjects: {composite}"


if __name__ == "__main__":
    test_room_pressure_only_uses_canonical_music_art_subjects()
    test_manual_locks_plus_room_pressure_preserves_canonical_music_art_subjects()
    print("ok")
