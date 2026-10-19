package com.music.bitchord.playback

/**
 * What to do when the user swipes Tunes away from the recent apps screen.
 *
 * Swiping an app away is the user closing it, so by default the music stops
 * with it. Playback carries on past the swipe only when it is clearly meant to
 * outlive the phone's UI:
 *
 * - the user turned off Settings → "Stop music on close from recents" (the
 *   explicit "keep playing in the background" choice), or
 * - a car head unit (Android Auto / Automotive) is connected to the session and
 *   driving playback, so the phone's own task is beside the point.
 *
 * Kept free of Android types so the decision can be unit-tested on the JVM.
 */
internal object TaskRemovalPolicy {

    enum class Decision { KEEP_PLAYING, STOP }

    /** Controllers that mean a car is driving playback, not the phone's UI. */
    val CAR_CONTROLLER_PACKAGES: Set<String> = setOf(
        "com.google.android.projection.gearhead", // Android Auto
        "com.android.car.media",                  // Android Automotive OS media centre
        "com.google.android.carassistant",
    )

    fun decide(stopOnClose: Boolean, controllerPackages: Collection<String>): Decision = when {
        !stopOnClose -> Decision.KEEP_PLAYING
        controllerPackages.any { it in CAR_CONTROLLER_PACKAGES } -> Decision.KEEP_PLAYING
        else -> Decision.STOP
    }
}
