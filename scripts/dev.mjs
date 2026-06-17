import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const backend = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '3001',
  },
})

const viteServer = await createServer()
await viteServer.listen()
viteServer.printUrls()

function shutdown() {
  backend.kill()
  viteServer.close().finally(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)