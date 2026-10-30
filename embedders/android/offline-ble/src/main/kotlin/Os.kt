
package android.os
import java.util.PriorityQueue
class Looper private constructor() { companion object {
  private val MAIN = Looper()
  @JvmStatic fun myLooper(): Looper? = MAIN
  @JvmStatic fun getMainLooper(): Looper = MAIN
} }
object Scheduler {
  private class Task(val at: Long, val seq: Long, val r: Runnable)
  private var now = 0L
  private var seq = 0L
  private val queue = PriorityQueue<Task>(compareBy({ it.at }, { it.seq }))
  fun reset() { now = 0; seq = 0; queue.clear() }
  fun post(owner: Handler, r: Runnable, delay: Long = 0L) { queue.add(Task(now + delay, seq++, r)) }
  fun runCurrent() {
    while (true) {
      val t = queue.peek() ?: break
      if (t.at > now) break
      queue.poll(); now = t.at; t.r.run()
    }
  }
  fun advance(ms: Long) {
    val target = now + ms
    while (true) {
      val t = queue.peek() ?: break
      if (t.at > target) break
      queue.poll(); now = t.at; t.r.run()
    }
    now = target
  }
}
class Handler(looper: Looper) {
  fun post(r: Runnable) { Scheduler.post(this, r) }
  fun postDelayed(r: Runnable, delay: Long) { Scheduler.post(this, r, delay) }
  fun removeCallbacks(r: Runnable) {}
  fun removeCallbacksAndMessages(token: Any?) {}
}
class Build {
  object VERSION { const val SDK_INT = 34 }
  object VERSION_CODES { const val TIRAMISU = 33; const val S = 31 }
}
class ParcelUuid private constructor(val uuid: java.util.UUID) {
  companion object { @JvmStatic fun fromString(s: String) = ParcelUuid(java.util.UUID.fromString(s)) }
  override fun toString() = uuid.toString()
}
