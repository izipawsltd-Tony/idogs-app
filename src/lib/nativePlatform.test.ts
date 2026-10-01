import { describe, expect, it } from 'vitest'
import { isAndroidNativeApp } from './nativePlatform'

function fakeDoc(platform: string | undefined): Pick<Document, 'documentElement'> {
  const dataset = platform === undefined ? {} : { idogsNativePlatform: platform }
  return { documentElement: { dataset } as unknown as HTMLElement }
}

describe('isAndroidNativeApp', () => {
  it('is true only when the native platform marker is android', () => {
    expect(isAndroidNativeApp(fakeDoc('android'))).toBe(true)
  })

  it('is false for other native platforms', () => {
    expect(isAndroidNativeApp(fakeDoc('ios'))).toBe(false)
  })

  it('is false on the regular web app where no marker is set', () => {
    expect(isAndroidNativeApp(fakeDoc(undefined))).toBe(false)
  })
})
