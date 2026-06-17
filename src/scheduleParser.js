const WEEKDAY_ORDER = ['一', '二', '三', '四', '五', '六', '日']

function normalizeDay(value) {
  const raw = String(value ?? '').trim().replace(/^週/, '').replace(/^星期/, '')

  if (WEEKDAY_ORDER.includes(raw)) {
    return raw
  }

  const lower = raw.toLowerCase()
  const map = {
    mon: '一', monday: '一', tue: '二', tues: '二', tuesday: '二', wed: '三', weds: '三', wednesday: '三', thu: '四', thur: '四', thurs: '四', thursday: '四', fri: '五', friday: '五', sat: '六', saturday: '六', sun: '日', sunday: '日',
  }

  return map[lower] || raw
}

function normalizeTime(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [hours, minutes] = raw.split(':').map(Number)
    return hours * 60 + minutes
  }

  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, '0')
    const hours = Number(padded.slice(0, 2))
    const minutes = Number(padded.slice(2))
    return hours * 60 + minutes
  }

  const numeric = Number(raw)
  if (!Number.isNaN(numeric)) {
    return numeric
  }

  return null
}

function extractStudentName(text) {
  const match = text.match(/\/\s*([^\s(\/]+)(?:\s*\(|$)/)
  return match?.[1]?.trim() || '課表學生'
}

function extractQuotedCells(text) {
  const cells = []
  const pattern = /"((?:[^"]|"")*)"/g
  let match

  while ((match = pattern.exec(text)) !== null) {
    cells.push(match[1].replaceAll('""', '"'))
  }

  return cells
}

function splitCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  result.push(current.trim())
  return result
}

function normalizeRow(record, defaultName = '課表學生') {
  const name = String(record.姓名 ?? record.name ?? record.學生 ?? record.student ?? defaultName).trim() || defaultName
  const day = normalizeDay(record.星期 ?? record.day ?? '')
  const start = normalizeTime(record.開始 ?? record.start ?? '')
  const end = normalizeTime(record.結束 ?? record.end ?? '')

  if (!day || start === null || end === null || end <= start) {
    return null
  }

  return {
    name,
    day,
    start,
    end,
    course: String(record.課程 ?? record.course ?? '').trim(),
    room: String(record.教室 ?? record.room ?? '').trim(),
  }
}

function isTimeToken(value) {
  return /^\d{1,2}:\d{2}$/.test(String(value ?? '').trim())
}

function isPipeToken(value) {
  return String(value ?? '').trim() === '|'
}

function isRowNumberToken(value) {
  return /^\d+$/.test(String(value ?? '').trim())
}

function extractWeekdayOrder(headerText) {
  const chinese = [...headerText.matchAll(/星期([一二三四五六日])/g)].map((match) => match[1])
  if (chinese.length) {
    return chinese
  }

  const englishMatches = [...headerText.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)\b/gi)].map((match) => match[1].toLowerCase())
  const map = { mon: '一', tue: '二', wed: '三', thu: '四', fri: '五', sat: '六', sun: '日' }
  const english = englishMatches.map((key) => map[key]).filter(Boolean)
  return english.length ? english : WEEKDAY_ORDER
}

function isRoomFragment(text) {
  const value = String(text ?? '').trim()
  if (!value) return false
  if (/[()（）]/.test(value) && /[\u4e00-\u9fff]/.test(value) && !/資電|忠|教室|實習|人\d|V\d/.test(value)) {
    return false
  }

  return /資電|忠\d|人\d|教室|實習|共善樓|電腦實習室|V\d|[A-Z]\d{3,4}/.test(value)
}

function flushCourseBuffer(buffer, courseCells) {
  const cleaned = buffer.trim()
  if (cleaned) {
    courseCells.push(cleaned)
  }
}

