<script setup>
import { computed, onMounted, ref } from 'vue'
import { parseStandardCSV, parseExcelWorkbook } from './scheduleParser.js'
import ScheduleGrid from './components/ScheduleGrid.vue'

const SLOT_START = 8 * 60
const SLOT_END = 18 * 60
const SLOT_MINUTES = 10
const WEEKDAY_ORDER = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_LABELS = { 一: '週一', 二: '週二', 三: '週三', 四: '週四', 五: '週五', 六: '週六', 日: '週日' }

const rows = ref([])
const activeSource = ref('無')
const statusText = ref('尚未載入課表，請從上方上傳課表')
const lastSyncText = ref('未同步')
const searchText = ref('')
const selectedName = ref('全部')
const uploadName = ref('')
const selectedPeople = ref([])
const matchRooms = ref([])
const selectedRoom = ref(null)
const currentPage = ref('control')

function createMatchRoom() {
  if (selectedPeople.value.length === 0) {
    alert('請先選取學生以建立媒合空間！')
    return
  }
  const id = `room-${Date.now()}`
  const room = { id, name: `媒合空間 ${matchRooms.value.length + 1}`, members: [...selectedPeople.value] }
  matchRooms.value.push(room)
  selectedPeople.value = []
  selectedRoom.value = room.id
  currentPage.value = 'demo'
  return room
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

function parseCSV(text) {
  return parseStandardCSV(text)
}

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
  if (typeof value === 'number') {
    return value
  }
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
    if (minutes < 60) {
      return hours * 60 + minutes
    }
  }

  const numeric = Number(raw)
  if (!Number.isNaN(numeric)) {
    return numeric
  }

  return null
}

function minutesToLabel(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mins = String(minutes % 60).padStart(2, '0')
  return `${hours}:${mins}`
}

function normalizeRow(record) {
  const name = String(record.姓名 ?? record.name ?? record.學生 ?? record.student ?? '').trim()
  const day = normalizeDay(record.星期 ?? record.day ?? '')
  const start = normalizeTime(record.開始 ?? record.start ?? '')
  const end = normalizeTime(record.結束 ?? record.end ?? '')

  if (!name || !day || start === null || end === null || end <= start) {
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



function sortedDays() {
  return [...WEEKDAY_ORDER]
}

function createSlots() {
  return [
    { start: 8 * 60 + 10,  end: 9 * 60 },       // 08:10~09:00 (第一節)
    { start: 9 * 60 + 10,  end: 10 * 60 },      // 09:10~10:00 (第二節)
    { start: 10 * 60 + 10, end: 11 * 60 },      // 10:10~11:00 (第三節)
    { start: 11 * 60 + 10, end: 12 * 60 },      // 11:10~12:00 (第四節)
    { start: 12 * 60 + 10, end: 13 * 60 + 10 }, // 12:10~13:10 (第五節/中午)
    { start: 13 * 60 + 10, end: 14 * 60 },      // 13:10~14:00 (第六節)
    { start: 14 * 60 + 10, end: 15 * 60 },      // 14:10~15:00 (第七節)
    { start: 15 * 60 + 10, end: 16 * 60 },      // 15:10~16:00 (第八節)
    { start: 16 * 60 + 10, end: 17 * 60 },      // 16:10~17:00 (第九節)
    { start: 17 * 60 + 10, end: 18 * 60 }       // 17:10~18:00 (第十節)
  ]
}

function mergeIntervals(intervals) {
  if (!intervals.length) {
    return []
  }

  const sorted = [...intervals].sort((left, right) => left.start - right.start)
  const merged = [sorted[0]]

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]
    const previous = merged[merged.length - 1]

    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end)
      continue
    }

    merged.push({ ...current })
  }

  return merged
}

function buildOccupationMap(value) {
  const map = new Map()

  for (const day of WEEKDAY_ORDER) {
    map.set(day, new Set())
  }

  for (const row of value) {
    const slots = map.get(row.day)
    if (!slots) continue

    for (const slot of createSlots()) {
      if (slot.start < row.end && slot.end > row.start) {
        slots.add(slot.start)
      }
    }
  }

  return map
}

