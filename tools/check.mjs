import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

async function visit(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await visit(file)
    else if (/\.(mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
      if (result.status !== 0) process.exit(1)
    }
  }
}
for (const directory of ['lib', 'tools', 'tests']) { if (await fs.access(directory).then(() => true, () => false)) await visit(directory) }
console.log('Source syntax checks passed')
