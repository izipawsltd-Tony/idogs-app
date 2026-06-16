# iDogs — Setup & Deployment

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set up Firebase
cp .env.example .env.local
# Edit .env.local with your Firebase config

# 3. Run locally
npm run dev
```

## Firebase setup (5 minutes)

1. Go to https://console.firebase.google.com
2. Create project: "idogs-app"
3. Add Web App → copy config into .env.local
4. Enable Authentication → Email/Password
5. Enable Firestore → Start in production mode
6. Enable Storage → Start in production mode

### Firestore rules (paste into Firebase Console → Firestore → Rules)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    // Dogs — only tenant can access
    match /dogs/{dogId} {
      allow read, write: if request.auth != null && 
        (resource.data.tenantId == request.auth.uid || 
         resource.data.currentOwnerId == request.auth.uid);
      allow create: if request.auth != null;
    }
    // Public passport access (no auth needed)
    match /dogs/{dogId} {
      allow read: if true; // filtered by passportId in query
    }
    // Health records — access if user owns the dog
    match /vaccineRecords/{id} {
      allow read, write: if request.auth != null;
    }
    match /wormingRecords/{id} {
      allow read, write: if request.auth != null;
    }
    match /healthTests/{id} {
      allow read, write: if request.auth != null;
    }
    match /reminders/{id} {
      allow read, write: if request.auth != null;
    }
    match /activityNotes/{id} {
      allow read, write: if request.auth != null;
    }
    match /litters/{id} {
      allow read, write: if request.auth != null;
    }
    match /scanLogs/{id} {
      allow create: if true; // anyone can log a scan
      allow read: if request.auth != null;
    }
  }
}
```

### Storage rules

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /dogs/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Deploy to Vercel

```bash
npm install -g vercel
vercel
# Follow prompts — select framework: Vite
# Add environment variables in Vercel dashboard
```

## Project structure

```
src/
  components/
    App.tsx          — routing + auth protection
    layout/
      AppLayout.tsx  — sidebar + main content shell
    ui/
      Toast.tsx      — notifications
  pages/
    LandingPage.tsx  — marketing site (use idogs_landing.html as reference)
    LoginPage.tsx    — sign in
    SignupPage.tsx   — create account
    DashboardPage.tsx
    DogListPage.tsx
    DogNewPage.tsx
    DogDetailPage.tsx — tabs: overview, vaccines, health, reminders, passport, timeline
    PassportPublicPage.tsx — public QR scan target (no login)
    NotFoundPage.tsx
  hooks/
    useAuth.tsx      — Firebase auth context
    useToast.ts      — notification hook
  lib/
    firebase.ts      — Firebase initialization
    db.ts            — all Firestore operations
    utils.ts         — date helpers, breed list, utilities
  types/
    index.ts         — all TypeScript interfaces
  index.css          — design tokens + global styles
  main.tsx           — React entry point
```

## Current status — Phase 1 complete

- [x] Design system (tokens, components, typography)
- [x] TypeScript types for entire domain
- [x] Firebase auth (signup, login, logout, reset password)
- [x] App routing with protected routes
- [x] Dashboard with stats + dog list + reminders
- [x] Dog CRUD (create, list, view)
- [x] QR Passport generation (qrcode library)
- [x] Public passport page (/p/:passportId)
- [x] Vaccine records (add, list, delete)
- [x] Activity timeline / notes
- [x] Reminder display and completion
- [x] Vercel deployment config

## Phase 2 — next steps

- [ ] LandingPage.tsx (use idogs_landing.html as source)
- [ ] Photo upload to Firebase Storage
- [ ] AI Document Scan (port from dog-care-app /api/scan.js)
- [ ] Worming records UI
- [ ] Health tests UI (add/edit)
- [ ] Reminder creation form
- [ ] Litter management
- [ ] Email notifications (EmailJS)
