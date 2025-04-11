# Moose App

## 🚀 Features

- 📱 Cross-platform mobile application (iOS & Android)
- 🗺️ Interactive maps with location services
- 📸 Camera integration for photo capture
- 🔒 Secure storage for sensitive data
- 🌐 Web browser integration
- 🔄 Real-time data synchronization with Supabase
- 🎨 Modern UI with React Native Paper components
- 📝 Markdown support for rich text display
- 🔍 TypeScript for type-safe development

## 🛠️ Tech Stack

- **Framework**: Expo (v52.0.41)
- **Language**: TypeScript
- **UI Components**: React Native Paper
- **Database**: Supabase
- **Maps**: React Native Maps
- **State Management**: React Hooks
- **Testing**: Jest

## 📋 Prerequisites

- Node.js (LTS version recommended)
- npm or yarn
- Expo CLI
- iOS Simulator (for Mac users) or Android Studio (for Android development)

## 🔧 Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd better-app-in-4-days
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Create a `.env` file in the root directory with the following variables:
```
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 🚀 Running the App

- Start the development server:
```bash
npm start
# or
yarn start
```

- Run on iOS:
```bash
npm run ios
# or
yarn ios
```

- Run on Android:
```bash
npm run android
# or
yarn android
```

- Run on Web:
```bash
npm run web
# or
yarn web
```


## 📁 Project Structure

```
├── app/              # Main application screens and navigation
├── components/       # Reusable UI components
├── constants/        # Application constants
├── hooks/           # Custom React hooks
├── services/        # API and external service integrations
├── utils/           # Utility functions
├── assets/          # Static assets (images, fonts, etc.)
└── api/             # API related code
```