package com.music.bitchord

import com.music.bitchord.data.model.Song
import com.music.bitchord.data.transfer.AppleMusicPage
import com.music.bitchord.data.transfer.CollectionKind
import com.music.bitchord.data.transfer.SourceTrack
import com.music.bitchord.data.transfer.TransferException
import com.music.bitchord.data.transfer.TransferFileParser
import com.music.bitchord.data.transfer.TransferMatchRules
import com.music.bitchord.data.transfer.TransferService
import com.music.bitchord.data.transfer.TransferSources
import com.music.bitchord.data.transfer.TransferText
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Music Transfer's parsing, duplicate keys and match rules: everything that runs without a network. */
class MusicTransferTest {

    // ---- duplicate keys ----

    @Test
    fun sameRecordingSameKeyDespiteCreditsAndTags() {
        val a = SourceTrack("Blinding Lights", "The Weeknd")
        val b = SourceTrack("Blinding Lights - 2020 Remaster", "The Weeknd, Rosalía")
        val c = SourceTrack("BLINDING LIGHTS (feat. Someone)", "the weeknd")
        assertEquals(a.key, b.key)
        assertEquals(a.key, c.key)
        assertTrue(a.key != SourceTrack("Save Your Tears", "The Weeknd").key)
    }

    @Test
    fun accentsDoNotSplitKeys() {
        assertEquals(SourceTrack("Café", "Beyoncé").key, SourceTrack("Cafe", "Beyonce").key)
    }

    @Test
    fun splitsArtistDashTitle() {
        assertEquals("Daft Punk" to "One More Time", TransferText.splitArtistTitle("Daft Punk - One More Time"))
        assertNull(TransferText.splitArtistTitle("Just a title"))
    }

    // ---- files ----

    @Test
    fun tuneMyMusicCsvGroupsByPlaylistAndType() {
        val csv = """
            Track name,Artist name,Album,Playlist name,Type,ISRC
            "Levitating","Dua Lipa","Future Nostalgia","Gym","Playlist","GBAHT2000008"
            "One Kiss","Calvin Harris, Dua Lipa","One Kiss","Gym","Playlist",""
            "Yellow","Coldplay","Parachutes","","Favorite","GBAYE0000351"
            "Parachutes","Coldplay","Parachutes","","Album",""
            "Coldplay","Coldplay","","","Artist",""
        """.trimIndent()
        val out = TransferFileParser.parse("My Spotify Library.csv", csv)
        val liked = out.single { it.kind == CollectionKind.LIKED }
        assertEquals(1, liked.tracks!!.size)
        assertEquals("GBAYE0000351", liked.tracks!![0].isrc)
        val gym = out.single { it.kind == CollectionKind.PLAYLIST }
        assertEquals("Gym", gym.name)
        assertEquals(listOf("Levitating", "One Kiss"), gym.tracks!!.map { it.title })
        assertNull(gym.tracks!![1].isrc)
        assertEquals("Parachutes", out.single { it.kind == CollectionKind.ALBUM }.name)
        assertEquals("Coldplay", out.single { it.kind == CollectionKind.ARTIST }.name)
        assertTrue(out.all { it.service == TransferService.FILE })
    }

    @Test
    fun tuneMyMusicRowsWithArtistInTitleAreSplit() {
        val csv = "Track name,Artist name,Album,Playlist name,Type,ISRC\n\"Lorde - Team\",\"\",\"\",\"My playlist\",\"Playlist\",\"\"\n"
        val t = TransferFileParser.parse("x.csv", csv).single().tracks!!.single()
        assertEquals("Team", t.title)
        assertEquals("Lorde", t.artist)
    }

    @Test
    fun exportifyCsvReadsDurationAndQuotedCommas() {
        val csv = "\"Track URI\",\"Track Name\",\"Artist Name(s)\",\"Album Name\",\"Duration (ms)\",\"ISRC\"\n" +
            "\"spotify:track:1\",\"Hello, Goodbye\",\"The Beatles\",\"Magical Mystery Tour\",\"208000\",\"GBAYE0601653\"\n"
        val t = TransferFileParser.parse("road trip.csv", csv).single().tracks!!.single()
        assertEquals("Hello, Goodbye", t.title)
        assertEquals(208, t.durationSec)
        assertEquals("road trip", TransferFileParser.parse("road trip.csv", csv).single().name)
    }

    @Test
    fun soundiizTabSeparated() {
        val tsv = "title\tartist\talbum\tisrc\nTitanium\tDavid Guetta\tNothing but the Beat\tGB28K1100036\n"
        val t = TransferFileParser.parse("export.tsv", tsv).single().tracks!!.single()
        assertEquals("Titanium", t.title)
        assertEquals("David Guetta", t.artist)
    }

    @Test
    fun m3uWithPlaylistNameAndDurations() {
        val m3u = "#EXTM3U\n#PLAYLIST:Chill\n#EXTINF:215,Bonobo - Kerala\n/music/kerala.mp3\n#EXTINF:-1,Tycho - Awake\nawake.flac\n"
        val c = TransferFileParser.parse("list.m3u8", m3u).single()
        assertEquals("Chill", c.name)
        assertEquals(listOf("Kerala", "Awake"), c.tracks!!.map { it.title })
        assertEquals(215, c.tracks!![0].durationSec)
        assertNull(c.tracks!![1].durationSec)
    }

    @Test
    fun plainTextListsWithNumbersAndBullets() {
        val txt = "1. Queen - Bohemian Rhapsody\n• ABBA - Dancing Queen\n\n# comment\nUnknown Track\n"
        val tracks = TransferFileParser.parse("faves.txt", txt).single().tracks!!
        assertEquals(listOf("Bohemian Rhapsody", "Dancing Queen", "Unknown Track"), tracks.map { it.title })
        assertEquals("", tracks[2].artist)
    }

