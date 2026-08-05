import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface BookdConfig {
  host: string
  port: number
  libraryDir: string
  stateDir: string
  clientDir: string
}

const expandHome = (value: string) => value.startsWith('~/')
  ? path.join(os.homedir(), value.slice(2))
  : path.resolve(value)

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const getConfig = (overrides: Partial<BookdConfig> = {}): BookdConfig => ({
  host: overrides.host ?? process.env.BOOKD_HOST ?? '127.0.0.1',
  port: overrides.port ?? Number(process.env.BOOKD_PORT ?? 4123),
  libraryDir: overrides.libraryDir ?? expandHome(process.env.BOOKD_LIBRARY_DIR ?? '~/Books/bookd'),
  stateDir: overrides.stateDir ?? path.resolve(process.env.BOOKD_STATE_DIR ?? '.reading'),
  clientDir: overrides.clientDir
    ?? (process.env.BOOKD_CLIENT_DIR ? expandHome(process.env.BOOKD_CLIENT_DIR) : path.join(packageRoot, 'dist-client')),
})
