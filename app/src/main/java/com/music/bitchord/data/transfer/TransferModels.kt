package com.music.bitchord.data.transfer

import java.text.Normalizer
import java.util.Locale

/** Where a transfer reads from. */
enum class TransferService(val label: String) {
    SPOTIFY("Spotify"),
    DEEZER("Deezer"),
    APPLE_MUSIC("Apple Music"),
    YOUTUBE_MUSIC("YouTube Music"),
    FILE("File"),
}

/** What a collection is, which decides how it is written on the other side. */
enum class CollectionKind { LIKED, PLAYLIST, ALBUM, ARTIST }

/** Where a transfer writes to. */
enum class TransferDestination {
    /** The signed-in YouTube Music account: likes, playlists, saved albums, subscriptions. */
    YOUTUBE_MUSIC,

    /** Playlists kept on this phone, for listeners who are not signed in. */
    ON_DEVICE,
}

/**
 * One track as the source service describes it.
 *
 * [videoId] is set only when the source already is YouTube (a YouTube Music
 * playlist link), so there is nothing to match.
 */
data class SourceTrack(
    val title: String,
    val artist: String,
    val album: String? = null,
    val durationSec: Int? = null,
    val isrc: String? = null,
    val videoId: String? = null,
) {
    /** Same recording, regardless of punctuation, case or "feat." credits. */
    val key: String get() = TransferText.trackKey(title, artist)
}

/**
 * Something the listener can pick to move: their liked songs, a playlist, a
 * saved album or a followed artist.
 *
 * [tracks] is filled in up front by sources that read everything at once (a
 * link, a file); account sources leave it null and read it when the transfer
 * reaches it, so listing a big library stays quick.
 */
data class SourceCollection(
    val id: String,
    val service: TransferService,
    val kind: CollectionKind,
    val name: String,
    val subtitle: String? = null,
    val imageUrl: String? = null,
    val count: Int? = null,
    val tracks: List<SourceTrack>? = null,
) {
    /** Stable across app restarts, so a resumed job finds its own entries again. */
    val uid: String get() = "${service.name}:${kind.name}:$id"
}

/** What to do when a song or playlist is already there. */
data class TransferOptions(
    /** Leave out songs the destination already has (always on for likes). */
    val skipExisting: Boolean = true,
    /** Add to a playlist with the same name instead of making a second one. */
    val mergeSameName: Boolean = true,
    /** New YouTube Music playlists start private. */
    val privatePlaylists: Boolean = true,
)

/** Text helpers shared by matching and duplicate checks. */
object TransferText {
    private val FEAT = Regex("""\s*[(\[]?\s*(feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]?""", RegexOption.IGNORE_CASE)
    private val NOISE = Regex("""\s*[-–(\[]\s*(\d{4}\s+)?(remaster(ed)?|single version|album version|radio edit|mono|stereo)[^)\]]*[)\]]?""", RegexOption.IGNORE_CASE)
    private val NON_WORD = Regex("""[^\p{L}\p{N}]+""")

    fun normalize(text: String): String {
        val stripped = Normalizer.normalize(text, Normalizer.Form.NFD).replace(Regex("""\p{M}+"""), "")
        return stripped.lowercase(Locale.ROOT).replace(NON_WORD, " ").trim()
    }

    /** The title without "feat." credits and remaster/edit tags. */
    fun cleanTitle(title: String): String = title.replace(FEAT, "").replace(NOISE, "").trim().ifEmpty { title.trim() }

    /** The first credited artist, for a key that survives "A, B & C" vs "A". */
    fun leadArtist(artist: String): String =
        artist.split(",", "&", " x ", " X ", ";", " and ", " feat", " ft.").first().trim()

    fun trackKey(title: String, artist: String): String =
        normalize(cleanTitle(title)) + "|" + normalize(leadArtist(artist))

    /** "Artist - Title" as many exports write a line; null when there is no dash. */
    fun splitArtistTitle(line: String): Pair<String, String>? {
        val idx = listOf(" - ", " – ", " — ").map { line.indexOf(it) }.filter { it > 0 }.minOrNull() ?: return null
        val artist = line.substring(0, idx).trim()
        val title = line.substring(idx + 3).trim()
        if (artist.isEmpty() || title.isEmpty()) return null
        return artist to title
    }

    /** How alike two names are, 0..1, by shared words. */
    fun similarity(a: String, b: String): Double {
        val wa = normalize(a).split(' ').filter { it.isNotBlank() }.toSet()
        val wb = normalize(b).split(' ').filter { it.isNotBlank() }.toSet()
        if (wa.isEmpty() || wb.isEmpty()) return 0.0
        return wa.intersect(wb).size.toDouble() / maxOf(wa.size, wb.size)
    }
}
