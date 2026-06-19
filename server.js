import http from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseImportedRows } from './src/scheduleParser.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const dataDir = path.join(__dirname, 'data')
const dataFile = path.join(dataDir, 'timetables.csv')
const distDir = path.join(__dirname, 'dist')

const SEED_CSV = `姓名,星期,開始,結束,課程,教室`

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

function normalizeDay(value) {
  return String(value ?? '').trim().replace(/^週/, '').replace(/^星期/, '')
}

function normalizeTime(value) {
  const raw = String(value ?? '').trim()
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    return raw
  }
  return raw
}

function parseCSV(text) {
  return parseImportedRows(text)
}

async function ensureSeedData() {
  await mkdir(dataDir, { recursive: true })
  try {
    await stat(dataFile)
  } catch {
    await writeFile(dataFile, SEED_CSV, 'utf8')
  }
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJSON(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  })
  response.end(JSON.stringify(payload))
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }

  return map[ext] || 'application/octet-stream'
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  let pathname = decodeURIComponent(url.pathname)

  if (pathname === '/') {
    pathname = '/index.html'
  }

  const filePath = path.join(distDir, pathname)
  try {
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) {
      throw new Error('Not a file')
    }

    const stream = createReadStream(filePath)
    response.writeHead(200, { 'Content-Type': getContentType(filePath) })
    stream.pipe(response)
    return true
  } catch {
    if (!pathname.includes('.')) {
      const indexPath = path.join(distDir, 'index.html')
      try {
        const stream = createReadStream(indexPath)
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        stream.pipe(response)
        return true
      } catch {
        return false
      }
    }
  }

  return false
}

await ensureSeedData()

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    })
    response.end()
    return
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    sendJSON(response, 200, { ok: true, service: '空堂媒合後端' })
    return
  }

  if (url.pathname === '/api/schedules' && request.method === 'GET') {
    const csv = await readFile(dataFile, 'utf8')
    sendJSON(response, 200, { rows: parseCSV(csv) })
    return
  }

  if (url.pathname === '/api/schedules' && request.method === 'POST') {
    const body = await readBody(request)
    let csv = body

    try {
      const parsed = JSON.parse(body)
      if (parsed && typeof parsed.csv === 'string') {
        csv = parsed.csv
      }
    } catch {
      // Use raw CSV body.
    }

    await writeFile(dataFile, csv, 'utf8')
    sendJSON(response, 200, { ok: true, count: parseCSV(csv).length })
    return
  }

  const handled = await serveStatic(request, response)
  if (!handled) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
  }
})

server.listen(PORT, () => {
  console.log(`空堂媒合後端已啟動：http://localhost:${PORT}`)
})