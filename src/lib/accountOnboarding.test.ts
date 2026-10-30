import { beforeEach, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
const s=vi.hoisted(()=>({user:{uid:'same-uid',email:null as string|null,emailVerified:false,providerData:[] as {providerId:string}[],getIdToken:vi.fn()},link:vi.fn(),reauth:vi.fn(),reload:vi.fn(),send:vi.fn()}))
vi.mock('./firebase',()=>({auth:{get currentUser(){return s.user}}}))
vi.mock('firebase/auth',()=>({EmailAuthProvider:{credential:(email:string,password:string)=>({email,password})},linkWithCredential:s.link,reauthenticateWithCredential:s.reauth,reload:s.reload,sendEmailVerification:s.send}))
import { accountSetupRequest, finishPrimaryPassword, linkPrimaryEmail } from './accountOnboarding'
beforeEach(()=>{s.user={uid:'same-uid',email:null,emailVerified:false,providerData:[],getIdToken:vi.fn().mockResolvedValue('synthetic-token')};s.link.mockReset().mockImplementation(async()=>({user:s.user}));s.reauth.mockReset().mockResolvedValue({user:s.user});s.reload.mockReset().mockResolvedValue(undefined);s.send.mockReset().mockResolvedValue(undefined);vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({ready:true,required:true})}))})
it('links email/password onto the phone UID and immediately requests verification',async()=>{
 await linkPrimaryEmail(s.user as unknown as User,' person@example.invalid ','Synthetic-only-123!')
 expect(s.link).toHaveBeenCalledWith(s.user,{email:'person@example.invalid',password:'Synthetic-only-123!'})
 expect(s.send).toHaveBeenCalledWith(s.user)
})
it('keeps the linked identity when verification delivery fails so the user can resend',async()=>{
 s.send.mockRejectedValueOnce(new Error('delivery failed'));expect(await linkPrimaryEmail(s.user as unknown as User,'person@example.invalid','Synthetic-only-123!')).toEqual({sent:false})
})
it('does not merge or send verification when email belongs to another account',async()=>{
 s.link.mockRejectedValueOnce(new Error('auth/email-already-in-use'))
 await expect(linkPrimaryEmail(s.user as unknown as User,'other@example.invalid','Synthetic-only-123!')).rejects.toThrow()
 expect(s.send).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
})
it('will not mark an unverified email ready',async()=>{
 s.user.email='person@example.invalid';await expect(finishPrimaryPassword(s.user as unknown as User,'Synthetic-only-123!')).rejects.toThrow('Verify your email')
 expect(fetch).not.toHaveBeenCalled();expect(s.link).not.toHaveBeenCalled()
})
it('confirms an existing password instead of overwriting it and asks the server to prove it',async()=>{
 s.user.email='person@example.invalid';s.user.emailVerified=true;s.user.providerData=[{providerId:'password'}]
 await finishPrimaryPassword(s.user as unknown as User,'Synthetic-only-123!')
 expect(s.reauth).toHaveBeenCalledOnce();expect(s.link).not.toHaveBeenCalled()
 expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({password:'Synthetic-only-123!'})
})
it('does not use a password proof for another UID after a session switch',async()=>{
 s.user.getIdToken.mockImplementationOnce(async()=>{s.user={...s.user,uid:'other'};return 'synthetic'})
 const original=s.user;await expect(accountSetupRequest(original as unknown as User,'Synthetic-only-123!')).rejects.toThrow('account changed')
 expect(fetch).not.toHaveBeenCalled()
})
