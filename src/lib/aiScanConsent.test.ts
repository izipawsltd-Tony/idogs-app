import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIScan from '../components/ui/AIScan'

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({
  user: { getIdToken: async () => 'synthetic-token' }, profile: { plan: 'free' },
}) }))

afterEach(() => vi.unstubAllGlobals())

describe('AI document permission', () => {
  it('keeps selection local, allows cancellation, and asks again for the same file', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const renderer = create(createElement(AIScan, { onResult: vi.fn(), toast: vi.fn() }))
    const input = renderer.root.findByType('input')
    const target = { files: [{ name: 'synthetic.pdf', type: 'application/pdf' }], value: 'selected' }
    act(() => input.props.onChange({ target }))
    expect(target.value).toBe('')
    expect(JSON.stringify(renderer.toJSON())).toContain('Anthropic, a third-party AI provider')
    expect(JSON.stringify(renderer.toJSON())).toContain('up to 30 days')
    expect(JSON.stringify(renderer.toJSON())).toContain('does not immediately erase copies retained by Anthropic')
    expect(renderer.root.findAllByType('a').some(a => a.props.href === 'https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    const cancel = renderer.root.findAllByType('button').find(b => b.children.join('').startsWith('Cancel'))!
    act(() => cancel.props.onClick())
    expect(renderer.root.findAllByType('section')).toHaveLength(0)
    act(() => input.props.onChange({ target }))
    expect(renderer.root.findAllByType('section')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('sends only after explicit permission and rejects duplicate scan clicks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ documentType: 'other', vaccines: [] })))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('FileReader', class {
      result = 'data:application/pdf;base64,c3ludGhldGlj'
      onload: (() => void) | null = null
      readAsDataURL() { this.onload?.() }
    })
    const onResult = vi.fn()
    const renderer = create(createElement(AIScan, { onResult, toast: vi.fn() }))
    act(() => renderer.root.findByType('input').props.onChange({ target: {
      files: [{ name: 'synthetic.pdf', type: 'application/pdf' }], value: '',
    } }))
    const allow = renderer.root.findAllByType('button').find(b => b.children.join('').startsWith('Allow'))!
    await act(async () => { await Promise.all([allow.props.onClick(), allow.props.onClick()]) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/scan')
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(renderer.root.findAllByType('section')).toHaveLength(0)
    act(() => renderer.unmount())
  })
})
