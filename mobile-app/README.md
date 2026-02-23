# Daily Expense — Mobile App (Expo)

This is a minimal Expo React Native starter demonstrating local auth (AsyncStorage) and expense tracking.

To run:

1. Install Expo CLI: `npm install -g expo-cli`
2. From this folder run:

```bash
npm install
npm start
```

Open on your device with the Expo Go app or run in an emulator.

Server integration:
- The mobile app can talk to a local server at `http://10.0.2.2:4000` by default (Android emulator). For iOS simulator or devices, change `API_URL` in `App.js` to point to your machine (e.g., `http://localhost:4000` or your LAN IP).
- When `USE_SERVER` is true the app uses the Express API in `../server` for register/login/budget/expenses.

Notes:
- This demo uses local storage or a simple local server — not secure for production. For real apps, use a hosted backend and secure auth (OAuth or managed auth providers).
