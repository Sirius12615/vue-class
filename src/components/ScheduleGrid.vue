<template>
  <div class="schedule-shell">
    <div class="legend-container">
      <!-- 狀態顏色對照 -->
      <div class="status-legend">
        <div class="legend-item">
          <span class="swatch swatch-green"></span>
          <small>無重疊 (1人)</small>
        </div>
        <div class="legend-item" v-if="people.length > 2">
          <span class="swatch swatch-yellow"></span>
          <small>部分重疊</small>
        </div>
        <div class="legend-item" v-if="people.length > 1">
          <span class="swatch swatch-red"></span>
          <small>全部重疊 ({{ people.length }}人)</small>
        </div>
      </div>
      <!-- 已選學生列表（無顏色圖例） -->
      <div class="people-legend" v-if="people.length">
        <span class="people-title">已選學生：</span>
        <span v-for="name in people" :key="name" class="person-tag">{{ name }}</span>
      </div>
    </div>

    <div class="grid-wrapper">
      <div class="header-row">
        <div class="time-header"></div>
        <div class="days-headers">
          <div v-for="day of days" :key="day" class="day-header">{{ dayLabel(day) }}</div>
        </div>
      </div>

      <div class="grid">
        <div class="time-col">
          <div v-for="slot in slots" :key="slot.id" class="time-cell">
            <div class="slot-number">{{ slot.id }}</div>
            <div class="slot-range">{{ slot.label }}</div>
          </div>
        </div>

        <div class="days-col">
          <div class="day-columns">
            <div v-for="day of days" :key="day" class="day-column">
              <div v-for="slot in slots" :key="slot.id" class="grid-cell"></div>

              <div class="blocks">
                <div v-for="block in blocksForDay(day)" :key="`${block.name}-${block.start}-${block.course}`"
                  :class="['person-block', { 'has-overlap': block.overlapCount > 1 }]"
                  :title="`${block.name} ${minutesToLabel(block.start)} 到 ${minutesToLabel(block.end)}\n${block.course || ''}`"
                  :style="blockStyle(block)">
                  <div class="block-label">{{ block.name }}</div>
                  <div class="block-course" v-if="block.course">{{ block.course }}</div>
                  <div class="block-time">{{ minutesToLabel(block.start) }}-{{ minutesToLabel(block.end) }}</div>
                  <div v-if="block.overlapCount > 1" class="overlap-badge" :title="`有 ${block.overlapCount} 個人在此時段有課`">
                    👥 {{ block.overlapCount }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  people: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },
})

const WEEKDAY_ORDER = ['一', '二', '三', '四', '五', '六', '日']

function minutesToLabel(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mins = String(minutes % 60).padStart(2, '0')
  return `${hours}:${mins}`
}



// 🎯 核心修正 1：寫死逢甲官方標準節次時間對照表（精確到分鐘數）
const slots = computed(() => [
  { id: '1',  start: 8 * 60 + 10,  end: 9 * 60,       label: '08:10~09:00' },
  { id: '2',  start: 9 * 60 + 10,  end: 10 * 60,      label: '09:10~10:00' },
  { id: '3',  start: 10 * 60 + 10, end: 11 * 60,      label: '10:10~11:00' },
  { id: '4',  start: 11 * 60 + 10, end: 12 * 60,      label: '11:10~12:00' },
  { id: '5',  start: 12 * 60 + 10, end: 13 * 60 + 10, label: '12:10~13:10' }, // 👈 逢甲中午是 60 分鐘
  { id: '6',  start: 13 * 60 + 10, end: 14 * 60,      label: '13:10~14:00' }, // 👈 與第五節無縫接軌
  { id: '7',  start: 14 * 60 + 10, end: 15 * 60,      label: '14:10~15:00' },
  { id: '8',  start: 15 * 60 + 10, end: 16 * 60,      label: '15:10~16:00' },
  { id: '9',  start: 16 * 60 + 10, end: 17 * 60,      label: '16:10~17:00' },
  { id: '10', start: 17 * 60 + 10, end: 18 * 60,      label: '17:10~18:00' },
  { id: '11', start: 18 * 60 + 30, end: 19 * 60 + 20, label: '18:30~19:20' }, // 夜間進修節次防禦
  { id: '12', start: 19 * 60 + 25, end: 20 * 60 + 15, label: '19:25~20:15' },
  // 🎯 補上第 13、14 節，這樣深夜的課程就不會溢出了
  { id: '13', start: 20 * 60 + 25, end: 21 * 60 + 15, label: '20:25~21:15' },
  { id: '14', start: 21 * 60 + 20, end: 22 * 60 + 10, label: '21:20~22:10' }
])

