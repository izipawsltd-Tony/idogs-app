import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const PREVIEW_STATE = join(tmpdir(), 'idogs-preview-bypass-state.json')
