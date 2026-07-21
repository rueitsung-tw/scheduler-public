import { describe, expect, it } from 'vitest'
import { formatRoomSlotAssignments } from '../src/utils/classroomTimetable'

describe('formatRoomSlotAssignments', () => {
  it('只顯示明確指派到該教室的班級，不把同科未指派班級誤判成衝堂', () => {
    const classes = [
      {
        name: '4年1班',
        timetable: {
          2: {
            1: {
              subject: '資訊',
              teacher: '陳老師',
              classroomId: 'computer-1',
              classroomName: '電腦教室一',
            },
          },
        },
      },
      {
        name: '4年2班',
        timetable: {
          2: {
            1: {
              subject: '資訊',
              teacher: '王老師',
            },
          },
        },
      },
    ]

    const result = formatRoomSlotAssignments(classes, { id: 'computer-1', name: '電腦教室一' }, 2, 1)
    expect(result).toBe('4年1班')
  })

  it('沒有明確教室指派時，回傳空字串而不是用科目猜測房間', () => {
    const classes = [
      {
        name: '5年1班',
        timetable: {
          4: {
            4: {
              subject: '資訊',
              teacher: '李老師',
            },
          },
        },
      },
    ]

    const result = formatRoomSlotAssignments(classes, { id: 'computer-2', name: '電腦教室二' }, 4, 4)
    expect(result).toBe('')
  })

  it('同一教室被多個 both 週班級明確占用時，保留衝堂標記', () => {
    const classes = [
      {
        name: '3年1班',
        timetable: {
          1: {
            3: {
              subject: '自然科學',
              teacher: '林老師',
              classroomId: 'science-1',
              classroomName: '自然教室一',
            },
          },
        },
      },
      {
        name: '3年2班',
        timetable: {
          1: {
            3: {
              subject: '自然科學',
              teacher: '張老師',
              classroomId: 'science-1',
              classroomName: '自然教室一',
            },
          },
        },
      },
    ]

    const result = formatRoomSlotAssignments(classes, { id: 'science-1', name: '自然教室一' }, 1, 3)
    expect(result).toBe('【衝堂】\n3年1班\n3年2班')
  })
})
