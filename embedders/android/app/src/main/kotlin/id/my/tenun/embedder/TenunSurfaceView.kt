package id.my.tenun.embedder

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.AttributeSet
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewConfiguration
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import org.json.JSONObject

/**
 * State of an editable field tracking committed text and active composition region.
 */
private fun DisplayListScene.Op.isFixed(): Boolean = when (this) {
    is DisplayListScene.Op.RectOp -> rect.fixed
    is DisplayListScene.Op.TextOp -> text.fixed
    is DisplayListScene.Op.TextInputOp -> input.fixed
    is DisplayListScene.Op.CircleOp -> fixed
    is DisplayListScene.Op.RingOp -> fixed
    is DisplayListScene.Op.LineOp -> fixed
    is DisplayListScene.Op.ScrollRegionOp -> false // region boxes belong to the scene layer
}

class EditableFieldState {
    var committedText: String = ""
    var composingText: String = ""

    val displayText: String
        get() = committedText + composingText

    fun setComposing(text: String) {
        // Replaces current composing region
        composingText = text
    }

    fun commit(text: String) {
        // Replaces composing region with committed text
        committedText += if (text.isNotEmpty()) text else composingText
        composingText = ""
    }

    fun deleteSurrounding(beforeLength: Int) {
        if (composingText.isNotEmpty()) {
            composingText = composingText.dropLast(beforeLength.coerceAtMost(composingText.length))
        } else if (committedText.isNotEmpty()) {
            committedText = committedText.dropLast(beforeLength.coerceAtMost(committedText.length))
        }
    }

    fun reset() {
        committedText = ""
        composingText = ""
    }
}

/**
 * Commits display-list scenes atomically (JVM-testable; the view itself
 * cannot be instantiated on the JVM). A candidate that violates the scene
 * contract — unsupported version or unknown op kind, at ANY position — is
 * rejected whole: the previously committed scene stays active INCLUDING its
 * hit regions, and no candidate op or tap ever becomes partially live.
 *
 * [hasRejection] with a null [current] means the FIRST candidate was
 * rejected: the view renders an explicit incompatible-bundle state rather
 * than falling back to the unrelated legacy notes screen.
 */
class SceneHolder {
    var current: DisplayListScene? = null
        private set
    var hasRejection: Boolean = false
        private set

    /** The most recent contract violation, for host-side diagnostics. */
    var lastRejection: String? = null
        private set

    enum class Outcome { APPLIED, REJECTED, NOT_A_DISPLAY_LIST }

    fun apply(sceneJson: String): Outcome {
        return try {
            val parsed = DisplayListScene.parse(sceneJson)
            if (parsed != null) {
                current = parsed
                Outcome.APPLIED
            } else {
                Outcome.NOT_A_DISPLAY_LIST
            }
        } catch (e: SceneContractException) {
            hasRejection = true
            lastRejection = e.message
            Outcome.REJECTED
        }
    }

    /**
     * Leaves display-list mode for the legacy root-tree scene — a valid
     * alternative application, superseding any stale rejection state.
     */
    fun clear() {
        current = null
        hasRejection = false
        lastRejection = null
    }
}

/**
 * TenunSurfaceView renders the TenunJS UI scene onto an Android SurfaceView,
 * dispatches touch events to native button actions, and bridges Android IME (InputConnection).
 */
class TenunSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : SurfaceView(context, attrs, defStyleAttr), SurfaceHolder.Callback {

    var engine: TenunEngine? = null
        set(value) {
            // A platform connection belongs to one engine, even if the next
            // bundle happens to allocate the same numeric session ID.
            endDisplayTextInput(notifyRuntime = false)
            field = value
            // TN-134: dispatch evidence is per-engine. Without this reset
            // the first-successful-dispatch hook fired once per VIEW
            // lifetime, so a pre-update tap satisfied the OTA trial
            // criterion for every later engine.
            dispatchedOnce = false
            // TN-158: a swapped engine re-negotiates viewport delivery —
            // support is a property of the bundle, not the view.
            viewportDriven = false
            // TN-165: scroll offsets belong to the engine that produced
            // them — a swapped-in bundle whose regions reuse the same ids
            // must not inherit another application's scroll positions.
            regionOffsets.clear()
            // Reflect the engine's already-committed scene (including the
            // JS-provided button label) before the first draw, so the view
            // renders the JavaScript application's initial state.
            value?.getLatestScene()?.let { syncFromScene(it) }
            if (isSurfaceValid) maybeDeliverViewport(width, height)
            redraw()
        }

    private var activeField: String = "title"
    val titleField = EditableFieldState()
    val detailsField = EditableFieldState()
    val entries = mutableListOf<String>()

    private val textInputSession = TextInputSessionState()
    private var textInputConnection: DisplayListInputConnection? = null
    private var acceptsTextInput = true

