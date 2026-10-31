import { describe, expect, it } from 'vitest'
import { isAndroidNativeApp, isNativeApp } from './nativePlatform'

function fakeDoc(platform: string | undefined): Pick<Document, 'documentElement'> {
  const dataset = platform === undefined ? {} : { idogsNativePlatform: platform }
  return { documentElement: { dataset } as unknown as HTMLElement }
}

describe('native platform markers', () => {
  it('treats server rendering without a document as web', () => {
    expect(isNativeApp()).toBe(false)
    expect(isAndroidNativeApp()).toBe(false)
  })
  it('keeps Android-only detection Android-specific', () => {
    expect(isAndroidNativeApp(fakeDoc('android'))).toBe(true)
    expect(isAndroidNativeApp(fakeDoc('ios'))).toBe(false)
    expect(isAndroidNativeApp(fakeDoc(undefined))).toBe(false)
  })

  it('treats both Android and iOS shells as native apps', () => {
    expect(isNativeApp(fakeDoc('android'))).toBe(true)
    expect(isNativeApp(fakeDoc('ios'))).toBe(true)
    expect(isNativeApp(fakeDoc(undefined))).toBe(false)
    expect(isNativeApp(fakeDoc('web'))).toBe(false)
  })
})
