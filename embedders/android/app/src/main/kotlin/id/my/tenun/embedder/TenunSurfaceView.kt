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

    // Display-list scene (gallery device bundle). Null while the legacy
    // notes scene drives the view.
    private var displayList: DisplayListScene? = null
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
        if (displayList != null) return onDisplayListTouch(event)

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
        val parsed = DisplayListScene.parse(sceneJson)
        if (parsed != null) {
            displayList = parsed
            return
        }
        displayList = null
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
        val dl = displayList ?: return false
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
                    val designY = event.y / dlScale + scrollY
                    // Topmost painted region wins: ops paint in order, so
                    // the LAST containing tap is the one the user sees —
                    // required for overlays (modal drawer scrim over
                    // content). Matches the browser renderer.
                    val hit = dl.taps.lastOrNull { it.contains(designX, designY) }
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
        val dl = displayList
        if (dl != null) {
            renderDisplayList(canvas, dl)
            return
        }
        renderNotesScene(canvas)
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
            when (op) {
                is DisplayListScene.Op.RectOp -> {
                    val r = op.rect
                    // Elevation is emulated with a translucent underlay:
                    // Paint.setShadowLayer is ignored for shapes on
                    // hardware canvases, and this renders identically to
                    // the browser fallback.
                    if (!r.stroked && r.shadow > 0f) {
                        val shadowPaint = fillPaint("#000000")
                        shadowPaint.alpha = 64
                        canvas.drawRoundRect(
                            r.x, r.y + r.shadow / 2, r.x + r.w, r.y + r.h + r.shadow / 2,
                            r.radius, r.radius, shadowPaint
                        )
                    }
                    val paint = if (r.stroked) {
                        outlinePaint(r.color, r.strokeWidth)
                    } else if (r.colorTo != null) {
                        val gradient = android.graphics.LinearGradient(
                            r.x, r.y, r.x, r.y + r.h,
                            Color.parseColor(r.color),
                            Color.parseColor(r.colorTo),
                            android.graphics.Shader.TileMode.CLAMP
                        )
                        fillPaint(r.color).apply { shader = gradient }
                    } else {
                        fillPaint(r.color)
                    }
                    canvas.drawRoundRect(
                        r.x, r.y, r.x + r.w, r.y + r.h,
                        r.radius, r.radius, paint
                    )
                }
                is DisplayListScene.Op.CircleOp -> {
                    val paint = fillPaint(op.color)
                    canvas.drawCircle(op.cx, op.cy, op.r, paint)
                }
                is DisplayListScene.Op.RingOp -> {
                    val bounds = RectF(
                        op.cx - op.r, op.cy - op.r, op.cx + op.r, op.cy + op.r
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
                        // -90f starts at 12 o'clock; sweep is clockwise.
                        canvas.drawArc(bounds, -90f, sweep, false, arcPaint)
                    }
                }
                is DisplayListScene.Op.LineOp -> {
                    canvas.drawLine(op.x1, op.y1, op.x2, op.y2, outlinePaint(op.color, op.strokeWidth))
                }
                is DisplayListScene.Op.TextOp -> {
                    val t = op.text
                    textPaint.color = Color.parseColor(t.color)
                    textPaint.textSize = t.size
                    textPaint.typeface = if (t.weight >= 600) {
                        android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD)
                    } else {
                        android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.NORMAL)
                    }
                    canvas.drawText(t.text, t.x, t.y, textPaint)
                }
            }
        }
        canvas.restore()
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
