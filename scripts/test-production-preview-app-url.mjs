import assert from 'node:assert/strict'
import { requireAppUrl } from '../api/_lib/require-config.js'

function withEnvs(map, fn) {
  const prev = {}
  for (const key of Object.keys(map)) {
    prev[key] = { had: key in process.env, value: process.env[key] }
    if (map[key] === undefined) delete process.env[key]
    else process.env[key] = map[key]
  }
  try {
    return fn()
  } finally {
    for (const key of Object.keys(map)) {
      if (prev[key].had) process.env[key] = prev[key].value
      else delete process.env[key]
    }
  }
}

const PROD_PROJECT = 'idogs-app'
const PROD_VERCEL_PROJECT = 'prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo'
const PREVIEW_HOST = 'idogs-akkfoo3jn-izipawsltd-tonys-projects.vercel.app'

const cases = [
  {
    name: 'verified production Vercel Preview with APP_URL absent is accepted',
    env: { FIREBASE_PROJECT_ID: PROD_PROJECT, APP_URL: undefined, VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: PROD_VERCEL_PROJECT, VERCEL_URL: PREVIEW_HOST },
    expected: `https://${PREVIEW_HOST}`,
  },
  {
    name: 'production environment never uses Preview fallback',
    env: { FIREBASE_PROJECT_ID: PROD_PROJECT, APP_URL: undefined, VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_VERCEL_PROJECT, VERCEL_URL: PREVIEW_HOST },
    expected: null,
  },
  {
    name: 'wrong Vercel project id is rejected',
    env: { FIREBASE_PROJECT_ID: PROD_PROJECT, APP_URL: undefined, VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_wrong', VERCEL_URL: PREVIEW_HOST },
    expected: null,
  },
  {
    name: 'staging Firebase project cannot use production Preview fallback',
    env: { FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: undefined, VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: PROD_VERCEL_PROJECT, VERCEL_URL: PREVIEW_HOST },
    expected: null,
  },
  {
    name: 'different Vercel team hostname is rejected',
    env: { FIREBASE_PROJECT_ID: PROD_PROJECT, APP_URL: undefined, VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: PROD_VERCEL_PROJECT, VERCEL_URL: 'idogs-akkfoo3jn-attacker-team.vercel.app' },
    expected: null,
  },
  {
    name: 'malformed VERCEL_URL with scheme is rejected',
    env: { FIREBASE_PROJECT_ID: PROD_PROJECT, APP_URL: undefined, VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: PROD_VERCEL_PROJECT, VERCEL_URL: `https://${PREVIEW_HOST}` },
    expected: null,
  },
  {
    name: 'invalid present APP_URL does not fall through to Preview fallback',
    env: { FIREBASE_PROJECT_ID: PROD_PROJECT, APP_URL: 'https://evil.example.com', VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: PROD_VERCEL_PROJECT, VERCEL_URL: PREVIEW_HOST },
    expected: null,
  },
  {
    name: 'canonical production APP_URL remains accepted',
    env: { FIREBASE_PROJECT_ID: PROD_PROJECT, APP_URL: 'https://idogs.com.au', VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_VERCEL_PROJECT, VERCEL_URL: 'idogs.com.au' },
    expected: 'https://idogs.com.au',
  },
  {
    name: 'canonical staging APP_URL remains accepted',
    env: { FIREBASE_PROJECT_ID: 'idogs-app-staging', APP_URL: 'https://idogs-app-staging.vercel.app', VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: 'prj_UGKaWkdtHrXpLovxDyoP4Tm8wN5o', VERCEL_URL: 'idogs-app-staging.vercel.app' },
    expected: 'https://idogs-app-staging.vercel.app',
  },
]

let passed = 0
for (const testCase of cases) {
  const actual = withEnvs(testCase.env, () => requireAppUrl())
  assert.equal(actual, testCase.expected, testCase.name)
  passed += 1
  console.log(`PASS ${testCase.name}`)
}

console.log(`Production Preview APP_URL guard: ${passed}/${cases.length} PASS`)
