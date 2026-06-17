export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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
  "healthTest": {
    "testType": "hip" | "elbow" | "eye" | "dna" | "cardiac" | "other" | null,
    "result": string | null,
    "dateTested": "YYYY-MM-DD" | null,
    "lab": string | null,
    "certNumber": string | null
  } | null,
  "notes": string | null
}

IMPORTANT extraction rules:
- Australian documents ALWAYS use DD/MM/YYYY format (day first, then month, then year) — NEVER MM/DD/YYYY. Convert to YYYY-MM-DD for output.
- Example: "03/04/2025" on an Australian document means 3 April 2025, NOT March 4th. Output as "2025-04-03".
- Example: "25/12/2024" means 25 December 2024. Output as "2024-12-25".
- If a date appears ambiguous (e.g. could be parsed either way) but one of the two numbers is greater than 12, that number MUST be the day, confirming DD/MM/YYYY — use this to resolve ambiguity confidently.
- Some Australian vaccine cards print treatment rows upside-down relative to each other on the same page (e.g. rotated 180°) so the booklet can be folded — mentally rotate the text as needed to read it correctly, don't transcribe upside-down digits as-is.
- Handwritten dates are sometimes written as a run of digits without clear separators (e.g. "22526" meaning "22/5/26" or "6826" meaning "6/8/26"). Parse these carefully digit-by-digit using DD/M/YY or DD/MM/YY logic, and mark uncertain:true whenever the digit grouping is genuinely ambiguous.
- HANDWRITTEN DATES ARE HIGH RISK. If a date is handwritten (not printed/typed), be much more conservative: only set uncertain:false if every digit is unambiguous and clearly formed. If digits could plausibly be read more than one way (e.g. a "1" that could be a "7", a "5" that could be a "6" or "8", a "2" that could be a "26" vs "25"), set uncertain:true even if you have a best guess — your best guess still goes in the field, but flagged.
- If a date format is genuinely unclear or the document quality makes a date hard to read, set "uncertain": true on that vaccine entry rather than guessing confidently.
- Double-check that "dateGiven" is chronologically BEFORE "nextDue" for every vaccine. If a parsed date would place "nextDue" before "dateGiven", you have likely misread a digit — re-examine the handwriting and, if still unclear after re-checking, set uncertain:true rather than forcing a date order that doesn't make sense.
- Extract "colour" from fields like "Colour: Yellow", "Color: Black", etc.
- Extract "sex" from fields like "Sex: Female", "Sex: Male", "Bitch", "Dog"
- Extract "breed" from "Breed:" field on pedigree certificates. Use the exact full breed name as commonly registered in Australia (e.g. "Labrador Retriever" not "Labrador", "Staffordshire Bull Terrier" not "Staffy").
- Extract "ankc" from registration numbers on pedigree certificates
- Extract "microchip" from microchip/chip numbers
- If document is a microchip registration or implant certificate, set documentType to "microchip_cert"
- For vaccines: extract each vaccine as a separate entry in the vaccines array
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

      // Safety net: if a vaccine's dateGiven is after its nextDue, the model
      // likely mixed up day/month somewhere. Don't silently trust it — flag
      // as uncertain so the user reviews it instead of acting on a bad date.
      if (Array.isArray(extracted.vaccines)) {
        extracted.vaccines = extracted.vaccines.map((v) => {
          if (v.dateGiven && v.nextDue && v.dateGiven > v.nextDue) {
            return { ...v, uncertain: true }
          }
          return v
        })
      }

      return res.status(200).json(extracted)
    } catch {
      return res.status(200).json({ documentType: 'other', vaccines: [], healthTest: null, raw: text })
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal error', message: String(err) })
  }
}
