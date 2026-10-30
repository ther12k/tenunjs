package id.my.tenun.embedder

import android.graphics.Rect
import android.os.Bundle
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeProvider

/**
 * TN-180 (TN-091 slice 1): the Android accessibility bridge over
 * scene.semantics (ADR-0025).
 *
 * `SemanticsBridgeState` is deliberately ANDROID-FREE (pure Kotlin +
 * org.json): virtual-id allocation, commit diffing, focus bookkeeping,
 * and announcement decisions are JVM-unit-testable. The provider below
 * is the thin framework glue that maps state onto AccessibilityNodeInfo.
 *
 * Host-side generations (ADR-0025): every applied scene commit advances
 * the bridge — stable semantic ids keep their virtual ids across
 * commits, and the host pairs them with its own commit counter.
 */
class SemanticsBridgeState {

    data class CommitDiff(
        /** Virtual ids whose label/value/state changed (content-changed events). */
        val changedVirtualIds: List<Int>,
        /** Live-region texts to announce (explicit and rate-limited: at most
         *  [MAX_ANNOUNCEMENTS_PER_COMMIT] per commit, most recent first). */
        val announcements: List<String>,
        /** True when the accessibility-focused node disappeared from this commit. */
        val focusCleared: Boolean
    )

    private val virtualIds = HashMap<String, Int>()
    private val retiredIds = HashSet<Int>()
    private var nextVirtualId = FIRST_VIRTUAL_ID
    private var focusedVirtualId: Int? = null
    private var current: Map<String, SceneSemantics.Node> = emptyMap()
    private var currentOrdered: List<SceneSemantics.Node> = emptyList()

    fun nodeByVirtualId(virtualViewId: Int): SceneSemantics.Node? {
        if (virtualViewId <= 0) return null
        return currentOrdered.firstOrNull { virtualIds[it.id] == virtualViewId }
    }

    fun virtualIdFor(semanticId: String): Int? = virtualIds[semanticId]

    fun focusedVirtualId(): Int? = focusedVirtualId

    /** TalkBack focus request: only a currently-committed node is focusable. */
    fun setAccessibilityFocus(virtualViewId: Int?): Boolean {
        if (virtualViewId == null) {
            focusedVirtualId = null
            return true
        }
        if (nodeByVirtualId(virtualViewId) == null) return false
        focusedVirtualId = virtualViewId
        return true
    }

    /**
     * Advances the bridge to a newly applied commit. Virtual ids are
     * allocated in emission order; a semantic id KEEPS its id across
     * commits (focus stability) and retired ids are never reused (a
     * recycled id would read as "same element" to a screen reader).
     */
    fun onSceneCommitted(semantics: SceneSemantics?): CommitDiff {
        val previous = current
        val previousFocus = focusedVirtualId
        if (semantics == null) {
            current = emptyMap()
            currentOrdered = emptyList()
            virtualIds.clear()
            val cleared = previousFocus != null
            focusedVirtualId = null
            return CommitDiff(emptyList(), emptyList(), cleared)
        }
        val ordered = semantics.nodes
        val byId = ordered.associateBy { it.id }
        for (node in ordered) {
            if (node.id !in virtualIds) {
                var candidate = nextVirtualId
                while (candidate in retiredIds) candidate++
                nextVirtualId = candidate + 1
                virtualIds[node.id] = candidate
            }
        }
        val removedIds = previous.keys - byId.keys
        for (id in removedIds) {
            virtualIds.remove(id)?.let { retiredIds.add(it) }
        }
        current = byId
        currentOrdered = ordered

        val changed = ArrayList<Int>()
        val announcements = ArrayList<String>()
        for (node in ordered) {
            val before = previous[node.id] ?: continue // new nodes: no announcement churn
            if (before.label != node.label || before.value != node.value ||
                before.focused != node.focused || before.disabled != node.disabled ||
                before.readOnly != node.readOnly
            ) {
                val virtualId = virtualIds[node.id]!!
                if (node.liveRegion) {
                    val text = node.value ?: node.label
                    if (!text.isNullOrEmpty()) announcements.add(text)
                } else {
                    changed.add(virtualId)
                }
            }
        }
        val focusCleared = previousFocus != null && focusedVirtualId?.let { nodeByVirtualId(it) == null } == true
        if (focusCleared) focusedVirtualId = null
        if (announcements.size > MAX_ANNOUNCEMENTS_PER_COMMIT) {
            announcements.subList(0, announcements.size - MAX_ANNOUNCEMENTS_PER_COMMIT).clear()
        }
        return CommitDiff(changed, announcements, focusCleared)
    }

