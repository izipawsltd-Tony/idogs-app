from pathlib import Path

p = Path('src/pages/DogDetailPage.tsx')
s = p.read_text(encoding='utf-8')
old = 'rules.vetCertAfterAge * 12'
new = 'rules.vetCertAfterAgeYears * 12'
if old not in s:
    raise SystemExit('Expected vetCertAfterAge compatibility usage not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
