package com.music.bitchord.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FileOpen
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.music.bitchord.sharedui.resources.Res
import com.music.bitchord.sharedui.resources.spotify_logo
import org.jetbrains.compose.resources.painterResource
import com.music.bitchord.R
import com.music.bitchord.data.canvas.SpotifyToken
import com.music.bitchord.data.model.Song
import com.music.bitchord.data.settings.AppSettings
import com.music.bitchord.data.transfer.CollectionKind
import com.music.bitchord.data.transfer.ItemStatus
import com.music.bitchord.data.transfer.JobState
import com.music.bitchord.data.transfer.SourceCollection
import com.music.bitchord.data.transfer.SourceTrack
import com.music.bitchord.data.transfer.TransferDestination
import com.music.bitchord.data.transfer.TransferEngine
import com.music.bitchord.data.transfer.TransferFileParser
import com.music.bitchord.data.transfer.TransferItem
import com.music.bitchord.data.transfer.TransferJob
import com.music.bitchord.data.transfer.TransferOptions
import com.music.bitchord.data.transfer.TransferSources
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TUNEMYMUSIC_URL = "https://www.tunemymusic.com/transfer"
private const val SONGSHIFT_URL = "https://www.songshift.com/"

/** The transfer's own pages, in the order a listener moves through them. */
private enum class TransferStage { HOME, SPOTIFY_LOGIN, LOADING, PICK }

/**
 * Settings → Music Transfer.
 *
 * Home picks the destination and a source; the picker lists what that source
 * holds (liked songs, playlists, albums, artists) with the duplicate options;
 * then the progress page takes over until the job is cleared — it is what the
 * screen shows whenever a job exists, so coming back mid-transfer lands on it.
 */
