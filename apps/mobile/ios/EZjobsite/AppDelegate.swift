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
  // THE DELAY IS NOT A FLOURISH. On a COLD start the shortcut fires while React Native is
  // still coming up, and `Linking.getInitialURL()` cannot see it — a quick action does not
  // populate `launchOptions[.url]`, so an immediately-posted URL lands before any JS
  // listener exists and is lost. The app side ALSO holds the intent in state until it is
  // ready (see `pendingCapture` in App.tsx), so this is belt and braces: either half alone
  // would drop the cold case some of the time.
  public override func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard shortcutItem.type == "com.hilo.ezjobsite.capture",
          let url = URL(string: "ezjobsite://capture") else {
      completionHandler(false)
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
      RCTLinkingManager.application(application, open: url, options: [:])
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
