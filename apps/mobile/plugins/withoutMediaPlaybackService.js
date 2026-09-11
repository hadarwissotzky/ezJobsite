const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Remove expo-audio's mediaPlayback foreground service from the Android manifest.
 *
 * expo-audio ships a static <service> for AudioControlsService with
 * foregroundServiceType="mediaPlayback" — the lock-screen media-controls service. It is
 * started ONLY by the setActiveForLockScreen(true) JS API, which this app never calls
 * (we record on site and play recordings back in the foreground for review; we never
 * play audio in the background with lock-screen controls). Its mere declaration,
 * though, makes Google Play classify the app as a background media player and demand a
 * FOREGROUND_SERVICE_MEDIA_PLAYBACK justification we cannot honestly give.
 *
 * So strip the <service> node here. The matching FOREGROUND_SERVICE_MEDIA_PLAYBACK
 * permission is stripped separately via android.blockedPermissions in app.json
 * (blockedPermissions removes <uses-permission> entries but cannot remove a <service>).
 * Background RECORDING keeps working: that runs on AudioRecordingService
 * (foregroundServiceType="microphone"), a different service this plugin leaves alone.
 */
const SERVICE = 'expo.modules.audio.service.AudioControlsService';

module.exports = function withoutMediaPlaybackService(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (Array.isArray(app?.service)) {
      app.service = app.service.filter(
        (s) => s?.$?.['android:name'] !== SERVICE,
      );
    }
    return cfg;
  });
};
