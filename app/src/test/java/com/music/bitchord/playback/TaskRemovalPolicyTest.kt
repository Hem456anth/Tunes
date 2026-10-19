package com.music.bitchord.playback

import com.music.bitchord.data.settings.AppSettings
import com.music.bitchord.playback.TaskRemovalPolicy.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression tests for "music keeps playing after Tunes is swiped away from
 * recent apps" (fixed in 3.1.2).
 */
class TaskRemovalPolicyTest {

    private val app = "app.tunes.music"
    private val systemUi = "com.android.systemui"
    private val auto = "com.google.android.projection.gearhead"

    @Test
    fun `closing the app stops the music by default`() {
        assertTrue(AppSettings.DEFAULT_STOP_ON_TASK_REMOVED)
        assertEquals(
            Decision.STOP,
            TaskRemovalPolicy.decide(AppSettings.DEFAULT_STOP_ON_TASK_REMOVED, emptyList()),
        )
    }

    @Test
    fun `the app's own and system controllers do not keep playback alive`() {
        assertEquals(Decision.STOP, TaskRemovalPolicy.decide(true, listOf(app, systemUi)))
    }

    @Test
    fun `turning the setting off keeps background playback`() {
        assertEquals(Decision.KEEP_PLAYING, TaskRemovalPolicy.decide(false, emptyList()))
        assertEquals(Decision.KEEP_PLAYING, TaskRemovalPolicy.decide(false, listOf(app)))
    }

    @Test
    fun `a connected car keeps playing when the phone task is swiped`() {
        assertEquals(Decision.KEEP_PLAYING, TaskRemovalPolicy.decide(true, listOf(app, auto)))
        assertEquals(
            Decision.KEEP_PLAYING,
            TaskRemovalPolicy.decide(true, listOf("com.android.car.media")),
        )
    }

    @Test
    fun `lookalike package names are not cars`() {
        assertEquals(
            Decision.STOP,
            TaskRemovalPolicy.decide(true, listOf("com.google.android.projection.gearhead.fake")),
        )
    }
}
