import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // ── HOME SCREEN QUICK ACTION ──────────────────────────────────────────────────
  // hadar, 2026-08-19: a one-press "create change order" from the home screen.
  //
  // NO NATIVE MODULE AND NO NEW DEPENDENCY. A shortcut cannot open a URL by itself —
  // UIKit hands it to this method — so this turns it into the app's OWN deep link and
  // feeds it to RCTLinkingManager, which is the exact path the sign-in link already
  // travels (see `application(_:open:)` above). JS therefore needs one more case in a
  // listener it already has, rather than a new bridge.
  //
  // ONE DELAYED POST WAS NOT ENOUGH, AND THE "BELT AND BRACES" CLAIM WAS WRONG
  // (code review, 2026-08-23).
  //
  // On a COLD start the shortcut fires while React Native is still coming up. A quick
  // action does not populate `launchOptions[.url]`, so `Linking.getInitialURL()` cannot
  // recover it, and `RCTOpenURLNotification` is DROPPED outright when no JS listener is
  // subscribed yet. `pendingCapture` in App.tsx only helps once that listener has fired,
  // so it is not an independent second net — it is downstream of the very event that got
  // lost. A single 0.35 s post therefore did nothing at all whenever the bridge took
  // longer than 350 ms to mount, which on a jobsite handset is the ordinary case.
  //
  // So post REPEATEDLY across the window a cold start actually takes. Each attempt
  // carries the SAME nonce, and JS ignores a nonce it has already taken, so the retries
  // cost nothing once one has landed and cannot re-open capture after the user has
  // navigated away. A second long-press is a new invocation with a new nonce and is
  // honoured normally.
  //
  // Still no native module and no new dependency: this is the same RCTLinkingManager
  // path the sign-in link travels, posted more than once.
  private static let quickActionRetryDelays: [TimeInterval] = [0.35, 1.0, 2.0, 3.5, 5.0, 7.0]

  public override func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard shortcutItem.type == "com.hilo.ezjobsite.capture" else {
      completionHandler(false)
      return
    }
    let nonce = UUID().uuidString
    guard let url = URL(string: "ezjobsite://capture?n=\(nonce)") else {
      completionHandler(false)
      return
    }
    for delay in Self.quickActionRetryDelays {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        RCTLinkingManager.application(application, open: url, options: [:])
      }
    }
    completionHandler(true)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
