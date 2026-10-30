
package android.app
open class Activity : android.content.Context() {
  fun requestPermissions(p: Array<String>, code: Int) {}
  fun shouldShowRequestPermissionRationale(p: String) = false
}
