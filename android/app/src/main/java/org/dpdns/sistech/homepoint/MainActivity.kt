package org.dpdns.sistech.homepoint

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JsResult
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.annotation.StringRes
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * HOME POINT NAVI 앱: 사이트를 WebView 하나로 띄운다. 사이트 코드는 그대로 두고, 브라우저가 해 주던 일 중
 * WebView가 못 하는 것만 여기서 채운다.
 *  - CSV 가져오기: <input type=file>을 누르면 파일 고르기 화면을 띄운다(여러 개 가능).
 *  - CSV 내보내기: assets/bridge.js가 넘긴 파일을 다운로드 폴더에 저장하고 [공유]를 제안한다.
 *  - 확인 창(confirm/alert): 기기 기본 모양의 대화상자로 띄운다.
 *  - 다른 주소(카카오맵 웹, kakaomap:// 앱 길찾기, 새 창 링크): 사이트 밖이면 바깥 앱·브라우저로 연다.
 *  - [뒤로]: assets/back.js로 열린 창·메뉴·상세 정보를 하나씩 닫고, 닫을 것이 없으면 앱을 내린다.
 *  - 처음 불러오기 실패: 기본 오류 화면 대신 [다시 시도] 화면.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var errorView: View
    private lateinit var retryButton: Button
    private lateinit var appUri: Uri
    private lateinit var backScript: String

    private var mainFrameFailed = false
    private var webViewGone = false
    private var bridgeReady = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: PendingFile? = null
    private val io = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val popups = mutableSetOf<WebView>()

    private class PendingFile(val name: String, val mime: String, val bytes: ByteArray)

    // 파일 고르기 결과를 페이지의 <input type=file>로 돌려준다. 취소해도 반드시 한 번 불러야 다음에 다시 열린다.
    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val data = result.data
        val uris = if (result.resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) List(clip.itemCount) { clip.getItemAt(it).uri } else listOfNotNull(data.data)
        } else {
            emptyList()
        }
        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    // Android 9 이하: 저장할 자리를 사용자가 고른 뒤 쓴다(다운로드 폴더에 바로 쓰려면 저장소 권한이 필요해서).
    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data?.takeIf { result.resultCode == RESULT_OK }
        val file = pendingSave
        pendingSave = null
        if (uri == null) return@registerForActivityResult
        if (file == null) {
            // 고르는 사이 앱이 정리됐다 돌아오면(프로세스 종료·화면 다시 만들기) 쓸 내용이 없다. 빈 파일만 남지 않게 지운다.
            background { runCatching { DocumentsContract.deleteDocument(contentResolver, uri) } }
            return@registerForActivityResult
        }
        background {
            val ok = runCatching {
                contentResolver.openOutputStream(uri)?.use { it.write(file.bytes) } ?: throw IOException("no stream")
            }.isSuccess
            // 저장할 폴더는 사용자가 골랐으므로 "다운로드 폴더에"라고 쓰지 않는다.
            onUi {
                if (ok) showSaved(R.string.saved_message_picked, displayName(uri) ?: file.name, uri, file.mime)
                else toast(R.string.save_failed)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 사이트는 늘 밝은 화면이라 상태 표시줄·내비게이션 바 아이콘을 어둡게 둔다.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        setContentView(R.layout.activity_main)

        appUri = Uri.parse(resolveStartUrl())
        backScript = assets.open("back.js").bufferedReader().use { it.readText() }
        webView = findViewById(R.id.web)
        errorView = findViewById(R.id.error)
        retryButton = findViewById(R.id.retry)
        retryButton.setOnClickListener { retry() }

        // 상태 표시줄·내비게이션 바·화면 구멍·키보드에 가리지 않게 화면 전체에 안쪽 여백을 준다.
        // (WebView가 막대와 겹치지 않으므로 사이트의 env(safe-area-inset-*)는 0이 되어 여백이 겹치지 않는다.)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        setUpWebView()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })
        webView.loadUrl(appUri.toString())
    }

    // 점검용(debug) 빌드만 실행할 때 넘긴 주소(-e url ...)로 열 수 있다. 배포용은 늘 사이트 주소.
    // 점검용이라도 이 맥의 로컬 서버(에뮬레이터에서 localhost·127.0.0.1·10.0.2.2)나 사이트 주소만 받는다.
    // 다른 앱이 아무 주소나 넘겨 그 페이지에 다리(HomePointApp)를 심게 하지 않으려는 것이다.
    private fun resolveStartUrl(): String {
        if (BuildConfig.DEBUG) {
            val url = intent.getStringExtra("url")?.let(Uri::parse)
            val scheme = url?.scheme?.lowercase()
            val host = url?.host?.lowercase()
            val allowedHosts = setOf("localhost", "127.0.0.1", "10.0.2.2", Uri.parse(BuildConfig.START_URL).host)
            if (url != null && (scheme == "http" || scheme == "https") && host in allowedHosts) return url.toString()
        }
        return BuildConfig.START_URL
    }

    private val appOrigin get() = "${appUri.scheme}://${appUri.authority}"

    private fun isAppUrl(uri: Uri): Boolean =
        uri.scheme.equals(appUri.scheme, ignoreCase = true) && uri.authority.equals(appUri.authority, ignoreCase = true)

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.setBackgroundColor(getColor(R.color.page_bg))
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // 로그인 유지(supabase 세션)·화면 설정이 localStorage에 있다.
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true) // 새 창(target=_blank, window.open)은 onCreateWindow에서 바깥으로 연다.
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString HomePointNavi/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        webView.webViewClient = AppWebViewClient()
        webView.webChromeClient = AppChromeClient()
        webView.setDownloadListener { url, _, _, _, _ ->
            val uri = Uri.parse(url)
            when (uri.scheme?.lowercase()) {
                "http", "https" -> openExternal(uri)
                // blob:/data:는 bridge.js가 가로챈다. 여기까지 왔다면 WebView가 너무 오래되어 다리를 못 놓은 경우.
                "blob", "data" -> if (!bridgeReady) toast(R.string.save_unsupported)
            }
        }
        installBridge()
    }

    // 이 사이트 주소에서만 window.HomePointApp(메시지 통로)과 bridge.js를 심는다. 다른 주소의 페이지는 앱에 아무것도 보낼 수 없다.
    private fun installBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) {
            return
        }
        val origins = setOf(appOrigin)
        // 받는 쪽(화면 스레드)에서는 어느 틀에서 왔는지만 보고, 큰 JSON 읽기·base64 풀기는 뒤에서 한다(화면이 멈추지 않게).
        WebViewCompat.addWebMessageListener(webView, "HomePointApp", origins) { _, message, _, isMainFrame, _ ->
            val raw = message.data
            if (isMainFrame && raw != null) background { onBridgeMessage(raw) }
        }
        val script = assets.open("bridge.js").bufferedReader().use { it.readText() }
        WebViewCompat.addDocumentStartJavaScript(webView, script, origins)
        bridgeReady = true
    }

    // 뒤(io 스레드)에서 부른다. 화면을 건드리는 일은 onUi로 넘긴다.
    private fun onBridgeMessage(data: String) {
        val msg = runCatching { JSONObject(data) }.getOrNull() ?: return
        when (msg.optString("type")) {
            "download" -> {
                val name = safeFileName(msg.optString("name"))
                val mime = msg.optString("mime").substringBefore(';').trim().ifEmpty { "application/octet-stream" }
                val bytes = runCatching { Base64.decode(msg.optString("data"), Base64.DEFAULT) }.getOrNull()
                when {
                    bytes == null -> onUi { toast(R.string.save_failed) }
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> {
                        val uri = runCatching { saveToDownloads(name, mime, bytes) }.getOrNull()
                        onUi {
                            if (uri != null) showSaved(R.string.saved_message, displayName(uri) ?: name, uri, mime)
                            else toast(R.string.save_failed)
                        }
                    }
                    else -> onUi { askWhereToSave(PendingFile(name, mime, bytes)) }
                }
            }
            "download-failed" -> onUi { toast(R.string.save_failed) }
        }
    }

    // 뒤에서 할 일을 맡긴다. 화면이 이미 닫혀 일꾼을 멈췄으면(onDestroy) 그냥 버린다.
    private fun background(task: () -> Unit) {
        if (io.isShutdown) return
        try {
            io.execute(task)
        } catch (e: RejectedExecutionException) {
            // shutdown과 엇갈린 경우. 화면이 없으니 할 일도 없다.
        }
    }

    // 뒤에서 끝난 일을 화면에 알린다. 그사이 화면이 닫혔으면 아무것도 띄우지 않는다.
    private fun onUi(block: () -> Unit) = runOnUiThread { if (!isDestroyed) block() }

    // Android 10+: 권한 없이 다운로드 폴더에 쓴다. 같은 이름이 있으면 시스템이 "이름 (1).csv"처럼 바꿔 준다.
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveToDownloads(name: String, mime: String, bytes: ByteArray): Uri {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("insert failed")
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("no stream")
            contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            return uri
        } catch (e: Exception) {
            contentResolver.delete(uri, null, null)
            throw e
        }
    }

    private fun askWhereToSave(file: PendingFile) {
        if (isFinishing || isDestroyed) return
        // 저장할 곳 고르기가 이미 떠 있으면 새 요청은 버린다. 두 번째를 띄우면 앞의 결과가 뒤 파일 내용으로 저장된다.
        // 사용자는 지금 창을 마친 뒤 다시 내보내면 된다.
        if (pendingSave != null) return
        pendingSave = file
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(file.mime)
            .putExtra(Intent.EXTRA_TITLE, file.name)
        try {
            createDocument.launch(intent)
        } catch (e: RuntimeException) {
            // 고를 앱이 없거나(ActivityNotFound), 화면이 닫히는 중이라 띄울 수 없는 경우(IllegalState) 등.
            pendingSave = null
            toast(R.string.save_failed)
        }
    }

    private fun displayName(uri: Uri): String? = runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    private fun showSaved(@StringRes message: Int, name: String, uri: Uri, mime: String) {
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this, DIALOG_THEME)
            .setMessage(getString(message, name))
            .setPositiveButton(R.string.ok, null)
            .setNeutralButton(R.string.share) { _, _ -> share(uri, mime) }
            .show()
    }

    private fun share(uri: Uri, mime: String) {
        val send = Intent(Intent.ACTION_SEND)
            .setType(mime)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            startActivity(Intent.createChooser(send, getString(R.string.share)))
        } catch (e: RuntimeException) {
            // 받을 앱이 없거나(ActivityNotFound) 권한 문제(Security) 등. 앱이 꺼지지 않게 알리기만 한다.
            toast(R.string.no_app)
        }
    }

    // 사이트 밖 주소를 바깥 앱으로 연다. 열었으면 true.
    private fun openExternal(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        val intent = when (scheme) {
            "javascript", "file", "content", "data", "blob", "about" -> return false
            "intent" -> runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) }.getOrNull()?.apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                component = null
                selector = null
            } ?: return false
            else -> Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        }
        // intent: 주소가 기기 안 파일(file:, content:)을 열게 하는 것은 거절한다(크롬도 같다). 앱의 파일을 남에게 넘기는 통로가 된다.
        val target = intent.data?.scheme?.lowercase()
        if (scheme == "intent" && (target == "file" || target == "content")) return false
        return try {
            startActivity(intent)
            true
        } catch (e: RuntimeException) {
            // 열 앱이 없을 때(ActivityNotFound)만이 아니라 file: 주소(FileUriExposed), 권한이 걸린 화면(Security)도
            // 여기서 받아 앱이 꺼지지 않게 한다.
            val fallback = if (scheme == "intent") intent.getStringExtra("browser_fallback_url")?.let(Uri::parse) else null
            when {
                fallback != null && (fallback.scheme == "https" || fallback.scheme == "http") -> openExternal(fallback)
                // kakaomap:// 처럼 앱이 없으면 사이트가 스스로 웹 길찾기로 넘어가므로 따로 알리지 않는다.
                scheme == "http" || scheme == "https" -> false.also { toast(R.string.no_app) }
                else -> false
            }
        }
    }

    private fun goBack() {
        if (webViewGone) return
        if (errorView.visibility == View.VISIBLE) {
            moveTaskToBack(true)
            return
        }
        // 사이트는 한 페이지짜리라 WebView 방문 기록(제목 링크 "./" 등)으로 되돌아가면 같은 화면을 다시 불러올 뿐이다.
        // 그래서 기록은 쓰지 않고, 닫을 것이 없으면 안드로이드 12+ 기본 동작처럼 앱을 끝내지 않고 뒤로 내린다(쓰던 내용·로그인 유지).
        webView.evaluateJavascript(backScript) { closed ->
            if (closed != "true") moveTaskToBack(true)
        }
    }

    private fun retry() {
        retryButton.isEnabled = false
        val current = webView.url?.let(Uri::parse)
        if (current != null && isAppUrl(current)) webView.reload() else webView.loadUrl(appUri.toString())
    }

    private fun jsDialog(message: String?, result: JsResult, withCancel: Boolean) {
        if (isFinishing || isDestroyed) {
            result.cancel()
            return
        }
        val builder = AlertDialog.Builder(this, DIALOG_THEME)
            .setMessage(message.orEmpty())
            .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
            .setOnCancelListener { result.cancel() }
        if (withCancel) builder.setNegativeButton(R.string.cancel) { _, _ -> result.cancel() }
        builder.show()
    }

    private fun toast(@StringRes text: Int) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()

    private inner class AppWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (isAppUrl(uri)) return false
            val scheme = uri.scheme?.lowercase()
            if (!request.isForMainFrame) {
                // 페이지 안의 틀(iframe)이 웹 주소를 여는 것은 그대로 둔다.
                if (scheme == "http" || scheme == "https") return false
                // 틀이 사용자 누름 없이 앱 주소(intent:, kakaomap: 등)를 열려 하면 막는다(광고 틀이 앱을 마구 여는 것 방지).
                if (request.hasGesture()) openExternal(uri)
                return true
            }
            // 다리를 못 놓은 오래된 WebView에서 [내보내기](blob:/data: 링크)를 누른 경우. 조용히 없어지지 않게 알린다.
            if ((scheme == "blob" || scheme == "data") && !bridgeReady) {
                toast(R.string.save_unsupported)
                return true
            }
            // 페이지 전체가 넘어가는 것은 누름이 없어도 바깥으로 연다: 카카오맵 앱이 없을 때 사이트가 타이머로 웹 길찾기 주소로 넘어간다.
            openExternal(uri)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            mainFrameFailed = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            errorView.visibility = if (mainFrameFailed) View.VISIBLE else View.GONE
            retryButton.isEnabled = true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                mainFrameFailed = true
                errorView.visibility = View.VISIBLE
            }
        }

        // 화면 엔진(렌더러)이 죽으면 앱까지 꺼지지 않게 WebView를 버리고 화면을 다시 만든다.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            webViewGone = true
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            recreate()
            return true
        }
    }

    private inner class AppChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            // 파일 앱마다 CSV 형식 이름이 달라(text/csv, text/comma-separated-values, application/octet-stream…) 거르지 않는다.
            // 내용 검사는 사이트가 한다. GET_CONTENT는 안드로이드 14+에서 사진 고르기 화면으로 먼저 갈 수 있어 문서 고르기(OPEN_DOCUMENT)를 쓴다.
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
            if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            return try {
                pickFiles.launch(intent)
                true
            } catch (e: RuntimeException) {
                // 고를 앱이 없거나(ActivityNotFound) 화면이 닫히는 중(IllegalState). 콜백은 WebView가 정리하도록 false를 돌려준다.
                fileCallback = null
                toast(R.string.no_file_app)
                false
            }
        }

        // 새 창은 앱 안에 띄우지 않는다: 잠깐 만든 WebView로 열려던 주소만 알아내 바깥(또는 같은 사이트면 지금 화면)으로 연다.
        // 사용자가 누르지 않았는데 열리는 창(팝업 광고 등)은 아예 만들지 않는다.
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) return false
            val popup = WebView(this@MainActivity)
            popups += popup
            popup.webViewClient = object : WebViewClient() {
                private var taken = false

                private fun take(target: WebView, url: String) {
                    val uri = Uri.parse(url)
                    if (taken || uri.scheme.equals("about", ignoreCase = true)) return
                    taken = true
                    target.stopLoading()
                    if (isAppUrl(uri)) webView.loadUrl(url) else openExternal(uri)
                    // 이 콜백 안에서 바로 없애면 WebView가 꼬이므로 한 박자 뒤에 없앤다.
                    // (화면에 붙지 않은 View의 post는 영영 돌지 않아서 view.post 대신 mainHandler를 쓴다.)
                    mainHandler.post { closePopup(target) }
                }

                override fun shouldOverrideUrlLoading(target: WebView, request: WebResourceRequest): Boolean {
                    take(target, request.url.toString())
                    return true
                }

                override fun onPageStarted(target: WebView, url: String?, favicon: Bitmap?) {
                    if (url != null) take(target, url)
                }

                // 기본값(false)이면 이 숨은 창의 화면 엔진이 죽을 때 앱까지 꺼진다. 창만 버린다.
                override fun onRenderProcessGone(target: WebView, detail: RenderProcessGoneDetail): Boolean {
                    closePopup(target)
                    return true
                }
            }
            // window.open('')이나 about:blank처럼 쓸 주소가 끝내 안 오면 숨은 창이 남지 않게 잠시 뒤 없앤다.
            mainHandler.postDelayed({ closePopup(popup) }, POPUP_TIMEOUT_MS)
            (resultMsg.obj as WebView.WebViewTransport).webView = popup
            resultMsg.sendToTarget()
            return true
        }

        // 사이트가 저장 안 한 메모·미션 기록이 있으면 beforeunload로 "떠날까요?"를 묻는데, WebView는 이것을 영어 기본 창으로
        // 띄우고 그동안 페이지를 멈춘다. 그래서 kakaomap:// 길찾기를 누르면 그 창에 막혀 앱이 안 열린다. 묻지 않고 넘긴다.
        // 앱에서는 이래도 쓰던 것을 잃지 않는다:
        //  - 미션 기록 창은 모달이라 열려 있는 동안 제목 링크·새로고침 등 페이지의 나머지를 누를 수 없다.
        //  - 메모는 사이트가 pagehide·화면 숨김 때 저장한다.
        //  - 앱은 다시 불러오기 말고는 이 페이지를 실제로 떠나지 않는다(바깥 주소는 shouldOverrideUrlLoading이 바깥으로 넘긴다).
        override fun onJsBeforeUnload(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            result.confirm()
            return true
        }

        override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            jsDialog(message, result, withCancel = false)
            return true
        }

        override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
            jsDialog(message, result, withCancel = true)
            return true
        }
    }

    // 숨은 창을 한 번만 없앤다(주소를 받은 뒤·시간이 지난 뒤·엔진이 죽은 뒤 중 무엇이 먼저 와도).
    private fun closePopup(popup: WebView) {
        if (!popups.remove(popup)) return
        popup.stopLoading()
        popup.destroy()
    }

    // 앱이 뒤로 내려가면 페이지가 "숨김" 상태가 되어 사이트가 쓰던 메모를 바로 저장하고, 카카오맵 앱으로 넘어간 것도 알아챈다.
    override fun onPause() {
        if (!webViewGone) webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (!webViewGone) webView.onResume()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        mainHandler.removeCallbacksAndMessages(null)
        popups.toList().forEach(::closePopup)
        if (!webViewGone) {
            webView.stopLoading()
            webView.destroy()
        }
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        private val DIALOG_THEME = android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
        private const val POPUP_TIMEOUT_MS = 5000L

        // 파일 이름에 쓸 수 없는 글자를 바꾼다. 비면 "download".
        fun safeFileName(raw: String): String =
            raw.substringAfterLast('/')
                .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
                .trim()
                .trim('.')
                .take(120)
                .ifEmpty { "download" }
    }
}
