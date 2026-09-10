import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' })
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
process.exit(await run('cargo', ['run', '--manifest-path', 'server/Cargo.toml', ...(process.argv.includes('--release') ? ['--release'] : [])]))