@Composable
fun MusicTransferScreen(
    signedIn: Boolean,
    onSignIn: () -> Unit,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { TransferEngine.init(context) }
    val job by TransferEngine.job.collectAsStateWithLifecycle()
    val spotifyCookie by AppSettings.spotifySpdcToken.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var stage by rememberSaveable { mutableStateOf(TransferStage.HOME) }
    var destination by rememberSaveable {
        mutableStateOf(if (signedIn) TransferDestination.YOUTUBE_MUSIC else TransferDestination.ON_DEVICE)
    }
    var collections by remember { mutableStateOf<List<SourceCollection>>(emptyList()) }
    val selected = remember { mutableStateListOf<String>() }
    var error by remember { mutableStateOf<String?>(null) }
    var showLinkDialog by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf(TransferOptions()) }

    fun load(block: suspend () -> List<SourceCollection>) {
        stage = TransferStage.LOADING
        error = null
        scope.launch {
            runCatching { block() }
                .onSuccess { found ->
                    collections = found
                    selected.clear()
                    // Liked songs and playlists are what people come for; albums
                    // and artists are offered but left for the listener to tick.
                    selected.addAll(found.filter { it.kind == CollectionKind.LIKED || it.kind == CollectionKind.PLAYLIST }.map { it.uid })
                    if (found.isEmpty()) {
                        error = context.getString(R.string.transfer_nothing_found)
                        stage = TransferStage.HOME
                    } else {
                        stage = TransferStage.PICK
                    }
                }
                .onFailure {
                    error = it.message ?: it.javaClass.simpleName
                    stage = TransferStage.HOME
                }
        }
    }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        load {
            withContext(Dispatchers.IO) {
                val name = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
                    ?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "Imported.csv"
                val text = context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
                require(text.length < 20_000_000) { "That file is too large." }
                TransferFileParser.parse(name, text)
            }
        }
    }

    BackHandler(enabled = job == null && stage != TransferStage.HOME && stage != TransferStage.LOADING) {
        stage = TransferStage.HOME
    }

    val current = job
    if (current != null) {
        TransferProgress(
            job = current,
            contentPadding = contentPadding,
            modifier = modifier,
            onNew = {
                TransferEngine.clear()
                stage = TransferStage.HOME
            },
        )
        return
    }

    when (stage) {
        TransferStage.SPOTIFY_LOGIN -> SpotifyLogin(
            modifier = modifier.padding(contentPadding),
            onConnected = { token ->
                AppSettings.setSpotifySpdcToken(token)
                load { TransferSources.spotifyLibrary() }
            },
        )
        TransferStage.LOADING -> Box(modifier.fillMaxSize().padding(contentPadding), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.transfer_loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        TransferStage.PICK -> TransferPicker(
            collections = collections,
            selected = selected,
            destination = destination,
            options = options,
            onOptions = { options = it },
            contentPadding = contentPadding,
            modifier = modifier,
            onBack = { stage = TransferStage.HOME },
            onStart = {
                val picked = collections.filter { it.uid in selected }
                TransferEngine.start(picked, destination, options)
                stage = TransferStage.HOME
            },
        )
        TransferStage.HOME -> TransferHome(
            signedIn = signedIn,
            destination = destination,
            onDestination = { destination = it },
            spotifyConnected = spotifyCookie.isNotBlank(),
            error = error,
            contentPadding = contentPadding,
            modifier = modifier,
            onSignIn = onSignIn,
            onSpotify = {
                if (spotifyCookie.isBlank()) stage = TransferStage.SPOTIFY_LOGIN
                else load { TransferSources.spotifyLibrary() }
            },
            onSpotifyDisconnect = {
                AppSettings.setSpotifySpdcToken("")
                runCatching { SpotifyToken.invalidate() }
            },
            onLink = { showLinkDialog = true },
            onFile = { filePicker.launch(arrayOf("text/*", "application/csv", "application/vnd.ms-excel", "audio/x-mpegurl", "audio/mpegurl", "application/octet-stream")) },
            onOpenUrl = { url -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
        )
    }

    if (showLinkDialog) {
        var link by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showLinkDialog = false },
            title = { Text(stringResource(R.string.transfer_link)) },
            text = {
                Column {
                    Text(
                        stringResource(R.string.transfer_link_subtitle),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = link,
                        onValueChange = { link = it },
                        placeholder = { Text(stringResource(R.string.transfer_link_hint)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = link.isNotBlank(),
                    onClick = {
                        showLinkDialog = false
                        val text = link
                        load { TransferSources.fromLink(text) }
                    },
                ) { Text(stringResource(R.string.transfer_link_open)) }
            },
            dismissButton = {
                TextButton(onClick = { showLinkDialog = false }) { Text(stringResource(R.string.transfer_cancel)) }
            },
        )
    }
}

// ---- Home -----------------------------------------------------------------------

@Composable
private fun TransferHome(
    signedIn: Boolean,
    destination: TransferDestination,
    onDestination: (TransferDestination) -> Unit,
    spotifyConnected: Boolean,
    error: String?,
    contentPadding: PaddingValues,
    modifier: Modifier,
    onSignIn: () -> Unit,
    onSpotify: () -> Unit,
    onSpotifyDisconnect: () -> Unit,
    onLink: () -> Unit,
    onFile: () -> Unit,
    onOpenUrl: (String) -> Unit,
) {
    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = contentPadding) {
        item {
            Column(Modifier.padding(horizontal = GROUP_INSET + 4.dp, vertical = 8.dp)) {
                Box(
                    Modifier.size(52.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Rounded.SwapHoriz, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                }
                Spacer(Modifier.height(10.dp))
                Text(stringResource(R.string.music_transfer_subtitle), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            SettingsGroup(
                header = stringResource(R.string.transfer_move_to),
                footer = stringResource(
                    if (destination == TransferDestination.YOUTUBE_MUSIC) R.string.transfer_dest_youtube_footer else R.string.transfer_dest_device_footer,
                ),
                topSpacing = 8.dp,
            ) {
                Spacer(Modifier.height(12.dp))
                SegmentedControl(
                    options = listOf(stringResource(R.string.transfer_dest_youtube), stringResource(R.string.transfer_dest_device)),
                    selectedIndex = if (destination == TransferDestination.YOUTUBE_MUSIC) 0 else 1,
                    onSelect = { onDestination(if (it == 0) TransferDestination.YOUTUBE_MUSIC else TransferDestination.ON_DEVICE) },
                    modifier = Modifier.padding(start = ROW_INSET, end = ROW_INSET, bottom = 12.dp),
                )
                if (destination == TransferDestination.YOUTUBE_MUSIC && !signedIn) {
                    RowDivider()
                    SettingsRow(
                        icon = Icons.Rounded.Person,
                        title = stringResource(R.string.transfer_sign_in_needed),
                        subtitle = stringResource(R.string.transfer_sign_in_needed_subtitle),
                        onClick = onSignIn,
                    )
                }
            }
        }
        if (error != null) {
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(start = GROUP_INSET + 4.dp, end = GROUP_INSET + 4.dp, top = 16.dp),
                ) {
                    Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        item {
            val blocked = destination == TransferDestination.YOUTUBE_MUSIC && !signedIn
            SettingsGroup(header = stringResource(R.string.transfer_from)) {
                SettingsRow(
                    iconPainter = painterResource(Res.drawable.spotify_logo),
                    title = "Spotify",
                    subtitle = stringResource(R.string.transfer_spotify_subtitle),
                    value = stringResource(if (spotifyConnected) R.string.transfer_spotify_connected else R.string.transfer_spotify_connect),
                    enabled = !blocked,
                    onClick = onSpotify,
                )
                RowDivider()
                SettingsRow(
                    icon = Icons.Rounded.Link,
                    title = stringResource(R.string.transfer_link),
                    subtitle = stringResource(R.string.transfer_link_subtitle),
                    enabled = !blocked,
                    onClick = onLink,
                )
                RowDivider()
                SettingsRow(
                    icon = Icons.Rounded.FileOpen,
                    title = stringResource(R.string.transfer_file),
                    subtitle = stringResource(R.string.transfer_file_subtitle),
                    enabled = !blocked,
                    onClick = onFile,
                )
                if (spotifyConnected) {
                    RowDivider()
                    SettingsRow(title = stringResource(R.string.transfer_spotify_disconnect), onClick = onSpotifyDisconnect)
                }
            }
        }
        item {
            SettingsGroup(header = stringResource(R.string.transfer_more_services), footer = stringResource(R.string.transfer_privacy_footer)) {
                SettingsRow(
                    icon = Icons.AutoMirrored.Rounded.OpenInNew,
                    title = "TuneMyMusic",
                    subtitle = stringResource(R.string.transfer_tunemymusic_subtitle),
                    onClick = { onOpenUrl(TUNEMYMUSIC_URL) },
                )
                RowDivider()
                SettingsRow(
                    icon = Icons.AutoMirrored.Rounded.OpenInNew,
                    title = "SongShift",
                    subtitle = stringResource(R.string.transfer_songshift_subtitle),
                    onClick = { onOpenUrl(SONGSHIFT_URL) },
                )
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

// ---- Picker ---------------------------------------------------------------------

@Composable
private fun TransferPicker(
    collections: List<SourceCollection>,
    selected: MutableList<String>,
    destination: TransferDestination,
    options: TransferOptions,
    onOptions: (TransferOptions) -> Unit,
    contentPadding: PaddingValues,
    modifier: Modifier,
    onBack: () -> Unit,
    onStart: () -> Unit,
) {
    val groups = listOf(
        CollectionKind.LIKED to R.string.transfer_kind_liked,
        CollectionKind.PLAYLIST to R.string.transfer_kind_playlists,
        CollectionKind.ALBUM to R.string.transfer_kind_albums,
        CollectionKind.ARTIST to R.string.transfer_kind_artists,
    ).mapNotNull { (kind, label) -> collections.filter { it.kind == kind }.takeIf { it.isNotEmpty() }?.let { Triple(kind, label, it) } }

    Box(modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(
            top = contentPadding.calculateTopPadding(),
            bottom = contentPadding.calculateBottomPadding() + 96.dp,
        )) {
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(start = GROUP_INSET + 4.dp, end = GROUP_INSET, top = 4.dp),
                ) {
                    Text(
                        stringResource(R.string.transfer_pick_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    val all = selected.size == collections.size
                    TextButton(onClick = {
                        selected.clear()
                        if (!all) selected.addAll(collections.map { it.uid })
                    }) { Text(stringResource(if (all) R.string.transfer_select_none else R.string.transfer_select_all)) }
                }
            }
            groups.forEach { (_, label, list) ->
                item(key = "h$label") {
                    SettingsGroup(header = stringResource(label), topSpacing = 8.dp) {
                        list.forEachIndexed { index, c ->
                            if (index > 0) RowDivider()
                            CollectionRow(
                                collection = c,
                                checked = c.uid in selected,
                                onToggle = { if (c.uid in selected) selected.remove(c.uid) else selected.add(c.uid) },
                            )
                        }
                    }
                }
            }
            item {
                SettingsGroup(header = stringResource(R.string.transfer_options)) {
                    OptionRow(
                        title = stringResource(R.string.transfer_opt_skip_existing),
                        subtitle = stringResource(R.string.transfer_opt_skip_existing_subtitle),
                        checked = options.skipExisting,
                        onChange = { onOptions(options.copy(skipExisting = it)) },
                    )
                    RowDivider()
                    OptionRow(
                        title = stringResource(R.string.transfer_opt_merge),
                        subtitle = stringResource(R.string.transfer_opt_merge_subtitle),
                        checked = options.mergeSameName,
                        onChange = { onOptions(options.copy(mergeSameName = it)) },
                    )
                    if (destination == TransferDestination.YOUTUBE_MUSIC) {
                        RowDivider()
                        OptionRow(
                            title = stringResource(R.string.transfer_opt_private),
                            subtitle = null,
                            checked = options.privatePlaylists,
                            onChange = { onOptions(options.copy(privatePlaylists = it)) },
                        )
                    }
                }
            }
        }
        Surface(
            color = MaterialTheme.colorScheme.background,
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .padding(start = GROUP_INSET, end = GROUP_INSET, top = 12.dp)
                    .padding(bottom = contentPadding.calculateBottomPadding() + 12.dp),
            ) {
                OutlinedButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.transfer_back)) }
                Button(
                    onClick = onStart,
                    enabled = selected.isNotEmpty(),
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.transfer_start, selected.size)) }
            }
        }
    }
}

@Composable
private fun CollectionRow(collection: SourceCollection, checked: Boolean, onToggle: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = ROW_INSET, vertical = 10.dp),
    ) {
        CollectionArt(collection, Modifier.size(44.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(collection.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val detail = listOfNotNull(
                collection.subtitle,
                (collection.tracks?.size ?: collection.count)?.takeIf { it > 0 }?.let { stringResource(R.string.transfer_songs_count, it) },
            ).joinToString(" · ")
            if (detail.isNotBlank()) {
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Checkbox(
            checked = checked,
            onCheckedChange = { onToggle() },
            colors = CheckboxDefaults.colors(checkedColor = MaterialTheme.colorScheme.primary),
        )
    }
}

@Composable
private fun CollectionArt(collection: SourceCollection, modifier: Modifier) {
    val shape = if (collection.kind == CollectionKind.ARTIST) CircleShape else RoundedCornerShape(8.dp)
    Box(
        modifier.clip(shape).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(kindIcon(collection.kind), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
        if (collection.imageUrl != null) {
            AsyncImage(
                model = collection.imageUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

private fun kindIcon(kind: CollectionKind): ImageVector = when (kind) {
    CollectionKind.LIKED -> Icons.Rounded.Favorite
    CollectionKind.PLAYLIST -> Icons.AutoMirrored.Rounded.QueueMusic
    CollectionKind.ALBUM -> Icons.Rounded.Album
    CollectionKind.ARTIST -> Icons.Rounded.Person
}

@Composable
private fun OptionRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    SettingsRow(
        title = title,
        subtitle = subtitle,
        trailing = {
            Switch(
                checked = checked,
                onCheckedChange = onChange,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = MaterialTheme.colorScheme.primary,
                    checkedBorderColor = MaterialTheme.colorScheme.primary,
                ),
            )
        },
        onClick = { onChange(!checked) },
    )
}

// ---- Progress -------------------------------------------------------------------

@Composable
private fun TransferProgress(job: TransferJob, contentPadding: PaddingValues, modifier: Modifier, onNew: () -> Unit) {
    var fixing by remember { mutableStateOf<Pair<TransferItem, SourceTrack>?>(null) }
    var expanded by rememberSaveable { mutableStateOf<String?>(null) }
    val running = job.state == JobState.RUNNING

    LazyColumn(modifier.fillMaxSize(), contentPadding = contentPadding) {
        item {
            Column(Modifier.padding(horizontal = GROUP_INSET + 4.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (job.state == JobState.DONE) Icons.Rounded.CheckCircle else Icons.Rounded.SwapHoriz,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(26.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        stringResource(
                            when (job.state) {
                                JobState.RUNNING -> R.string.transfer_state_running
                                JobState.PAUSED -> R.string.transfer_state_paused
                                JobState.DONE -> R.string.transfer_state_done
                                JobState.CANCELLED -> R.string.transfer_state_cancelled
                            },
                        ),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        stringResource(if (job.destination == TransferDestination.YOUTUBE_MUSIC) R.string.transfer_dest_youtube else R.string.transfer_dest_device),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(14.dp))
                LinearProgressIndicator(
                    progress = { job.fraction },
                    modifier = Modifier.fillMaxWidth().height(6.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
                    strokeCap = StrokeCap.Round,
                    gapSize = 0.dp,
                    drawStopIndicator = {},
                )
                Spacer(Modifier.height(10.dp))
                Text(stringResource(R.string.transfer_overall, job.processedTracks.coerceAtMost(job.totalTracks), job.totalTracks), style = MaterialTheme.typography.bodyLarge)
                Text(
                    stringResource(R.string.transfer_counts, job.added, job.duplicates, job.notFound),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                job.message?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    when (job.state) {
                        JobState.RUNNING -> {
                            FilledTonalButton(onClick = TransferEngine::pause) { Text(stringResource(R.string.transfer_pause)) }
                            OutlinedButton(onClick = TransferEngine::cancel) { Text(stringResource(R.string.transfer_cancel)) }
                        }
                        JobState.PAUSED -> {
                            Button(onClick = TransferEngine::resume) { Text(stringResource(R.string.transfer_resume)) }
                            OutlinedButton(onClick = TransferEngine::cancel) { Text(stringResource(R.string.transfer_cancel)) }
                        }
                        JobState.DONE, JobState.CANCELLED -> {
                            if (job.notFound > 0 || job.failedItems > 0) {
                                FilledTonalButton(onClick = TransferEngine::retryProblems) { Text(stringResource(R.string.transfer_retry_problems)) }
                            }
                            Button(onClick = onNew) { Text(stringResource(R.string.transfer_new)) }
                        }
                    }
                }
                if (running) {
                    Spacer(Modifier.height(10.dp))
                    Text(stringResource(R.string.transfer_keep_open), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            SettingsGroup(topSpacing = 12.dp) {
                job.items.forEachIndexed { index, item ->
                    if (index > 0) RowDivider()
                    ProgressRow(
                        item = item,
                        expanded = expanded == item.collection.uid,
                        onToggle = { expanded = if (expanded == item.collection.uid) null else item.collection.uid },
                        onFind = { track -> fixing = item to track },
                        canFix = !running,
                    )
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }

    fixing?.let { (item, track) ->
        ManualMatchDialog(item = item, track = track, onDismiss = { fixing = null })
    }
}

@Composable
private fun ProgressRow(
    item: TransferItem,
    expanded: Boolean,
    onToggle: () -> Unit,
    onFind: (SourceTrack) -> Unit,
    canFix: Boolean,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = item.notFound.isNotEmpty(), onClick = onToggle)
                .padding(horizontal = ROW_INSET, vertical = 10.dp),
        ) {
            CollectionArt(item.collection, Modifier.size(40.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.collection.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val status = when (item.status) {
                    ItemStatus.QUEUED -> stringResource(R.string.transfer_item_queued)
                    ItemStatus.READING -> stringResource(R.string.transfer_item_reading)
                    ItemStatus.MATCHING -> stringResource(R.string.transfer_item_matching, item.processed, item.total)
                    ItemStatus.WRITING -> stringResource(R.string.transfer_item_writing)
                    ItemStatus.DONE -> stringResource(R.string.transfer_item_done, item.added, item.duplicates)
                    ItemStatus.PARTIAL -> stringResource(R.string.transfer_item_partial, item.added, item.notFound.size)
                    ItemStatus.FAILED, ItemStatus.SKIPPED -> item.error.orEmpty()
                }
                Text(
                    status,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (item.status == ItemStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!item.finished && item.status != ItemStatus.QUEUED) {
                    Spacer(Modifier.height(6.dp))
                    LinearProgressIndicator(
                        progress = { item.fraction },
                        modifier = Modifier.fillMaxWidth().height(3.dp),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
                        strokeCap = StrokeCap.Round,
                        gapSize = 0.dp,
                        drawStopIndicator = {},
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                when (item.status) {
                    ItemStatus.DONE -> Icons.Rounded.CheckCircle
                    ItemStatus.FAILED, ItemStatus.PARTIAL -> Icons.Rounded.ErrorOutline
                    ItemStatus.SKIPPED -> Icons.Rounded.PhoneAndroid
                    else -> Icons.Rounded.Schedule
                },
                contentDescription = null,
                tint = when (item.status) {
                    ItemStatus.DONE -> MaterialTheme.colorScheme.primary
                    ItemStatus.FAILED -> MaterialTheme.colorScheme.error
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(20.dp),
            )
        }
        if (expanded && item.notFound.isNotEmpty()) {
            Text(
                stringResource(R.string.transfer_not_found, item.notFound.size),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = TEXT_INSET, bottom = 4.dp),
            )
            item.notFound.take(200).forEach { track ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(start = TEXT_INSET, end = ROW_INSET),
                ) {
                    Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                        Text(track.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (track.artist.isNotBlank()) {
                            Text(track.artist, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    if (item.collection.kind == CollectionKind.LIKED || item.collection.kind == CollectionKind.PLAYLIST) {
                        TextButton(enabled = canFix, onClick = { onFind(track) }) { Text(stringResource(R.string.transfer_find)) }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ManualMatchDialog(item: TransferItem, track: SourceTrack, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var candidates by remember(track) { mutableStateOf<List<Song>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(track) { candidates = runCatching { TransferEngine.candidates(track) }.getOrDefault(emptyList()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.transfer_pick_match)) },
        text = {
            Column {
                Text("${track.title} · ${track.artist}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(10.dp))
                val list = candidates
                when {
                    list == null || busy -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    list.isEmpty() -> Text(stringResource(R.string.transfer_no_candidates))
                    else -> LazyColumn(Modifier.heightIn(max = 360.dp)) {
                        items(list, key = { it.videoId }) { song ->
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        busy = true
                                        scope.launch {
                                            TransferEngine.resolveManually(item.collection.uid, track, song)
                                                .onSuccess { onDismiss() }
                                                .onFailure { failure = it.message; busy = false }
                                        }
                                    }
                                    .padding(vertical = 6.dp),
                            ) {
                                AsyncImage(
                                    model = song.thumbnailUrl,
                                    contentDescription = null,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.size(42.dp).clip(RoundedCornerShape(6.dp)),
                                )
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(song.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        listOfNotNull(song.artist, song.durationText).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                    }
                }
                failure?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.transfer_close)) } },
    )
}
