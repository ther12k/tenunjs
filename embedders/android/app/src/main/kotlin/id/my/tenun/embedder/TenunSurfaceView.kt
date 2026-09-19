package id.my.tenun.embedder

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
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
    is DisplayListScene.Op.CircleOp -> fixed
    is DisplayListScene.Op.RingOp -> fixed
    is DisplayListScene.Op.LineOp -> fixed
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
            field = value
            // Reflect the engine's already-committed scene (including the
            // JS-provided button label) before the first draw, so the view
            // renders the JavaScript application's initial state.
            value?.getLatestScene()?.let { syncFromScene(it) }
            redraw()
        }

    private var activeField: String = "title"
    val titleField = EditableFieldState()
    val detailsField = EditableFieldState()
    val entries = mutableListOf<String>()

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
    private var touchDownY = 0f
    private var touchLastY = 0f
    private var isScrolling = false
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    /**
     * OTA confirm-criterion hook: invoked once after the first successful
     * TAP dispatch on an OTA trial bundle — evidence the host→JS event
     * contract works under the new code, not just that it initialized.
     */
    var onFirstSuccessfulDispatch: (() -> Unit)? = null
    private var dispatchedOnce = false

    private var isSurfaceValid = false

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
        redraw()
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        isSurfaceValid = false
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

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
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
        // Display-list scenes (gallery device bundle) take priority; the
        // legacy notes path stays authoritative for "root"-tree scenes.
        // A scene the host cannot render WHOLE (unsupported version or op
        // kind) is a compatibility failure: SceneHolder keeps the last
        // committed scene atomically — never a partial interface.
        when (sceneHolder.apply(sceneJson)) {
            SceneHolder.Outcome.APPLIED -> return
            SceneHolder.Outcome.REJECTED ->
                Log.e(
                    TAG,
                    "scene rejected (${sceneHolder.lastRejection}); " +
                        if (sceneHolder.current != null) "keeping last committed scene" else "no committed scene: incompatible-bundle state"
                )
            SceneHolder.Outcome.NOT_A_DISPLAY_LIST -> sceneHolder.clear()
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
    }

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
     * to dispatch the hit region's action back into the engine. The
     * committed scene after the dispatch is what gets drawn.
     */
    private fun onDisplayListTouch(event: MotionEvent): Boolean {
        val dl = sceneHolder.current ?: return false
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                touchDownY = event.y
                touchLastY = event.y
                isScrolling = false
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = touchLastY - event.y
                touchLastY = event.y
                if (!isScrolling && Math.abs(event.y - touchDownY) > touchSlop) {
                    isScrolling = true
                }
                if (isScrolling) {
                    scrollY = (scrollY + dy / dlScale).coerceIn(0f, maxScroll)
                    redraw()
                }
            }
            MotionEvent.ACTION_UP -> {
                if (!isScrolling) {
                    val designX = event.x / dlScale
                    val viewportY = event.y / dlScale
                    val visibleHeight = height / dlScale
                    // Topmost painted region wins: ops paint in order, so
                    // the LAST containing tap is the one the user sees —
                    // required for overlays (modal drawer scrim over
                    // content). Fixed overlays use viewport coordinates;
                    // ordinary content is translated by the current scroll.
                    val hit = dl.taps.lastOrNull {
                        it.contains(designX, viewportY, visibleHeight, scrollY)
                    }
                    if (hit != null) {
                        engine?.let { eng ->
                            eng.dispatchAction(hit.action, hit.payloadJson ?: "{}")
                            // The committed scene arrives via tenun_commit;
                            // the dispatch return value is engine state.
                            syncFromScene(eng.getLatestScene())
                            redraw()
                            if (!dispatchedOnce) {
                                dispatchedOnce = true
                                onFirstSuccessfulDispatch?.invoke()
                            }
                        }
                    }
                }
            }
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
        canvas.clipRect(0f, scrollY, dl.designWidth, scrollY + visibleHeight)
        canvas.translate(0f, -scrollY)
        for (op in dl.ops) {
            if (!op.isFixed()) paintDisplayOp(canvas, op, visibleHeight)
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
                canvas.drawText(t.text, t.x, t.y + dy, textPaint)
            }
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
