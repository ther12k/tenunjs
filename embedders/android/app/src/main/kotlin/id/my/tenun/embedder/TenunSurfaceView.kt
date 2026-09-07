package id.my.tenun.embedder

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.text.InputType
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import org.json.JSONObject

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
            redraw()
        }

    private var activeField: String? = "title"
    private var titleText: String = ""
    private var detailsText: String = ""
    private val entries = mutableListOf<String>()

    // Layout bounds
    private val titleRect = RectF(40f, 100f, 680f, 180f)
    private val detailsRect = RectF(40f, 220f, 680f, 300f)
    private val buttonRect = RectF(40f, 340f, 360f, 420f)

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

    override fun surfaceCreated(holder: SurfaceHolder) {
        redraw()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        redraw()
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        // Surface released
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            val x = event.x
            val y = event.y

            if (titleRect.contains(x, y)) {
                activeField = "title"
                showKeyboard()
                redraw()
                return true
            } else if (detailsRect.contains(x, y)) {
                activeField = "details"
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
                text?.let { appendInput(it.toString()) }
                return true
            }

            override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
                text?.let { appendInput(it.toString()) }
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                activeField?.let { field ->
                    if (field == "title" && titleText.isNotEmpty()) {
                        titleText = titleText.dropLast(beforeLength.coerceAtMost(titleText.length))
                        dispatchFieldChange("title", titleText)
                    } else if (field == "details" && detailsText.isNotEmpty()) {
                        detailsText = detailsText.dropLast(beforeLength.coerceAtMost(detailsText.length))
                        dispatchFieldChange("details", detailsText)
                    }
                    redraw()
                }
                return true
            }
        }
    }

    private fun appendInput(str: String) {
        activeField?.let { field ->
            if (field == "title") {
                titleText += str
                dispatchFieldChange("title", titleText)
            } else if (field == "details") {
                detailsText += str
                dispatchFieldChange("details", detailsText)
            }
            redraw()
        }
    }

    private fun dispatchFieldChange(field: String, value: String) {
        val payload = "{\"field\":\"$field\",\"value\":\"$value\"}"
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
                            if (f == "title") titleText = v
                            if (f == "details") detailsText = v
                        }
                        "listItem" -> {
                            val t = node.optString("title")
                            entries.add(t)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            // Ignored, preserve local state
        }
    }

    fun redraw() {
        val canvas = holder.lockCanvas() ?: return
        try {
            renderScene(canvas)
        } finally {
            holder.unlockCanvasAndPost(canvas)
        }
    }

    private fun renderScene(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)

        // Labels
        canvas.drawText("TenunJS Mobile Prototype", 40f, 60f, textPaint)

        // Title Input Field
        canvas.drawRoundRect(titleRect, 12f, 12f, inputPaint)
        canvas.drawRoundRect(titleRect, 12f, 12f, if (activeField == "title") activeBorderPaint else inputBorderPaint)
        val displayTitle = if (titleText.isEmpty()) "Enter Title..." else titleText
        canvas.drawText(displayTitle, titleRect.left + 20f, titleRect.centerY() + 12f, if (titleText.isEmpty()) labelPaint else textPaint)

        // Details Input Field
        canvas.drawRoundRect(detailsRect, 12f, 12f, inputPaint)
        canvas.drawRoundRect(detailsRect, 12f, 12f, if (activeField == "details") activeBorderPaint else inputBorderPaint)
        val displayDetails = if (detailsText.isEmpty()) "Enter Details..." else detailsText
        canvas.drawText(displayDetails, detailsRect.left + 20f, detailsRect.centerY() + 12f, if (detailsText.isEmpty()) labelPaint else textPaint)

        // Add Button
        canvas.drawRoundRect(buttonRect, 12f, 12f, buttonPaint)
        canvas.drawText("Add Entry", buttonRect.left + 50f, buttonRect.centerY() + 12f, textPaint)

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
