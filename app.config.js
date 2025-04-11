export default {
  expo: {
    name: "Moose Solar",
    slug: "moose-solar",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    jsEngine: "hermes",
    splash: {
      image: "./assets/splash.png",
      contentFit: "contain",
      backgroundColor: "#0066CC",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.moose.solar",
      buildNumber: "1.0.0",
      infoPlist: {
        NSCameraUsageDescription: "This app uses the camera to scan QR codes.",
        NSLocationWhenInUseUsageDescription:
          "This app uses your location to show nearby solar systems.",
        UIStatusBarStyle: "UIStatusBarStyleDarkContent",
        UIViewControllerBasedStatusBarAppearance: true,
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",
        backgroundColor: "#0066CC",
      },
      package: "com.moose.solar",
      versionCode: 1,
      permissions: ["CAMERA", "ACCESS_FINE_LOCATION"],
      softwareKeyboardLayoutMode: "pan",
      config: {
        windowSoftInputMode: "adjustResize",
      },
    },
    web: {
      favicon: "./assets/icon.png",
      bundler: "metro",
    },
    plugins: ["expo-router"],
    extra: {
      // Expose environment variables to the app
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      solarWebAccessKeyId: process.env.SOLAR_WEB_ACCESS_KEY_ID,
      solarWebAccessKeyValue: process.env.SOLAR_WEB_ACCESS_KEY_VALUE,
      solarWebUserId: process.env.SOLAR_WEB_USERID,
      solarWebPassword: process.env.SOLAR_WEB_PASSWORD,
      apiBaseUrl: process.env.API_BASE_URL,
      eas: {
        projectId: "a6e0a3fc-5475-4e55-819f-8257b0ea3fb3",
      },
    },
    experiments: {
      typedRoutes: true,
    },
  },
};