function buildRowsFromSlot(fragments, start, end, weekdayOrder, defaultName) {
  const courseCells = []
  let roomText = ''
  let buffer = ''
  let collectingRooms = false

  for (const fragment of fragments) {
    const value = String(fragment ?? '').trim()
    if (!value || isRowNumberToken(value) || isPipeToken(value)) {
      continue
    }

    if (!collectingRooms && isRoomFragment(value)) {
      collectingRooms = true
      flushCourseBuffer(buffer, courseCells)
      buffer = ''
      roomText += value
      continue
    }

    if (collectingRooms) {
      roomText += value
      continue
    }

    buffer += value
    const hasTeacherParen = buffer.includes('(') || buffer.includes('（')
    const balance = (buffer.match(/[（(]/g) || []).length - (buffer.match(/[）)]/g) || []).length
    if (hasTeacherParen && balance <= 0 && /[)）]$/.test(buffer)) {
      flushCourseBuffer(buffer, courseCells)
      buffer = ''
    }
  }

  flushCourseBuffer(buffer, courseCells)

  const assignedDays = weekdayOrder.slice(0, Math.max(courseCells.length, 1))
  return courseCells.map((course, index) => ({
    name: defaultName,
    day: assignedDays[index] || assignedDays[assignedDays.length - 1] || WEEKDAY_ORDER[index] || '一',
    start,
    end,
    course,
    room: roomText,
  }))
}

function parseTimetableExport(text) {
  const cells = extractQuotedCells(text).map((cell) => cell.trim())
  const headerIndex = cells.findIndex((cell) => /星期[一二三四五六日]/.test(cell) || /\b(mon|tue|wed|thu|fri|sat|sun)\b/i.test(cell))

  if (headerIndex === -1) {
    return []
  }

  const weekdayOrder = extractWeekdayOrder(cells[headerIndex])
  const defaultName = extractStudentName(cells.slice(0, headerIndex + 2).join(' '))
  const scheduleCells = cells.slice(headerIndex + 1)
  const rows = []

  for (let index = 0; index < scheduleCells.length; index += 1) {
    const start = scheduleCells[index]
    const separator = scheduleCells[index + 1]
    const end = scheduleCells[index + 2]

    if (!isTimeToken(start) || !isPipeToken(separator) || !isTimeToken(end)) {
      continue
    }

    index += 2
    const fragments = []

    for (let cursor = index + 1; cursor < scheduleCells.length; cursor += 1) {
      const value = scheduleCells[cursor]
      if (isTimeToken(value) && isPipeToken(scheduleCells[cursor + 1]) && isTimeToken(scheduleCells[cursor + 2])) {
        index = cursor - 1
        break
      }

      if (!value || isRowNumberToken(value) || isPipeToken(value)) {
        continue
      }

      fragments.push(value)

      if (cursor === scheduleCells.length - 1) {
        index = cursor
      }
    }

    rows.push(...buildRowsFromSlot(fragments, normalizeTime(start), normalizeTime(end), weekdayOrder, defaultName))
  }

  return rows.filter((row) => row && row.day && row.start !== null && row.end !== null)
}

function parseStandardCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trim()

  if (!cleaned) {
    return []
  }

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const headers = splitCSVLine(lines.shift() || '')

  return lines.map((line) => {
    const values = splitCSVLine(line)
    const record = {}

    headers.forEach((header, index) => {
      record[header] = values[index] ?? ''
    })

    return normalizeRow(record)
  }).filter(Boolean)
}

export function parseImportedRows(text) {
  const cleaned = String(text ?? '').replace(/^\uFEFF/, '').trim()
  if (!cleaned) {
    return []
  }

  if (/星期[一二三四五六日]/.test(cleaned) && /\d{1,2}:\d{2}/.test(cleaned) && cleaned.includes('"')) {
    const timetableRows = parseTimetableExport(cleaned)
    if (timetableRows.length) {
      return timetableRows
    }
  }

  return parseStandardCSV(cleaned)
}
