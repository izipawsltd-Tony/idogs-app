import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertNativeProductionEnvironment } from './validate-native-production-env.mjs'

const production = {
  VITE_FIREBASE_API_KEY: 'test-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'idogs-app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'idogs-app',
  VITE_FIREBASE_STORAGE_BUCKET: 'idogs-app.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456',
  VITE_FIREBASE_APP_ID: '1:123456:web:test',
}

test('accepts complete production config', () => {
  assert.doesNotThrow(() => assertNativeProductionEnvironment(production))
})

test('rejects staging, unrelated projects and lookalike project names', () => {
  for (const project of ['idogs-app-staging', 'another-production-project', 'idogs-app-copy', ' idogs-app']) {
    assert.throws(() => assertNativeProductionEnvironment({ ...production, VITE_FIREBASE_PROJECT_ID: project }), /FAIL CLOSED/)
  }
})

test('rejects mixed production project and staging or unrelated auth domain', () => {
  for (const domain of ['idogs-app-staging.firebaseapp.com', 'other.firebaseapp.com']) {
    assert.throws(() => assertNativeProductionEnvironment({ ...production, VITE_FIREBASE_AUTH_DOMAIN: domain }), /Auth domain mismatch/)
  }
})

test('rejects each missing, blank or multiline required field without logging its value', () => {
  for (const field of Object.keys(production)) {
    for (const value of [undefined, '', '   ', 'private-value\nINJECTED=value', 'private-value\rINJECTED=value']) {
      assert.throws(() => assertNativeProductionEnvironment({ ...production, [field]: value }), (error) => {
        assert.match(error.message, /FAIL CLOSED/)
        assert.ok(error.message.includes(field))
        assert.ok(!error.message.includes('private-value'))
        return true
      })
    }
  }
})
