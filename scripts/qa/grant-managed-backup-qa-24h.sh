#!/usr/bin/env bash
# Owner approved 28 October 2026: ten missing staging QA privileges for 24 hours.
# Execute only in an existing Google Cloud administrator session. No key export.
set -euo pipefail
qa_role_file=$(mktemp)
qa_condition_file=$(mktemp)
qa_identity_file=$(mktemp)
trap 'rm -f "$qa_role_file" "$qa_condition_file" "$qa_identity_file"' EXIT
gcloud projects describe idogs-app-staging --format=json > "$qa_identity_file"
python3 - "$qa_identity_file" <<'PY'
import json, sys
p=json.load(open(sys.argv[1]))
if p.get('projectId')!='idogs-app-staging' or str(p.get('projectNumber'))!='530003937245' or p.get('lifecycleState')!='ACTIVE':
    raise SystemExit('STOP: staging project identity mismatch')
PY
if ! gcloud iam roles describe idogsManagedBackupQa20261028 --project=idogs-app-staging --format=json > "$qa_role_file"; then
  gcloud iam roles create idogsManagedBackupQa20261028 \
    --project=idogs-app-staging --title='iDogs managed backup QA temporary privileges' --stage=GA \
    --permissions=datastore.databases.create,datastore.databases.delete,datastore.locations.get,datastore.locations.list,datastore.backups.delete,datastore.backups.restoreDatabase,datastore.backupSchedules.create,datastore.backupSchedules.delete,firebaserules.rulesets.test,firebaserules.releases.create --format=none
  gcloud iam roles describe idogsManagedBackupQa20261028 --project=idogs-app-staging --format=json > "$qa_role_file"
fi
python3 - "$qa_role_file" "$qa_condition_file" <<'PY'
import datetime, json, sys
r=json.load(open(sys.argv[1]))
expected={'datastore.databases.create','datastore.databases.delete','datastore.locations.get','datastore.locations.list','datastore.backups.delete','datastore.backups.restoreDatabase','datastore.backupSchedules.create','datastore.backupSchedules.delete','firebaserules.rulesets.test','firebaserules.releases.create'}
if r.get('name')!='projects/idogs-app-staging/roles/idogsManagedBackupQa20261028' or set(r.get('includedPermissions',[]))!=expected or r.get('deleted') or r.get('stage')!='GA':
    raise SystemExit('STOP: existing role does not match the ten approved permissions')
expiry=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
condition={'title':'idogs-managed-backup-qa-24h','description':'Owner-approved synthetic managed backup QA only','expression':f'request.time < timestamp("{expiry}")'}
with open(sys.argv[2],'w') as f: json.dump(condition,f)
print('Temporary QA binding expires at',expiry)
PY
gcloud projects add-iam-policy-binding idogs-app-staging \
  --member='serviceAccount:firebase-adminsdk-fbsvc@idogs-app-staging.iam.gserviceaccount.com' \
  --role='projects/idogs-app-staging/roles/idogsManagedBackupQa20261028' \
  --condition-from-file="$qa_condition_file" --format=none
gcloud projects get-iam-policy idogs-app-staging --format=json > "$qa_identity_file"
python3 - "$qa_identity_file" "$qa_condition_file" <<'PY'
import json, sys
p=json.load(open(sys.argv[1])); expected=json.load(open(sys.argv[2]))
role='projects/idogs-app-staging/roles/idogsManagedBackupQa20261028'
member='serviceAccount:firebase-adminsdk-fbsvc@idogs-app-staging.iam.gserviceaccount.com'
matches=[b for b in p.get('bindings',[]) if b.get('role')==role and member in b.get('members',[])]
if len(matches)!=1 or matches[0].get('condition')!=expected:
    raise SystemExit('STOP: expected exact time-limited binding not verified')
print('PASS: exact staging-only time-limited QA binding verified. No QA resources created.')
PY
