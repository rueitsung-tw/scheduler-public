"""
排課系統全域常數配置
"""

# 時間配置
DAYS = 5
PERIODS_PER_DAY = 7
TOTAL_PERIODS = DAYS * PERIODS_PER_DAY

# 午休邊界：第 4 節後為午休，禁止 4-5 節連堂
LUNCH_BOUNDARY = 4

# 虛擬教師關鍵字（此類教師享有分身豁免權）
VIRTUAL_TEACHER_KEYWORDS = ["虛擬", "外聘", "待排"]

# 專科教室容量 fallback（當無實體教室資料時的保底值）
CLASSROOM_LIMITS_FALLBACK = {
    "自然科學": 3,
    "語文-英語": 3,
    "音樂": 3,
    "美勞": 3,
    "體育": 6,
    "資訊": 1,
}
