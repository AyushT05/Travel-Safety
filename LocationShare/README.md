# Location Share — React Native (Expo)

A mobile app that shares your live GPS location to your backend server.

---

## 🚀 Quick Setup (5 minutes)

### 1. Install Node.js
Download from https://nodejs.org (LTS version)

### 2. Install Expo CLI
```bash
npm install -g expo-cli
```

### 3. Install dependencies
```bash
cd LocationShare
npm install
```

### 4. Set your server URL
Open `App.js` and replace the SERVER constant:
```js
const SERVER = 'https://your-server-url.onrender.com';
```

### 5. Run the app
```bash
npx expo start
```

This opens a QR code in your terminal.

---

## 📱 Test on your phone (no cable needed)

1. Install **Expo Go** on your phone:
   - iOS: https://apps.apple.com/app/expo-go/id982107779
   - Android: https://play.google.com/store/apps/details?id=host.exp.exponent

2. Scan the QR code shown after `npx expo start`

3. The app loads instantly on your phone!

---

## 📦 Build for App Store / Play Store

When you're ready to publish:

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo account (free)
eas login

# Build for both platforms
eas build --platform all
```

EAS Build handles signing, certificates, and generates .ipa (iOS) and .apk/.aab (Android) files.

---

## 🗂 Project Structure

```
LocationShare/
├── App.js          ← Main screen (all UI + logic)
├── app.json        ← Expo config + permissions
├── package.json    ← Dependencies
├── babel.config.js ← Babel config
└── assets/         ← App icons (add your own)
```

---

## 🔧 Key Features

- ✅ Live GPS tracking via `expo-location`
- ✅ POST updates to your `/update-location` endpoint
- ✅ Animated live pulse indicator
- ✅ Error handling (permission denied, server unreachable)
- ✅ Update counter
- ✅ Works on iOS & Android

---

## 🔑 Permissions

The app requests:
- **iOS**: `NSLocationWhenInUseUsageDescription`
- **Android**: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`

These are declared in `app.json` — no extra setup needed.

---

## 🛠 Future Improvements

- Background location tracking (use `expo-task-manager`)
- Map view showing your current position
- Multiple users on one dashboard
- Offline queue (retry failed updates when back online)
