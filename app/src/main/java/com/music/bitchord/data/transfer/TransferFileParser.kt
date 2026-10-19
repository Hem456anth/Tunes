package com.music.bitchord.data.transfer

/**
 * Reads the playlist exports other transfer tools and players write:
 *
 * - CSV from TuneMyMusic (`Track name, Artist name, Album, Playlist name, Type, ISRC`),
 *   Exportify (`Track Name, Artist Name(s), Album Name, ISRC, Duration (ms)`) and
 *   Soundiiz (tab separated `title, artist, album, isrc`), and any sheet with a
 *   title and an artist column.
 * - M3U / M3U8 (`#EXTINF:seconds,Artist - Title`).
 * - Plain text, one `Artist - Title` per line.
 *
 * Rows are grouped into collections the way the export grouped them: by its
 * playlist column, with favourites, albums and artists kept apart.
 */
object TransferFileParser {

    fun parse(fileName: String, content: String): List<SourceCollection> {
        val text = content.removePrefix("\uFEFF")
        val base = fileName.substringAfterLast('/').substringBeforeLast('.').ifBlank { "Imported" }
        val lower = fileName.lowercase()
        return when {
            lower.endsWith(".m3u") || lower.endsWith(".m3u8") || text.trimStart().startsWith("#EXTM3U") -> parseM3u(base, text)
            lower.endsWith(".csv") || lower.endsWith(".tsv") || looksTabular(text) -> parseTable(base, text)
            else -> parseLines(base, text)
        }.filter { (it.tracks?.isNotEmpty() == true) || it.kind == CollectionKind.ALBUM || it.kind == CollectionKind.ARTIST }
    }

    private fun looksTabular(text: String): Boolean {
        val first = text.lineSequence().firstOrNull { it.isNotBlank() }?.lowercase() ?: return false
        return (first.contains("track") || first.contains("title")) && (first.contains(',') || first.contains('\t') || first.contains(';'))
    }

    // ---- M3U ---------------------------------------------------------------

