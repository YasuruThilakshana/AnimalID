# AnimalID (React + Vite)

Pet registration, scannable IDs, and a lost & found alerts hub.

## Firebase setup (Auth + Firestore)

1. Create a project in the [Firebase Console](https://console.firebase.google.com), add a Web app, and enable **Authentication → Email/Password** plus **Firestore Database**.
2. Copy `.env.example` to `.env` and fill in the `VITE_FIREBASE_*` values from Project Settings → Your apps.
3. `npm install && npm run dev`.

Without a `.env`, the app runs in offline demo mode (localStorage seed data).
Auth uses Firebase Auth; pet profiles live in the `pets` collection, missing-pet
alerts in `alerts`, and area-alert signups in `alertSubscriptions`. Pet photos
are stored as inline Base64 data URLs — no Storage bucket needed.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
