package id.my.tenun.embedder

import android.text.Editable
import android.text.Selection
import android.text.SpannableStringBuilder
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.CompletionInfo
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.ExtractedText
import android.view.inputmethod.ExtractedTextRequest

/**
 * Platform editing for one captured display-list edit session. BaseInputConnection
 * edits a REAL Editable, including Android's cursor-position, composition,
 * selection and code-point deletion rules. The host sends complete editing
 * values and then adopts the framework's authoritative response.
 *
 * No callback looks up "the currently focused field" to choose its target.
 * Once its engine/session/generation is obsolete, this connection is inert.
 */
class DisplayListInputConnection(
    view: View,
    val token: TextInputSessionState.Token,
    initial: TextInputDescriptor,
    private val isCurrent: () -> Boolean,
    /** True when an editor submit may still be delivered after this object
     *  was retired mid-action by an intent-only restart of the SAME logical
     *  session (see performEditorAction). */
    private val canDeliverPendingSubmit: () -> Boolean,
    private val onEdit: (TextInputValue) -> Boolean,
    private val onCommand: (String) -> Boolean
) : BaseInputConnection(view, true) {
    private val content = SpannableStringBuilder()
    private var closed = false
    private var applying = false
    private var reporting = false
    private var operationDepth = 0
    private var batchDepth = 0
    private var reported = initial.value()
    /** The live descriptor's return action; ENTER maps to it (plan A2 Next/Done). */
    private var returnAction: String = initial.returnAction
    private var lastRevision: Long = -1L
    private var lastSessionId: Long = -1L
    /** Newest authority deferred while an IME batch is open (see
     *  applyAuthoritative); applied at the batch boundary. */
    private var pendingAuthoritative: TextInputDescriptor? = null

    init {
        applyAuthoritative(initial)
    }

    private fun live(): Boolean = !closed && isCurrent()

    /** The IME action this field's descriptor carries: NEXT advances focus, DONE submits. */
    private fun editorAction(): Int =
        if (returnAction == "next") EditorInfo.IME_ACTION_NEXT else EditorInfo.IME_ACTION_DONE

    override fun getEditable(): Editable? = if (live()) content else null

    /** Acknowledgements are copied; never predict the runtime's next revision. */
    fun applyAuthoritative(input: TextInputDescriptor) {
        if (!live()) return
        returnAction = input.returnAction
        val next = input.value()
        // If the descriptor's revision and session are unchanged, this is an
        // unedited scene re-render (e.g. INSET/VIEWPORT delivery or background repaint).
        // Never overwrite local buffered edits when authority has not moved.
        if (input.sessionId == lastSessionId && input.revision == lastRevision) {
            return
        }
        // Exact acknowledgements and geometry-only paints must not replace
        // the IME's existing composing spans (which can carry its own styles).
        if (value() == next) {
            lastSessionId = input.sessionId
            lastRevision = input.revision
            reported = next
            // The buffer already mirrors this NEWER authority, so anything
            // still deferred from an earlier replacement is superseded: at
            // the batch boundary it would roll the editor BACK over this
            // acknowledgement (review fix — the equality path used to leave
            // the older deferred value queued, and draining it then let the
            // next keystroke overwrite the accepted newer text).
            pendingAuthoritative = null
            return
        }
        // A moved revision whose content differs is genuine new authority —
        // an accepted external ACTION_SET_TEXT replacement. Mid-batch it must
        // not clobber the composing buffer NOW, but it also may not be DROPPED:
        // dropping it let the stale local buffer overwrite the accepted value
        // on the next keystroke, and later same-revision paints skip too
        // (review P1). Defer to the batch boundary; the deferred drain re-runs
        // this full path with the batch closed.
        if (batchDepth > 0) {
            pendingAuthoritative = input
            return
        }
        lastSessionId = input.sessionId
        lastRevision = input.revision
        applying = true
        try {
            reported = next
            if (content.toString() != input.text) content.replace(0, content.length, input.text)
            BaseInputConnection.removeComposingSpans(content)
            Selection.setSelection(content, input.selection.base, input.selection.extent)
            input.composing?.let { super.setComposingRegion(it.start, it.end) }
        } finally {
            applying = false
        }
    }

    /** Applies an authority update deferred by an open IME batch; called at
     *  the batch boundary and before an in-batch editor action. The deferred
     *  replacement wins over the un-flushed local buffer — an external
     *  ACTION_SET_TEXT is a full replacement by Android contract — but never
     *  over a NEWER acknowledgement recorded meanwhile: authority may not
     *  move backwards (review fix). */
    private fun drainDeferredAuthority() {
        val pending = pendingAuthoritative ?: return
        pendingAuthoritative = null
        if (pending.sessionId == lastSessionId && pending.revision < lastRevision) return
        applyAuthoritative(pending)
    }

    private fun value(): TextInputValue {
        val start = BaseInputConnection.getComposingSpanStart(content)
        val end = BaseInputConnection.getComposingSpanEnd(content)
        return TextInputValue(
            content.toString(),
            TextInputSelection(Selection.getSelectionStart(content), Selection.getSelectionEnd(content)),
            if (start >= 0 && end > start) TextInputComposition(start, end) else null
        )
    }

    private fun flush(): Boolean {
        if (!live()) return false
        if (applying || reporting || operationDepth > 0 || batchDepth > 0) return true
        val next = value()
        if (next == reported) return true
        reporting = true
        return try {
            // onEdit synchronizes the authoritative scene before returning,
            // even after a rejected/stale event. It may close this connection.
            onEdit(next)
        } finally {
            reporting = false
        }
    }

    private inline fun mutate(change: () -> Boolean): Boolean {
        if (!live()) return false
        operationDepth++
        val succeeded = try { change() } finally { operationDepth-- }
        return succeeded && flush()
    }

    override fun beginBatchEdit(): Boolean {
        if (!live()) return false
        batchDepth++
        return true
    }

    override fun endBatchEdit(): Boolean {
        if (!live() || batchDepth == 0) return false
        batchDepth--
        if (batchDepth == 0) drainDeferredAuthority()
        flush()
        return batchDepth > 0
    }

    override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean =
        mutate { super.commitText(text ?: "", newCursorPosition) }

    override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean =
        mutate { super.setComposingText(text ?: "", newCursorPosition) }

    override fun setComposingRegion(start: Int, end: Int): Boolean =
        mutate { super.setComposingRegion(start, end) }

    override fun finishComposingText(): Boolean = mutate { super.finishComposingText() }

    override fun setSelection(start: Int, end: Int): Boolean =
        mutate { super.setSelection(start, end) }

    override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean =
        mutate { super.deleteSurroundingText(beforeLength, afterLength) }

    override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean =
        mutate { super.deleteSurroundingTextInCodePoints(beforeLength, afterLength) }

    override fun getTextBeforeCursor(length: Int, flags: Int): CharSequence? =
        if (live()) super.getTextBeforeCursor(length, flags) else null

    override fun getTextAfterCursor(length: Int, flags: Int): CharSequence? =
        if (live()) super.getTextAfterCursor(length, flags) else null

    override fun getSelectedText(flags: Int): CharSequence? =
        if (live()) super.getSelectedText(flags) else null

    override fun getCursorCapsMode(reqModes: Int): Int =
        if (live()) super.getCursorCapsMode(reqModes) else 0

    override fun getExtractedText(request: ExtractedTextRequest?, flags: Int): ExtractedText? {
        if (!live()) return null
        return ExtractedText().apply {
            text = content.toString()
            startOffset = 0
            partialStartOffset = -1
            partialEndOffset = -1
            selectionStart = Selection.getSelectionStart(content)
            selectionEnd = Selection.getSelectionEnd(content)
            this.flags = ExtractedText.FLAG_SINGLE_LINE
        }
    }

    override fun commitCompletion(text: CompletionInfo?): Boolean =
        if (text == null) false else commitText(text.text, 1)

    override fun performEditorAction(actionCode: Int): Boolean {
        if (!live() || (actionCode != EditorInfo.IME_ACTION_DONE &&
                actionCode != EditorInfo.IME_ACTION_NEXT && actionCode != EditorInfo.IME_ACTION_UNSPECIFIED)) {
            return false
        }
        // An editor action must observe every pending edit even if an IME
        // issues it before closing its batch.
        val previousBatchDepth = batchDepth
        batchDepth = 0
        drainDeferredAuthority()
        val finished = finishComposingText()
        // The flush itself can retire THIS connection: an accepted edit whose
        // keyboard/return intent changed (e.g. text -> number) triggers an
        // intent-only restart, invalidating this object mid-action. The
        // logical session continues, so the user's Done must still be
        // delivered — the host's command guard decides (review P2).
        if (!finished || (!live() && !canDeliverPendingSubmit())) return false
        batchDepth = previousBatchDepth
        return onCommand("TEXT_SUBMIT")
    }

    /** Some IMEs deliver delete/enter as key events even for a full editor. */
    override fun sendKeyEvent(event: KeyEvent): Boolean {
        if (!live()) return false
        if (event.action == KeyEvent.ACTION_UP) return true
        if (event.action != KeyEvent.ACTION_DOWN) return false
        return when (event.keyCode) {
            KeyEvent.KEYCODE_DEL, KeyEvent.KEYCODE_FORWARD_DEL -> {
                val selected = Selection.getSelectionStart(content) != Selection.getSelectionEnd(content)
                if (selected) commitText("", 1)
                else if (event.keyCode == KeyEvent.KEYCODE_DEL) deleteSurroundingTextInCodePoints(1, 0)
                else deleteSurroundingTextInCodePoints(0, 1)
            }
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> performEditorAction(editorAction())
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> {
                val base = Selection.getSelectionStart(content)
                val extent = Selection.getSelectionEnd(content)
                val backward = event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                val next = when {
                    !event.isShiftPressed && base != extent -> if (backward) minOf(base, extent) else maxOf(base, extent)
                    backward && extent > 0 -> Character.offsetByCodePoints(content, extent, -1)
                    !backward && extent < content.length -> Character.offsetByCodePoints(content, extent, 1)
                    else -> extent
                }
                setSelection(if (event.isShiftPressed) base else next, next)
            }
            else -> {
                val codePoint = event.unicodeChar
                if (codePoint > 0 && Character.isValidCodePoint(codePoint) && !event.isCtrlPressed) {
                    commitText(String(Character.toChars(codePoint)), 1)
                } else false
            }
        }
    }

    /** Host teardown/restart must not blur a newer session. */
    fun invalidate() {
        if (closed) return
        closed = true
        batchDepth = 0
        super.closeConnection()
    }

    override fun closeConnection() {
        if (live()) {
            batchDepth = 0
            finishComposingText()
        }
        val wasCurrent = live()
        invalidate()
        if (wasCurrent) onCommand("TEXT_BLUR")
    }
}
