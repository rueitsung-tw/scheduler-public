<template>
  <section class="slot-rule-editor">
    <header class="slot-rule-header">
      <h3>時段規則</h3>
      <button type="button" class="add-rule-btn" @click="createDefaultRule">新增規則</button>
    </header>

    <div v-if="rules.length === 0" class="empty-state">尚未設定時段規則</div>

    <div v-for="rule in rules" :key="rule.id" class="rule-row">
      <input
        :value="rule.name"
        placeholder="規則名稱"
        @input="update(rule.id, { name: $event.target.value })"
      />
      <select :value="rule.ownerType" @change="update(rule.id, { ownerType: $event.target.value })">
        <option value="teacher">教師</option>
        <option value="admin_role">行政角色</option>
        <option value="team_instructor">團隊指導</option>
        <option value="class">班級</option>
      </select>
      <select :value="rule.ownerId" @change="update(rule.id, { ownerId: $event.target.value })">
        <option value="">請選擇</option>
        <option
          v-for="teacher in scheduleStore.teachers"
          :key="teacher.teacher_id || teacher.name"
          :value="teacher.teacher_id || teacher.name"
        >
          {{ teacher.name }}
        </option>
      </select>
      <input
        type="number"
        min="1"
        max="5"
        :value="rule.day"
        @input="update(rule.id, { day: Number($event.target.value) })"
      />
      <input
        type="number"
        min="1"
        max="7"
        :value="Array.isArray(rule.period) ? rule.period[0] : rule.period"
        @input="update(rule.id, { period: Number($event.target.value) })"
      />
      <select :value="rule.mode" @change="update(rule.id, { mode: $event.target.value })">
        <option value="hard">不可排</option>
        <option value="soft">盡量不排</option>
      </select>
      <input
        type="number"
        min="1"
        max="10"
        :value="rule.weight"
        :disabled="rule.mode === 'hard'"
        @input="update(rule.id, { weight: Number($event.target.value) })"
      />
      <button type="button" class="delete-rule-btn" @click="scheduleStore.deleteSlotRule(rule.id)">
        刪除
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useScheduleStore } from '../stores/schedule'

const scheduleStore = useScheduleStore()
const rules = computed(() =>
  Array.isArray(scheduleStore.aiSettings?.slotRules) ? scheduleStore.aiSettings.slotRules : [],
)

const createDefaultRule = () => {
  scheduleStore.addSlotRule({
    name: '',
    ownerType: 'teacher',
    ownerId: '',
    day: 1,
    period: 1,
    mode: 'soft',
    action: 'avoid',
    weight: 3,
  })
}

const update = (id, updates) => {
  scheduleStore.updateSlotRule(id, updates)
}
</script>

<style scoped>
.slot-rule-editor {
  display: grid;
  gap: 12px;
}
.slot-rule-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.rule-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1.2fr 72px 72px 96px 80px auto;
  gap: 8px;
  align-items: center;
}
.empty-state {
  color: #64748b;
  padding: 12px 0;
}
.add-rule-btn,
.delete-rule-btn {
  cursor: pointer;
}
input,
select,
button {
  min-height: 34px;
}
</style>
