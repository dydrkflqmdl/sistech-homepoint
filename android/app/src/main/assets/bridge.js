// 앱(WebView) 전용 — 사이트 코드는 바꾸지 않고 앱이 이 사이트 주소에서만 심는다(MainActivity.installBridge).
// 사이트의 [내보내기]는 <a download> + blob: 주소로 파일을 내려받게 하는데, WebView는 blob: 주소를 내려받지 못한다.
// 그래서 그 누르기를 가로채 페이지 안에서 내용을 읽고(base64) 앱(window.HomePointApp)에 넘긴다. 저장은 앱이 한다.
(() => {
  if (window.__homePointAppBridge) return;
  window.__homePointAppBridge = true;

  const post = (message) => window.HomePointApp.postMessage(JSON.stringify(message));

  const readAsBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        resolve(url.slice(url.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  // fetch(blob 주소)는 부르는 순간 내용을 붙잡으므로 사이트가 곧바로 주소를 지워도(revokeObjectURL) 괜찮다.
  async function save(href, name) {
    try {
      const blob = await (await fetch(href)).blob();
      post({ type: 'download', name, mime: blob.type, data: await readAsBase64(blob) });
    } catch (err) {
      post({ type: 'download-failed', name, message: String(err?.message ?? err) });
    }
  }

  // 캡처 단계에서 받아 브라우저 기본 동작(WebView에서는 아무 일도 안 일어남)보다 먼저 처리한다.
  document.addEventListener(
    'click',
    (e) => {
      const link = e.target instanceof Element ? e.target.closest('a[download]') : null;
      if (!link || !window.HomePointApp) return;
      const href = link.href;
      if (!href.startsWith('blob:') && !href.startsWith('data:')) return;
      e.preventDefault();
      save(href, link.getAttribute('download') || 'download');
    },
    true,
  );
})();