    private data class TextEditResponse(
        val previous: TextInputDescriptor,
        val proposed: TextInputValue,
        val accepted: Boolean
    )

    // Button label taken from the committed scene's button node, so a
    // JavaScript-only label change is what renderScene draws.
    var buttonLabel: String = "Add Entry"
        private set

    // Display-list scene (gallery device bundle), committed atomically via
    // [SceneHolder]. Null while the legacy notes scene drives the view.
    private val sceneHolder = SceneHolder()
    private var dlScale = 1f
    private var scrollY = 0f
    private var maxScroll = 0f
    private var touchDownX = 0f
    private var touchDownY = 0f
    private var touchLastY = 0f
    private var isScrolling = false
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    // TN-148 long-press: hold past ViewConfiguration's timeout over a
    // "long-press" region dispatches it; scroll-slop, release, or cancel
    // ends the wait, and a fired long-press suppresses that press's tap
    // (the standard host rule; the scene contract relies on it).
    private val mainHandler = Handler(Looper.getMainLooper())
    private var longPressRunnable: Runnable? = null
    private var longPressFired = false
    private val longPressTimeoutMs = ViewConfiguration.getLongPressTimeout().toLong()

    /**
     * OTA confirm-criterion hook: invoked once after the first successful
     * TAP dispatch on an OTA trial bundle — evidence the host→JS event
     * contract works under the new code, not just that it initialized.
     */
    var onFirstSuccessfulDispatch: (() -> Unit)? = null
    private var dispatchedOnce = false

    private var isSurfaceValid = false

    // TN-158 viewport delivery: true once the running bundle has adopted
    // host bounds via a successful VIEWPORT dispatch. Bundles without that
    // support answer NULL across JNI (UNKNOWN_ACTION or a non-string
    // result) and keep the committed scene's own design-width scaling —
    // they are not asked again until the engine is swapped.
    private var viewportDriven = false

    /**
     * Delivers the surface size in LOGICAL units (pixels / density) to
     * bundles whose handoff implements the VIEWPORT verb. Logical units
     * are the scene's own coordinate space afterwards: the re-laid-out
     * scene's designWidth equals the delivered width, so dlScale converges
     * to the display density and hit-testing stays consistent.
     */
    private fun maybeDeliverViewport(widthPx: Int, heightPx: Int) {
        if (widthPx <= 0 || heightPx <= 0) return
        val eng = engine ?: return
        if (!dispatchViewport(eng, widthPx, heightPx)) return
        if (!viewportDriven) {
            viewportDriven = true
            // Coordinates from the previous (design-width-scaled) layout
            // are meaningless under the adopted bounds.
            scrollY = 0f
        }
        syncFromScene(eng.getLatestScene())
    }

    private fun dispatchViewport(eng: TenunEngine, widthPx: Int, heightPx: Int): Boolean {
        val density = resources.displayMetrics.density
        if (density <= 0f) return false
        val logicalW = maxOf(1, (widthPx / density).toInt())
        val logicalH = maxOf(1, (heightPx / density).toInt())
        return try {
            eng.dispatchActionResult("VIEWPORT", "{\"width\":$logicalW,\"height\":$logicalH}") != null
        } catch (e: Exception) {
            Log.w(TAG, "viewport delivery failed: ${e.message}")
            false
        }
    }

    // Layout bounds
    val titleRect = RectF(40f, 100f, 680f, 180f)
    val detailsRect = RectF(40f, 220f, 680f, 300f)
    val buttonRect = RectF(40f, 340f, 360f, 420f)

    private val bgPaint = Paint().apply { color = Color.parseColor("#121212") }
    private val inputPaint = Paint().apply {
        color = Color.parseColor("#1E1E1E")
        style = Paint.Style.FILL
    }
    private val inputBorderPaint = Paint().apply {
        color = Color.parseColor("#444444")
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }
    private val activeBorderPaint = Paint().apply {
        color = Color.parseColor("#007AFF")
        style = Paint.Style.STROKE
        strokeWidth = 5f
    }
    private val buttonPaint = Paint().apply {
        color = Color.parseColor("#007AFF")
        style = Paint.Style.FILL
    }
    private val textPaint = Paint().apply {
        color = Color.WHITE
        textSize = 36f
        isAntiAlias = true
    }
    private val labelPaint = Paint().apply {
        color = Color.LTGRAY
        textSize = 28f
        isAntiAlias = true
    }

    init {
        holder.addCallback(this)
        isFocusable = true
        isFocusableInTouchMode = true
    }

    companion object {
        private const val TAG = "TenunSurfaceView"
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        isSurfaceValid = true
        redraw()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        isSurfaceValid = true
        maybeDeliverViewport(width, height)
        redraw()
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        isSurfaceValid = false
        endDisplayTextInput(notifyRuntime = true)
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        acceptsTextInput = hasWindowFocus
        if (!hasWindowFocus) endDisplayTextInput(notifyRuntime = true)
        else sceneHolder.current?.let { adoptDisplayTextInput(it) }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        acceptsTextInput = true
    }

