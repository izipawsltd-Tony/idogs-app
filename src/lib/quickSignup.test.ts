import { describe, it, expect } from 'vitest'
import { discoveryRoute, signupDestination, splitDisplayName } from './quickSignup'
describe('Quick signup routing and verification boundary',()=>{
 it('sends general visitors straight to their dashboard',()=>expect(signupDestination()).toBe('/app/dashboard'))
 it('replaces the legacy intermediate page with the dashboard',()=>expect(signupDestination('/app/start')).toBe('/app/dashboard'))
 it('returns puppy follow intent to its public QR profile',()=>expect(signupDestination('/app/puppy-updates/QR-RUBY?follow=1')).toBe('/p/QR-RUBY?follow=1'))
 it('preserves the public QR destination after registration',()=>expect(signupDestination('/p/QR-RUBY?follow=1')).toBe('/p/QR-RUBY?follow=1'))
 it.each(['https://attacker.invalid','//attacker.invalid','/p/QR?next=https://attacker.invalid','/p/QR/../../outside'])('blocks unsafe return URLs: %s',next=>expect(signupDestination(next)).toBe('/app/dashboard'))
 it.each(['/app/start','/app/dashboard','/app/settings','/app/dogs','/app/following-puppies','/app/puppy-updates/QR-RUBY'])('allows account discovery without email verification: %s',path=>expect(discoveryRoute(path)).toBe(true))
 it.each(['/app/dogs/new','/app/finance','/app/buyers','/app/claim-dogs','/app/export','/app/shared-dogs/ruby'])('retains verification for deeper operations: %s',path=>expect(discoveryRoute(path)).toBe(false))
 it('accepts a display name without requiring a surname',()=>expect(splitDisplayName('  Ruby  ')).toEqual({firstName:'Ruby',lastName:''}))
})
