const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Remove expo-audio's mediaPlayback foreground service from the Android build.
 *
 * expo-audio ships a static <service> for AudioControlsService with
 * foregroundServiceType="mediaPlayback" — the lock-screen media-controls service. It is
 * started ONLY by the setActiveForLockScreen(true) JS API, which this app never calls
 * (we record on site and play recordings back in the foreground for review; we never
 * play audio in the background with lock-screen controls). Its mere declaration, though,
 * makes Google Play classify the app as a background media player and demand a
 * FOREGROUND_SERVICE_MEDIA_PLAYBACK justification we cannot honestly give.
 *
 * WHY tools:node="remove" AND NOT array filtering. This service is contributed by
 * expo-audio's OWN library manifest, which the Android Gradle manifest merger folds in
 * at BUILD time — AFTER config plugins run. At config-plugin time it is simply not in
 * the app manifest yet, so filtering application.service here removes nothing and the
 * service survives into the build. The merger's own removal marker is the only thing
 * that reaches a library-contributed node: we add a matching <service> stub carrying
 * tools:node="remove", and the merger drops expo-audio's contribution during the merge.
 * (This is the same mechanism android.blockedPermissions uses to strip the paired
 * FOREGROUND_SERVICE_MEDIA_PLAYBACK uses-permission.)
 *
 * Background RECORDING is untouched: that runs on AudioRecordingService
 * (foregroundServiceType="microphone"), a different service this plugin leaves alone.
 */
const SERVICE = 'expo.modules.audio.service.AudioControlsService';
const TOOLS_NS = 'http://schemas.android.com/tools';

module.exports = function withoutMediaPlaybackService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // The removal marker lives in the tools namespace; declare it on <manifest> once.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) manifest.$['xmlns:tools'] = TOOLS_NS;

    const app = manifest.application?.[0];
    if (!app) return cfg;
    app.service = app.service || [];

    // Idempotent: don't stack duplicate removal stubs on repeat prebuilds.
    const already = app.service.some(
      (s) =>
        s?.$?.['android:name'] === SERVICE &&
        s?.$?.['tools:node'] === 'remove',
    );
    if (!already) {
      app.service.push({ $: { 'android:name': SERVICE, 'tools:node': 'remove' } });
    }
    return cfg;
  });
};
