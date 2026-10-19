package com.music.bitchord.data.transfer

import android.content.Context
import com.music.bitchord.data.LikeState
import com.music.bitchord.data.YtMusicRepository
import com.music.bitchord.data.model.BrowseType
import com.music.bitchord.data.model.LikeStatus
import com.music.bitchord.data.model.PlaylistPrivacy
import com.music.bitchord.data.model.SearchFilter
import com.music.bitchord.data.model.SearchResult
import com.music.bitchord.data.model.Song
import com.music.bitchord.data.sources.TrackMatcher
import com.music.bitchord.data.spotify.LocalPlaylistStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

enum class ItemStatus { QUEUED, READING, MATCHING, WRITING, DONE, PARTIAL, FAILED, SKIPPED }

enum class JobState { RUNNING, PAUSED, DONE, CANCELLED }

/** One collection's progress through a transfer. */
data class TransferItem(
    val collection: SourceCollection,
    val status: ItemStatus = ItemStatus.QUEUED,
    val total: Int = collection.tracks?.size ?: collection.count ?: 0,
    val processed: Int = 0,
    val added: Int = 0,
    val duplicates: Int = 0,
    val notFound: List<SourceTrack> = emptyList(),
    val error: String? = null,
    /** The playlist (YouTube or on-device) this item writes into, kept so a resume adds to it rather than making another. */
    val targetId: String? = null,
    /** Track keys already dealt with, so a resume picks up where it stopped. */
    val doneKeys: Set<String> = emptySet(),
) {
    val finished get() = status == ItemStatus.DONE || status == ItemStatus.PARTIAL || status == ItemStatus.FAILED || status == ItemStatus.SKIPPED
    val fraction: Float get() = when {
        finished -> 1f
        total <= 0 -> 0f
        else -> (processed.toFloat() / total).coerceIn(0f, 1f)
    }
}

data class TransferJob(
    val id: String,
    val destination: TransferDestination,
    val options: TransferOptions,
    val items: List<TransferItem>,
    val state: JobState,
    val startedAt: Long,
    /** A job-wide problem, e.g. the YouTube Music sign-in lapsed. */
    val message: String? = null,
) {
    val totalTracks get() = items.sumOf { it.total }
    val processedTracks get() = items.sumOf { if (it.finished) it.total else it.processed }
    val added get() = items.sumOf { it.added }
    val duplicates get() = items.sumOf { it.duplicates }
    val notFound get() = items.sumOf { it.notFound.size }
    val failedItems get() = items.count { it.status == ItemStatus.FAILED }
    val fraction: Float get() = if (items.isEmpty()) 0f else items.map { it.fraction }.average().toFloat()
}

/**
 * Runs Music Transfer: reads each picked collection, finds every song on
 * YouTube Music, and writes it to the destination — liked songs as likes,
 * playlists as playlists, albums saved, artists subscribed.
 *
 * - **Progress** is a [StateFlow] the screen draws from, saved to disk after
 *   every batch, so closing the app (or the system killing it) loses nothing:
 *   the job comes back paused and resumes where it stopped, adding to the
 *   playlists it already made instead of making new ones.
 * - **Duplicates**: songs repeated in a source are written once; songs the
 *   destination already has (already liked, already in the playlist) are
 *   skipped and counted; a playlist with the same name is merged into.
 * - **Errors**: network and rate-limit failures retry with backoff; a
 *   collection that still fails is marked and the rest carry on; songs with
 *   no match are listed for a manual pick or a later retry.
 */
object TransferEngine {

    private const val FILE_NAME = "music_transfer.json"
    private const val CHUNK = 20
    private const val MATCH_PARALLELISM = 3
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var file: File? = null
    private var runner: Job? = null
    private val matchCache = HashMap<String, Song?>()

    private val _job = MutableStateFlow<TransferJob?>(null)
    val job: StateFlow<TransferJob?> = _job.asStateFlow()