// 🎯 核心修正 2：根據精確的節次時間算位置，不再用模糊的連續線性時間
function timeToGridIndex(minutes) {
  const sList = slots.value
  if (!sList.length) return 0

  if (minutes <= sList[0].start) return 0

  for (let i = 0; i < sList.length; i++) {
    const currentSlot = sList[i]
    
    // 落在該節次內
    if (minutes >= currentSlot.start && minutes <= currentSlot.end) {
      const slotProgress = (minutes - currentSlot.start) / (currentSlot.end - currentSlot.start)
      return i + slotProgress
    }
    
    // 落在節次與節次之間的下課休息時間
    if (i < sList.length - 1) {
      const nextSlot = sList[i + 1]
      if (minutes > currentSlot.end && minutes < nextSlot.start) {
        // 直接無縫貼齊下一節的開頭
        return i + 1
      }
    }
  }
  
  return sList.length
}

const days = computed(() => {
  const hasWeekend = props.rows.some(r => r.day === '六' || r.day === '日')
  return hasWeekend ? WEEKDAY_ORDER : WEEKDAY_ORDER.slice(0, 5)
})

function dayLabel(day) {
  const map = { 一: '週一', 二: '週二', 三: '週三', 四: '週四', 五: '週五', 六: '週六', 日: '週日' }
  return map[day] || day
}

const personMap = computed(() => {
  const m = new Map()
  for (const name of props.people) m.set(name, [])
  for (const row of props.rows) {
    if (!m.has(row.name)) continue
    m.get(row.name).push(row)
  }
  return m
})

function layoutBlocks(blocks) {
  if (blocks.length === 0) return []

  // Sort blocks by start time, then duration descending
  const sorted = [...blocks].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return (b.end - b.start) - (a.end - a.start)
  })

  const clusters = []
  let currentCluster = []
  let clusterEnd = 0

  for (const b of sorted) {
    if (currentCluster.length === 0) {
      currentCluster.push(b)
      clusterEnd = b.end
    } else if (b.start < clusterEnd) {
      currentCluster.push(b)
      clusterEnd = Math.max(clusterEnd, b.end)
    } else {
      clusters.push(currentCluster)
      currentCluster = [b]
      clusterEnd = b.end
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster)
  }

  for (const cluster of clusters) {
    const columns = []
    for (const b of cluster) {
      let colIdx = 0
      while (true) {
        if (colIdx >= columns.length) {
          columns.push([])
        }
        const overlaps = columns[colIdx].some(o => b.start < o.end && b.end > o.start)
        if (!overlaps) {
          columns[colIdx].push(b)
          b.colIdx = colIdx
          break
        }
        colIdx++
      }
    }
    
    const totalCols = columns.length
    for (const b of cluster) {
      b.totalCols = totalCols
    }
  }
  
  return sorted
}

function blocksForDay(day) {
  const blocks = []
  for (const [name, rows] of personMap.value) {
    for (const r of rows.filter((x) => x.day === day)) {
      blocks.push({ name, start: r.start, end: r.end, course: r.course })
    }
  }

  // Calculate maximum simultaneous overlapping courses count for each block
  const blocksWithOverlap = blocks.map(b => {
    const checkTimes = new Set([b.start])
    for (const o of blocks) {
      if (o.start > b.start && o.start < b.end) {
        checkTimes.add(o.start)
      }
    }
    
    let maxCount = 0
    for (const t of checkTimes) {
      const peopleAtTime = new Set()
      for (const o of blocks) {
        if (t >= o.start && t < o.end) {
          peopleAtTime.add(o.name)
        }
      }
      if (peopleAtTime.size > maxCount) {
        maxCount = peopleAtTime.size
      }
    }
    return {
      ...b,
      overlapCount: maxCount
    }
  })

  return layoutBlocks(blocksWithOverlap)
}