    companion object {
        /** Virtual ids start above the host view's own root id space. */
        const val FIRST_VIRTUAL_ID = 1
        /** Rate limit (accessibility-requirements.md:13): explicit and bounded. */
        const val MAX_ANNOUNCEMENTS_PER_COMMIT = 2
    }
}

/** What the provider needs from its host view — the same dispatch touch uses. */
interface AccessibilityHost {
    val hostView: View

    /** Dispatches a semantic action through the ORDINARY tap path. */
    fun dispatchSemanticAction(action: String, tapId: Int): Boolean

    /** View-local pixel bounds of the node (scroll offsets applied). */
    fun semanticBounds(node: SceneSemantics.Node): Rect

    /** Screen-space offset of the host view (boundsInScreen). */
    fun screenOffset(): Pair<Int, Int>

    fun sendVirtualViewEvent(virtualViewId: Int, eventType: Int)

    fun announce(text: String)
}

/**
 * The AccessibilityNodeProvider a screen reader drives: node population,
 * focus queries, and actions — where ACTION_CLICK dispatches the very
 * same "tap"/"long-press" a finger does (accessibility activation ≡
 * touch activation, ADR-0025 rule 3).
 */
class TenunAccessibilityProvider(
    private val host: AccessibilityHost,
    private val state: SemanticsBridgeState
) : AccessibilityNodeProvider() {

    private fun className(role: String): String = when (role) {
        "button" -> "android.widget.Button"
        "text", "header" -> "android.widget.TextView"
        "textfield" -> "android.widget.EditText"
        "alert" -> "android.widget.TextView"
        else -> "android.view.View"
    }

    override fun createAccessibilityNodeInfo(virtualViewId: Int): AccessibilityNodeInfo? {
        val node = state.nodeByVirtualId(virtualViewId) ?: return null
        val info = AccessibilityNodeInfo.obtain()
        val view = host.hostView
        info.setSource(view, virtualViewId)
        info.setParent(view)
        info.packageName = view.context.packageName
        info.className = className(node.role)
        info.isVisibleToUser = true
        info.isEnabled = !node.disabled
        node.label?.let { info.text = it }
        node.value?.let { info.text = it }
        node.hint?.let { info.hintText = it }
        info.contentDescription = node.label ?: node.hint
        info.isFocused = node.focused
        info.isAccessibilityFocused = state.focusedVirtualId() == virtualViewId
        info.isClickable = node.pressTapId != null
        info.isLongClickable = node.longPressTapId != null
        info.isEditable = node.role == "textfield" && !node.readOnly
        if (node.liveRegion) info.liveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        val local = host.semanticBounds(node)
        info.setBoundsInParent(Rect(local))
        val (sx, sy) = host.screenOffset()
        info.setBoundsInScreen(Rect(local.left + sx, local.top + sy, local.right + sx, local.bottom + sy))
        if (node.pressTapId != null) {
            info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLICK)
            if (node.role == "textfield") {
                info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_FOCUS)
            }
        }
        if (node.longPressTapId != null) {
            info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_LONG_CLICK)
        }
        info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_ACCESSIBILITY_FOCUS)
        info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_CLEAR_ACCESSIBILITY_FOCUS)
        return info
    }

    override fun performAction(virtualViewId: Int, action: Int, arguments: Bundle?): Boolean {
        val node = state.nodeByVirtualId(virtualViewId) ?: return false
        return when (action) {
            AccessibilityNodeInfo.ACTION_CLICK ->
                node.pressTapId?.let { host.dispatchSemanticAction("tap", it) } ?: false
            AccessibilityNodeInfo.ACTION_LONG_CLICK ->
                node.longPressTapId?.let { host.dispatchSemanticAction("long-press", it) } ?: false
            AccessibilityNodeInfo.ACTION_FOCUS ->
                node.pressTapId?.let { host.dispatchSemanticAction("tap", it) } ?: false
            AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS -> {
                if (state.setAccessibilityFocus(virtualViewId)) {
                    host.sendVirtualViewEvent(virtualViewId, AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED)
                    true
                } else false
            }
            AccessibilityNodeInfo.ACTION_CLEAR_ACCESSIBILITY_FOCUS -> {
                state.setAccessibilityFocus(null)
                host.sendVirtualViewEvent(virtualViewId, AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED)
                true
            }
            else -> false
        }
    }

    override fun findFocus(focusType: Int): AccessibilityNodeInfo? {
        if (focusType == AccessibilityNodeInfo.FOCUS_ACCESSIBILITY) {
            return state.focusedVirtualId()?.let { createAccessibilityNodeInfo(it) }
        }
        return null
    }
}
