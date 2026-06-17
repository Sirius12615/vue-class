<script setup>
import { computed, onMounted, ref } from 'vue'
import { parseImportedRows } from './scheduleParser.js'
import ScheduleGrid from './components/ScheduleGrid.vue'

const SAMPLE_CSV = `姓名,星期,開始,結束,課程,教室
林芷晴,一,09:00,11:00,資料結構,A301
林芷晴,三,13:30,15:00,網頁設計,B204
王柏宇,一,10:00,12:00,作業系統,C102
王柏宇,四,13:00,15:30,資料庫系統,D305
陳思妤,二,09:30,12:00,演算法,A201
陳思妤,四,10:00,12:00,專題討論,B108
周子安,三,08:30,10:30,程式設計基礎,C210
周子安,五,13:00,16:00,人工智慧,E101`

const SLOT_START = 8 * 60
const SLOT_END = 18 * 60
const SLOT_MINUTES = 30
const WEEKDAY_ORDER = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_LABELS = { 一: '週一', 二: '週二', 三: '週三', 四: '週四', 五: '週五', 六: '週六', 日: '週日' }

const rows = ref([])
const activeSource = ref('內建示範課表')
const statusText = ref('尚未連線')
const lastSyncText = ref('未同步')
const searchText = ref('')
const selectedName = ref('全部')
const uploadName = ref('')
const selectedPeople = ref([])
const matchRooms = ref([])
const currentPage = ref('control')

