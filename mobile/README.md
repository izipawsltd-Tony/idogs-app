# iDogs Mobile App Foundation

This folder contains the Capacitor mobile shell for the existing iDogs React/Vite app.

## Locked identity

- App name: `iDogs`
- Bundle / application ID: `au.com.idogs.app`
- Web build source: `../dist`
- App icon source: `../public/02_idogs_icon_transparent.png`
- Horizontal brand source: `../public/01_idogs_primary_horizontal_transparent.png`

## Phase 1 workflow

From the repository root:

1. Build the existing web app: `npm ci && npm run build`
2. Install mobile dependencies: `npm --prefix mobile install`
3. Prepare branding sources: `npm --prefix mobile run branding`
4. Generate Android project: `npm --prefix mobile run add:android`
5. Generate iOS project on macOS: `npm --prefix mobile run add:ios`
6. Sync the latest web build: `npm --prefix mobile run sync`

Capacitor 8 requires Node.js 22 or newer for mobile tooling. The existing web CI remains unchanged while this mobile foundation is developed on its feature branch.

## Guardrails

- Do not point the mobile app at a different Firebase project without explicit approval.
- Do not change Stripe, Firebase rules, Storage/CORS, Resend, or production environment variables as part of mobile foundation work.
- Production web deployment remains a separate approval gate.
- Native platform folders are generated artifacts during Phase 1. They will only be committed once the generated Android/iOS projects have been reviewed and the asset pipeline is finalised.

## Next phases

- Native splash/icon generation from the approved iDogs branding.
- Camera and document upload integration.
- Push notifications and deep links.
- Biometric sign-in convenience layer.
- TestFlight and Google Play internal testing.