function buildFreeIntervalsForPerson(personRows, occupationMap) {
  const freeIntervals = []
  const used = new Map(occupationMap)

  // 正常上課時間為週一至週五，排除週末
  const targetDays = WEEKDAY_ORDER.slice(0, 5)

  for (const day of targetDays) {
    const occupied = used.get(day) || new Set()
    let openStart = null
    let openEnd = null

    const daySlots = createAllDaySlots()

    for (let i = 0; i < daySlots.length; i++) {
      const slot = daySlots[i]
      const isFree = !occupied.has(slot.start)

      if (isFree) {
        if (openStart === null) {
          openStart = slot.start
        }
        openEnd = slot.end
      }

      if ((!isFree || i === daySlots.length - 1) && openStart !== null) {
        freeIntervals.push({ day, start: openStart, end: openEnd })
        openStart = null
        openEnd = null
      }
    }
  }

  return freeIntervals
}

function flattenRowsByName(value) {
  const people = new Map()

  for (const row of value) {
    if (!people.has(row.name)) {
      people.set(row.name, [])
    }
    people.get(row.name).push(row)
  }

  return people
}

function createAllDaySlots() {
  return [
    ...createSlots(),
    { start: 18 * 60 + 30, end: 19 * 60 + 20 }, // 18:30~19:20 (第十一節)
    { start: 19 * 60 + 25, end: 20 * 60 + 15 }, // 19:25~20:15 (第十二節)
    { start: 20 * 60 + 25, end: 21 * 60 + 15 }, // 20:25~21:15 (第十三節)
    { start: 21 * 60 + 20, end: 22 * 60 + 10 }  // 21:20~22:10 (第十四節)
  ]
}

function getMorningSlots() {
  return [
    { start: 8 * 60 + 10,  end: 9 * 60 },       // 08:10~09:00 (第一節)
    { start: 9 * 60 + 10,  end: 10 * 60 },      // 09:10~10:00 (第二節)
    { start: 10 * 60 + 10, end: 11 * 60 },      // 10:10~11:00 (第三節)
    { start: 11 * 60 + 10, end: 12 * 60 }       // 11:10~12:00 (第四節)
  ]
}

function getAfternoonSlots() {
  return [
    { start: 12 * 60 + 10, end: 13 * 60 + 10 }, // 12:10~13:10 (第五節/中午)
    { start: 13 * 60 + 10, end: 14 * 60 },      // 13:10~14:00 (第六節)
    { start: 14 * 60 + 10, end: 15 * 60 },      // 14:10~15:00 (第七節)
    { start: 15 * 60 + 10, end: 16 * 60 },      // 15:10~16:00 (第八節)
    { start: 16 * 60 + 10, end: 17 * 60 },      // 16:10~17:00 (第九節)
    { start: 17 * 60 + 10, end: 18 * 60 }       // 17:10~18:00 (第十節)
  ]
}

function getEveningSlots() {
  return [
    { start: 18 * 60 + 30, end: 19 * 60 + 20 }, // 18:30~19:20 (第十一節)
    { start: 19 * 60 + 25, end: 20 * 60 + 15 }, // 19:25~20:15 (第十二節)
    { start: 20 * 60 + 25, end: 21 * 60 + 15 }, // 20:25~21:15 (第十三節)
    { start: 21 * 60 + 20, end: 22 * 60 + 10 }  // 21:20~22:10 (第十四節)
  ]
}

function countFreePeriods(personRows, slotsList) {
  let count = 0
  const targetDays = WEEKDAY_ORDER.slice(0, 5) // Monday to Friday

  for (const day of targetDays) {
    const dayRows = personRows.filter(r => r.day === day)
    for (const slot of slotsList) {
      const isOccupied = dayRows.some(row => slot.start < row.end && slot.end > row.start)
      if (!isOccupied) {
        count++
      }
    }
  }
  return count
}

