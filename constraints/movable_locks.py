from config import PERIODS_PER_DAY, TOTAL_PERIODS, LUNCH_BOUNDARY

def get_movable_lock_policy(payload):
    policy = payload.get("movableLocksPolicy", {})
    if not policy:
        if payload.get("movableLocksEnabled"):
            return payload
    return policy

def is_manual_lock_movable(lock_subj, policy, cell=None):
    if cell and isinstance(cell, dict):
        if cell.get("protectedByPullout") is True:
            return False
        mode = cell.get("lockMode")
        if mode == "hard":
            return False
        if mode == "movable":
            return True

    # 未提供逐格 lockMode 時才退回既有全域 policy
    if not policy or not policy.get("movableLocksEnabled"):
        return False
    movable_subjects = policy.get("movableSubjects", [])
    return lock_subj in movable_subjects

def is_cell_per_cell_movable(cell, active_event_id=None):
    """
    檢查 cell 是否可微調移動。

    Args:
        cell: timetable cell 物件
        active_event_id: 當前微調事件 ID；指定時只允許同一 preallocEventId 且 lockMode='movable' 的課次

    Returns:
        bool: True 表示可移動
    """
    if cell and isinstance(cell, dict):
        if cell.get("protectedByPullout") is True:
            return False
        mode = cell.get("lockMode")

        # Event-scoped mode: 指定 active_event_id 時，只允許同事件的 movable 課次
        if active_event_id is not None:
            cell_event_id = cell.get("preallocEventId")
            if cell_event_id != active_event_id:
                # 不同事件的課次一律視為硬鎖
                return False
            return mode == "movable"

        # 無 active_event_id 時，退回既有全域語意
        if mode == "movable":
            return True
        if mode == "hard":
            return False
    return False

def is_special_course_lock_movable(sc, policy):
    if not policy or not policy.get("movableLocksEnabled"):
        return False
    types = policy.get("movableSpecialCourseTypes", [])
    tags = policy.get("movableCourseTags", [])
    sc_name = sc.get("name", "")
    sc_tags = sc.get("courseTags", [])
    if sc_name in types:
        return True
    if any(tag in tags for tag in sc_tags):
        return True
    return False

def get_candidate_periods(original_p, policy, allowed_periods=None, must_cross_noon=False):
    if allowed_periods is None:
        allowed_periods = set(range(TOTAL_PERIODS))

    window = policy.get("moveWindow", {}) if policy else {}
    scope = window.get("scope", "same_day")
    allow_cross_noon = window.get("allowCrossMorningAfternoon", False)
    max_dist = window.get("maxPeriodDistance", 0)

    candidates = []
    orig_d = original_p // PERIODS_PER_DAY
    orig_pr = original_p % PERIODS_PER_DAY
    orig_is_morning = orig_pr < LUNCH_BOUNDARY

    for p in range(TOTAL_PERIODS):
        if p not in allowed_periods:
            continue
        d = p // PERIODS_PER_DAY
        pr = p % PERIODS_PER_DAY
        is_morning = pr < LUNCH_BOUNDARY

        if must_cross_noon:
            if d != orig_d:
                continue
            if is_morning == orig_is_morning:
                continue
        else:
            if scope == "same_day" and d != orig_d:
                continue
            if not allow_cross_noon and (is_morning != orig_is_morning):
                continue
            dist = abs(p - original_p)
            if dist > max_dist and max_dist > 0:
                continue

        dist = abs(p - original_p)
        candidates.append((p, dist))

    return candidates

def apply_movable_lock(model, original_p, candidate_periods, var_getter, decision_meta):
    if not hasattr(model, "movable_lock_decisions"):
        model.movable_lock_decisions = []

    candidate_vars = []
    for p, dist in candidate_periods:
        var = var_getter(p)
        if var is not None:
            candidate_vars.append((p, var, dist))

    if not candidate_vars:
        orig_var = var_getter(original_p)
        if orig_var is not None:
            model.Add(orig_var == 1)
        return

    lock_choice_vars = []
    for p, var, dist in candidate_vars:
        choice_var = model.NewBoolVar(f"movable_lock_{decision_meta['lockType']}_{decision_meta['className']}_{original_p}_to_{p}")
        lock_choice_vars.append((p, choice_var, var, dist))
        model.Add(var == 1).OnlyEnforceIf(choice_var)

    model.Add(sum(cv for _, cv, _, _ in lock_choice_vars) == 1)

    is_moved = model.NewBoolVar(f"movable_lock_{decision_meta['className']}_{original_p}_is_moved")
    orig_choice_var = next((cv for p, cv, _, _ in lock_choice_vars if p == original_p), None)

    # orig_var is the schedule variable at the original period
    orig_var = next((var for p, _, var, _ in lock_choice_vars if p == original_p), None)

    if orig_choice_var is not None:
        model.Add(is_moved == 0).OnlyEnforceIf(orig_choice_var)
        model.Add(is_moved == 1).OnlyEnforceIf(orig_choice_var.Not())

        # [Semantic Fix] If moved, original slot must NOT be occupied by this subject
        # This prevents "fake moves" where it just swaps with another period of the same subject
        if orig_var is not None:
            model.Add(orig_var == 0).OnlyEnforceIf(is_moved)
    else:
        model.Add(is_moved == 1)
        if orig_var is not None:
            model.Add(orig_var == 0)

    decision_meta["lock_choice_vars"] = lock_choice_vars
    decision_meta["is_moved"] = is_moved
    model.movable_lock_decisions.append(decision_meta)

def apply_movable_budgets(model, policy):
    if not hasattr(model, "movable_lock_decisions"):
        return

    max_total = policy.get("maxMovesTotal", 9999)
    max_per_class = policy.get("maxMovesPerClass", 9999)
    max_per_subj = policy.get("maxMovesPerSubject", 9999)

    all_is_moved = []
    class_moves = {}
    subj_moves = {}

    for dec in model.movable_lock_decisions:
        is_moved = dec["is_moved"]
        all_is_moved.append(is_moved)

        c_str = dec["className"]
        for c in c_str.split(","):
            c = c.strip()
            if not c:
                continue
            if c not in class_moves:
                class_moves[c] = []
            class_moves[c].append(is_moved)

        s = dec["subject"]
        if s not in subj_moves:
            subj_moves[s] = []
        subj_moves[s].append(is_moved)

    if all_is_moved:
        model.Add(sum(all_is_moved) <= max_total)

    for c, moves in class_moves.items():
        model.Add(sum(moves) <= max_per_class)

    for s, moves in subj_moves.items():
        model.Add(sum(moves) <= max_per_subj)

    objective_terms = []
    for dec in model.movable_lock_decisions:
        is_special = dec["lockType"] == "special_course_lock"
        shift_penalty_val = 12000 if is_special else 10000

        for p, cv, var, dist in dec["lock_choice_vars"]:
            if dist > 0:
                total_penalty = shift_penalty_val + 1000 * dist
                objective_terms.append({
                    "var": cv,
                    "weight": total_penalty,
                    "rule_id": f"movable_lock_{dec['className']}"
                })

    model.movable_objective_terms = getattr(model, "movable_objective_terms", [])
    model.movable_objective_terms.extend(objective_terms)
