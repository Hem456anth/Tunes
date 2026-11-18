package com.music.bitchord.ui.icons

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBackIos
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.Label
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.automirrored.rounded.Notes
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.automirrored.rounded.PlaylistPlay
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.automirrored.rounded.ShowChart
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.AccountCircle
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Animation
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material.icons.rounded.BlurOff
import androidx.compose.material.icons.rounded.BlurOn
import androidx.compose.material.icons.rounded.BugReport
import androidx.compose.material.icons.rounded.Cached
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.DragHandle
import androidx.compose.material.icons.rounded.Draw
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.rounded.FileDownloadOff
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material.icons.rounded.FilterAlt
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.Gradient
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.LocalOffer
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.MotionPhotosOff
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.MusicOff
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.PlaylistRemove
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.QueuePlayNext
import androidx.compose.material.icons.rounded.Radio
import androidx.compose.material.icons.rounded.RadioButtonChecked
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SignalCellularAlt
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.SurroundSound
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material.icons.rounded.SwapVert
import androidx.compose.material.icons.rounded.SwitchAccount
import androidx.compose.material.icons.rounded.TextFields
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material.icons.rounded.Translate
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Upload
import androidx.compose.material.icons.rounded.Usb
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.Watch
import androidx.compose.material.icons.rounded.Waves
import androidx.compose.material.icons.rounded.WebAssetOff
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.VectorGroup
import androidx.compose.ui.graphics.vector.VectorPath
import androidx.compose.ui.unit.dp

/**
 * The icons the settings pages and the menus draw, named for what they stand
 * for here rather than for the glyph, so a call site reads `SfIcons.Download`
 * and the choice of glyph lives in one place.
 *
 * Tunes: upstream BitChord draws these from Apple's SF Symbols (through the
 * Jetpack_SF_Symbols port). Apple licenses SF Symbols only for apps on its own
 * platforms, and every Tunes dependency has to be GPL-3.0 compatible, so here
 * each name maps to a Material Symbols Rounded icon (Apache-2.0) instead. The
 * object keeps upstream's name and members so later upstream merges stay small.
 */