    override fun onDetachedFromWindow() {
        acceptsTextInput = false
        cancelLongPressTimer()
        endDisplayTextInput(notifyRuntime = true)
        super.onDetachedFromWindow()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (sceneHolder.current != null) return onDisplayListTouch(event)

        if (event.action == MotionEvent.ACTION_UP) {
            val x = event.x
            val y = event.y

            if (titleRect.contains(x, y)) {
                transferFocus("title")
                showKeyboard()
                redraw()
                return true
            } else if (detailsRect.contains(x, y)) {
                transferFocus("details")
                showKeyboard()
                redraw()
                return true
            } else if (buttonRect.contains(x, y)) {
                // Trigger Add Entry action in engine
                engine?.let { eng ->
                    val sceneJson = eng.dispatchAction("ADD_ENTRY")
                    syncFromScene(sceneJson)
                    redraw()
                }
                return true
            }
        }
        return true
    }

    fun transferFocus(newField: String) {
        if (activeField != newField) {
            // Commit ongoing composition on previous field before transferring focus
            getActiveFieldState().commit("")
            dispatchActiveFieldChange()
            activeField = newField
        }
    }

    fun getActiveFieldState(): EditableFieldState {
        return if (activeField == "title") titleField else detailsField
    }

    private fun showKeyboard() {
        requestFocus()
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
    }

    override fun onCheckIsTextEditor(): Boolean = if (sceneHolder.current != null) {
        textInputSession.current != null && engine?.isDisposed == false
    } else engine?.isDisposed == false

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        if (sceneHolder.current != null) {
            val input = textInputSession.current ?: return null
            val token = textInputSession.token() ?: return null
            val owner = engine ?: return null
            if (!isCurrentTextInput(owner, token)) return null
            textInputConnection?.invalidate()
            outAttrs.inputType = InputType.TYPE_CLASS_TEXT
            outAttrs.imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_EXTRACT_UI or EditorInfo.IME_FLAG_NO_FULLSCREEN
            outAttrs.initialSelStart = input.selection.base
            outAttrs.initialSelEnd = input.selection.extent
            outAttrs.hintText = input.label
            val connection = DisplayListInputConnection(
                this, token, input,
                isCurrent = { isCurrentTextInput(owner, token) },
                onEdit = { value -> dispatchTextEdit(owner, token, value) },
                onCommand = { action -> dispatchTextCommand(owner, token, action) }
            )
            textInputConnection = connection
            return connection
        }
        // The reference notes application retains its independent legacy path.
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        outAttrs.imeOptions = EditorInfo.IME_ACTION_DONE

        return object : BaseInputConnection(this, true) {
            override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
                val str = text?.toString() ?: ""
                Log.d(TAG, "IME commitText len=${str.length}")
                getActiveFieldState().commit(str)
                dispatchActiveFieldChange()
                redraw()
                return true
            }