function countCommonFreePeriods(leftRows, rightRows, slotsList) {
  let count = 0
  const targetDays = WEEKDAY_ORDER.slice(0, 5) // Monday to Friday

  for (const day of targetDays) {
    const leftDayRows = leftRows.filter(r => r.day === day)
    const rightDayRows = rightRows.filter(r => r.day === day)
    for (const slot of slotsList) {
      const leftOccupied = leftDayRows.some(row => slot.start < row.end && slot.end > row.start)
      const rightOccupied = rightDayRows.some(row => slot.start < row.end && slot.end > row.start)
      if (!leftOccupied && !rightOccupied) {
        count++
      }
    }
  }
  return count
}

function buildCommonFreeIntervals(leftRows, rightRows) {
  const freeIntervals = []
  const targetDays = WEEKDAY_ORDER.slice(0, 5)

  for (const day of targetDays) {
    const leftDayRows = leftRows.filter(r => r.day === day)
    const rightDayRows = rightRows.filter(r => r.day === day)
    let openStart = null
    let openEnd = null

    const daySlots = createAllDaySlots()

    for (let i = 0; i < daySlots.length; i++) {
      const slot = daySlots[i]
      const leftOccupied = leftDayRows.some(row => slot.start < row.end && slot.end > row.start)
      const rightOccupied = rightDayRows.some(row => slot.start < row.end && slot.end > row.start)
      const isCommonFree = !leftOccupied && !rightOccupied

      if (isCommonFree) {
        if (openStart === null) {
          openStart = slot.start
        }
        openEnd = slot.end
      }

      if ((!isCommonFree || i === daySlots.length - 1) && openStart !== null) {
        freeIntervals.push({ day, start: openStart, end: openEnd })
        openStart = null
        openEnd = null
      }
    }
  }

  return freeIntervals
}

function intervalText(interval) {
  return `${WEEKDAY_LABELS[interval.day] || interval.day} ${minutesToLabel(interval.start)} 到 ${minutesToLabel(interval.end)}`
}

function summarizePerson(name, occupationMap, peopleMap) {
  const personalRows = peopleMap.get(name) || []
  
  const freePeriodsMorning = countFreePeriods(personalRows, getMorningSlots())
  const freePeriodsAfternoon = countFreePeriods(personalRows, getAfternoonSlots())
  const freePeriodsEvening = countFreePeriods(personalRows, getEveningSlots())
  
  const personalOccupation = new Map()
  for (const day of WEEKDAY_ORDER) {
    personalOccupation.set(day, new Set())
  }
  for (const row of personalRows) {
    const slots = personalOccupation.get(row.day)
    if (!slots) continue
    for (const slot of createAllDaySlots()) {
      if (slot.start < row.end && slot.end > row.start) {
        slots.add(slot.start)
      }
    }
  }

  const freeIntervals = buildFreeIntervalsForPerson(personalRows, personalOccupation)

  return {
    name,
    classCount: personalRows.length,
    freeIntervals,
    freePeriodsMorning,
    freePeriodsAfternoon,
    freePeriodsEvening
  }
}

function refreshRows(value, sourceLabel) {
  rows.value = value.map(normalizeRow).filter(Boolean)
  activeSource.value = sourceLabel
  statusText.value = '已載入'
  lastSyncText.value = new Date().toLocaleString('zh-TW')

  const names = availableNames.value
  if (!names.includes(selectedName.value)) {
    selectedName.value = names[0] || '全部'
  }
}

const availableNames = computed(() => {
  return [...new Set(rows.value.map((row) => row.name))].sort((left, right) => left.localeCompare(right, 'zh-Hant'))
})

const filteredRows = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    const matchesKeyword = !keyword || [row.name, row.course, row.room, WEEKDAY_LABELS[row.day] || row.day].some((text) => String(text).toLowerCase().includes(keyword))
    const matchesSelection = selectedName.value === '全部' || row.name === selectedName.value
    return matchesKeyword && matchesSelection
  })
})

function toggleSelectPerson(name) {
  const idx = selectedPeople.value.indexOf(name)
  if (idx === -1) selectedPeople.value.push(name)
  else selectedPeople.value.splice(idx, 1)
}

