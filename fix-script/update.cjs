const fs = require('fs');
const { getAccessToken } = require('./auth.cjs');

async function main() {
  if (!fs.existsSync('./matches.json')) {
    console.error('matches.json not found — run dry-run.js first.');
    process.exit(1);
  }

  const matches = JSON.parse(fs.readFileSync('./matches.json', 'utf-8'));
  if (matches.length === 0) {
    console.log('No matches to update.');
    return;
  }

  console.log(`About to update ${matches.length} documents (replacing "AI Scan" with "iDogs Scan" in the details field).`);
  console.log('Press Ctrl+C within 5 seconds to cancel...\n');
  await new Promise(r => setTimeout(r, 5000));

  const token = await getAccessToken();
  let updated = 0;

  for (const m of matches) {
    const newDetails = m.details.replaceAll('AI Scan', 'iDogs Scan');

    // PATCH only the `details` field, using updateMask so nothing else
    // on the document is touched.
    const url = `https://firestore.googleapis.com/v1/${m.name}?updateMask.fieldPaths=details`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          details: { stringValue: newDetails },
        },
      }),
    });

    if (res.ok) {
      updated++;
      console.log(`✓ [${m.id}] updated`);
    } else {
      const err = await res.text();
      console.error(`✗ [${m.id}] failed: ${err}`);
    }
  }

  console.log(`\nDone. ${updated}/${matches.length} documents updated.`);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
