import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useScheduleStore } from '../src/stores/schedule'

describe('SpecialCourseView special-ed teacher filter', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useScheduleStore()
  })

  it('shows only special_ed_resource teachers in pullout teacher select', () => {
    store.teachers = [
      { name: '導師 A', type: 'homeroom' },
      { name: '科任 B', type: 'subject' },
      { name: '舊特殊 C', type: 'special' },
      { name: '特教 D', type: 'special_ed_resource' },
      { name: '行政 E', type: 'admin' },
    ]

    const specialEdTeachers = store.teachers.filter((t) => t.type === 'special_ed_resource')
    const names = specialEdTeachers.map((t) => t.name)

    expect(names).toContain('特教 D')
    expect(names).not.toContain('舊特殊 C')
    expect(names).not.toContain('導師 A')
    expect(names).not.toContain('科任 B')
    expect(names).not.toContain('行政 E')
  })

  it('excludes legacy special type from pullout teacher list', () => {
    store.teachers = [
      { name: 'A', type: 'special' },
      { name: 'B', type: '特殊' },
      { name: 'C', type: '專科' },
      { name: 'D', type: '專任' },
    ]

    const specialEdTeachers = store.teachers.filter((t) => t.type === 'special_ed_resource')
    expect(specialEdTeachers).toHaveLength(0)
  })

  it('includes only special_ed_resource variant labels', () => {
    store.teachers = [
      { name: '特教 A', type: 'special_ed_resource' },
      { name: '特教 B', type: 'special_ed_resource' },
    ]

    const specialEdTeachers = store.teachers.filter((t) => t.type === 'special_ed_resource')
    expect(specialEdTeachers).toHaveLength(2)
  })
})