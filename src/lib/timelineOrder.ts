export type TimelineOrder = 'newest' | 'oldest'
export const TIMELINE_ORDER_KEY = 'idogs.timelineOrder'

/** Saved per-browser preference; Newest first unless a valid saved value exists. */
export function readTimelineOrder(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null): TimelineOrder {
  try { return storage?.getItem(TIMELINE_ORDER_KEY) === 'oldest' ? 'oldest' : 'newest' } catch { return 'newest' }
}

export function saveTimelineOrder(order: TimelineOrder, storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage?.setItem(TIMELINE_ORDER_KEY, order) } catch { /* private mode: keep in memory only */ }
}
