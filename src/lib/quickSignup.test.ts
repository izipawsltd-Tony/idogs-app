import { describe, it, expect } from 'vitest'
import { discoveryRoute, signupDestination, splitDisplayName } from './quickSignup'
describe('Quick signup routing and verification boundary',()=>{
 it('sends general visitors to a lightweight start page',()=>expect(signupDestination()).toBe('/app/start'))
 it('also treats the default sign-in dashboard return as discovery for a new account',()=>expect(signupDestination('/app/dashboard')).toBe('/app/start'))
 it('preserves explicit puppy follow intent',()=>expect(signupDestination('/app/puppy-updates/QR-RUBY?follow=1')).toBe('/app/puppy-updates/QR-RUBY?follow=1'))
 it('blocks external return URLs',()=>expect(signupDestination('https://attacker.invalid')).toBe('/app/start'))
 it.each(['/app/start','/app/following-puppies','/app/puppy-updates/QR-RUBY'])('allows discovery without email verification: %s',path=>expect(discoveryRoute(path)).toBe(true))
 it.each(['/app/dogs/new','/app/finance','/app/buyers','/app/settings','/app/claim-dogs','/app/export','/app/shared-dogs/ruby'])('retains verification for deeper operations: %s',path=>expect(discoveryRoute(path)).toBe(false))
 it('accepts a display name without requiring a surname',()=>expect(splitDisplayName('  Ruby  ')).toEqual({firstName:'Ruby',lastName:''}))
})
