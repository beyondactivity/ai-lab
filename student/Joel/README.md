# Forget-Me-Not: GitHub Pages + Firebase

index.html is the whole app. GitHub hosts it; Firebase handles sign-in and stores the data.

## 1. Host on GitHub Pages
Put index.html at the root of your repo (or in /docs), then
Settings > Pages > choose the branch and folder > Save.
Your site will be at https://<your-username>.github.io/<repo>/

## 2. Firebase console (project pixel-outlaws)
1. Authentication > Sign-in method > turn on Email/Password.
2. Authentication > Settings > Authorized domains > Add domain: <your-username>.github.io
   (Without this, sign-in from your GitHub site is refused.)
3. Firestore Database > Create database, if the project has none.
4. Firestore Database > Rules > paste the `match /forgetmenot/{uid}` block from
   firestore.rules into your existing rules and Publish.
   If Pixel Outlaws does not use Firestore, you can paste the whole file instead.
   (Or run: firebase deploy --only firestore:rules --project pixel-outlaws, which
   replaces ALL rules in the project.)

The app only reads and writes forgetmenot/{your user id}, and the rules let each
person touch only their own document.

## Notes
- The apiKey in the page is meant to be public. The rules above are what protect the data.
- Do not commit firebase-tools login files or service account keys.
