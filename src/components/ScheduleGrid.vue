<template>
  <div class="schedule-shell">
    <div class="legend">
      <div v-for="(name, idx) in people" :key="name" class="legend-item">
        <span class="swatch" :style="{background: nameColor(name)}"></span>
        <small>{{ name }}</small>
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
          <div v-for="slot in slots" :key="slot.start" class="time-cell">{{ slot.label }}</div>
        </div>

        <div class="days-col">
          <div class="day-columns">
            <div v-for="day of days" :key="day" class="day-column">
              <div v-for="slot in slots" :key="slot.start" class="grid-cell"></div>

              <div class="blocks">
                <div v-for="block in blocksForDay(day)" :key="`${block.name}-${block.start}`"
                  class="person-block"
                  :title="`${block.name} ${minutesToLabel(block.start)} 到 ${minutesToLabel(block.end)}\n${block.course || ''}`"
                  :style="blockStyle(block)">
                  <div class="block-label">{{ block.name }} {{ minutesToLabel(block.start) }} 到 {{ minutesToLabel(block.end) }}</div>
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
  slotStart: { type: Number, default: 8 * 60 },
  slotEnd: { type: Number, default: 18 * 60 },
  slotStep: { type: Number, default: 10 },
})

const WEEKDAY_ORDER = ['一','二','三','四','五','六','日']

function minutesToLabel(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mins = String(minutes % 60).padStart(2, '0')
  return `${hours}:${mins}`
}

function nameColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}deg 70% 55% / 0.95)`
}

const slots = computed(() => {
  const out = []
  const startHour = Math.floor(props.slotStart / 60)
  const endHour = Math.ceil(props.slotEnd / 60)

  for (let h = startHour; h < endHour; h++) {
    const s = h * 60 + 10
    const e = (h + 1) * 60
    if (s >= props.slotEnd) break
    out.push({
      start: s,
      end: e,
      label: `${String(h).padStart(2, '0')}:10 到 ${String(h + 1).padStart(2, '0')}:00`
    })
  }
  return out
})

function timeToY(minutes) {
  const sList = slots.value
  if (!sList.length) return 0

  for (let i = 0; i < sList.length; i++) {
    const s = sList[i]
    if (minutes < s.start) return i
    if (minutes <= s.end) {
      return i + (minutes - s.start) / (s.end - s.start)
    }
  }
  return sList.length
}

const days = computed(() => WEEKDAY_ORDER.slice(0,5))

function dayLabel(day){
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

function blocksForDay(day){
  const blocks = []
  for (const [name, rows] of personMap.value) {
    for (const r of rows.filter((x) => x.day === day)) {
      blocks.push({ name, start: r.start, end: r.end, course: r.course })
    }
  }
  return blocks
}

function blockStyle(block){
  const startY = timeToY(block.start)
  const endY = timeToY(block.end)
  const total = slots.value.length

  const top = (startY / total) * 100
  const height = ((endY - startY) / total) * 100
  return {
    top: `${top}%`,
    height: `${height}%`,
    background: nameColor(block.name),
  }
}
</script>

<style scoped>
.schedule-shell { color: #0b1222; background: linear-gradient(180deg,#f8fafc,#eef2ff); padding:12px; border-radius:10px }
.legend { display:flex; gap:12px; margin-bottom:8px; flex-wrap:wrap }
.legend-item { display:flex; gap:8px; align-items:center }
.swatch { width:14px; height:14px; border-radius:4px; display:inline-block }

.grid-wrapper { display:flex; flex-direction:column; gap:0 }

.header-row { display:flex; gap:8px; margin-bottom:8px }
.time-header { width:100px }
.days-headers { display:flex; gap:6px; flex:1 }
.day-header { 
  flex:1; 
  display:flex; 
  justify-content:center; 
  font-weight:600; 
  color:#0f172a;
  min-width:0;
}

.grid { 
  display:flex; 
  gap:8px;
  overflow-x:auto;
}

.time-col { 
  width:100px;
  display:flex;
  flex-direction:column;
  gap:0;
}

.time-cell { 
  flex:1;
  min-height:40px;
  font-size:11px; 
  color:#334155; 
  display:flex; 
  align-items:center;
  padding:4px 0;
}

.days-col { flex:1 }

.day-columns { 
  display:flex; 
  gap:6px;
  min-width:0;
}

.day-column { 
  position:relative; 
  flex:1; 
  min-width:0;
  border-radius:6px; 
  background:#fff; 
  padding:0;
  display:flex;
  flex-direction:column;
  gap:0;
  overflow:hidden;
}

.grid-cell { 
  flex:1;
  min-height:40px;
  border-bottom:1px dashed #e6eef8;
  padding:6px;
}

.blocks { 
  position:absolute; 
  left:0; 
  right:0; 
  top:0; 
  bottom:0;
  padding:6px;
}

.person-block { 
  position:absolute; 
  left:6px; 
  right:6px; 
  border-radius:6px; 
  color:#021124; 
  padding:4px 6px; 
  font-size:12px; 
  box-shadow:0 6px 12px rgba(11,20,40,0.08);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.block-label { 
  font-weight:600;
}
</style>