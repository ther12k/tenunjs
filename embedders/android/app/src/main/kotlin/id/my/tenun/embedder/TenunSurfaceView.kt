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
        val payload = "{\"field\":\"$activeField\",\"value\":\"${state.displayText}\"}"
        engine?.let { eng ->
            val sceneJson = eng.dispatchAction("SET_FIELD", payload)
            syncFromScene(sceneJson)
        }
    }

    fun syncFromScene(sceneJson: String) {
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

    private fun renderScene(canvas: Canvas) {
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
