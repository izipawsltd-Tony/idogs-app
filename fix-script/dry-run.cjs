const { getAccessToken, projectId } = require('./auth.cjs');

function decodeFirestoreValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return v.integerValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  return v;
}

async function main() {
  const token = await getAccessToken();
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  let pageToken = undefined;
  let totalScanned = 0;
  const matches = [];

  do {
    const url = `${baseUrl}/auditLogs?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();

    if (data.error) {
      console.error('Firestore API error:', JSON.stringify(data.error));
      process.exit(1);
    }

    const docs = data.documents || [];
    totalScanned += docs.length;

    for (const doc of docs) {
      const fields = doc.fields || {};
      const details = fields.details ? decodeFirestoreValue(fields.details) : '';
      if (typeof details === 'string' && details.includes('AI Scan')) {
        matches.push({
          name: doc.name, // full resource path, needed for PATCH later
          id: doc.name.split('/').pop(),
          dogName: fields.dogName ? decodeFirestoreValue(fields.dogName) : '',
          details,
        });
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  console.log(`Scanned ${totalScanned} auditLogs documents.`);
  console.log(`Found ${matches.length} documents containing "AI Scan":\n`);
  for (const m of matches) {
    console.log(`- [${m.id}] ${m.dogName}: "${m.details}"`);
  }

  // Write matches to a file so the update script can reuse them without re-scanning
  require('fs').writeFileSync('./matches.json', JSON.stringify(matches, null, 2));
  console.log(`\nSaved ${matches.length} matches to matches.json — review before running update.js`);
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
