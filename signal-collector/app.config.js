/**
 * SignalCollector app configuration.
 *
 * Plain JS (not TS) on purpose: the EAS CLI's TypeScript config loader can
 * fail with "Cannot read properties of undefined (reading 'CommonJS')" on
 * some Node/ts-node combos. JS sidesteps that entirely.
 *
 * Location permission strings are deliberately explicit: reviewers on both
 * app stores reject vague background-location justifications. Background
 * location is OFF by default and only started when the user opts in from
 * Settings.
 */
module.exports = ({ config }) => ({
  ...config,
  name: 'SignalCollector',
  slug: 'signal-collector',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'signalcollector',
  userInterfaceStyle: 'dark',
  /**
   * Opt out of the New Architecture (default-on in SDK 54).
   *
   * react-native-maps renders through Fabric's legacy view-manager interop
   * layer, whose finalizeUpdates: throws NSRangeException when a map's
   * marker children are inserted/reordered — crashing the app outright
   * (confirmed in a device crash log). The legacy architecture uses
   * react-native-maps' native view manager directly and does not have this
   * failure mode. Revisit when react-native-maps ships a real Fabric
   * component (the legacy architecture is removed in SDK 55).
   */
  newArchEnabled: false,
  ios: {
    bundleIdentifier: 'com.signalcollector.app',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'SignalCollector records your GPS position, speed and heading alongside each traffic-signal observation while you are collecting data.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'If you enable background collection in Settings, SignalCollector continues recording GPS samples during an active collection session while the app is in the background. Tracking stops when the session ends.',
      UIBackgroundModes: ['location'],
    },
  },
  android: {
    package: 'com.signalcollector.app',
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
    ],
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'SignalCollector records your GPS position, speed and heading alongside each traffic-signal observation.',
        locationAlwaysAndWhenInUsePermission:
          'If you enable background collection in Settings, SignalCollector keeps recording GPS samples during an active session while the app is backgrounded. Tracking stops when the session ends.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: 'eaa7d9f7-bea5-4341-b8e8-ac3c2b759eac',
    },
  },
  owner: 'istlyfe',
});
