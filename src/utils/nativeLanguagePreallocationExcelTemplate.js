import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

export function downloadNativeLanguagePreallocationExcelTemplate() {
  const wb = XLSX.utils.book_new()

  // 1. 預排課表 工作表
  const rows = [
    ['註記：請將教師姓名改為系統內教師名稱，並在課程格填入班級代號，例如 501。'],
    ['星期', '編號', '教師', '節次', '教師姓名 1', '教師姓名 2'],
  ]

  const days = ['一', '二', '三', '四', '五']
  const periods = ['早', '一', '二', '三', '四', '午休', '五', '六', '七']

  for (const day of days) {
    for (let pIdx = 0; pIdx < periods.length; pIdx++) {
      const period = periods[pIdx]
      const dayVal = pIdx === 0 ? day : ''
      rows.push([dayVal, '', '', period, '', ''])
    }
  }
  rows.push(['總計'])

  const wsSchedule = XLSX.utils.aoa_to_sheet(rows)
  wsSchedule['!cols'] = [
    { wch: 8 },
    { wch: 6 },
    { wch: 8 },
    { wch: 8 },
    { wch: 14 },
    { wch: 14 },
  ]

  XLSX.utils.book_append_sheet(wb, wsSchedule, '預排課表')

  // 2. 填寫說明 工作表
  const guideRows = [
    ['本土語預排課表 Excel 匯入填寫說明'],
    [''],
    ['項次', '說明事項'],
    ['1', '檔案格式：僅支援 Excel 活頁簿格式（.xlsx）。'],
    ['2', '班級代號：儲存格填入班級代號（數字或文字皆可），例如 501 代表「5年1班」，系統會自動對照轉換。'],
    ['3', '有效範圍：系統僅匯入星期一至星期五、第 1 節至第 7 節之預排課程。'],
    ['4', '非課程列：列標籤為「早」、「午休」或空白儲存格將自動跳過，不會匯入為預排課程。'],
    ['5', '衝突預覽：匯入後資料會先進行班級、教師與時段之衝突預覽診斷，確認並完成決議後才會套用至系統。'],
  ]

  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows)
  wsGuide['!cols'] = [{ wch: 8 }, { wch: 70 }]

  XLSX.utils.book_append_sheet(wb, wsGuide, '填寫說明')

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  try {
    saveAs(blob, '本土語預排課表範例.xlsx')
  } catch {
    // 於單元測試環境無原生 saveAs 時不報錯
  }

  return { blob, wb }
}
