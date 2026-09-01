from pathlib import Path

cta_path = Path('src/components/ExtraLitterButton.tsx')
cta = cta_path.read_text()
old_allowed = "const allowed = parsed.plan !== 'plus' || parsed.unlimited || used < parsed.includedLimit || parsed.extraCreditsAvailable > 0"
new_allowed = "const allowed = parsed.unlimited || (parsed.plan === 'plus' && (used < parsed.includedLimit || parsed.extraCreditsAvailable > 0))"
assert cta.count(old_allowed) == 1, 'unexpected allowed expression count'
cta = cta.replace(old_allowed, new_allowed)
old_render = "  if (!summary || summary.plan !== 'plus' || summary.unlimited) return null"
new_render = """  if (!summary) return null
  if (summary.plan === 'free') {
    return (
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--light)' }}>
        Free plan — upgrade to Plus to create litters
      </span>
    )
  }
  if (summary.unlimited) return null"""
assert cta.count(old_render) == 1, 'unexpected Free render gate count'
cta = cta.replace(old_render, new_render)
cta_path.write_text(cta)

page_path = Path('src/pages/LittersPage.tsx')
page = page_path.read_text()
old_disabled = 'disabled={canCreateLitterFromQuota === false}'
assert page.count(old_disabled) == 2, 'unexpected new-litter disabled gate count'
page = page.replace(old_disabled, 'disabled={canCreateLitterFromQuota !== true}')
old_title = "title={canCreateLitterFromQuota === false ? 'Purchase an Extra Litter credit to create another litter.' : undefined}"
new_title = "title={canCreateLitterFromQuota === null ? 'Checking litter availability…' : canCreateLitterFromQuota === false ? 'Your current plan does not allow creating another litter.' : undefined}"
assert page.count(old_title) == 2, 'unexpected CTA title count'
page = page.replace(old_title, new_title)
old_mounted = """  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  function startLoad() {"""
new_mounted = """  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Fail closed if authoritative quota resolves to blocked after a form
  // was opened from stale UI state or during an account/plan transition.
  useEffect(() => {
    if (canCreateLitterFromQuota === false) setShowCreate(false)
  }, [canCreateLitterFromQuota])

  function startLoad() {"""
assert page.count(old_mounted) == 1, 'unexpected mounted effect anchor count'
page = page.replace(old_mounted, new_mounted)
old_handler = """  async function handleCreateLitter() {
    if (!form.damId) { toast('Please select a dam', 'error'); return }"""
new_handler = """  async function handleCreateLitter() {
    if (canCreateLitterFromQuota !== true) {
      toast('Your current plan does not allow creating another litter.', 'error')
      return
    }
    if (!form.damId) { toast('Please select a dam', 'error'); return }"""
assert page.count(old_handler) == 1, 'unexpected create handler anchor count'
page = page.replace(old_handler, new_handler)
page_path.write_text(page)

test_path = Path('scripts/test-litter-pricing-policy.mjs')
test = test_path.read_text()
old_decl = "const littersPage = fs.readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')"
new_decl = old_decl + "\nconst createLitterApi = fs.readFileSync(new URL('../api/create-litter.js', import.meta.url), 'utf8')"
assert test.count(old_decl) == 1, 'unexpected test declaration anchor count'
test = test.replace(old_decl, new_decl)
old_check = "check('new-litter CTAs are disabled when quota requires an Extra Litter credit', (littersPage.match(/disabled=\\{canCreateLitterFromQuota === false\\}/g) || []).length >= 2 && littersPage.includes('Purchase an Extra Litter credit to create another litter.'))"
new_checks = """check('new-litter CTAs fail closed until quota explicitly permits creation', (littersPage.match(/disabled=\\{canCreateLitterFromQuota !== true\\}/g) || []).length >= 2)
check('Free quota summary cannot authorize litter creation', cta.includes("parsed.plan === 'plus'") && !cta.includes("parsed.plan !== 'plus' ||"))
check('Free litter UX tells the breeder to upgrade', cta.includes('Free plan — upgrade to Plus to create litters'))
check('create handler fails closed before calling the API', littersPage.includes('if (canCreateLitterFromQuota !== true)') && littersPage.includes('Your current plan does not allow creating another litter.'))
check('blocked quota automatically closes any stale create form', littersPage.includes('if (canCreateLitterFromQuota === false) setShowCreate(false)'))
check('server still blocks Free litter creation with 403 plan gate', createLitterApi.includes("if (plan !== 'plus')") && createLitterApi.includes('status: 403') && createLitterApi.includes("reason: 'LITTER_PLAN_GATE'"))"""
assert test.count(old_check) == 1, 'unexpected old CTA regression check count'
test = test.replace(old_check, new_checks)
test_path.write_text(test)