const peopleMap = computed(() => flattenRowsByName(rows.value))

const totalClasses = computed(() => rows.value.length)

const totalPeople = computed(() => availableNames.value.length)

const totalEmptyBlocks = computed(() => {
  const people = peopleMap.value
  let total = 0

  for (const name of availableNames.value) {
    const summary = summarizePerson(name, null, people)
    total += summary.freeIntervals.length
  }

  return total
})

const selectedSummary = computed(() => {
  if (selectedName.value === '全部') {
    return null
  }

  return summarizePerson(selectedName.value, null, peopleMap.value)
})

const selectedMatches = computed(() => {
  const people = availableNames.value
  if (!people.length) {
    return []
  }

  const target = selectedName.value === '全部' ? people[0] : selectedName.value
  const targetRows = peopleMap.value.get(target) || []

  return people
    .filter((name) => name !== target)
    .map((name) => {
      const otherRows = peopleMap.value.get(name) || []
      const score = countCommonFreePeriods(targetRows, otherRows, createAllDaySlots())
      const common = buildCommonFreeIntervals(targetRows, otherRows)

      return {
        name,
        score,
        common,
        classCount: otherRows.length,
      }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
})

const demoPagePeople = computed(() => {
  if (!selectedRoom.value) {
    return availableNames.value
  }
  const room = matchRooms.value.find((r) => r.id === selectedRoom.value)
  return room ? room.members : []
})

const demoPageRows = computed(() => {
  const people = new Set(demoPagePeople.value)
  return rows.value.filter((row) => people.has(row.name))
})

const pairMatches = computed(() => {
  const people = availableNames.value

  const pairs = []
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const leftName = people[i]
      const rightName = people[j]
      const leftRows = peopleMap.value.get(leftName) || []
      const rightRows = peopleMap.value.get(rightName) || []
      
      const score = countCommonFreePeriods(leftRows, rightRows, createAllDaySlots())
      const common = buildCommonFreeIntervals(leftRows, rightRows)

      pairs.push({
        left: leftName,
        right: rightName,
        score,
        common,
      })
    }
  }

  return pairs.sort((left, right) => right.score - left.score).slice(0, 6)
})

async function loadFromBackend() {
  try {
    const response = await fetch('/api/schedules')
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const payload = await response.json()
    refreshRows(Array.isArray(payload.rows) ? payload.rows : [], '後端資料庫')
    statusText.value = '後端連線成功'
  } catch {
    statusText.value = '尚未載入課表，請從上方上傳課表'
  }
}

async function handleFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  uploadName.value = file.name
  
  let parsed = []
  try {
    // 判斷是否為 Excel 檔
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const buffer = await file.arrayBuffer()
      // 假設檔名去掉副檔名就是該學生的名字
      const studentName = file.name.replace(/\.[^/.]+$/, "") 
      parsed = parseExcelWorkbook(buffer, studentName)
    } else {
      // 保留對舊版 CSV 的支援
      const text = await file.text()
      parsed = parseStandardCSV(text)
    }
  } catch (error) {
    console.error("檔案解析失敗:", error)
    statusText.value = '檔案格式不正確或解析失敗'
    return
  }

  if (!parsed.length) {
    statusText.value = '找不到有效的課表資料'
    return
  }



  // Determine name conflicts between incoming rows and existing rows
  const existingNames = new Set(rows.value.map((r) => r.name))
  const incomingNames = [...new Set(parsed.map((r) => r.name))]
  const conflicts = incomingNames.filter((n) => existingNames.has(n))

  let toAppend = parsed.slice()

  if (conflicts.length) {
    const toRemoveFromExisting = new Set()
    const renameMap = new Map()

    for (const conflictName of conflicts) {
      const input = window.prompt(
        `發現系統中已存在名為「${conflictName}」的學生。\n\n` +
        `1. 若此檔案是其他同學：請輸入新別名（例如：${conflictName} (2) 或 ${conflictName}-乙班 等）。\n` +
        `2. 若您想覆蓋舊課表：請清空此對話框，點選確定即可。\n` +
        `3. 若您想取消此次動作：請點選取消。`,
        `${conflictName} (2)`
      )

      if (input === null) {
        renameMap.set(conflictName, 'SKIP')
      } else {
        const trimmed = input.trim()
        if (trimmed === '' || trimmed === conflictName) {
          renameMap.set(conflictName, 'OVERWRITE')
          toRemoveFromExisting.add(conflictName)
        } else {
          renameMap.set(conflictName, trimmed)
        }
      }
    }

    if (toRemoveFromExisting.size > 0) {
      rows.value = rows.value.filter((r) => !toRemoveFromExisting.has(r.name))
    }

    const toAppendFiltered = []
    for (const r of toAppend) {
      if (renameMap.has(r.name)) {
        const action = renameMap.get(r.name)
        if (action === 'SKIP') {
          continue
        } else if (action === 'OVERWRITE') {
          toAppendFiltered.push(r)
        } else {
          toAppendFiltered.push({ ...r, name: action })
        }
      } else {
        toAppendFiltered.push(r)
      }
    }
    toAppend = toAppendFiltered
  }

  // Append the (possibly filtered) incoming rows
  for (const r of toAppend) rows.value.push(r)

  activeSource.value = `上傳檔案：${file.name}`
  statusText.value = `已讀入 ${toAppend.length} 筆 (衝突: ${conflicts.length})`

  // adjust selection if necessary
  const names = availableNames.value
  if (!names.includes(selectedName.value)) {
    selectedName.value = names[0] || '全部'
  }
}