function getBlockBgColor(overlapCount, totalPeople) {
  if (overlapCount <= 1) {
    // 只有一個人時顯示綠色 (Sleek emerald green)
    return 'hsl(142deg 52% 30% / 0.85)'
  }
  if (totalPeople > 1 && overlapCount === totalPeople) {
    // 人數是最大值時顯示紅色 (Sleek crimson red)
    return 'hsl(354deg 66% 40% / 0.85)'
  }
  // 1跟最大值中間顯示黃色 (Sleek amber/gold)
  return 'hsl(38deg 74% 38% / 0.85)'
}

function blockStyle(block) {
  const startIdx = timeToGridIndex(block.start)
  const endIdx = timeToGridIndex(block.end)
  const totalSlots = slots.value.length

  const topPct = (startIdx / totalSlots) * 100
  const heightPct = ((endIdx - startIdx) / totalSlots) * 100

  const colWidth = 100 / (block.totalCols || 1)
  const leftPct = (block.colIdx || 0) * colWidth
  const widthPct = colWidth

  return {
    top: `${topPct}%`,
    height: `${heightPct}%`,
    backgroundColor: getBlockBgColor(block.overlapCount, props.people.length),
    left: `calc(${leftPct}% + 4px)`,
    width: `calc(${widthPct}% - 8px)`,
    right: 'auto'
  }
}
</script>

<style scoped>
.schedule-shell { color: #0b1222; background: rgba(15, 23, 42, 0.4); padding: 16px; border-radius: 16px; border: 1px solid rgba(148, 163, 184, 0.1); }
.legend-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}
.status-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.legend-item {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #e2e8f0;
}
.swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  display: inline-block;
}
.swatch-green {
  background: hsl(142deg 52% 30%);
}
.swatch-yellow {
  background: hsl(38deg 74% 38%);
}
.swatch-red {
  background: hsl(354deg 66% 40%);
}
.people-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}
.people-title {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}
.person-tag {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.grid-wrapper { display: flex; flex-direction: column; }

.header-row { display: flex; margin-bottom: 8px }
.time-header { width: 110px }
.days-headers { display: flex; flex: 1 }
.day-header { 
  flex: 1; 
  display: flex; 
  justify-content: center; 
  font-weight: 600; 
  color: #cbd5e1;
  min-width: 0;
}

.grid { 
  display: flex; 
  position: relative;
}

.time-col { 
  width: 110px;
  display: flex;
  flex-direction: column;
}

.time-cell { 
  height: 65px; 
  font-size: 11px; 
  color: #94a3b8; 
  display: flex; 
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid transparent;
}

.slot-number {
  font-weight: 700;
  color: #60a5fa;
  font-size: 13px;
}

.slot-range {
  font-size: 10px;
  opacity: 0.8;
  margin-top: 1px;
}

.days-col { flex: 1; position: relative; }
.day-columns { display: flex; height: 100%; }

.day-column { 
  position: relative; 
  flex: 1; 
  min-width: 0;
  background: rgba(255, 255, 255, 0.02); 
  border-left: 1px solid rgba(148, 163, 184, 0.1);
}

.day-column:last-child {
  border-right: 1px solid rgba(148, 163, 184, 0.1);
}

.grid-cell { 
  height: 65px; 
  border-bottom: 1px dashed rgba(148, 163, 184, 0.1);
}

.blocks { 
  position: absolute; 
  left: 0; 
  right: 0; 
  top: 0; 
  bottom: 0;
  pointer-events: none; 
}

.person-block { 
  position: absolute; 
  left: 4px; 
  right: 4px; 
  border-radius: 6px; 
  color: #fff; 
  padding: 6px; 
  font-size: 11px; 
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  pointer-events: auto; 
  border-left: 3px solid rgba(255, 255, 255, 0.5);
}

.block-label { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.block-course { opacity: 0.9; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.block-time { font-size: 9px; opacity: 0.6; margin-top: 2px; }

.person-block.has-overlap {
  padding-right: 22px;
}

.overlap-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(239, 68, 68, 0.95);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 999px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  gap: 2px;
  pointer-events: none;
  z-index: 10;
  border: 1px solid rgba(255, 255, 255, 0.25);
  line-height: 1;
}
</style>