            override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
                val str = text?.toString() ?: ""
                Log.d(TAG, "IME setComposingText len=${str.length}")
                // Replaces current composing span (not simple append)
                getActiveFieldState().setComposing(str)
                dispatchActiveFieldChange()
                redraw()
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                Log.d(TAG, "IME deleteSurroundingText before=$beforeLength")
                getActiveFieldState().deleteSurrounding(beforeLength)
                dispatchActiveFieldChange()
                redraw()
                return true
            }
        }
    }

    // Input-path diagnostics: whether hardware key events reach this view
    // directly (instead of being routed through the IME session) is the
    // discriminating signal for IME delivery issues.
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (sceneHolder.current != null && event != null && textInputConnection?.sendKeyEvent(event) == true) return true
        Log.d(TAG, "view onKeyDown keyCode=$keyCode")
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        Log.d(TAG, "view onKeyUp keyCode=$keyCode")
        return super.onKeyUp(keyCode, event)
    }

    private fun dispatchActiveFieldChange() {
        val state = getActiveFieldState()
        // JSONObject escapes the value: raw interpolation would emit invalid
        // JSON when the text contains quotes/backslashes, and the app's
        // JSON.parse failure silently drops the SET_FIELD update.
        val payload = JSONObject()
            .put("field", activeField)
            .put("value", state.displayText)
            .toString()
        engine?.let { eng ->
            val sceneJson = eng.dispatchAction("SET_FIELD", payload)
            syncFromScene(sceneJson)
        }
    }

    fun syncFromScene(sceneJson: String) {
        syncFromScene(sceneJson, editResponse = null)
    }

    private fun syncFromScene(sceneJson: String, editResponse: TextEditResponse?): Boolean {
        // Display-list scenes (gallery device bundle) take priority; the
        // legacy notes path stays authoritative for "root"-tree scenes.
        // A scene the host cannot render WHOLE (unsupported version or op
        // kind) is a compatibility failure: SceneHolder keeps the last
        // committed scene atomically — never a partial interface.
        when (sceneHolder.apply(sceneJson)) {
            SceneHolder.Outcome.APPLIED -> {
                adoptDisplayTextInput(sceneHolder.current!!, editResponse)
                return true
            }
            SceneHolder.Outcome.REJECTED -> {
                Log.e(
                    TAG,
                    "scene rejected (${sceneHolder.lastRejection}); " +
                        if (sceneHolder.current != null) "keeping last committed scene" else "no committed scene: incompatible-bundle state"
                )
                // The whole previous scene remains authoritative, including
                // its platform editing value after an unaccepted local edit.
                sceneHolder.current?.let { adoptDisplayTextInput(it, editResponse?.copy(accepted = false)) }
                return false
            }
            SceneHolder.Outcome.NOT_A_DISPLAY_LIST -> {
                endDisplayTextInput(notifyRuntime = false)
                sceneHolder.clear()
            }
        }
        try {
            val root = JSONObject(sceneJson)
            val children = root.optJSONObject("root")?.optJSONArray("children")
            if (children != null) {
                entries.clear()
                for (i in 0 until children.length()) {
                    val node = children.getJSONObject(i)
                    when (node.optString("type")) {
                        "input" -> {
                            val f = node.optString("field")
                            val v = node.optString("value")
                            // The JS application clears its state only in
                            // ADD_ENTRY, so an empty scene value against
                            // non-empty local text means the entry was just
                            // committed: clear the editing field.
                            if (f == "title" && v.isEmpty() && titleField.displayText.isNotEmpty()) {
                                titleField.reset()
                            }
                            if (f == "details" && v.isEmpty() && detailsField.displayText.isNotEmpty()) {
                                detailsField.reset()
                            }
                        }
                        "listItem" -> {
                            val t = node.optString("title")
                            val d = node.optString("details")
                            val itemText = if (d.isNotEmpty()) "$t - $d" else t
                            entries.add(itemText)
                        }
                        "button" -> {
                            buttonLabel = node.optString("text")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            // Ignored, preserve local state
        }
        return true
    }

    private fun inputMethodManager(): InputMethodManager? =
        context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager

    private fun isCurrentTextInput(owner: TenunEngine, token: TextInputSessionState.Token): Boolean =
        acceptsTextInput && engine === owner && !owner.isDisposed && textInputSession.accepts(token)

    /** Called only after native dispatch returns; never from tenun_host_call. */
    private fun adoptDisplayTextInput(scene: DisplayListScene, editResponse: TextEditResponse? = null) {
        val owner = engine?.takeUnless { it.isDisposed }
        // TN-165: discovery sees focused descriptors nested inside scroll
        // regions too — root-only lookup left a TextField inside a
        // ScrollView with no editor session on a scene the contract accepts.
        val input = if (acceptsTextInput) scene.focusedEditableInput()?.input else null
        val previous = textInputSession.current
        val ownEdit = editResponse?.let { it.accepted && input?.acknowledgesEdit(it.previous, it.proposed) == true } ?: false
        // A rejected edit may leave the committed descriptor unchanged while
        // the IME has already mutated its own local composition. A controlled
        // transformation likewise is not an acknowledgement of that edit.
        val restart = textInputSession.adopt(owner, input, ownEdit, forceRestart = editResponse != null && !ownEdit)
        if (restart) {
            textInputConnection?.invalidate()
            textInputConnection = null
        }
        val active = textInputSession.current
        if (active == null) {
            if (restart) {
                inputMethodManager()?.hideSoftInputFromWindow(windowToken, 0)
                inputMethodManager()?.restartInput(this)
            }
            return
        }
        textInputConnection?.applyAuthoritative(active)
        if (restart && hasWindowFocus()) {
            requestFocus()
            inputMethodManager()?.restartInput(this)
            showKeyboard()
        }
        if (previous?.text != active.text || previous?.selection != active.selection || previous?.composing != active.composing || restart) {
            inputMethodManager()?.updateSelection(
                this, active.selection.base, active.selection.extent,
                active.composing?.start ?: -1, active.composing?.end ?: -1
            )
        }
    }

    private fun dispatchTextEdit(owner: TenunEngine, token: TextInputSessionState.Token, value: TextInputValue): Boolean {
        if (!isCurrentTextInput(owner, token)) return false
        val input = textInputSession.current ?: return false
        val payload = input.eventIdentity()
            .put("text", value.text)
            .put("selection", JSONObject().put("base", value.selection.base).put("extent", value.selection.extent))
            .put("composing", value.composing?.let { JSONObject().put("start", it.start).put("end", it.end) } ?: JSONObject.NULL)
        return dispatchTextEvent(owner, "TEXT_EDIT", textInputEventJson(payload), TextEditResponse(input, value, accepted = false))
    }

    private fun dispatchTextCommand(owner: TenunEngine, token: TextInputSessionState.Token, action: String): Boolean {
        if (!isCurrentTextInput(owner, token)) return false
        val input = textInputSession.current ?: return false
        return dispatchTextEvent(owner, action, textInputEventJson(input.eventIdentity()))
    }

    private fun dispatchTextEvent(owner: TenunEngine, action: String, payload: String, editResponse: TextEditResponse? = null): Boolean {
        return try {
            val result = owner.dispatchActionResult(action, payload)
            if (engine !== owner || owner.isDisposed) return false
            // A rejection is still followed by an authoritative resync; the
            // connection must not retain its unaccepted local edit.
            val acceptedScene = syncFromScene(owner.getLatestScene(), editResponse?.copy(accepted = result != null))
            redraw()
            result != null && acceptedScene
        } catch (e: Exception) {
            Log.w(TAG, "text-input $action failed: ${e.message}")
            endDisplayTextInput(notifyRuntime = false)
            false
        }
    }

    private fun endDisplayTextInput(notifyRuntime: Boolean) {
        val input = textInputSession.current
        val owner = engine
        val hadInput = input != null || textInputConnection != null
        textInputSession.invalidate()
        textInputConnection?.invalidate()
        textInputConnection = null
        if (hadInput) inputMethodManager()?.hideSoftInputFromWindow(windowToken, 0)
        if (notifyRuntime && input != null && owner != null && !owner.isDisposed) {
            try {
                owner.dispatchActionResult("TEXT_BLUR", textInputEventJson(input.eventIdentity()))
                // Keep the authoritative paint scene, while this lifecycle
                // transition remains in charge of whether editing is active.
                sceneHolder.apply(owner.getLatestScene())
                redraw()
            } catch (e: Exception) {
                Log.w(TAG, "text-input detach failed: ${e.message}")
            }
        }
    }

    /**
     * Acceptance-observation accessor: the committed display-list scene and
     * the current design-unit scroll offset. Observation only — installed-
     * device tests drive input through the real touch pipeline and use this
     * to assert what the renderer actually committed.
     */
    fun committedSceneForTest(): Pair<DisplayListScene?, Float> = sceneHolder.current to scrollY

    fun redraw() {
        if (!isSurfaceValid) return
        val canvas = holder.lockCanvas() ?: return
        try {
            renderScene(canvas)
        } finally {
            holder.unlockCanvasAndPost(canvas)
        }
    }

    /**
     * Display-list touch handling: drag to scroll (in design units), tap
     * to dispatch the hit region's action back into the engine, and a
     * hold past the long-press timeout to dispatch a "long-press"
     * region (TN-148 — a fired long-press suppresses that press's tap).
     * The committed scene after the dispatch is what gets drawn.
     */
    /** TN-161: the region under a touch point, or null for whole-scene scroll. */
    private var activeScrollRegion: DisplayListScene.Op.ScrollRegionOp? = null

    private fun scrollRegionUnder(x: Float, y: Float): DisplayListScene.Op.ScrollRegionOp? {
        val dl = sceneHolder.current ?: return null
        val designX = x / dlScale
        val viewportY = y / dlScale
        var hit: DisplayListScene.Op.ScrollRegionOp? = null
        for (op in dl.ops) {
            if (op is DisplayListScene.Op.ScrollRegionOp) {
                val top = op.y - scrollY
                if (designX >= op.x && designX <= op.x + op.w &&
                    viewportY >= top && viewportY <= top + op.h
                ) {
                    hit = op // later regions paint above earlier ones
                }
            }
        }
        return hit
    }

    /** Routes a scroll delta: an active region scrolls itself (clamped);
     *  otherwise the whole scene scrolls as before. Paint-only, never layout. */
    private fun scrollBy(delta: Float) {
        val region = activeScrollRegion
        if (region != null) {
            val max = (region.contentHeight - region.h).coerceAtLeast(0f)
            regionOffsets[region.id] = ((regionOffsets[region.id] ?: 0f) + delta).coerceIn(0f, max)
        } else {
            scrollY = (scrollY + delta).coerceIn(0f, maxScroll)
        }
    }

    private fun onDisplayListTouch(event: MotionEvent): Boolean {
        sceneHolder.current ?: return false
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                touchDownX = event.x
                touchDownY = event.y
                touchLastY = event.y
                isScrolling = false
                longPressFired = false
                // TN-161: the region under the DOWN point owns this gesture.
                activeScrollRegion = scrollRegionUnder(event.x, event.y)
                scheduleLongPress(event.x, event.y)
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = touchLastY - event.y
                touchLastY = event.y
                // Slop is axis-agnostic: a horizontal drag past slop also
                // ends the long-press wait (the hold timer hit-tests the
                // DOWN point — a finger that wandered sideways must not
                // still trigger it).
                if (!isScrolling &&
                    (Math.abs(event.y - touchDownY) > touchSlop || Math.abs(event.x - touchDownX) > touchSlop)
                ) {
                    isScrolling = true
                    cancelLongPressTimer()
                }
                if (isScrolling) {
                    scrollBy(dy / dlScale)
                    redraw()
                }
            }
            MotionEvent.ACTION_UP -> {
                cancelLongPressTimer()
                if (!isScrolling && !longPressFired) {
                    dispatchRegionHit(event.x, event.y, action = "tap")
                }
                longPressFired = false
            }
            MotionEvent.ACTION_CANCEL -> {
                cancelLongPressTimer()
                longPressFired = false
            }
        }
        return true
    }

    private fun scheduleLongPress(downX: Float, downY: Float) {
        cancelLongPressTimer()
        val runnable = Runnable {
            longPressRunnable = null
            // The wait ends silently if the press became a scroll; a
            // long-press that fires suppresses this press's tap.
            if (!isScrolling && dispatchRegionHit(downX, downY, action = "long-press")) {
                longPressFired = true
            }
        }
        longPressRunnable = runnable
        mainHandler.postDelayed(runnable, longPressTimeoutMs)
    }

    private fun cancelLongPressTimer() {
        longPressRunnable?.let { mainHandler.removeCallbacks(it) }
        longPressRunnable = null
    }

    /**
     * Hit-tests the DOWN/UP point against the CURRENT committed scene
     * and dispatches the topmost region carrying [action]. Returns
     * whether a region was found and dispatched.
     */
    private fun dispatchRegionHit(x: Float, y: Float, action: String): Boolean {
        val dl = sceneHolder.current ?: return false
        val designX = x / dlScale
        val viewportY = y / dlScale
        val visibleHeight = height / dlScale
        // Topmost painted region wins: the LAST containing region is the
        // one the user sees — required for overlays. TN-161: taps tagged
        // with a scroll region resolve in that region's CONTENT space (the
        // region's viewport box scrolls with the scene; its own paint
        // offset translates content). One reverse scan keeps topmost-wins
        // across both kinds.
        val regions = HashMap<String, DisplayListScene.Op.ScrollRegionOp>()
        for (op in dl.ops) {
            if (op is DisplayListScene.Op.ScrollRegionOp) regions[op.id] = op
        }
        val hit = dl.taps.lastOrNull { tap ->
            if (tap.action != action) return@lastOrNull false
            if (tap.scroll == null) {
                return@lastOrNull tap.contains(designX, viewportY, visibleHeight, scrollY)
            }
            val region = regions[tap.scroll] ?: return@lastOrNull false
            val regionTop = region.y - scrollY
            if (designX < region.x || designX > region.x + region.w) return@lastOrNull false
            if (viewportY < regionTop || viewportY > regionTop + region.h) return@lastOrNull false
            val contentY = viewportY - regionTop + regionOffset(region)
            val contentX = designX - region.x
            contentX >= tap.x && contentX <= tap.x + tap.w &&
                contentY >= tap.y && contentY <= tap.y + tap.h
        }
        if (hit == null) return false
        val eng = engine ?: return false
        // TN-137: the result channel distinguishes a FAILED handler (null —
        // it threw) from a successful dispatch; a thrown action must not
        // fire the OTA trial's dispatch criterion, and there is nothing to
        // sync (the engine kept its last committed scene).
        val handlerResult = eng.dispatchActionResult(hit.action, hit.payloadJson ?: "{}")
        if (handlerResult == null) return true
        // The committed scene arrives via tenun_commit;
        // the dispatch return value is engine state.
        syncFromScene(eng.getLatestScene())
        redraw()
        if (!dispatchedOnce) {
            dispatchedOnce = true
            onFirstSuccessfulDispatch?.invoke()
        }
        return true
    }

    private fun renderScene(canvas: Canvas) {
        val dl = sceneHolder.current
        if (dl != null) {
            renderDisplayList(canvas, dl)
            return
        }
        // A rejected first commit is an explicit incompatible-bundle state —
        // never the unrelated legacy notes screen, which would make the
        // application appear to have loaded.
        if (sceneHolder.hasRejection) {
            renderIncompatibleScene(canvas)
            return
        }
        renderNotesScene(canvas)
    }

    /** Explicit fail-closed outcome: the bundle needs a newer host APK. */
    private fun renderIncompatibleScene(canvas: Canvas) {
        canvas.drawColor(Color.parseColor("#101014"))
        textPaint.color = Color.parseColor("#FF5A5F")
        textPaint.textSize = 30f
        canvas.drawText("Application bundle incompatible with this host", 40f, 120f, textPaint)
        textPaint.color = Color.parseColor("#9AA3B2")
        textPaint.textSize = 22f
        canvas.drawText("Update the app to run this bundle.", 40f, 170f, textPaint)
        val reason = sceneHolder.lastRejection
        if (reason != null) {
            canvas.drawText(reason.take(60), 40f, 220f, textPaint)
        }
    }

    private fun renderDisplayList(canvas: Canvas, dl: DisplayListScene) {
        dlScale = if (dl.designWidth > 0) width / dl.designWidth else 1f
        val visibleHeight = height / dlScale
        maxScroll = (dl.contentHeight - visibleHeight).coerceAtLeast(0f)
        scrollY = scrollY.coerceIn(0f, maxScroll)

        canvas.drawColor(Color.parseColor(dl.background))
        canvas.save()
        canvas.scale(dlScale, dlScale)
        // TN-161 review fix (P1 #3): the clip is established in VIEWPORT
        // space BEFORE the content translate. Canvas fixes a clip in device
        // space when applied — clipping to [scrollY, scrollY+visible] and
        // then translating blanked the top scrollY units and could hide the
        // whole scrolling layer.
        canvas.clipRect(0f, 0f, dl.designWidth, visibleHeight)
        canvas.translate(0f, -scrollY)
        for (op in dl.ops) {
            if (!op.isFixed()) paintDisplayListOp(canvas, op, visibleHeight)
        }
        canvas.restore()

        canvas.save()
        canvas.scale(dlScale, dlScale)
        canvas.clipRect(0f, 0f, dl.designWidth, visibleHeight)
        for (op in dl.ops) {
            if (op.isFixed()) paintDisplayOp(canvas, op, visibleHeight)
        }
        canvas.restore()
    }

    /** TN-161 per-region paint offsets — host-owned scroll state, keyed by region id. */
    private val regionOffsets = HashMap<String, Float>()

    private fun regionOffset(region: DisplayListScene.Op.ScrollRegionOp): Float {
        val max = (region.contentHeight - region.h).coerceAtLeast(0f)
        return (regionOffsets[region.id] ?: 0f).coerceIn(0f, max)
    }

    /** TN-161 scroll-region-aware dispatch into paintDisplayOp. */
    private fun paintDisplayListOp(canvas: Canvas, op: DisplayListScene.Op, visibleHeight: Float) {
        if (op is DisplayListScene.Op.ScrollRegionOp) {
            // The region's viewport box (already in scene coordinates, so it
            // scrolls with the scene) clips its content; the region's own
            // paint offset translates it. Scrolling changes paint only.
            val offset = regionOffset(op)
            canvas.save()
            canvas.clipRect(op.x, op.y, op.x + op.w, op.y + op.h)
            // TN-165: children are in content space RELATIVE TO THE REGION.
            // Hit-testing already subtracts the region origin; painting must
            // add it back, or a region at (20,100) clips its first rows away
            // (they painted at scene (0,0) while their taps still hit —
            // invisible content with working hit-testing).
            canvas.translate(op.x, op.y - offset)
            for (nested in op.ops) paintDisplayOp(canvas, nested, visibleHeight)
            canvas.restore()
            return
        }
        paintDisplayOp(canvas, op, visibleHeight)
    }

    private fun anchorOffset(anchor: String?, anchorSize: Float?, visibleHeight: Float): Float {
        if (anchorSize == null) return 0f
        return when (anchor) {
            "bottom" -> visibleHeight - anchorSize
            "center" -> (visibleHeight - anchorSize) / 2f
            else -> 0f
        }
    }

    private fun paintDisplayOp(canvas: Canvas, op: DisplayListScene.Op, visibleHeight: Float) {
        when (op) {
            // Scroll regions only reach paintDisplayListOp, never here.
            is DisplayListScene.Op.ScrollRegionOp -> return
            is DisplayListScene.Op.RectOp -> {
                val r = op.rect
                val dy = if (r.fixed) anchorOffset(r.anchor, r.anchorSize, visibleHeight) else 0f
                if (!r.stroked && r.shadow > 0f) {
                    val shadowPaint = fillPaint("#000000")
                    shadowPaint.alpha = 64
                    canvas.drawRoundRect(
                        r.x, r.y + dy + r.shadow / 2, r.x + r.w, r.y + dy + r.h + r.shadow / 2,
                        r.radius, r.radius, shadowPaint
                    )
                }
                val paint = if (r.stroked) {
                    outlinePaint(r.color, r.strokeWidth)
                } else if (r.colorTo != null) {
                    val gradient = android.graphics.LinearGradient(
                        r.x, r.y + dy, r.x, r.y + dy + r.h,
                        Color.parseColor(r.color),
                        Color.parseColor(r.colorTo),
                        android.graphics.Shader.TileMode.CLAMP
                    )
                    fillPaint(r.color).apply { shader = gradient }
                } else {
                    fillPaint(r.color)
                }
                canvas.drawRoundRect(
                    r.x, r.y + dy, r.x + r.w, r.y + dy + r.h,
                    r.radius, r.radius, paint
                )
            }
            is DisplayListScene.Op.CircleOp -> {
                val dy = if (op.fixed) anchorOffset(op.anchor, op.anchorSize, visibleHeight) else 0f
                canvas.drawCircle(op.cx, op.cy + dy, op.r, fillPaint(op.color))
            }
            is DisplayListScene.Op.RingOp -> {
                val dy = if (op.fixed) anchorOffset(op.anchor, op.anchorSize, visibleHeight) else 0f
                val bounds = RectF(
                    op.cx - op.r, op.cy - op.r + dy, op.cx + op.r, op.cy + op.r + dy
                )
                if (op.track != null) {
                    val trackPaint = outlinePaint(op.track, op.strokeWidth).apply {
                        strokeCap = android.graphics.Paint.Cap.ROUND
                    }
                    canvas.drawArc(bounds, 0f, 360f, false, trackPaint)
                }
                if (op.progress > 0f) {
                    val sweep = 360f * op.progress.coerceAtMost(1f)
                    val arcPaint = outlinePaint(op.color, op.strokeWidth).apply {
                        strokeCap = android.graphics.Paint.Cap.ROUND
                    }
                    canvas.drawArc(bounds, -90f, sweep, false, arcPaint)
                }
            }
            is DisplayListScene.Op.LineOp -> {
                val dy = if (op.fixed) anchorOffset(op.anchor, op.anchorSize, visibleHeight) else 0f
                canvas.drawLine(op.x1, op.y1 + dy, op.x2, op.y2 + dy, outlinePaint(op.color, op.strokeWidth))
            }
            is DisplayListScene.Op.TextOp -> {
                val t = op.text
                val dy = if (t.fixed) anchorOffset(t.anchor, t.anchorSize, visibleHeight) else 0f
                textPaint.color = Color.parseColor(t.color)
                textPaint.textSize = t.size
                textPaint.typeface = if (t.weight >= 600) {
                    android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD)
                } else {
                    android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.NORMAL)
                }
                var drawX = t.x
                if (t.width != null && t.align == "center") {
                    val measured = textPaint.measureText(t.text)
                    drawX = t.x + Math.max(0f, (t.width - measured) / 2f)
                }
                val clip = t.clip
                if (clip == null) {
                    canvas.drawText(t.text, drawX, t.y + dy, textPaint)
                } else {
                    val saved = canvas.save()
                    try {
                        canvas.clipRect(clip.x, clip.y + dy, clip.x + clip.w, clip.y + dy + clip.h)
                        canvas.drawText(t.text, drawX, t.y + dy, textPaint)
                    } finally {
                        canvas.restoreToCount(saved)
                    }
                }
            }
            is DisplayListScene.Op.TextInputOp -> Unit // Session metadata; normal ops paint it.
        }
    }

    private fun fillPaint(color: String): Paint =
        Paint().apply {
            this.color = Color.parseColor(color)
            style = Paint.Style.FILL
            isAntiAlias = true
        }

    private fun outlinePaint(color: String, width: Float): Paint =
        Paint().apply {
            this.color = Color.parseColor(color)
            style = Paint.Style.STROKE
            strokeWidth = width
            isAntiAlias = true
        }

    private fun renderNotesScene(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)

        // Title Header
        canvas.drawText("TenunJS Mobile Prototype", 40f, 60f, textPaint)

        // Title Input Field
        canvas.drawRoundRect(titleRect, 12f, 12f, inputPaint)
        canvas.drawRoundRect(titleRect, 12f, 12f, if (activeField == "title") activeBorderPaint else inputBorderPaint)
        val displayTitle = if (titleField.displayText.isEmpty()) "Enter Title..." else titleField.displayText
        canvas.drawText(displayTitle, titleRect.left + 20f, titleRect.centerY() + 12f, if (titleField.displayText.isEmpty()) labelPaint else textPaint)

        // Details Input Field
        canvas.drawRoundRect(detailsRect, 12f, 12f, inputPaint)
        canvas.drawRoundRect(detailsRect, 12f, 12f, if (activeField == "details") activeBorderPaint else inputBorderPaint)
        val displayDetails = if (detailsField.displayText.isEmpty()) "Enter Details..." else detailsField.displayText
        canvas.drawText(displayDetails, detailsRect.left + 20f, detailsRect.centerY() + 12f, if (detailsField.displayText.isEmpty()) labelPaint else textPaint)

        // Add Button (label comes from the committed scene)
        canvas.drawRoundRect(buttonRect, 12f, 12f, buttonPaint)
        canvas.drawText(buttonLabel, buttonRect.left + 50f, buttonRect.centerY() + 12f, textPaint)

        // Entries List Header
        var currentY = 480f
        canvas.drawText("Committed Entries (${entries.size}):", 40f, currentY, labelPaint)
        currentY += 40f

        // Entry items
        for ((idx, entry) in entries.withIndex()) {
            canvas.drawText("${idx + 1}. $entry", 50f, currentY, textPaint)
            currentY += 45f
            if (currentY > height - 40f) break
        }
    }
}