async function syncToBackend() {
  try {
    const response = await fetch('/api/schedules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rows: rows.value }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const result = await response.json()
    lastSyncText.value = new Date().toLocaleString('zh-TW')
    statusText.value = `已同步至後端資料庫，共 ${result.count} 筆`
  } catch {
    statusText.value = '同步失敗，請確認後端是否啟動'
  }
}



function deletePerson(name) {
  if (name === '全部' || !name) return
  if (!window.confirm(`確定要刪除「${name}」的所有課表資料嗎？此操作無法復原。`)) return

  rows.value = rows.value.filter((r) => r.name !== name)

  if (selectedName.value === name) {
    selectedName.value = '全部'
  }
  selectedPeople.value = selectedPeople.value.filter((n) => n !== name)

  statusText.value = `已刪除學生：${name}`
}

onMounted(loadFromBackend)
</script>

<template>
  <div class="page-shell">
    <div class="ambient ambient-one"></div>
    <div class="ambient ambient-two"></div>

    <main class="layout">
      <nav style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
        <button @click.prevent="currentPage = 'control'" :class="currentPage === 'control' ? 'primary-button active' : 'ghost-button'">控制中心</button>
        <button @click.prevent="currentPage = 'demo'" :class="currentPage === 'demo' ? 'primary-button active' : 'ghost-button'">模擬課表</button>
        <div style="margin-left:auto;color:#b6c2db">目前頁面：{{ currentPage === 'control' ? '控制中心' : '模擬課表' }}</div>
      </nav>

      <section v-if="currentPage === 'control'" class="hero card">
        <div class="hero-copy">
          <span class="eyebrow">空堂媒合系統</span>
          <h1>用 CSV 課表，自動找出可一起約課的空堂。</h1>
          <p>
            這是一個以 Vue 與純 JavaScript 建立的全端範例，前端負責讀取與分析 CSV，後端負責保存課表資料，資料庫則以 CSV 檔呈現。
          </p>

          <div class="hero-actions">
            <label class="primary-button">
              上傳課表 (Excel / CSV)
              <input type="file" accept=".xlsx,.xls,.csv,text/csv" @change="handleFileChange">
            </label>
            <button class="secondary-button" type="button" @click="syncToBackend">同步到後端資料庫</button>
          </div>

          <div class="status-row">
            <span class="status-pill">狀態：{{ statusText }}</span>
            <span class="status-pill muted">來源：{{ activeSource }}</span>
            <span class="status-pill muted">最後同步：{{ lastSyncText }}</span>
          </div>
        </div>

        <div class="hero-panel">
          <div class="panel-header">
            <strong>CSV 格式</strong>
            <span>姓名,星期,開始,結束,課程,教室</span>
          </div>

          <div class="panel-grid">
            <div>
              <label>搜尋</label>
              <input v-model="searchText" class="text-input" type="text" placeholder="搜尋姓名、課程、教室或星期">
            </div>
            <div>
              <label>媒合對象</label>
              <div style="display:flex;gap:8px;">
                <select v-model="selectedName" class="text-input">
                  <option value="全部">全部</option>
                  <option v-for="name in availableNames" :key="name" :value="name">{{ name }}</option>
                </select>
                <button v-if="selectedName !== '全部'" 
                        class="secondary-button" 
                        style="border-color:rgba(239,68,68,0.4);color:#f87171;min-height:42px;padding:0 12px;background:rgba(239,68,68,0.1)"
                        @click="deletePerson(selectedName)">
                  刪除
                </button>
              </div>
            </div>
          </div>

          <div style="margin-top:10px;">
            <label style="display:block;margin-bottom:6px;color:#9eb0d1">選取多名顯示課表</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button v-for="name in availableNames" :key="name" @click.prevent="toggleSelectPerson(name)" :class="['primary-button', selectedPeople.includes(name) ? 'selected' : '']" style="padding:6px 10px;min-height:34px;background:transparent;border:1px solid rgba(148,163,184,0.12);color:#cfe6ff">
                {{ name }}
              </button>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px">
              <button class="secondary-button" @click.prevent="createMatchRoom">建立媒合空間</button>
              <span class="status-pill muted">已選 {{ selectedPeople.length }} 人</span>
            </div>
          </div>

          <div class="metric-grid">
            <article class="metric-card">
              <span>課堂筆數</span>
              <strong>{{ totalClasses }}</strong>
            </article>
            <article class="metric-card">
              <span>學生人數</span>
              <strong>{{ totalPeople }}</strong>
            </article>
            <article class="metric-card">
              <span>空堂區段</span>
              <strong>{{ totalEmptyBlocks }}</strong>
            </article>
          </div>
        </div>
      </section>

      <section v-if="currentPage === 'control'" class="content-grid">
        <article class="card table-card">
          <div class="section-heading">
            <div>
              <span class="eyebrow">課表資料庫</span>
              <h2>課堂明細</h2>
            </div>
            <span class="subtle">目前顯示 {{ filteredRows.length }} 筆</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>星期</th>
                  <th>時間</th>
                  <th>課程</th>
                  <th>教室</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in filteredRows" :key="`${row.name}-${row.day}-${row.start}-${row.course}`">
                  <td>{{ row.name }}</td>
                  <td>{{ WEEKDAY_LABELS[row.day] || row.day }}</td>
                  <td>{{ minutesToLabel(row.start) }} 到 {{ minutesToLabel(row.end) }}</td>
                  <td>{{ row.course || '—' }}</td>
                  <td>{{ row.room || '—' }}</td>
                </tr>

                <tr v-if="!filteredRows.length">
                  <td colspan="5" class="empty-state">找不到符合條件的課程資料。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <aside class="side-column">
          <article class="card match-card" v-if="selectedSummary">
            <div class="section-heading compact">
              <div>
                <span class="eyebrow">個人空堂</span>
                <h2>{{ selectedName }}</h2>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="subtle">{{ selectedSummary.classCount }} 堂課</span>
                <button class="ghost-button" 
                        style="color:#f87171;border-color:rgba(239,68,68,0.2);font-size:0.8rem;padding:2px 8px;min-height:auto;"
                        @click="deletePerson(selectedName)">
                  刪除此人
                </button>
              </div>
            </div>

            <p class="summary-line">
              可用空堂：上午 <strong>{{ selectedSummary.freePeriodsMorning }}</strong> 節 / 下午 <strong>{{ selectedSummary.freePeriodsAfternoon }}</strong> 節 / 晚上 <strong>{{ selectedSummary.freePeriodsEvening }}</strong> 節
            </p>

            <div class="chip-list">
              <span v-for="interval in selectedSummary.freeIntervals.slice(0, 8)" :key="`${interval.day}-${interval.start}`" class="chip">
                {{ intervalText(interval) }}
              </span>
            </div>

            <div class="match-list">
              <h3>推薦媒合對象</h3>
              <div v-for="match in selectedMatches" :key="match.name" class="match-row">
                <div>
                  <strong>{{ match.name }}</strong>
                  <p>{{ match.classCount }} 堂課</p>
                </div>
                 <div class="match-score">
                  <span>{{ match.score }} 節</span>
                  <small>共同空堂</small>
                </div>
              </div>
            </div>
          </article>

          <article class="card match-card" v-else>
            <div class="section-heading compact">
              <div>
                <span class="eyebrow">整體媒合</span>
                <h2>最佳配對</h2>
              </div>
              <span class="subtle">全班排序</span>
            </div>

            <div class="match-list">
              <div v-for="pair in pairMatches" :key="`${pair.left}-${pair.right}`" class="match-row">
                <div>
                  <strong>{{ pair.left }} ＋ {{ pair.right }}</strong>
                  <p>{{ pair.common.length }} 個共同空堂區段</p>
                </div>
                <div class="match-score">
                  <span>{{ pair.score }} 節</span>
                  <small>可共同安排</small>
                </div>
              </div>
            </div>
          </article>

          <article class="card note-card">
            <span class="eyebrow">資料說明</span>
            <p>請使用 CSV 欄位：姓名、星期、開始、結束、課程、教室。星期可填一到日，也可使用 Monday 等英文格式。</p>
          </article>
        </aside>
      </section>

      <section v-else class="card" style="padding:20px;border-radius:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px;">
            <button class="ghost-button" @click.prevent="currentPage = 'control'">← 返回控制中心</button>
            <h2 style="margin:0;color:#e8eefc">模擬課表</h2>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <label style="color:#9eb0d1;font-size:0.9rem;">目前顯示：</label>
            <select v-model="selectedRoom" class="text-input" style="width:200px;">
              <option :value="null">所有學生</option>
              <option v-for="room in matchRooms" :key="room.id" :value="room.id">{{ room.name }}</option>
            </select>
          </div>
        </div>

        <div>
          <ScheduleGrid :people="demoPagePeople" :rows="demoPageRows" :slotStart="5*60" :slotEnd="22*60" :slotStep="10" />
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background:
    radial-gradient(circle at top left, rgba(93, 95, 255, 0.18), transparent 26%),
    radial-gradient(circle at right bottom, rgba(22, 160, 133, 0.18), transparent 28%),
    linear-gradient(180deg, #07111f 0%, #0d1730 100%);
  color: #ecf2ff;
}

:global(button),
:global(input),
:global(select) {
  font: inherit;
}

.page-shell {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
}

.ambient {
  position: absolute;
  border-radius: 999px;
  filter: blur(30px);
  opacity: 0.7;
  pointer-events: none;
}

.ambient-one {
  top: -80px;
  left: -60px;
  width: 240px;
  height: 240px;
  background: rgba(88, 114, 255, 0.28);
}

.ambient-two {
  right: -40px;
  bottom: 80px;
  width: 200px;
  height: 200px;
  background: rgba(18, 185, 149, 0.22);
}

.layout {
  position: relative;
  z-index: 1;
  width: min(1200px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 48px;
}

.card {
  background: rgba(11, 18, 34, 0.74);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(18px);
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.9fr);
  gap: 24px;
  padding: 28px;
  border-radius: 28px;
}

.hero-copy h1 {
  margin: 12px 0 16px;
  font-size: clamp(2rem, 4vw, 3.7rem);
  line-height: 1.06;
}

.hero-copy p {
  margin: 0;
  color: #b9c5df;
  line-height: 1.75;
  max-width: 58ch;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.12);
  color: #8fc6ff;
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 24px 0 18px;
}