    fun init(context: Context) {
        if (file != null) return
        file = File(context.applicationContext.filesDir, FILE_NAME)
        val restored = runCatching { file?.takeIf { it.exists() }?.readText()?.let(TransferStore::decode) }.getOrNull()
        // A job that was running when the process died comes back paused.
        _job.value = restored?.let { if (it.state == JobState.RUNNING) it.copy(state = JobState.PAUSED, message = null) else it }
    }

    val isRunning: Boolean get() = runner?.isActive == true

    fun start(collections: List<SourceCollection>, destination: TransferDestination, options: TransferOptions) {
        if (isRunning || collections.isEmpty()) return
        val unique = collections.distinctBy { it.uid }
        matchCache.clear()
        val job = TransferJob(
            id = System.currentTimeMillis().toString(),
            destination = destination,
            options = options,
            items = unique.map { TransferItem(it) },
            state = JobState.RUNNING,
            startedAt = System.currentTimeMillis(),
        )
        publish(job)
        launch()
    }

    fun pause() {
        runner?.cancel()
        runner = null
        _job.value?.let { if (it.state == JobState.RUNNING) publish(it.copy(state = JobState.PAUSED)) }
    }

    fun resume() {
        val current = _job.value ?: return
        if (isRunning || current.state == JobState.DONE || current.state == JobState.CANCELLED) return
        publish(current.copy(state = JobState.RUNNING, message = null))
        launch()
    }

    fun cancel() {
        runner?.cancel()
        runner = null
        _job.value?.let { publish(it.copy(state = JobState.CANCELLED)) }
    }

    /** Forgets a finished or cancelled job; what it wrote stays written. */
    fun clear() {
        if (isRunning) return
        _job.value = null
        file?.delete()
    }

    /** Runs failed collections again, and looks again for songs that weren't found. */
    fun retryProblems() {
        val current = _job.value ?: return
        if (isRunning) return
        val items = current.items.map { item ->
            when {
                item.status == ItemStatus.FAILED -> item.copy(status = ItemStatus.QUEUED, error = null)
                item.notFound.isNotEmpty() -> item.copy(
                    status = ItemStatus.QUEUED,
                    error = null,
                    processed = (item.processed - item.notFound.size).coerceAtLeast(0),
                    doneKeys = item.doneKeys - item.notFound.map { it.key }.toSet(),
                    notFound = emptyList(),
                )
                else -> item
            }
        }
        synchronized(matchCache) { current.items.flatMap { it.notFound }.forEach { matchCache.remove(it.key) } }
        publish(current.copy(items = items, state = JobState.RUNNING, message = null))
        launch()
    }

    /** The listener picked [song] for a track that had no match; write it and take the track off the list. */
    suspend fun resolveManually(itemUid: String, track: SourceTrack, song: Song): Result<Unit> = runCatching {
        val current = _job.value ?: error("No transfer")
        val item = current.items.firstOrNull { it.collection.uid == itemUid } ?: error("Gone")
        var targetId = item.targetId
        when (current.destination) {
            TransferDestination.YOUTUBE_MUSIC -> when (item.collection.kind) {
                CollectionKind.LIKED -> like(song.videoId)
                else -> {
                    if (targetId == null) {
                        targetId = createYtPlaylist(item.collection.name, current.options, listOf(song.videoId))
                    } else {
                        retrying { YtMusicRepository.addToPlaylist(targetId, listOf(song.videoId)).getOrThrow() }
                    }
                }
            }
            TransferDestination.ON_DEVICE -> {
                if (targetId == null) {
                    targetId = LocalPlaylistStore.savePlaylist(localTitle(item.collection), listOf(song)).id
                } else {
                    LocalPlaylistStore.appendSongs(targetId, listOf(song))
                }
            }
        }
        synchronized(matchCache) { matchCache[track.key] = song }
        updateItem(itemUid) {
            val left = it.notFound.filterNot { nf -> nf == track }
            it.copy(
                targetId = targetId,
                added = it.added + 1,
                notFound = left,
                status = if (it.status == ItemStatus.PARTIAL && left.isEmpty()) ItemStatus.DONE else it.status,
            )
        }
    }

