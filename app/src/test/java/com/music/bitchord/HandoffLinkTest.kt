package com.music.bitchord

import com.music.bitchord.playback.MusicLink
import org.junit.Assert.assertEquals
import org.junit.Test

/** Tunes handoff: the `t=` position on shared YouTube Music links. */
class HandoffLinkTest {
    @Test fun secondsAndUnits() {
        assertEquals(754_000L, MusicLink.startOffsetMs("754"))
        assertEquals(754_000L, MusicLink.startOffsetMs("754s"))
        assertEquals(754_000L, MusicLink.startOffsetMs("12m34s"))
        assertEquals(3_723_000L, MusicLink.startOffsetMs("1h2m3s"))
    }

    @Test fun badValuesStartAtZero() {
        assertEquals(0L, MusicLink.startOffsetMs(null))
        assertEquals(0L, MusicLink.startOffsetMs(""))
        assertEquals(0L, MusicLink.startOffsetMs("abc"))
        assertEquals(0L, MusicLink.startOffsetMs("-5"))
        assertEquals(0L, MusicLink.startOffsetMs("999999"))
    }
}