    @Test
    fun emptyFileYieldsNothing() {
        assertTrue(TransferFileParser.parse("empty.txt", "\n\n").isEmpty())
    }

    // ---- links ----

    @Test
    fun recognisesServiceLinks() {
        assertEquals(TransferSources.Link.SpotifyPlaylist("37i9dQZF1DXcBWIGoYBM5M"), TransferSources.parseLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc"))
        assertEquals(TransferSources.Link.SpotifyAlbum("1DFixLWuPkv3KT3TnV35m3"), TransferSources.parseLink("Check this https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3"))
        assertEquals(TransferSources.Link.DeezerPlaylist("908622995"), TransferSources.parseLink("https://www.deezer.com/en/playlist/908622995"))
        assertEquals(TransferSources.Link.DeezerProfile("2529"), TransferSources.parseLink("https://www.deezer.com/us/profile/2529"))
        assertEquals(TransferSources.Link.DeezerAlbum("302127"), TransferSources.parseLink("https://deezer.com/album/302127"))
        assertTrue(TransferSources.parseLink("https://link.deezer.com/s/30abcd") is TransferSources.Link.DeezerShort)
        assertTrue(TransferSources.parseLink("https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb") is TransferSources.Link.ApplePage)
        assertEquals(TransferSources.Link.YouTubePlaylist("PL123"), TransferSources.parseLink("https://music.youtube.com/playlist?list=PL123"))
        assertNull(TransferSources.parseLink("https://example.com/playlist/1"))
        assertNull(TransferSources.parseLink("not a link"))
    }

    @Test
    fun spotifyEmbedAlbum() {
        val json = """{"props":{"pageProps":{"state":{"data":{"entity":{"type":"album","name":"Emotion","subtitle":"Carly Rae Jepsen",
            "trackList":[{"title":"Run Away With Me","subtitle":"Carly Rae Jepsen","duration":251320},{"title":"Emotion","subtitle":"Carly Rae Jepsen","duration":197000}],
            "visualIdentity":{"image":[{"url":"https://i.scdn.co/a.jpg"},{"url":"https://i.scdn.co/b.jpg"}]}}}}}}}"""
        val c = TransferSources.parseSpotifyEmbed(Json.parseToJsonElement(json).jsonObject, "album", "id1")
        assertEquals(CollectionKind.ALBUM, c.kind)
        assertEquals("Emotion", c.name)
        assertEquals(2, c.tracks!!.size)
        assertEquals(251, c.tracks!![0].durationSec)
        assertEquals("Emotion", c.tracks!![0].album)
        assertEquals("https://i.scdn.co/b.jpg", c.imageUrl)
    }

    @Test
    fun appleMusicPlaylistPage() {
        val html = """<html><script type="application/json" id="serialized-server-data">{"data":[{"data":{"sections":[
            {"id":"playlist-detail-header-section - pl.x","itemKind":"containerDetailHeaderLockup","items":[{"title":"Today’s Hits","subtitleLinks":[{"title":"Apple Music Hits"}],
              "artwork":{"dictionary":{"url":"https://is1-ssl.mzstatic.com/x/{w}x{h}bb.{f}"}}}]},
            {"id":"track-list - pl.x","itemKind":"trackLockup","items":[
              {"title":"expectations","duration":223935,"subtitleLinks":[{"title":"Olivia Rodrigo"},{"title":"Chappell Roan"}],"tertiaryLinks":[{"title":"expectations - Single"}]},
              {"title":"Song Two","artistName":"Someone","duration":180000}]}]}}]}</script></html>"""
        val c = AppleMusicPage.parse(html, "https://music.apple.com/us/playlist/todays-hits/pl.x")
        assertEquals(TransferService.APPLE_MUSIC, c.service)
        assertEquals(CollectionKind.PLAYLIST, c.kind)
        assertEquals("Today’s Hits", c.name)
        assertEquals("Olivia Rodrigo, Chappell Roan", c.tracks!![0].artist)
        assertEquals("expectations", c.tracks!![0].album)
        assertEquals(223, c.tracks!![0].durationSec)
        assertEquals("Someone", c.tracks!![1].artist)
        assertEquals("https://is1-ssl.mzstatic.com/x/300x300bb.jpg", c.imageUrl)
    }

    @Test(expected = TransferException::class)
    fun appleMusicPageWithoutDataFails() {
        AppleMusicPage.parse("<html></html>", "https://music.apple.com/us/album/x/1")
    }

    // ---- loose match fallback ----

    @Test
    fun looseMatchNeedsTitleArtistAndCloseLength() {
        val track = SourceTrack("Starboy", "The Weeknd", durationSec = 230)
        val good = Song(videoId = "a", title = "Starboy (feat. Daft Punk)", artist = "The Weeknd", thumbnailUrl = null, durationText = "3:50")
        val wrongArtist = Song(videoId = "b", title = "Starboy", artist = "Cover Band", thumbnailUrl = null, durationText = "3:50")
        val wrongLength = Song(videoId = "c", title = "Starboy", artist = "The Weeknd", thumbnailUrl = null, durationText = "10:00")
        assertNull(TransferMatchRules.loose(listOf(wrongArtist, wrongLength), track))
        assertNotNull(TransferMatchRules.loose(listOf(wrongArtist, good), track))
        assertEquals("a", TransferMatchRules.loose(listOf(wrongLength, good), track)?.videoId)
    }
}