    /** Search results to choose from for a track with no match. */
    suspend fun candidates(track: SourceTrack): List<Song> {
        val query = listOf(TransferText.cleanTitle(track.title), TransferText.leadArtist(track.artist))
            .filter { it.isNotBlank() }.joinToString(" ")
        return YtMusicRepository.search(query, SearchFilter.SONGS).getOrNull()
            ?.filterIsInstance<SearchResult.Track>()?.map { it.song }?.take(8).orEmpty()
    }

    // ---- the run ------------------------------------------------------------------

    private fun launch() {
        runner = scope.launch {
            try {
                while (true) {
                    val current = _job.value ?: return@launch
                    val next = current.items.firstOrNull { !it.finished } ?: break
                    runItem(current.destination, current.options, next.collection.uid)
                }
                _job.value?.let { publish(it.copy(state = JobState.DONE)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignInLapsed) {
                _job.value?.let { publish(it.copy(state = JobState.PAUSED, message = e.message)) }
            }
        }
    }

    private suspend fun runItem(destination: TransferDestination, options: TransferOptions, uid: String) {
        try {
            updateItem(uid) { it.copy(status = ItemStatus.READING, error = null) }
            val item0 = itemOf(uid) ?: return
            val tracks = item0.collection.tracks ?: retrying { TransferSources.tracksOf(item0.collection) }
            val kind = item0.collection.kind
            val single = kind == CollectionKind.ARTIST || (kind == CollectionKind.ALBUM && destination == TransferDestination.YOUTUBE_MUSIC)
            updateItem(uid) { it.copy(collection = it.collection.copy(tracks = tracks), total = if (single) 1 else tracks.size) }
            when (item0.collection.kind) {
                CollectionKind.ARTIST -> followArtist(destination, options, uid)
                CollectionKind.ALBUM -> if (destination == TransferDestination.YOUTUBE_MUSIC) saveAlbum(options, uid) else copyTracks(destination, options, uid)
                CollectionKind.LIKED, CollectionKind.PLAYLIST -> copyTracks(destination, options, uid)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: SignInLapsed) {
            throw e
        } catch (e: Exception) {
            updateItem(uid) { it.copy(status = ItemStatus.FAILED, error = friendly(e)) }
        }
    }

    private suspend fun copyTracks(destination: TransferDestination, options: TransferOptions, uid: String) {
        val item = itemOf(uid) ?: return
        val collection = item.collection
        val tracks = collection.tracks.orEmpty()
        if (tracks.isEmpty()) {
            updateItem(uid) { it.copy(status = ItemStatus.DONE, total = 0) }
            return
        }
        // Repeats inside the source are one song.
        val unique = LinkedHashMap<String, SourceTrack>()
        var repeats = 0
        tracks.forEach { t -> if (unique.putIfAbsent(t.key, t) != null) repeats++ }
        val pending = unique.values.filter { it.key !in item.doneKeys }
        if (item.doneKeys.isEmpty() && repeats > 0) {
            updateItem(uid) { it.copy(duplicates = it.duplicates + repeats, processed = it.processed + repeats) }
        }

        // What the destination already holds.
        var targetId = item.targetId
        val existing = HashSet<String>()
        val isLiked = collection.kind == CollectionKind.LIKED
        when (destination) {
            TransferDestination.YOUTUBE_MUSIC -> {
                if (isLiked) {
                    existing += likedOnYouTube()
                } else {
                    if (targetId == null && options.mergeSameName) {
                        targetId = retrying { YtMusicRepository.userPlaylists().getOrThrow() }
                            .firstOrNull { TransferText.normalize(it.title) == TransferText.normalize(collection.name) }
                            ?.playlistId
                    }
                    if (targetId != null && options.skipExisting) existing += playlistVideoIds(targetId)
                }
            }
            TransferDestination.ON_DEVICE -> {
                if (targetId == null && options.mergeSameName) targetId = LocalPlaylistStore.findByTitle(localTitle(collection))?.id
                if (targetId != null && options.skipExisting) {
                    LocalPlaylistStore.getPlaylist(targetId)?.songs?.mapTo(existing) { it.videoId }
                }
            }
        }
        updateItem(uid) { it.copy(status = ItemStatus.MATCHING, targetId = targetId) }

        for (chunk in pending.chunked(CHUNK)) {
            val matches: List<Pair<SourceTrack, Song?>> = coroutineScope {
                val gate = Semaphore(MATCH_PARALLELISM)
                chunk.map { t -> async { gate.withPermit { t to retrying { match(t) } } } }.awaitAll()
            }
            val found = matches.mapNotNull { (_, s) -> s }.distinctBy { it.videoId }
            val fresh = found.filter { existing.add(it.videoId) }
            val dupes = found.size - fresh.size
            val missing = matches.filter { it.second == null }.map { it.first }

            if (fresh.isNotEmpty()) {
                updateItem(uid) { it.copy(status = ItemStatus.WRITING) }
                when (destination) {
                    TransferDestination.YOUTUBE_MUSIC -> if (isLiked) {
                        fresh.forEach { like(it.videoId); delay(120) }
                    } else if (targetId == null) {
                        targetId = createYtPlaylist(collection.name, options, fresh.map { it.videoId })
                    } else {
                        val id = targetId
                        retrying { YtMusicRepository.addToPlaylist(id, fresh.map { it.videoId }).getOrThrow() }
                    }
                    TransferDestination.ON_DEVICE -> if (targetId == null) {
                        targetId = LocalPlaylistStore.savePlaylist(localTitle(collection), fresh).id
                    } else {
                        LocalPlaylistStore.appendSongs(targetId!!, fresh)
                    }
                }
            }
            val newTarget = targetId
            updateItem(uid) {
                it.copy(
                    status = ItemStatus.MATCHING,
                    targetId = newTarget,
                    processed = it.processed + chunk.size,
                    added = it.added + fresh.size,
                    duplicates = it.duplicates + dupes,
                    notFound = it.notFound + missing,
                    doneKeys = it.doneKeys + chunk.map { t -> t.key },
                )
            }
        }
        updateItem(uid) { it.copy(status = if (it.notFound.isEmpty()) ItemStatus.DONE else ItemStatus.PARTIAL, processed = it.total) }
    }

    private suspend fun saveAlbum(options: TransferOptions, uid: String) {
        val item = itemOf(uid) ?: return
        val c = item.collection
        updateItem(uid) { it.copy(status = ItemStatus.MATCHING, total = 1) }
        val artist = c.subtitle ?: c.tracks?.firstOrNull()?.artist.orEmpty()
        val results = retrying { YtMusicRepository.search("${c.name} $artist".trim(), SearchFilter.ALBUMS).getOrThrow() }
            .filterIsInstance<SearchResult.Browse>().map { it.item }.filter { it.type == BrowseType.ALBUM }
        val best = results.maxByOrNull { TransferText.similarity(it.title, c.name) * 2 + TransferText.similarity(it.subtitle, artist) }
            ?.takeIf { TransferText.similarity(it.title, c.name) >= 0.5 }
        if (best == null) {
            updateItem(uid) { it.copy(status = ItemStatus.PARTIAL, processed = 1, notFound = listOf(SourceTrack(c.name, artist))) }
            return
        }
        updateItem(uid) { it.copy(status = ItemStatus.WRITING) }
        val state = retrying { YtMusicRepository.releaseLibraryState(best.browseId).getOrThrow() }
            ?: throw SignInLapsed()
        if (state.saved && options.skipExisting) {
            updateItem(uid) { it.copy(status = ItemStatus.DONE, processed = 1, duplicates = 1) }
            return
        }
        writing { YtMusicRepository.setSaved(state.playlistId, true) }
        updateItem(uid) { it.copy(status = ItemStatus.DONE, processed = 1, added = 1) }
    }

    private suspend fun followArtist(destination: TransferDestination, options: TransferOptions, uid: String) {
        val c = itemOf(uid)?.collection ?: return
        if (destination == TransferDestination.ON_DEVICE) {
            updateItem(uid) { it.copy(status = ItemStatus.SKIPPED, total = 1, processed = 1, error = "Following artists needs YouTube Music sign-in") }
            return
        }
        updateItem(uid) { it.copy(status = ItemStatus.MATCHING, total = 1) }
        val artist = retrying { YtMusicRepository.search(c.name, SearchFilter.ARTISTS).getOrThrow() }
            .filterIsInstance<SearchResult.Browse>().map { it.item }
            .filter { it.type == BrowseType.ARTIST && it.browseId.startsWith("UC") }
            .maxByOrNull { TransferText.similarity(it.title, c.name) }
            ?.takeIf { TransferText.normalize(it.title) == TransferText.normalize(c.name) || TransferText.similarity(it.title, c.name) >= 0.8 }
        if (artist == null) {
            updateItem(uid) { it.copy(status = ItemStatus.PARTIAL, processed = 1, notFound = listOf(SourceTrack(c.name, c.name))) }
            return
        }
        if (options.skipExisting) {
            val subscribed = YtMusicRepository.artistPage(artist.browseId).getOrNull()?.subscription?.subscribed == true
            if (subscribed) {
                updateItem(uid) { it.copy(status = ItemStatus.DONE, processed = 1, duplicates = 1) }
                return
            }
        }
        updateItem(uid) { it.copy(status = ItemStatus.WRITING) }
        writing { YtMusicRepository.setSubscribed(artist.browseId, true) }
        updateItem(uid) { it.copy(status = ItemStatus.DONE, processed = 1, added = 1) }
    }

    // ---- matching -----------------------------------------------------------------

    /** The YouTube Music song for [track], or null when there is no believable match. */
    private suspend fun match(track: SourceTrack): Song? {
        track.videoId?.let {
            return Song(videoId = it, title = track.title, artist = track.artist, thumbnailUrl = null, albumName = track.album)
        }
        synchronized(matchCache) { if (matchCache.containsKey(track.key)) return matchCache[track.key] }
        val target = TrackMatcher.Target(title = track.title, artist = track.artist, durationSec = track.durationSec, album = track.album)
        var song: Song? = null
        track.isrc?.let { isrc ->
            val byIsrc = searchSongs(isrc)
            song = TrackMatcher.best(byIsrc, target)
        }
        if (song == null) {
            val query = listOf(TransferText.cleanTitle(track.title), TransferText.leadArtist(track.artist))
                .filter { it.isNotBlank() }.joinToString(" ")
            val candidates = searchSongs(query)
            song = TrackMatcher.best(candidates, target) ?: TransferMatchRules.loose(candidates, track)
        }
        synchronized(matchCache) { matchCache[track.key] = song }
        return song
    }

    private suspend fun searchSongs(query: String): List<Song> =
        YtMusicRepository.search(query, SearchFilter.SONGS).getOrElse { throw IOException(it.message, it) }
            .filterIsInstance<SearchResult.Track>().map { it.song }

    // ---- writing ------------------------------------------------------------------

    private suspend fun likedOnYouTube(): Set<String> {
        val liked = YtMusicRepository.allSongs(YtMusicRepository.LIKED_MUSIC).getOrNull()?.map { it.videoId }.orEmpty()
        val overrides = LikeState.overrides.value.filterValues { it == LikeStatus.LIKE }.keys
        return liked.toSet() + overrides
    }

    private suspend fun playlistVideoIds(playlistId: String): Set<String> =
        YtMusicRepository.allSongs("VL$playlistId").getOrNull()?.mapTo(HashSet()) { it.videoId }.orEmpty()

    private suspend fun like(videoId: String) {
        writing { YtMusicRepository.rate(videoId, LikeStatus.LIKE) }
        LikeState.set(videoId, LikeStatus.LIKE)
    }

    private suspend fun createYtPlaylist(name: String, options: TransferOptions, videoIds: List<String>): String {
        val privacy = if (options.privatePlaylists) PlaylistPrivacy.PRIVATE else PlaylistPrivacy.PUBLIC
        return writing { YtMusicRepository.createPlaylist(name.take(150), privacy, videoIds) }
    }

    private fun localTitle(c: SourceCollection): String = when (c.kind) {
        CollectionKind.LIKED -> "Liked Songs (${c.service.label})"
        CollectionKind.ALBUM -> listOfNotNull(c.name, c.subtitle).joinToString(" · ")
        else -> c.name
    }

    /** A write to the account. Failures that look like a lapsed sign-in pause the whole job. */
    private suspend fun <T> writing(block: suspend () -> Result<T>): T = retrying {
        block().getOrElse { e ->
            val text = e.message.orEmpty()
            if ("401" in text || "403" in text || "sign in" in text.lowercase() || "login" in text.lowercase()) throw SignInLapsed()
            throw IOException(text.ifBlank { "YouTube Music refused the change" }, e)
        }
    }

    /** Tries [block] up to four times, waiting 1, 2 and 4 seconds between attempts. */
    private suspend fun <T> retrying(block: suspend () -> T): T {
        var wait = 1_000L
        var last: Exception? = null
        repeat(4) { attempt ->
            try {
                return block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignInLapsed) {
                throw e
            } catch (e: TransferException) {
                if (!e.retryable) throw e
                last = e
            } catch (e: Exception) {
                last = e
            }
            if (attempt < 3) { delay(wait); wait *= 2 }
        }
        throw last ?: IOException("Failed")
    }

    private fun friendly(e: Exception): String = when (e) {
        is TransferException -> e.message.orEmpty()
        is IOException -> "Network problem: ${e.message ?: "no connection"}"
        is IllegalStateException -> e.message ?: "Couldn't read this"
        else -> e.message ?: e.javaClass.simpleName
    }

    private class SignInLapsed : Exception("YouTube Music needs you to sign in again, then tap Resume.")

    // ---- state ---------------------------------------------------------------------

    private fun itemOf(uid: String) = _job.value?.items?.firstOrNull { it.collection.uid == uid }

    @Synchronized
    private fun updateItem(uid: String, change: (TransferItem) -> TransferItem) {
        val current = _job.value ?: return
        publish(current.copy(items = current.items.map { if (it.collection.uid == uid) change(it) else it }))
    }

    @Synchronized
    private fun publish(job: TransferJob) {
        _job.value = job
        runCatching { file?.writeText(TransferStore.encode(job)) }
    }
}

/** The fallback match when the strict matcher finds nothing: same title, a shared artist word. */
internal object TransferMatchRules {
    fun loose(candidates: List<Song>, track: SourceTrack): Song? = candidates.take(5).firstOrNull { c ->
        val titleOk = TransferText.similarity(TransferText.cleanTitle(c.title), TransferText.cleanTitle(track.title)) >= 0.75
        val artistOk = track.artist.isBlank() || TransferText.similarity(c.artist, track.artist) > 0.0
        val durationOk = track.durationSec == null ||
            TrackMatcher.secondsOf(c.durationText)?.let { kotlin.math.abs(it - track.durationSec) <= 15 } ?: true
        titleOk && artistOk && durationOk
    }
}

/** Saves a job as JSON, tracks included, so a resume needs nothing from the source again. */
internal object TransferStore {
    fun encode(job: TransferJob): String = JSONObject().apply {
        put("id", job.id)
        put("destination", job.destination.name)
        put("state", job.state.name)
        put("startedAt", job.startedAt)
        put("message", job.message)
        put("skipExisting", job.options.skipExisting)
        put("mergeSameName", job.options.mergeSameName)
        put("privatePlaylists", job.options.privatePlaylists)
        put("items", JSONArray().apply { job.items.forEach { put(item(it)) } })
    }.toString()

    private fun item(i: TransferItem) = JSONObject().apply {
        val c = i.collection
        put("cid", c.id); put("service", c.service.name); put("kind", c.kind.name); put("name", c.name)
        put("subtitle", c.subtitle); put("image", c.imageUrl); put("count", c.count ?: JSONObject.NULL)
        c.tracks?.let { put("tracks", tracks(it)) }
        put("status", i.status.name); put("total", i.total); put("processed", i.processed)
        put("added", i.added); put("duplicates", i.duplicates); put("error", i.error); put("targetId", i.targetId)
        put("notFound", tracks(i.notFound))
        put("doneKeys", JSONArray(i.doneKeys.toList()))
    }

    private fun tracks(list: List<SourceTrack>) = JSONArray().apply {
        list.forEach { t ->
            put(JSONObject().apply {
                put("t", t.title); put("a", t.artist); put("al", t.album); put("d", t.durationSec ?: JSONObject.NULL)
                put("i", t.isrc); put("v", t.videoId)
            })
        }
    }

    fun decode(text: String): TransferJob {
        val o = JSONObject(text)
        val items = o.getJSONArray("items").let { arr -> (0 until arr.length()).map { readItem(arr.getJSONObject(it)) } }
        return TransferJob(
            id = o.getString("id"),
            destination = TransferDestination.valueOf(o.getString("destination")),
            options = TransferOptions(
                skipExisting = o.optBoolean("skipExisting", true),
                mergeSameName = o.optBoolean("mergeSameName", true),
                privatePlaylists = o.optBoolean("privatePlaylists", true),
            ),
            items = items,
            state = JobState.valueOf(o.getString("state")),
            startedAt = o.optLong("startedAt"),
            message = o.str("message"),
        )
    }

    private fun readItem(o: JSONObject): TransferItem {
        val collection = SourceCollection(
            id = o.getString("cid"),
            service = TransferService.valueOf(o.getString("service")),
            kind = CollectionKind.valueOf(o.getString("kind")),
            name = o.getString("name"),
            subtitle = o.str("subtitle"),
            imageUrl = o.str("image"),
            count = if (o.isNull("count")) null else o.optInt("count"),
            tracks = o.optJSONArray("tracks")?.let(::readTracks),
        )
        return TransferItem(
            collection = collection,
            status = ItemStatus.valueOf(o.getString("status")).let { if (it == ItemStatus.READING || it == ItemStatus.MATCHING || it == ItemStatus.WRITING) ItemStatus.QUEUED else it },
            total = o.optInt("total"),
            processed = o.optInt("processed"),
            added = o.optInt("added"),
            duplicates = o.optInt("duplicates"),
            notFound = o.optJSONArray("notFound")?.let(::readTracks).orEmpty(),
            error = o.str("error"),
            targetId = o.str("targetId"),
            doneKeys = o.optJSONArray("doneKeys")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }.orEmpty(),
        )
    }

    private fun readTracks(a: JSONArray) = (0 until a.length()).map { idx ->
        val t = a.getJSONObject(idx)
        SourceTrack(
            title = t.optString("t"),
            artist = t.optString("a"),
            album = t.str("al"),
            durationSec = if (t.isNull("d")) null else t.optInt("d"),
            isrc = t.str("i"),
            videoId = t.str("v"),
        )
    }

    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }
}
