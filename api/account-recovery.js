// QA prototype is composed only by the isolated local demo harness. Cloud
// deployment must fail closed, even if someone sets a client feature flag.
export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  return res.status(503).json({ error: 'Account recovery is not available on this deployment. Please use your email or contact iDogs support.' })
}
