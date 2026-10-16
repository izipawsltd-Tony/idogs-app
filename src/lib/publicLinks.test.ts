import { describe, expect, it } from 'vitest'
import { publicAppOrigin } from './publicLinks'
describe('shareable public origin', () => {
  it.each(['android', 'ios'])('uses public production origin for %s', platform => {
    expect(publicAppOrigin('https://localhost', { idogsNativePlatform: platform, idogsNativeApi: 'production' })).toBe('https://idogs.com.au')
  })
  it('preserves web Preview', () => {
    expect(publicAppOrigin('https://preview.vercel.app', {})).toBe('https://preview.vercel.app')
  })
  it('keeps dedicated native QA isolated', () => {
    expect(publicAppOrigin('https://localhost', { idogsNativePlatform: 'android', idogsNativeApi: 'dedicated-staging-qa' })).toBe('https://idogs-native-api-qa-izipaws.vercel.app')
  })
})
