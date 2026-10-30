
package android.util
object Log {
  fun i(tag: String, msg: String) = 0
  fun w(tag: String, msg: String) = 0
  fun w(tag: String, msg: String, t: Throwable) = 0
  fun d(tag: String, msg: String) = 0
  fun e(tag: String, msg: String) = 0
}
