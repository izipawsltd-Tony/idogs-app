import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // SECURITY FIX: this endpoint had no auth check at all — since it
  // spends real money on every call (calls the Anthropic API using our
  // own API key), anyone who found the URL (trivial via browser DevTools
  // Network tab) could script unlimited free OCR requests against our
  // API budget. Now requires a valid Firebase ID token from a signed-in
  // iDogs user before doing anything.
  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }
  try {
    await getAuth().verifyIdToken(idToken)
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })
  }

  const { image, mediaType } = req.body
  if (!image) {
    return res.status(400).json({ error: 'No file provided' })
  }

  const isPDF = mediaType === 'application/pdf'

  const prompt = `You are a veterinary document scanner for Australian dog breeders.
Extract information from this document (vaccine card, pedigree certificate, health test result, or vet record).

Return ONLY a JSON object with these exact fields (use null if not found):
{
  "documentType": "vaccine_card" | "pedigree" | "health_test" | "microchip_cert" | "vet_record" | "other",
  "dogName": string | null,
  "breed": string | null,
  "dateOfBirth": "YYYY-MM-DD" | null,
  "sex": "male" | "female" | null,
  "colour": string | null,
  "microchip": string | null,
  "ankc": string | null,
  "vaccines": [
    {
      "name": string,
      "dateGiven": "YYYY-MM-DD" | null,
      "nextDue": "YYYY-MM-DD" | null,
      "vetClinic": string | null,
      "uncertain": boolean
    }
  ],
  "healthTests": [
    {
      "testType": "hip" | "elbow" | "eye" | "dna" | "cardiac" | "other" | null,
      "result": string | null,
      "dateTested": "YYYY-MM-DD" | null,
      "lab": string | null,
      "certNumber": string | null
    }
  ],
  "notes": string | null
}

IMPORTANT extraction rules:
- Australian date format is DD/MM/YYYY — convert to YYYY-MM-DD
- Extract "colour" from fields like "Colour: Yellow", "Color: Black", etc.
- Extract "sex" from fields like "Sex: Female", "Sex: Male", "Bitch", "Dog"
- Extract "breed" from "Breed:" field on pedigree certificates
- Extract "ankc" from registration numbers on pedigree certificates
- IMPORTANT: "ankc" and each healthTests[].result are separate fields and must never contain the same value. Health test certificates (hip/elbow/eye/cardiac scores) often also print the dog's ANKC registration number somewhere on the page for identification purposes — that number belongs in "ankc" only, never in a healthTests entry's "result". Each entry's "result" must be the actual test outcome only (e.g. a hip/elbow score or grade such as "Excellent", "Good", "9/9", or a left/right breakdown like "Left: Excellent, Right: Good" — never a registration or certificate number on its own)
- Extract "microchip" from microchip/chip numbers
- If document is a microchip registration or implant certificate, set documentType to "microchip_cert"
- For vaccines: extract each vaccine as a separate entry in the vaccines array
- For health tests: extract each test type as a separate entry in the healthTests array. If one certificate reports multiple test types (e.g. hip AND elbow scored in the same session), output EACH as a separate entry in healthTests, splitting the result text so each entry's result contains ONLY that test's outcome. Hip score and elbow grade must never share one entry.
- Mark uncertain:true if you are not confident about a date or value
- Return ONLY valid JSON, no markdown, no explanation`

  try {
    const content = isPDF
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image } },
          { type: 'text', text: prompt },
        ]
      : [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } },
          { type: 'text', text: prompt },
        ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(500).json({ error: 'Claude API error', status: response.status, details: data })
    }

    const text = data.content?.[0]?.text || ''

    try {
      const clean = text.replace(/```json\n?|\n?```/g, '').trim()
      const extracted = JSON.parse(clean)
      return res.status(200).json(extracted)
    } catch {
      return res.status(200).json({ documentType: 'other', vaccines: [], healthTests: [], raw: text })
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal error', message: String(err) })
  }
}
