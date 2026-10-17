// declarativeNetRequest rules: how the extension "dresses" its requests the
// way Tunes's OkHttp client does (PlayerClient.mediaHeaders()).
const R = chrome.declarativeNetRequest;
const SET = R.HeaderOperation.SET;
const REMOVE = R.HeaderOperation.REMOVE;
const XHR_TYPES = [R.ResourceType.XMLHTTPREQUEST, R.ResourceType.OTHER];

const ext = () => [chrome.runtime.id];

export async function installStaticRules() {
  await R.updateDynamicRules({
    removeRuleIds: [1, 4, 10, 11, 14, 16, 17],
    addRules: [
      {
        // The YouTube player inside the offscreen page: YouTube refuses to
        // start an embed with no Referer (error 153), and refuses its own
        // domain as the embedding site (152). A neutral site works.
        id: 17, priority: 1,
        action: { type: R.RuleActionType.MODIFY_HEADERS, requestHeaders: [
          { header: 'Referer', operation: SET, value: 'https://www.google.com/' },
        ] },
        condition: { regexFilter: '^https://www\\.youtube(-nocookie)?\\.com/embed/', initiatorDomains: ext(), resourceTypes: [R.ResourceType.SUB_FRAME] },
      },
      {
        // Apple Music library API only answers music.apple.com
        id: 14, priority: 1,
        action: { type: R.RuleActionType.MODIFY_HEADERS, requestHeaders: [
          { header: 'Origin', operation: SET, value: 'https://music.apple.com' },
          { header: 'Referer', operation: SET, value: 'https://music.apple.com/' },
        ] },
        condition: { urlFilter: '||amp-api.music.apple.com/', initiatorDomains: ext(), resourceTypes: XHR_TYPES },
      },
      {
        // WEB_REMIX browse/search/next: look like music.youtube.com itself.
        id: 1, priority: 1,
        action: {
          type: R.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            { header: 'Origin', operation: SET, value: 'https://music.youtube.com' },
            { header: 'Referer', operation: SET, value: 'https://music.youtube.com/' },
            { header: 'X-Origin', operation: SET, value: 'https://music.youtube.com' },
          ],
        },
        condition: { urlFilter: '||music.youtube.com/youtubei/', initiatorDomains: ext(), resourceTypes: XHR_TYPES },
      },
      {
        // JioSaavn API: Tunes sends an Indian IP hint + explicit cookie.
        id: 4, priority: 1,
        action: {
          type: R.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            { header: 'Origin', operation: REMOVE },
            { header: 'Referer', operation: SET, value: 'https://www.jiosaavn.com/' },
            { header: 'Cookie', operation: SET, value: 'explicit_content=1' },
          ],
        },
        condition: { urlFilter: '||www.jiosaavn.com/api.php', initiatorDomains: ext(), resourceTypes: XHR_TYPES },
      },
    ],
  });
}

// Signed-in YouTube Music calls carry your Chrome session cookies explicitly,
// so "Block third-party cookies" or SameSite rules can't strip them and leave
// Tunes looking signed out. Re-synced whenever those cookies change.
let lastCookie = '';
export async function syncYouTubeCookies() {
  let header = '';
  try {
    const { settings } = await chrome.storage.local.get('settings');
    if ((settings as { useAccount?: boolean } | undefined)?.useAccount === false) throw 0;
    const all = await chrome.cookies.getAll({ domain: 'youtube.com' });
    const seen = new Set<string>();
    header = all
      .filter((c) => (c.domain === '.youtube.com' || c.domain.endsWith('music.youtube.com')) && !c.partitionKey && c.value)
      .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
      .map((c) => `${c.name}=${c.value}`).join('; ');
  } catch { /* ignore */ }
  if (header === lastCookie) return;
  lastCookie = header;
  const signedIn = /(^|; )(SAPISID|__Secure-3PAPISID)=/.test(header);
  await R.updateDynamicRules({
    removeRuleIds: [12, 13],
    addRules: signedIn ? [{
      id: 12, priority: 1,
      action: { type: R.RuleActionType.MODIFY_HEADERS, requestHeaders: [{ header: 'Cookie', operation: SET, value: header }] },
      condition: { urlFilter: '||music.youtube.com/youtubei/', initiatorDomains: ext(), resourceTypes: XHR_TYPES },
    }, {
      // anonymous retries stay anonymous
      id: 13, priority: 3,
      action: { type: R.RuleActionType.MODIFY_HEADERS, requestHeaders: [{ header: 'Cookie', operation: REMOVE }] },
      condition: { urlFilter: '||music.youtube.com/youtubei/*bc=anon', initiatorDomains: ext(), resourceTypes: XHR_TYPES },
    }] : [],
  });
}

let currentUa = '';
/** Native-client identity for /player and the googlevideo media fetch that follows it. */
export async function setNativeUserAgent(ua: string) {
  if (ua === currentUa) return;
  currentUa = ua;
  const headers = [
    { header: 'User-Agent', operation: SET, value: ua },
    { header: 'Origin', operation: REMOVE },
    { header: 'Referer', operation: REMOVE },
  ];
  await R.updateDynamicRules({
    removeRuleIds: [2, 3],
    addRules: [
      {
        id: 2, priority: 1,
        action: { type: R.RuleActionType.MODIFY_HEADERS, requestHeaders: headers },
        condition: { urlFilter: '||www.youtube.com/youtubei/v1/player', initiatorDomains: ext(), resourceTypes: XHR_TYPES },
      },
      {
        id: 3, priority: 1,
        action: { type: R.RuleActionType.MODIFY_HEADERS, requestHeaders: headers },
        condition: { urlFilter: '||googlevideo.com/', initiatorDomains: ext(), resourceTypes: [R.ResourceType.MEDIA, ...XHR_TYPES] },
      },
    ],
  });
}