object SfIcons {
    // ---- Settings ----
    val AccountPlaceholder: ImageVector get() = Icons.Rounded.AccountCircle
    val Add: ImageVector get() = Icons.Rounded.Add
    val Animation: ImageVector get() = Icons.Rounded.Animation
    val Appearance: ImageVector get() = Icons.Rounded.Palette
    val Apps: ImageVector get() = Icons.Rounded.Apps
    val ArrowBack: ImageVector get() = Icons.AutoMirrored.Rounded.ArrowBackIos
    val AutoAwesome: ImageVector get() = Icons.Rounded.AutoAwesome
    val BarChart: ImageVector get() = Icons.Rounded.BarChart
    val Bluetooth: ImageVector get() = Icons.Rounded.Headphones
    val BlurOff: ImageVector get() = Icons.Rounded.BlurOff
    val BlurOn: ImageVector get() = Icons.Rounded.BlurOn
    val Brightness: ImageVector get() = Icons.Rounded.LightMode
    val Cached: ImageVector get() = Icons.Rounded.Cached
    val Check: ImageVector get() = Icons.Rounded.Check
    val ChevronRight: ImageVector get() = Icons.AutoMirrored.Rounded.KeyboardArrowRight
    val Clock: ImageVector get() = Icons.Rounded.Schedule
    val Cloud: ImageVector get() = Icons.Rounded.Cloud
    val CloudDone: ImageVector get() = Icons.Rounded.CloudDone
    val CloudOff: ImageVector get() = Icons.Rounded.CloudOff
    val ContentCopy: ImageVector get() = Icons.Rounded.ContentCopy
    val DeleteSweep: ImageVector get() = Icons.Rounded.DeleteSweep
    val Dns: ImageVector get() = Icons.Rounded.Dns
    val Download: ImageVector get() = Icons.Rounded.Download
    val DragHandle: ImageVector get() = Icons.Rounded.DragHandle
    val Draw: ImageVector get() = Icons.Rounded.Draw
    val ErrorOutline: ImageVector get() = Icons.Rounded.ErrorOutline
    val Extension: ImageVector get() = Icons.Rounded.Extension
    val FileDownload: ImageVector get() = Icons.Rounded.FileDownload
    val FileDownloadOff: ImageVector get() = Icons.Rounded.FileDownloadOff
    val FileUpload: ImageVector get() = Icons.Rounded.FileUpload
    val FilterAlt: ImageVector get() = Icons.Rounded.FilterAlt
    val Folder: ImageVector get() = Icons.Rounded.Folder
    val Font: ImageVector get() = Icons.Rounded.TextFields
    val FrameRate: ImageVector get() = Icons.Rounded.Timer
    val Fullscreen: ImageVector get() = Icons.Rounded.Fullscreen
    val Gradient: ImageVector get() = Icons.Rounded.Gradient
    val GraphicEq: ImageVector get() = Icons.Rounded.GraphicEq
    val Groups: ImageVector get() = Icons.Rounded.Groups
    val History: ImageVector get() = Icons.Rounded.History
    val Key: ImageVector get() = Icons.Rounded.Key
    val Label: ImageVector get() = Icons.AutoMirrored.Rounded.Label
    val Language: ImageVector get() = Icons.Rounded.Language
    val LibraryMusic: ImageVector get() = Icons.Rounded.LibraryMusic
    val LocalOffer: ImageVector get() = Icons.Rounded.LocalOffer
    val Lock: ImageVector get() = Icons.Rounded.Lock
    val Login: ImageVector get() = Icons.AutoMirrored.Rounded.Login
    val Logout: ImageVector get() = Icons.AutoMirrored.Rounded.Logout
    val Miscellaneous: ImageVector get() = Icons.Rounded.MoreHoriz
    val MotionPhotosOff: ImageVector get() = Icons.Rounded.MotionPhotosOff
    val MusicNote: ImageVector get() = Icons.Rounded.MusicNote
    val MusicOff: ImageVector get() = Icons.Rounded.MusicOff
    val Notes: ImageVector get() = Icons.AutoMirrored.Rounded.Notes
    val Performance: ImageVector get() = Icons.Rounded.Speed
    val Person: ImageVector get() = Icons.Rounded.Person
    val PlayCircle: ImageVector get() = Icons.Rounded.PlayCircle
    val PlaylistPlay: ImageVector get() = Icons.AutoMirrored.Rounded.PlaylistPlay
    val RadioButtonChecked: ImageVector get() = Icons.Rounded.RadioButtonChecked
    val Settings: ImageVector get() = Icons.Rounded.Settings
    val Share: ImageVector get() = Icons.Rounded.Share
    val ShowChart: ImageVector get() = Icons.AutoMirrored.Rounded.ShowChart
    val SignalCellularAlt: ImageVector get() = Icons.Rounded.SignalCellularAlt
    val SmartButton: ImageVector get() = Icons.Rounded.TouchApp
    val Storage: ImageVector get() = Icons.Rounded.Storage
    val SurroundSound: ImageVector get() = Icons.Rounded.SurroundSound
    val SwapHoriz: ImageVector get() = Icons.Rounded.SwapHoriz
    val SwitchAccount: ImageVector get() = Icons.Rounded.SwitchAccount
    val Translate: ImageVector get() = Icons.Rounded.Translate
    val Tune: ImageVector get() = Icons.Rounded.Tune
    val Usb: ImageVector get() = Icons.Rounded.Usb
    val VisibilityOff: ImageVector get() = Icons.Rounded.VisibilityOff
    val VolumeOff: ImageVector get() = Icons.AutoMirrored.Rounded.VolumeOff
    val VolumeUp: ImageVector get() = Icons.AutoMirrored.Rounded.VolumeUp
    val Warning: ImageVector get() = Icons.Rounded.Warning
    val Watch: ImageVector get() = Icons.Rounded.Watch
    val Waves: ImageVector get() = Icons.Rounded.Waves
    val WebAssetOff: ImageVector get() = Icons.Rounded.WebAssetOff
    val Wifi: ImageVector get() = Icons.Rounded.Wifi
    val YourData: ImageVector get() = Icons.Rounded.Inventory2

