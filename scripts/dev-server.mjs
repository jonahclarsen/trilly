import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

export async function startDevServer({ synthetic = false } = {}) {
  const ports = JSON.parse(await readFile(new URL('../port.json', import.meta.url), 'utf8'))
  const port = synthetic ? ports.dev_test_port : ports.port
  const backendPort = synthetic ? ports.dev_test_backend_port : ports.dev_backend_port
  const origin = `http://127.0.0.1:${port}`
  const allowed = req => req.headers.host === `127.0.0.1:${port}`
    && (!req.headers.origin || req.headers.origin === origin)
    && req.headers['sec-fetch-site'] !== 'cross-site'
  const server = await createServer({
    plugins: [{
      name: 'trilly-loopback-boundary',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!allowed(req)) { res.writeHead(403); res.end('Request blocked'); return }
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('X-Content-Type-Options', 'nosniff')
          res.setHeader('Referrer-Policy', 'no-referrer')
          res.setHeader('X-Frame-Options', 'DENY')
          res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:${port}; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`)
          next()
        })
        server.httpServer.prependListener('upgrade', (req, socket) => {
          if (!allowed(req) || req.headers.origin !== origin) socket.destroy()
        })
      },
    }],
    server: {
      host: '127.0.0.1', port, strictPort: true, cors: false,
      proxy: { '/api/': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: false } },
      fs: { strict: true, deny: ['.env', '.env.*', '**/.git/**', '**/*.{vault,vault.tmp,key,pem,p12,pfx,keychain,keychain-db,log}', '**/server/target/**'] },
      watch: { ignored: ['**/server/**', '**/test-results/**', '**/docs/screenshots/**'] },
    },
  })
  await server.listen()
  return server
}
