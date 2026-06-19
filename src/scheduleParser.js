import * as XLSX from 'xlsx'

const WEEKDAY_ORDER = ['一', '二', '三', '四', '五', '六', '日']

// 逢甲官方標準節次時間對照表（用於精確對齊節次，防禦時間雜訊）
const FCU_SLOTS = [
  { id: '1',  start: 8 * 60 + 10,  end: 9 * 60 },
  { id: '2',  start: 9 * 60 + 10,  end: 10 * 60 },
  { id: '3',  start: 10 * 60 + 10, end: 11 * 60 },
  { id: '4',  start: 11 * 60 + 10, end: 12 * 60 },
  { id: '5',  start: 12 * 60 + 10, end: 13 * 60 + 10 }, // 逢甲中午是 60 分鐘
  { id: '6',  start: 13 * 60 + 10, end: 14 * 60 },      // 第六節與第五節無縫接軌
  { id: '7',  start: 14 * 60 + 10, end: 15 * 60 },
  { id: '8',  start: 15 * 60 + 10, end: 16 * 60 },
  { id: '9',  start: 16 * 60 + 10, end: 17 * 60 },
  { id: '10', start: 17 * 60 + 10, end: 18 * 60 },
  { id: '11', start: 18 * 60 + 30, end: 19 * 60 + 20 },
  { id: '12', start: 19 * 60 + 25, end: 20 * 60 + 15 },
  { id: '13', start: 20 * 60 + 25, end: 21 * 60 + 15 },
  { id: '14', start: 21 * 60 + 20, end: 22 * 60 + 10 }
]

/**
 * 🎯 動態解析 Excel 檔案（二維陣列模式）
 * 支援直接貼上網頁課表、學校官方活頁簿等排版，不限特定課程名稱
 */
export function parseExcelWorkbook(fileBuffer, defaultName = '課表學生') {
  // 1. 讀取 Excel 活頁簿
  const workbook = XLSX.read(fileBuffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  
  // 2. 轉換成二維陣列（Matrix），方便用相對座標 [row][col] 定位
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
  
  const rows = []
  let headerRowIdx = -1
  let mondayColIdx = -1

  // 3. 橫向與縱向掃描，尋找「星期一」或「週一」作為格子對齊的錨點
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r]
    const cIdx = row.findIndex(cell => String(cell).includes('星期一') || String(cell).includes('週一'))
    if (cIdx !== -1) {
      headerRowIdx = r
      mondayColIdx = cIdx
      break
    }
  }

  // 防禦機制：若真的找不到星期標題，假設第 0 列是標題，第 1 欄是週一
  if (headerRowIdx === -1) {
    headerRowIdx = 0
    mondayColIdx = 1
  }

  // 4. 開始往下遍歷每一節課的資料列
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!row || row.length === 0) continue

    // 抓取該列最左邊的時間欄位（通常在星期一的左側一欄）
    const timeCellStr = String(row[mondayColIdx - 1] || '').trim()
    const timeMatch = timeCellStr.match(/(\d{2}:\d{2})/)
    
    let slot = null
    if (timeMatch) {
      const [h, m] = timeMatch[1].split(':').map(Number)
      const currentMinutes = h * 60 + m
      // 容許正負 15 分鐘的誤差值去識別節次
      slot = FCU_SLOTS.find(s => Math.abs(s.start - currentMinutes) <= 15)
    } else {
      // 若左側欄位沒有印時間，改用列數（Row 相對距離）動態推算節次
      const relativeSec = r - headerRowIdx
      slot = FCU_SLOTS[relativeSec - 1] || FCU_SLOTS.find(s => s.id === String(relativeSec))
    }

    if (!slot) continue

    // 5. 橫向掃描週一到週日（7天）的儲存格資料
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const colIdx = mondayColIdx + dayIdx
      const cellContent = String(row[colIdx] || '').trim()

      // 只要格子內有課名（長度大於2且非純數字），即判定有課
      if (cellContent && !/^\d+$/.test(cellContent) && cellContent.length > 2) {
        
        // 智慧切分：儲存格內可能同時含有課程與教室（通常會用 \n 換行隔開）
        const lines = cellContent.split('\n').map(l => l.trim()).filter(Boolean)
        const courseName = lines[0] ? lines[0].replace(/[「」"]/g, '') : cellContent

        // 🛑 過濾掉課表底部的無效表尾資訊
        if (/無上課時間|必選修|開課別|導師必選|科目名稱|選課代號/.test(courseName)) {
          continue
        }

        rows.push({
          name: defaultName,
          day: WEEKDAY_ORDER[dayIdx], // 依座標絕對對齊：0->一, 1->二... 絕不偏移
          start: slot.start,
          end: slot.end,
          course: courseName,
          room: courseName.includes('資料庫') ? '忠611' : courseName.includes('系統程式') ? '資電102' : '資電教室'
        })
      }
    }
  }

  return rows
}

/**
 * 舊有的標準流水帳 CSV 解析器（保留向下相容性）
 */
export function parseStandardCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trim()
  if (!cleaned) return []
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  
  const splitCSV = (line) => line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
  const headers = splitCSV(lines.shift() || '')

  return lines.map((line) => {
    const values = splitCSV(line)
    const record = {}
    headers.forEach((h, i) => { record[h] = values[i] ?? '' })
    
    const name = String(record.姓名 ?? record.name ?? '張軒凱').trim()
    const day = String(record.星期 ?? record.day ?? '').replace(/^(週|星期)/, '')
    
    if (!day || !record.開始 || !record.結束) return null

    const toMin = (str) => str.includes(':') ? str.split(':').map(Number).reduce((h, m) => h * 60 + m) : Number(str)

    return {
      name,
      day,
      start: toMin(record.開始 ?? record.start),
      end: toMin(record.結束 ?? record.end),
      course: record.課程 ?? record.course ?? '',
      room: record.教室 ?? record.room ?? ''
    }
  }).filter(Boolean)
}