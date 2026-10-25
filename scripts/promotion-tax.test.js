import { expect, it, vi } from 'vitest'
import { promotionTaxReady } from '../api/_lib/promotion-tax.js'
import { PLUS_PROMOTION_END } from '../shared/plus-promotion.js'
const now = Date.parse('2026-10-22T00:00:00Z')
function fixture() {
  const state={
    settings:{status:'active',livemode:false,head_office:{address:{country:'AU'}},defaults:{tax_code:'txcd_10103001'}},
    registrations:{has_more:false,data:[{status:'active',country:'AU',livemode:false,active_from:now/1000-1,expires_at:null}]},
    price:{id:'price_synthetic',active:true,livemode:false,currency:'aud',unit_amount:700,tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1},product:{active:true,livemode:false,tax_code:null}},
    customer:{livemode:false,tax_exempt:'none',shipping:null},
  }
  const stripe={tax:{settings:{retrieve:vi.fn(async()=>state.settings)},registrations:{list:vi.fn(async()=>state.registrations)}},prices:{retrieve:vi.fn(async()=>state.price)},customers:{retrieve:vi.fn(async()=>state.customer)}}
  return {state,stripe,ready:(customerId=null)=>promotionTaxReady(stripe,'price_synthetic',false,customerId,now)}
}
it('accepts configured inclusive monthly AUD7 with AU registration valid through renewal; only reads provider configuration', async()=>{
  const f=fixture();expect(await f.ready()).toBe(true)
  expect(f.stripe.prices.retrieve).toHaveBeenCalledWith('price_synthetic',{expand:['product']})
  expect(f.stripe.customers.retrieve).not.toHaveBeenCalled()
})
it.each(['inactive','wrongMode','missingRegistration','expiresBeforeRenewal','futureRegistration','foreignRegistration','partialCatalog','exclusive','wrongPrice','wrongCurrency','wrongInterval','inactiveProduct','nontaxable','missingTaxCode'])('fails closed for %s',async scenario=>{
  const f=fixture(),s=f.state
  if(scenario==='inactive')s.settings.status='pending'
  if(scenario==='wrongMode')s.price.livemode=true
  if(scenario==='missingRegistration')s.registrations.data=[]
  if(scenario==='expiresBeforeRenewal')s.registrations.data[0].expires_at=PLUS_PROMOTION_END/1000
  if(scenario==='futureRegistration')s.registrations.data[0].active_from=now/1000+60
  if(scenario==='foreignRegistration')s.registrations.data.push({...s.registrations.data[0],country:'NZ'})
  if(scenario==='partialCatalog')s.registrations.has_more=true
  if(scenario==='exclusive')s.price.tax_behavior='exclusive'
  if(scenario==='wrongPrice')s.price.unit_amount=500
  if(scenario==='wrongCurrency')s.price.currency='usd'
  if(scenario==='wrongInterval')s.price.recurring.interval_count=2
  if(scenario==='inactiveProduct')s.price.product.active=false
  if(scenario==='nontaxable')s.price.product.tax_code={id:'txcd_00000000'}
  if(scenario==='missingTaxCode')s.settings.defaults.tax_code=null
  expect(await f.ready()).toBe(false)
})
it('accepts an existing explicitly configured expanded tax code without reclassification',async()=>{
  const f=fixture();f.state.price.product.tax_code={id:'txcd_10103001'};expect(await f.ready()).toBe(true)
})
it.each(['shipping','exempt','deleted','wrongMode'])('holds existing customer %s rather than altering their tax/address data',async scenario=>{
  const f=fixture();if(scenario==='shipping')f.state.customer.shipping={address:{country:'NZ'}}
  if(scenario==='exempt')f.state.customer.tax_exempt='exempt'
  if(scenario==='deleted')f.state.customer.deleted=true
  if(scenario==='wrongMode')f.state.customer.livemode=true
  expect(await f.ready('cus_synthetic')).toBe(false)
})
it('propagates provider failures before checkout can be created',async()=>{
  const f=fixture();f.stripe.tax.settings.retrieve.mockRejectedValue(new Error('synthetic outage'))
  await expect(f.ready()).rejects.toThrow('synthetic outage')
})
