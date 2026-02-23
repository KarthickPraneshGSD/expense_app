# 🔥 SpendWise — Firebase Setup Guide

Your app now uses **Firebase** as its backend with a **scalable subcollection architecture**.
Each expense and budget is its own Firestore document — supports years of data with no limits.

---

## 📐 Database Structure

```
Firestore
├── usernames/
│   └── {username}                    → { uid, createdAt }
│
└── users/
    └── {uid}                         → { username, createdAt }
        ├── expenses/
        │   └── {auto-id}             → { desc, amt, date, createdAt }
        │   └── {auto-id}             → { desc, amt, date, createdAt }
        │   └── ...                   (one doc per expense — unlimited)
        │
        └── budgets/
            └── 2026-01-15            → { amount: 500 }
            └── 2026-01-16            → { amount: 300 }
            └── ...                   (one doc per day)
```

**Why this design?**
- ✅ No document size limits (old array design hits 1MB limit at ~10,000 expenses)
- ✅ Fast date-range queries (e.g., "show January expenses")
- ✅ Real-time sync per collection
- ✅ Works offline — data cached on device, syncs when back online
- ✅ Admin can query across all users

---

## Step 1 — Create a Free Firebase Project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → Name it `spendwise`
3. Disable Google Analytics → Click **"Create project"**

---

## Step 2 — Enable Firebase Authentication

1. Click **"Authentication"** in the left sidebar
2. Click **"Get started"**
3. Click **"Email/Password"** → Toggle **Enable** → Click **"Save"**

---

## Step 3 — Create Firestore Database

1. Click **"Firestore Database"** in the left sidebar
2. Click **"Create database"**
3. Choose **"Start in production mode"** (we'll set proper rules below)
4. Select a location close to you:
   - India → `asia-south1 (Mumbai)`
   - US    → `us-central1`
5. Click **"Enable"**

---

## Step 4 — Get Your Firebase Config

1. Click the **⚙️ gear icon** → **"Project settings"**
2. Scroll to **"Your apps"** → Click **"</> Web"**
3. Name it `SpendWise` → Click **"Register app"**
4. Copy the config object shown

---

## Step 5 — Paste Config into script.js

Open `script.js` → find lines 16–23 at the top:

```js
const firebaseConfig = {
  apiKey:            "PASTE_YOUR_API_KEY",
  authDomain:        "PASTE_YOUR_AUTH_DOMAIN",
  projectId:         "PASTE_YOUR_PROJECT_ID",
  storageBucket:     "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID",
  appId:             "PASTE_YOUR_APP_ID"
};
```

Replace each `"PASTE_YOUR_..."` with your real values.

---

## Step 6 — Set Firestore Security Rules

In Firebase Console → Firestore → **Rules** tab, paste this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Username lookup table — any logged-in user can read/create
    match /usernames/{username} {
      allow read:   if request.auth != null;
      allow create: if request.auth != null;
      allow delete: if request.auth != null;
      allow update: if request.auth != null;
    }

    // User profile — only the owner can write; any logged-in user can read
    // (any logged-in user read is needed for admin panel)
    match /users/{uid} {
      allow read:   if request.auth != null;
      allow write:  if request.auth != null && request.auth.uid == uid;
      allow delete: if request.auth != null;

      // Expenses subcollection — only owner can read/write
      match /expenses/{expenseId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
        allow delete:      if request.auth != null;
      }

      // Budgets subcollection — only owner can read/write
      match /budgets/{date} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
        allow delete:      if request.auth != null;
      }
    }
  }
}
```

Click **"Publish"**.

---

## Step 7 — Create Firestore Indexes (for fast queries)

The app queries expenses ordered by `date` and `createdAt`.
Firebase will prompt you to create the index automatically when you first run the app —
just click the link in the browser console error message.

Or create it manually:
1. Firebase Console → Firestore → **Indexes** tab
2. Click **"Add index"**
3. Collection: `expenses`
4. Fields: `date (Descending)`, `createdAt (Descending)`
5. Click **"Create"**

---

## Step 8 — Deploy to Netlify (Go Live!)

1. Go to **https://app.netlify.com/drop**
2. Select your 3 files: `index.html`, `script.js`, `style.css`
3. Drag them onto the Netlify Drop page
4. Get your live URL! 🎉

---

## Admin Credentials

| Field    | Value         |
|----------|---------------|
| Username | `adminsystem` |
| Password | `kratos`      |

To change: edit lines 26–27 in `script.js`:
```js
const ADMIN_USER = 'adminsystem';
const ADMIN_PASS = btoa('kratos');
```

---

## Offline Support

The app uses **Firestore offline persistence** — this means:
- ✅ Data is cached on the device automatically
- ✅ Users can view and add expenses even without internet
- ✅ Changes sync to the cloud when connection is restored
- ✅ If a user's device is lost, all data is safe in Firebase

---

## Data Capacity

| Item              | Limit                     |
|-------------------|---------------------------|
| Expenses per user | Unlimited (each is 1 doc) |
| Budgets per user  | Unlimited (each is 1 doc) |
| Free tier reads   | 50,000 / day              |
| Free tier writes  | 20,000 / day              |
| Free tier storage | 1 GB                      |

A user with 10 expenses/day for 1 year = **3,650 documents** — well within free limits.