function createMatchRoom() {
  const id = `room-${Date.now()}`
  const room = { id, name: `媒合空間 ${matchRooms.value.length + 1}`, members: [...selectedPeople.value] }
  matchRooms.value.push(room)
  selectedPeople.value = []
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
  return parseImportedRows(text).map(normalizeRow).filter(Boolean)
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

function rowsToCSV(value) {
  const escapeCell = (cell) => {
    const text = String(cell ?? '')
    if (/[",\n]/.test(text)) {
      return `"${text.replaceAll('"', '""')}"`
    }
    return text
  }

  return [
    '姓名,星期,開始,結束,課程,教室',
    ...value.map((row) => [row.name, row.day, minutesToLabel(row.start), minutesToLabel(row.end), row.course, row.room].map(escapeCell).join(',')),
  ].join('\n')
}

function sortedDays() {
  return [...WEEKDAY_ORDER]
}

function createSlots() {
  const slots = []
  for (let minute = SLOT_START; minute < SLOT_END; minute += SLOT_MINUTES) {
    slots.push({ start: minute, end: minute + SLOT_MINUTES })
  }
  return slots
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

  for (const day of WEEKDAY_ORDER) {
    const occupied = used.get(day) || new Set()
    let openStart = null

    for (const slot of createSlots()) {
      const isFree = !occupied.has(slot.start)

      if (isFree && openStart === null) {
        openStart = slot.start
      }

      if ((!isFree || slot.end >= SLOT_END) && openStart !== null) {
        const closeAt = isFree && slot.end >= SLOT_END ? slot.end : slot.start
        freeIntervals.push({ day, start: openStart, end: closeAt })
        openStart = null
      }
    }
  }

  return freeIntervals
}

function durationLabel(minutes) {
  if (minutes < 60) {
    return `${minutes} 分鐘`
  }

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins === 0 ? `${hours} 小時` : `${hours} 小時 ${mins} 分鐘`
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

function overlapMinutes(left, right) {
  const leftMap = new Map(left.map((item) => [item.day, item]))
  const rightMap = new Map(right.map((item) => [item.day, item]))
  let total = 0

  for (const day of WEEKDAY_ORDER) {
    const leftItem = leftMap.get(day)
    const rightItem = rightMap.get(day)
    if (!leftItem || !rightItem) continue

    const start = Math.max(leftItem.start, rightItem.start)
    const end = Math.min(leftItem.end, rightItem.end)
    if (end > start) {
      total += end - start
    }
  }

  return total
}

function intervalText(interval) {
  return `${WEEKDAY_LABELS[interval.day] || interval.day} ${minutesToLabel(interval.start)}-${minutesToLabel(interval.end)}`
}

function summarizePerson(name, occupationMap, peopleMap) {
  const personalRows = peopleMap.get(name) || []
  const personalOccupation = new Map()

  for (const day of WEEKDAY_ORDER) {
    personalOccupation.set(day, new Set())
  }

  for (const row of personalRows) {
    const slots = personalOccupation.get(row.day)
    if (!slots) continue

    for (const slot of createSlots()) {
      if (slot.start < row.end && slot.end > row.start) {
        slots.add(slot.start)
      }
    }
  }

  const freeIntervals = buildFreeIntervalsForPerson(personalRows, personalOccupation)
  const availableMinutes = freeIntervals.reduce((total, interval) => total + interval.end - interval.start, 0)
  return {
    name,
    classCount: personalRows.length,
    freeIntervals,
    availableMinutes,
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
    const summary = summarizePerson(name, buildOccupationMap(rows.value), people)
    total += summary.freeIntervals.length
  }

  return total
})

const selectedSummary = computed(() => {
  if (selectedName.value === '全部') {
    return null
  }

  return summarizePerson(selectedName.value, buildOccupationMap(rows.value), peopleMap.value)
})

const selectedMatches = computed(() => {
  const people = availableNames.value
  if (!people.length) {
    return []
  }

  const target = selectedName.value === '全部' ? people[0] : selectedName.value
  const targetSummary = summarizePerson(target, buildOccupationMap(rows.value), peopleMap.value)

  return people
    .filter((name) => name !== target)
    .map((name) => {
      const summary = summarizePerson(name, buildOccupationMap(rows.value), peopleMap.value)
      const score = overlapMinutes(targetSummary.freeIntervals, summary.freeIntervals)
      const common = targetSummary.freeIntervals.filter((left) => summary.freeIntervals.some((right) => left.day === right.day && Math.min(left.end, right.end) > Math.max(left.start, right.start)))

      return {
        name,
        score,
        common,
        classCount: summary.classCount,
      }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
  })

const pairMatches = computed(() => {
  const people = availableNames.value
  const occupationMap = buildOccupationMap(rows.value)

  const summaries = new Map(
    people.map((name) => [name, summarizePerson(name, occupationMap, peopleMap.value)]),
  )

  const pairs = []
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const left = summaries.get(people[i])
      const right = summaries.get(people[j])
      const score = overlapMinutes(left.freeIntervals, right.freeIntervals)
      const common = left.freeIntervals.filter((item) => right.freeIntervals.some((other) => item.day === other.day && Math.min(item.end, other.end) > Math.max(item.start, other.start)))

      pairs.push({
        left: people[i],
        right: people[j],
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
    if (!rows.value.length) {
      loadSample()
    }
    statusText.value = '後端未啟動，已使用前端示範資料'
  }
}

function loadSample() {
  refreshRows(parseCSV(SAMPLE_CSV), '內建示範課表')
}

async function handleFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  uploadName.value = file.name
  const text = await file.text()
  const parsed = parseCSV(text)

  if (!parsed.length) {
    statusText.value = 'CSV 格式不正確'
    return
  }

  // If currently using built-in sample, remove it when user uploads their CSV
  if (activeSource.value === '內建示範課表' && rows.value.length) {
    rows.value = []
  }

  // Determine name conflicts between incoming rows and existing rows
  const existingNames = new Set(rows.value.map((r) => r.name))
  const incomingNames = [...new Set(parsed.map((r) => r.name))]
  const conflicts = incomingNames.filter((n) => existingNames.has(n))

  let toAppend = parsed.slice()

  if (conflicts.length) {
    const list = conflicts.slice(0, 20).join(', ')
    const more = conflicts.length > 20 ? `，等 ${conflicts.length - 20} 人` : ''
    const ok = window.confirm(`發現已存在學生：${list}${more}。按「確定」將覆蓋這些學生的舊資料；按「取消」則僅加入新學生的資料。`)

    if (ok) {
      const conflictSet = new Set(conflicts)
      rows.value = rows.value.filter((r) => !conflictSet.has(r.name))
    } else {
      const conflictSet = new Set(conflicts)
      toAppend = toAppend.filter((r) => !conflictSet.has(r.name))
    }
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
  const payload = rowsToCSV(rows.value)

  try {
    const response = await fetch('/api/schedules', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: payload,
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

function useSample() {
  loadSample()
  statusText.value = '已切換為示範資料'
}

onMounted(loadFromBackend)
</script>

<template>
  <div class="page-shell">
    <div class="ambient ambient-one"></div>
    <div class="ambient ambient-two"></div>

    <main class="layout">
      <nav style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
        <button @click.prevent="currentPage = 'control'" :class="['primary-button', currentPage === 'control' ? 'active' : '']">控制中心</button>
        <button @click.prevent="currentPage = 'demo'" :class="['secondary-button', currentPage === 'demo' ? 'active' : '']">示範課表</button>
        <div style="margin-left:auto;color:#b6c2db">目前頁面：{{ currentPage === 'control' ? '控制中心' : '示範課表' }}</div>
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
              上傳 CSV
              <input type="file" accept=".csv,text/csv" @change="handleFileChange">
            </label>
            <button class="secondary-button" type="button" @click="syncToBackend">同步到後端資料庫</button>
            <button class="ghost-button" type="button" @click="useSample">載入示範資料</button>
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
              <select v-model="selectedName" class="text-input">
                <option value="全部">全部</option>
                <option v-for="name in availableNames" :key="name" :value="name">{{ name }}</option>
              </select>
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
                  <td>{{ minutesToLabel(row.start) }} - {{ minutesToLabel(row.end) }}</td>
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
            <aside class="side-column">
              <article class="card note-card">
                <span class="eyebrow">媒合空間</span>
                <p>已建立的媒合空間清單：</p>
                <ul>
                  <li v-for="room in matchRooms" :key="room.id">{{ room.name }} — 成員：{{ room.members.join(', ') }}</li>
                </ul>
              </article>

              <article class="card note-card">
                <span class="eyebrow">課表示範圖</span>
                <ScheduleGrid :people="selectedPeople" :rows="rows" />
              </article>

            </aside>
              </div>
              <span class="subtle">{{ selectedSummary.classCount }} 堂課</span>
            </div>

            <p class="summary-line">可用空堂：約 {{ durationLabel(selectedSummary.availableMinutes) }}</p>

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
                  <span>{{ durationLabel(match.score) }}</span>
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
                  <span>{{ durationLabel(pair.score) }}</span>
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
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <button class="ghost-button" @click.prevent="currentPage = 'control'">← 返回控制中心</button>
          <h2 style="margin:0;color:#e8eefc">示範課表（放大檢視）</h2>
        </div>

        <div>
          <ScheduleGrid :people="availableNames" :rows="rows" :slotStart="5*60" :slotEnd="22*60" :slotStep="20" />
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

.secondary-button {
  background: rgba(96, 165, 250, 0.12);
  border-color: rgba(96, 165, 250, 0.24);
  color: #e7f0ff;
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
