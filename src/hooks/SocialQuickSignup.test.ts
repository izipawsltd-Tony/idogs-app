import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({popup:vi.fn(),read:vi.fn(),write:vi.fn(),signout:vi.fn(),api:null as any,newUser:true}))
vi.mock('../lib/firebase',()=>({auth:{}}))
vi.mock('firebase/auth',()=>({createUserWithEmailAndPassword:vi.fn(),signInWithEmailAndPassword:vi.fn(),onAuthStateChanged:()=>()=>{},sendPasswordResetEmail:vi.fn(),sendEmailVerification:vi.fn(),reload:vi.fn(),updateProfile:vi.fn(),signOut:state.signout,signInWithPopup:state.popup,getAdditionalUserInfo:()=>({isNewUser:state.newUser}),GoogleAuthProvider:class{},FacebookAuthProvider:class{addScope(){}}}))
vi.mock('../lib/db',()=>({createUserProfile:state.write,getUserProfile:state.read,getUserProfileFromServer:vi.fn(),updateUserProfile:vi.fn(),deleteUserData:vi.fn()}))
import {AuthProvider,useAuth} from './useAuth'
function Capture(){state.api=useAuth();return null}
beforeEach(async()=>{state.newUser=true;state.popup.mockReset().mockResolvedValue({user:{uid:'qa',email:'qa@example.invalid',displayName:'Ruby Friend'}});state.read.mockReset().mockResolvedValue(null);state.write.mockClear();state.signout.mockClear();await act(async()=>{create(createElement(AuthProvider,null,createElement(Capture)))})})
it('copies provider name/email into a minimal owner profile, marketing off by default',async()=>{await act(async()=>{expect(await state.api.socialLogin('google.com')).toBe(true)});expect(state.write).toHaveBeenCalledWith('qa',expect.objectContaining({firstName:'Ruby',lastName:'Friend',email:'qa@example.invalid',role:'owner',marketingConsent:expect.objectContaining({choice:'opt_out'})}))})
it('does not overwrite existing breeder role or marketing consent on social sign-in',async()=>{state.newUser=false;state.read.mockResolvedValue({role:'breeder',firstName:'Existing'});await act(async()=>{expect(await state.api.socialLogin('google.com')).toBe(false)});expect(state.write).not.toHaveBeenCalled()})
it('does not create an unusable email-less Facebook profile',async()=>{state.popup.mockResolvedValue({user:{uid:'qa',email:null,displayName:'Ruby Friend'}});await expect(state.api.socialLogin('facebook.com')).rejects.toThrow('email-required');expect(state.write).not.toHaveBeenCalled();expect(state.signout).toHaveBeenCalled()})
