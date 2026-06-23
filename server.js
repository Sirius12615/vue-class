import http from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const dataDir = path.join(__dirname, 'data')
const dbFile = path.join(dataDir, 'timetables.db')
const distDir = path.join(__dirname, 'dist')

function openDB() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbFile, (err) => {
      if (err) reject(err)
      else resolve(db)
    })
  })
}

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err)
      else resolve(this)
    })
  })
}

function allQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

async function ensureSeedData() {
  await mkdir(dataDir, { recursive: true })
  const db = await openDB()
  try {
    await runQuery(db, `
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        day TEXT,
        start INTEGER,
        end INTEGER,
        course TEXT,
        room TEXT
      )
    `)
  } finally {
    db.close()
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

  // 移除非必要的 /vue-class 前綴，以支援部署與本地運行相容性
  if (pathname.startsWith('/vue-class/')) {
    pathname = pathname.substring(10) // 移除 '/vue-class' (長度為 10)
  } else if (pathname === '/vue-class') {
    pathname = '/'
  }

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
    let db;
    try {
      db = await openDB()
      const dbRows = await allQuery(db, 'SELECT name, day, start, end, course, room FROM schedules')
      sendJSON(response, 200, { rows: dbRows })
    } catch (error) {
      sendJSON(response, 200, { rows: [] })
    } finally {
      if (db) db.close()
    }
    return
  }

  if (url.pathname === '/api/schedules' && request.method === 'POST') {
    let db;
    try {
      const body = await readBody(request)
      const payload = JSON.parse(body)
      const rows = payload.rows || []

      db = await openDB()
      await runQuery(db, 'BEGIN TRANSACTION')
      await runQuery(db, 'DELETE FROM schedules')

      const insertStmt = db.prepare(`
        INSERT INTO schedules (name, day, start, end, course, room)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      for (const row of rows) {
        await new Promise((resolve, reject) => {
          insertStmt.run([
            row.name || '',
            row.day || '',
            row.start || 0,
            row.end || 0,
            row.course || '',
            row.room || ''
          ], (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      }

      await new Promise((resolve, reject) => {
        insertStmt.finalize((err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      await runQuery(db, 'COMMIT')
      sendJSON(response, 200, { ok: true, count: rows.length })
    } catch (error) {
      if (db) {
        try {
          await runQuery(db, 'ROLLBACK')
        } catch {}
      }
      sendJSON(response, 500, { error: error.message })
    } finally {
      if (db) db.close()
    }
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