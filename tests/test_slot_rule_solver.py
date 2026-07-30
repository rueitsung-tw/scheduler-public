from scheduler_policy import SlotRule, build_hard_slot_mask, parse_slot_rules


def test_parse_slot_rules_keeps_hard_and_soft_separate():
    rules = parse_slot_rules([
        {
            "id": "r1",
            "enabled": True,
            "ownerType": "teacher",
            "ownerId": "T001",
            "day": 5,
            "period": [1, 2],
            "mode": "hard",
            "action": "avoid",
        },
        {
            "id": "r2",
            "enabled": True,
            "ownerType": "teacher",
            "ownerId": "T002",
            "day": 1,
            "period": 1,
            "mode": "soft",
            "action": "avoid",
            "weight": 2,
        },
    ])

    assert [rule.id for rule in rules] == ["r1", "r2"]
    assert rules[0].mode == "hard"
    assert rules[1].mode == "soft"


def test_build_hard_slot_mask_only_uses_hard_rules():
    rules = [
        SlotRule(id="r1", enabled=True, owner_type="teacher", owner_id="T001", day=5, periods=(1, 2), mode="hard", action="avoid", weight=3, note=""),
        SlotRule(id="r2", enabled=True, owner_type="teacher", owner_id="T002", day=1, periods=(1,), mode="soft", action="avoid", weight=2, note=""),
    ]

    mask = build_hard_slot_mask(rules)

    assert mask == {"T001": {(5, 1), (5, 2)}}


def test_hard_slot_mask_expands_all_day():
    rules = parse_slot_rules([
        {"id": "r1", "enabled": True, "ownerType": "teacher", "ownerId": "T001", "day": "all", "period": 7, "mode": "hard"}
    ])

    assert build_hard_slot_mask(rules) == {
        "T001": {(1, 7), (2, 7), (3, 7), (4, 7), (5, 7)}
    }