    private fun parseM3u(base: String, text: String): List<SourceCollection> {
        var name = base
        val tracks = mutableListOf<SourceTrack>()
        var pending: Pair<Int?, String>? = null
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            when {
                line.startsWith("#PLAYLIST:", ignoreCase = true) -> name = line.substringAfter(':').trim().ifBlank { name }
                line.startsWith("#EXTINF:", ignoreCase = true) -> {
                    val body = line.substringAfter(':')
                    val seconds = body.substringBefore(',').trim().substringBefore(' ').toIntOrNull()?.takeIf { it > 0 }
                    pending = seconds to body.substringAfter(',', "").trim()
                }
                line.isEmpty() || line.startsWith("#") -> Unit
                else -> {
                    val label = pending?.second?.takeIf { it.isNotBlank() }
                        ?: line.substringAfterLast('/').substringAfterLast('\\').substringBeforeLast('.')
                    trackFromLabel(label, pending?.first)?.let(tracks::add)
                    pending = null
                }
            }
        }
        // Some exports carry only #EXTINF lines with no paths after them.
        pending?.let { (sec, label) -> trackFromLabel(label, sec)?.let(tracks::add) }
        return listOf(collection(name, CollectionKind.PLAYLIST, tracks))
    }

    // ---- Plain text ----------------------------------------------------------

    private fun parseLines(base: String, text: String): List<SourceCollection> {
        val tracks = text.lineSequence()
            .map { it.trim().removePrefix("\u2022").trimStart('-', '*', ' ').let { l -> l.replace(Regex("""^\d+[.)]\s+"""), "") } }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .mapNotNull { trackFromLabel(it, null) }
            .toList()
        return listOf(collection(base, CollectionKind.PLAYLIST, tracks))
    }

    private fun trackFromLabel(label: String, seconds: Int?): SourceTrack? {
        val split = TransferText.splitArtistTitle(label)
        return when {
            split != null -> SourceTrack(title = split.second, artist = split.first, durationSec = seconds)
            label.isNotBlank() -> SourceTrack(title = label.trim(), artist = "", durationSec = seconds)
            else -> null
        }
    }

    // ---- CSV / TSV -------------------------------------------------------

    private val TITLE = listOf("track name", "track", "title", "song", "song name", "name", "track title")
    private val ARTIST = listOf("artist name", "artist name(s)", "artist names", "artists", "artist", "artist(s)")
    private val ALBUM = listOf("album", "album name", "album title")
    private val PLAYLIST = listOf("playlist name", "playlist")
    private val TYPE = listOf("type")
    private val ISRC = listOf("isrc")
    private val DURATION_MS = listOf("duration (ms)", "duration_ms", "duration ms", "track duration (ms)")
    private val DURATION = listOf("duration", "length", "time")

    private fun parseTable(base: String, text: String): List<SourceCollection> {
        val firstLine = text.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()
        val delimiter = listOf('\t', ';', ',').maxByOrNull { d -> firstLine.count { it == d } } ?: ','
        val rows = readDelimited(text, delimiter).filter { row -> row.any { it.isNotBlank() } }
        if (rows.isEmpty()) return emptyList()
        val header = rows.first().map { it.trim().lowercase() }
        fun col(names: List<String>) = names.firstNotNullOfOrNull { n -> header.indexOf(n).takeIf { it >= 0 } }
        val title = col(TITLE)
        val artist = col(ARTIST)
        if (title == null) {
            // No header row: read it as artist,title, as several tools write it.
            return listOf(collection(base, CollectionKind.PLAYLIST, rows.mapNotNull { r ->
                when {
                    r.size >= 2 && r[1].isNotBlank() -> SourceTrack(title = r[1].trim(), artist = r[0].trim())
                    r.isNotEmpty() -> trackFromLabel(r[0], null)
                    else -> null
                }
            }))
        }
        val album = col(ALBUM)
        val playlist = col(PLAYLIST)
        val type = col(TYPE)
        val isrc = col(ISRC)
        val durationMs = col(DURATION_MS)
        val duration = col(DURATION)

        val playlists = LinkedHashMap<String, MutableList<SourceTrack>>()
        val liked = mutableListOf<SourceTrack>()
        val albums = LinkedHashMap<String, Pair<String, String>>()
        val artists = LinkedHashSet<String>()

        for (row in rows.drop(1)) {
            fun cell(i: Int?) = i?.let { row.getOrNull(it) }?.trim().orEmpty()
            var t = cell(title)
            var a = cell(artist)
            val kind = cell(type).lowercase()
            // TuneMyMusic sometimes leaves the artist empty and writes "Artist - Title".
            if (a.isEmpty()) TransferText.splitArtistTitle(t)?.let { (sa, st) -> a = sa; t = st }
            val seconds = cell(durationMs).toLongOrNull()?.div(1000)?.toInt()?.takeIf { it > 0 }
                ?: secondsOf(cell(duration))
            when {
                kind.contains("artist") -> (a.ifEmpty { t }).takeIf { it.isNotBlank() }?.let(artists::add)
                kind.contains("album") && !kind.contains("track") -> {
                    val albumName = cell(album).ifEmpty { t }
                    if (albumName.isNotBlank()) albums.putIfAbsent(TransferText.normalize("$albumName|$a"), albumName to a)
                }
                t.isBlank() -> Unit
                else -> {
                    val track = SourceTrack(
                        title = t,
                        artist = a,
                        album = cell(album).ifEmpty { null },
                        durationSec = seconds,
                        isrc = cell(isrc).uppercase().takeIf { ISRC_FORMAT.matches(it) },
                    )
                    if (kind.contains("favorite") || kind.contains("favourite") || kind.contains("liked")) {
                        liked += track
                    } else {
                        val name = cell(playlist).ifEmpty { base }
                        playlists.getOrPut(name) { mutableListOf() } += track
                    }
                }
            }
        }

        val out = mutableListOf<SourceCollection>()
        if (liked.isNotEmpty()) out += collection("Liked Songs", CollectionKind.LIKED, liked)
        playlists.forEach { (name, tracks) -> out += collection(name, CollectionKind.PLAYLIST, tracks) }
        albums.values.forEach { (name, by) ->
            out += SourceCollection(
                id = "file-album-" + TransferText.normalize("$name $by").replace(' ', '-'),
                service = TransferService.FILE,
                kind = CollectionKind.ALBUM,
                name = name,
                subtitle = by.ifBlank { null },
            )
        }
        artists.forEach { name ->
            out += SourceCollection(
                id = "file-artist-" + TransferText.normalize(name).replace(' ', '-'),
                service = TransferService.FILE,
                kind = CollectionKind.ARTIST,
                name = name,
            )
        }
        return out
    }

    private val ISRC_FORMAT = Regex("""[A-Z]{2}[A-Z0-9]{3}\d{7}""")

    private fun secondsOf(text: String): Int? {
        val parts = text.split(':').takeIf { it.size in 2..3 } ?: return text.toIntOrNull()?.takeIf { it in 1..36_000 }
        val numbers = parts.map { it.trim().toIntOrNull() ?: return null }
        return numbers.fold(0) { total, part -> total * 60 + part }.takeIf { it > 0 }
    }

    private fun collection(name: String, kind: CollectionKind, tracks: List<SourceTrack>) = SourceCollection(
        id = "file-" + kind.name.lowercase() + "-" + TransferText.normalize(name).replace(' ', '-').ifEmpty { "list" },
        service = TransferService.FILE,
        kind = kind,
        name = name,
        count = tracks.size,
        tracks = tracks,
    )

    /** RFC 4180 reading: quoted fields may hold the delimiter, quotes and line breaks. */
    internal fun readDelimited(text: String, delimiter: Char): List<List<String>> {
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        val field = StringBuilder()
        var quoted = false
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length && text[i + 1] == '"') { field.append('"'); i++ } else quoted = false
                } else field.append(c)
            } else when (c) {
                '"' -> if (field.isEmpty()) quoted = true else field.append(c)
                delimiter -> { row.add(field.toString()); field.setLength(0) }
                '\r' -> Unit
                '\n' -> { row.add(field.toString()); field.setLength(0); rows.add(row); row = mutableListOf() }
                else -> field.append(c)
            }
            i++
        }
        if (field.isNotEmpty() || row.isNotEmpty()) { row.add(field.toString()); rows.add(row) }
        return rows
    }
}