    // ---- Menus ----
    val AddToPlaylist: ImageVector get() = Icons.AutoMirrored.Rounded.PlaylistAdd
    val Album: ImageVector get() = Icons.Rounded.Album
    val Artist: ImageVector get() = Icons.Rounded.Mic
    val Bug: ImageVector get() = Icons.Rounded.BugReport
    val Close: ImageVector get() = Icons.Rounded.Close
    val Downloaded: ImageVector get() = Icons.Rounded.CheckCircle
    val Heart: ImageVector get() = Icons.Rounded.FavoriteBorder
    val HeartFill: ImageVector get() = Icons.Rounded.Favorite
    val Info: ImageVector get() = Icons.Rounded.Info
    val Open: ImageVector get() = Icons.AutoMirrored.Rounded.KeyboardArrowRight
    val Pencil: ImageVector get() = Icons.Rounded.Edit
    val Pin: ImageVector get() = Icons.Rounded.PushPin
    val Play: ImageVector get() = Icons.Rounded.PlayArrow
    val PlayLast: ImageVector get() = Icons.AutoMirrored.Rounded.QueueMusic
    val PlayNext: ImageVector get() = Icons.Rounded.QueuePlayNext
    val Radio: ImageVector get() = Icons.Rounded.Radio
    val RemoveFromPlaylist: ImageVector get() = Icons.Rounded.PlaylistRemove
    val Reorder: ImageVector get() = Icons.Rounded.SwapVert
    val Revert: ImageVector get() = Icons.AutoMirrored.Rounded.Undo
    val Shuffle: ImageVector get() = Icons.Rounded.Shuffle
    val SleepTimer: ImageVector get() = Icons.Rounded.Bedtime
    val Sliders: ImageVector get() = Icons.Rounded.Tune
    val Star: ImageVector get() = Icons.Rounded.StarBorder
    val StarFill: ImageVector get() = Icons.Rounded.Star
    val Trash: ImageVector get() = Icons.Rounded.Delete
    val Upgrade: ImageVector get() = Icons.Rounded.AutoAwesome
    val Upload: ImageVector get() = Icons.Rounded.Upload
    val Video: ImageVector get() = Icons.Rounded.Videocam

    /** Line added by [copyInto]: Material icons are filled shapes, so a hair only. */
    internal const val BOLD_STROKE = 0.4f

    /** The square every glyph is centred on, in its own units (Material's 24). */
    internal const val CANVAS = 24f

    /** A [width]×[height] drawing, in glyph units, centred on the shared canvas. */
    internal inline fun canvas(
        name: String,
        width: Float,
        height: Float,
        autoMirror: Boolean = false,
        content: ImageVector.Builder.() -> Unit,
    ): ImageVector {
        val fit = minOf(1f, CANVAS / width, CANVAS / height)
        return ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = CANVAS,
            viewportHeight = CANVAS,
            autoMirror = autoMirror,
        ).apply {
            addGroup(
                translationX = (CANVAS - width * fit) / 2f,
                translationY = (CANVAS - height * fit) / 2f,
                scaleX = fit,
                scaleY = fit,
            )
            content()
            clearGroup()
        }.build()
    }

    /**
     * Adds every node of [group] to [builder], each fully opaque and traced with
     * [extraStroke] more line in its own colour.
     */
    internal fun copyInto(builder: ImageVector.Builder, group: VectorGroup, extraStroke: Float = BOLD_STROKE) {
        for (node in group) {
            when (node) {
                is VectorGroup -> {
                    builder.addGroup(
                        name = node.name,
                        rotate = node.rotation,
                        pivotX = node.pivotX,
                        pivotY = node.pivotY,
                        scaleX = node.scaleX,
                        scaleY = node.scaleY,
                        translationX = node.translationX,
                        translationY = node.translationY,
                        clipPathData = node.clipPathData,
                    )
                    copyInto(builder, node, extraStroke)
                    builder.clearGroup()
                }
                is VectorPath -> builder.addPath(
                    pathData = node.pathData,
                    pathFillType = node.pathFillType,
                    name = node.name,
                    fill = node.fill,
                    fillAlpha = 1f,
                    stroke = node.stroke ?: node.fill,
                    strokeAlpha = 1f,
                    strokeLineWidth = node.strokeLineWidth + extraStroke,
                    strokeLineCap = node.strokeLineCap,
                    strokeLineJoin = StrokeJoin.Round,
                    strokeLineMiter = node.strokeLineMiter,
                )
            }
        }
    }
}
