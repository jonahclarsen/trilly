import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
function run(command, args, openBrowser = false) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: openBrowser ? ['inherit', 'pipe', 'inherit'] : 'inherit' })
    let opened = false
    let output = ''
    child.stdout?.on('data', chunk => {
      process.stdout.write(chunk)
      output = (output + chunk.toString()).slice(-2048)
      const url = output.match(/Trilly: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
      if (!opened && url && process.platform === 'darwin' && process.env.TRILLY_NO_OPEN !== '1') {
        opened = true
        const browser = spawn('/usr/bin/open', [url], { stdio: 'ignore' })
        browser.on('error', () => process.stderr.write(`Open ${url} in your browser.\n`))
      }
    })
    const stop = () => child.kill('SIGTERM')
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    child.on('exit', code => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve(code ?? 1)
    })
  })
}
const built = await run('pnpm', ['build'])
if (built !== 0) process.exit(built)
process.exit(await run('cargo', ['run', '--manifest-path', 'server/Cargo.toml', ...(process.argv.includes('--release') ? ['--release'] : [])], true))
