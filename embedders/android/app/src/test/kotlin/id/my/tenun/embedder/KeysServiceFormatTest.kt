package id.my.tenun.embedder

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * TN-189 signature wire-format tests (JVM): the SAME vectors as
 * packages/platform/test/keys.test.ts — raw r||s is the pinned parity
 * point between the AndroidKeyStore tier and the preview keyring, so
 * both converters must agree byte-for-byte on every case.
 */
class KeysServiceFormatTest {

    private fun pad(tail: Int): ByteArray = ByteArray(32) { if (it == 31) tail.toByte() else 0 }

    @Test
    fun minimalIntegersRoundTripCanonically() {
        val raw = pad(0x01) + pad(0x02)
        val der = DerSignature.rawToDerP256(raw)!!
        assertArrayEquals(byteArrayOf(0x30, 6, 2, 1, 1, 2, 1, 2), der)
        assertArrayEquals(raw, DerSignature.derToRawP256(der))
    }

    @Test
    fun highBitIntegerGainsDerSignByteAndExtractionStripsIt() {
        val raw = ByteArray(32) { 0xff.toByte() } + pad(0x01)
        val der = DerSignature.rawToDerP256(raw)!!
        assertEquals(0x02, der[2].toInt())
        assertEquals(33, der[3].toInt()) // 32 bytes + the sign byte
        assertArrayEquals(raw, DerSignature.derToRawP256(der))
    }

    @Test
    fun zeroIntegersStayValid() {
        val raw = ByteArray(64)
        val der = DerSignature.rawToDerP256(raw)!!
        assertEquals(1, der[3].toInt()) // INTEGER length 1, content 0x00
        assertArrayEquals(raw, DerSignature.derToRawP256(der))
    }

    @Test
    fun malformedDerIsRefusedNeverGuessed() {
        assertNull(DerSignature.derToRawP256(ByteArray(0)))
        // truncated s-INTEGER (same bytes as the TS vector)
        assertNull(DerSignature.derToRawP256(byteArrayOf(0x30, 6, 2, 1, 1, 2, 1)))
        // not a SEQUENCE
        assertNull(DerSignature.derToRawP256(byteArrayOf(0x31, 0)))
        // long-form length
        assertNull(
            DerSignature.derToRawP256(byteArrayOf(0x30, 0x81.toByte(), 8, 0, 0, 0, 0, 0, 0, 0))
        )
        // integer wider than the 32-byte field
        assertNull(
            DerSignature.derToRawP256(byteArrayOf(0x30, 0x24, 0x02, 0x21) + ByteArray(33) { 1 })
        )
        // wrong raw length
        assertNull(DerSignature.rawToDerP256(ByteArray(63)))
    }
}