.primary-button,
.secondary-button,
.ghost-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 16px;
  border-radius: 14px;
  border: 1px solid transparent;
  transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
  cursor: pointer;
}

.primary-button:hover,
.secondary-button:hover,
.ghost-button:hover {
  transform: translateY(-1px);
}

.primary-button {
  background: linear-gradient(135deg, #5b8cff, #7b61ff);
  color: #fff;
  font-weight: 700;
}

.primary-button.active {
  background: linear-gradient(135deg, #60a5fa, #818cf8);
  box-shadow: 0 0 20px rgba(96, 165, 250, 0.4);
}

.secondary-button {
  background: rgba(96, 165, 250, 0.12);
  border-color: rgba(96, 165, 250, 0.24);
  color: #e7f0ff;
}

.secondary-button.active {
  background: linear-gradient(135deg, #60a5fa, #818cf8);
  border-color: rgba(96, 165, 250, 0.6);
  color: #fff;
  box-shadow: 0 0 20px rgba(96, 165, 250, 0.4);
}

.ghost-button {
  background: transparent;
  border-color: rgba(148, 163, 184, 0.24);
  color: #c6d2ea;
}

.primary-button input {
  display: none;
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.status-pill {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.1);
  color: #e8eefc;
  font-size: 0.88rem;
}

.status-pill.muted {
  color: #b6c2db;
}

.hero-panel {
  display: grid;
  gap: 16px;
  align-content: start;
  padding: 20px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.panel-header,
.section-heading,
.compact {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.panel-header span,
.subtle {
  color: #9eb0d1;
  font-size: 0.92rem;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.panel-grid label {
  display: block;
  margin-bottom: 8px;
  color: #9eb0d1;
  font-size: 0.9rem;
}

.text-input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(7, 13, 24, 0.72);
  color: #eff4ff;
  outline: none;
}

.text-input:focus {
  border-color: rgba(99, 179, 255, 0.6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.metric-card {
  padding: 16px;
  border-radius: 18px;
  background: rgba(7, 13, 24, 0.48);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.metric-card span {
  display: block;
  margin-bottom: 8px;
  color: #9eb0d1;
  font-size: 0.92rem;
}

.metric-card strong {
  font-size: 1.6rem;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(310px, 0.85fr);
  gap: 24px;
  margin-top: 24px;
}

.table-card,
.match-card,
.note-card {
  border-radius: 24px;
  padding: 22px;
}

.table-wrap {
  overflow: auto;
  margin-top: 18px;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 620px;
}

th,
td {
  padding: 14px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

th {
  color: #98acd0;
  font-weight: 600;
}

td {
  color: #edf3ff;
}

.empty-state {
  text-align: center;
  color: #9eb0d1;
  padding: 28px 12px;
}

.side-column {
  display: grid;
  gap: 24px;
}

.summary-line {
  margin: 14px 0 16px;
  color: #dbe7ff;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.chip {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(91, 140, 255, 0.12);
  border: 1px solid rgba(91, 140, 255, 0.18);
  color: #e5edff;
  font-size: 0.9rem;
}

.match-list {
  margin-top: 20px;
}

.match-list h3 {
  margin: 0 0 14px;
  font-size: 1rem;
}

.match-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.match-row:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.match-row p {
  margin: 4px 0 0;
  color: #9eb0d1;
  font-size: 0.9rem;
}

.match-score {
  text-align: right;
}

.match-score span {
  display: block;
  color: #86ffc8;
  font-weight: 700;
}

.match-score small {
  color: #9eb0d1;
}

.note-card p {
  margin: 10px 0 0;
  line-height: 1.75;
  color: #b9c5df;
}

@media (max-width: 980px) {
  .hero,
  .content-grid {
    grid-template-columns: 1fr;
  }

  .metric-grid,
  .panel-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .layout {
    width: min(100% - 20px, 1200px);
    padding: 20px 0 28px;
  }

  .hero,
  .table-card,
  .match-card,
  .note-card {
    padding: 18px;
    border-radius: 22px;
  }

  .hero-actions {
    flex-direction: column;
  }

  .primary-button,
  .secondary-button,
  .ghost-button {
    width: 100%;
  }
}
</style>

