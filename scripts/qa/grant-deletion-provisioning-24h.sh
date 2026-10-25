#!/usr/bin/env bash
# Run manually in Google Cloud Shell as a project IAM administrator.
# User-authorised scope: exactly three staging-only permissions for 24 hours.
set -euo pipefail
qa_role_file=$(mktemp)
qa_condition_file=$(mktemp)
trap 'rm -f "$qa_role_file" "$qa_condition_file"' EXIT
if ! gcloud iam roles describe idogsDeletionQaProvisioner20261025 --project=idogs-app-staging --format=json > "$qa_role_file"; then
  gcloud iam roles create idogsDeletionQaProvisioner20261025 \
    --project=idogs-app-staging --title='iDogs deletion QA provisioning' --stage=GA \
    --permissions=datastore.databases.create,firebaserules.rulesets.test,firebaserules.releases.create --format=none
  gcloud iam roles describe idogsDeletionQaProvisioner20261025 --project=idogs-app-staging --format=json > "$qa_role_file"
fi
python3 - "$qa_role_file" "$qa_condition_file" <<'PY'
import datetime, json, sys
role=json.load(open(sys.argv[1]))
expected={'datastore.databases.create','firebaserules.rulesets.test','firebaserules.releases.create'}
if role.get('name')!='projects/idogs-app-staging/roles/idogsDeletionQaProvisioner20261025' or set(role.get('includedPermissions',[]))!=expected or role.get('deleted') or role.get('stage')!='GA':
    raise SystemExit('STOP: existing role does not match the three authorised permissions')
expiry=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(sys.argv[2],'w') as f:
    json.dump({'title':'idogs-deletion-qa-24h','description':'Owner-authorised staging QA resource provisioning only','expression':f'request.time < timestamp("{expiry}")'},f)
print('Temporary binding expires at',expiry)
PY
gcloud projects add-iam-policy-binding idogs-app-staging \
  --member='serviceAccount:firebase-adminsdk-fbsvc@idogs-app-staging.iam.gserviceaccount.com' \
  --role='projects/idogs-app-staging/roles/idogsDeletionQaProvisioner20261025' \
  --condition-from-file="$qa_condition_file" --format=none
printf '%s\n' 'Staging-only temporary provisioning grant saved. No resources have been created by this script.'
