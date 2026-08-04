import { makeChecker } from './_lib/test-check.mjs'
import { centsToMoneyText, parseMoneyLive, parseMoneyCommit } from '../src/lib/showcaseMoney.js'
import { MAX_HEIC_DECODE_PIXELS, validateHeicDecodeDimensions } from '../src/lib/heicDecodeLimits.js'

const { check, summary } = makeChecker()

for (const [text, cents] of [['10', 1000], ['10.01', 1001], ['500', 50000], ['2490', 249000], ['2500', 250000]]) {
  const result = parseMoneyCommit(text)
  check(`money commit accepts ${text} and preserves exact cents`, result.error === null && result.cents === cents)
}

for (const text of ['-1', '12.345', 'abc', '.', 'NaN', 'Infinity', '1..2']) {
  check(`money commit rejects malformed value ${text}`, parseMoneyCommit(text).error !== null)
}

check('empty money input intentionally clears the committed value', parseMoneyCommit('').cents === null && parseMoneyCommit('').error === null)
check('partial input survives live parsing while last valid cents remain intact', parseMoneyLive('10.', 1000) === 1000)
check('malformed input cannot replace the last valid cents', parseMoneyLive('abc', 249000) === 249000)
check('committed cents render back as dollars, not cents', centsToMoneyText(250000) === '2500.00')
check('deposit values use the same exact parser contract', parseMoneyCommit('500').cents === 50000)

const commonIphone48Mp = validateHeicDecodeDimensions(8064, 6048)
check('common 48MP iPhone dimensions remain accepted', commonIphone48Mp.ok && commonIphone48Mp.rgbaBytes === 8064 * 6048 * 4)
check('zero and non-integer dimensions are rejected before allocation', !validateHeicDecodeDimensions(0, 100).ok && !validateHeicDecodeDimensions(10.5, 10).ok)
check('over-limit dimensions are rejected before allocation', !validateHeicDecodeDimensions(16385, 1).ok)
check('over-limit pixel count is rejected before allocation', !validateHeicDecodeDimensions(MAX_HEIC_DECODE_PIXELS, 2).ok)
check('integer-overflow-like dimensions are rejected before multiplication/allocation', !validateHeicDecodeDimensions(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER).ok)

summary()
