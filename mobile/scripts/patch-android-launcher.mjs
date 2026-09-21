import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const mobileRoot = path.resolve(scriptDir, '..')
const androidRoot = path.join(mobileRoot, 'android')
const appId = (process.env.IDOGS_MOBILE_APP_ID || 'au.com.idogs.app').trim()

if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(appId)) {
  throw new Error(`Invalid Android app id: ${appId}`)
}

const packageDir = path.join(androidRoot, 'app', 'src', 'main', 'java', ...appId.split('.'))
const mainActivityPath = path.join(packageDir, 'MainActivity.java')
const manifestPath = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml')

if (!fs.existsSync(mainActivityPath)) {
  throw new Error(`Generated MainActivity not found: ${mainActivityPath}`)
}
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Generated AndroidManifest not found: ${manifestPath}`)
}

const mainActivity = `package ${appId};

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Native launcher policy for iDogs.
 *
 * A launcher tap is intentionally different from a deep link:
 * - MAIN + LAUNCHER always enters through Capacitor's configured startPath
 *   (/login). LoginPage then sends an existing authenticated session to the
 *   dashboard.
 * - VIEW/deep-link intents are left to Capacitor so passport/showcase links
 *   keep their destination.
 *
 * Passing null saved state for a launcher cold start prevents Android from
 * restoring an old WebView navigation stack over the configured startPath.
 */
public class MainActivity extends BridgeActivity {
    private static boolean isLauncherIntent(Intent intent) {
        return intent != null
            && Intent.ACTION_MAIN.equals(intent.getAction())
            && intent.hasCategory(Intent.CATEGORY_LAUNCHER);
    }

    private void resetToNativeStartPath() {
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        bridge.getWebView().loadUrl(bridge.getAppUrl());
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        final boolean launcher = isLauncherIntent(getIntent());
        super.onCreate(launcher ? null : savedInstanceState);
        if (launcher) {
            resetToNativeStartPath();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isLauncherIntent(intent)) {
            resetToNativeStartPath();
        }
    }
}
`

fs.writeFileSync(mainActivityPath, mainActivity, 'utf8')

let manifest = fs.readFileSync(manifestPath, 'utf8')
const activityPattern = /<activity\b(?=[^>]*android:name="\.MainActivity")[^>]*>/s
const activityMatch = manifest.match(activityPattern)
if (!activityMatch) {
  throw new Error('MainActivity <activity> entry not found in AndroidManifest.xml')
}

let patchedActivity = activityMatch[0]
if (/android:launchMode="[^"]*"/.test(patchedActivity)) {
  patchedActivity = patchedActivity.replace(/android:launchMode="[^"]*"/, 'android:launchMode="singleTask"')
} else {
  patchedActivity = patchedActivity.replace(/>$/, '\n            android:launchMode="singleTask">')
}
manifest = manifest.replace(activityPattern, patchedActivity)
fs.writeFileSync(manifestPath, manifest, 'utf8')

console.log(`Patched Android launcher policy for ${appId}`)
console.log(`MainActivity: ${path.relative(mobileRoot, mainActivityPath)}`)
console.log('Launch mode: singleTask')
console.log('Launcher route: Capacitor startPath (expected /login)')
