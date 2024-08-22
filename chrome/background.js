chrome.runtime.onInstalled.addListener(async () => {
    await chrome.storage.session.set({ "cbgr": {} })
})

chrome.tabs.onUpdated.addListener(async (tabId) => {
    const tab = await getCurrentTab();
    if (!tab) {
        return;
    }

    if (tab.url.startsWith('chrome://')) {
        return;
    }

    const { hostname } = new URL(tab.url)

    const { cbgr } = await chrome.storage.session.get(["cbgr"])
    
    if (cbgr[hostname]) {
        // Visited before. Use lastVisited to check again after some time.
    } else {
        cbgr[hostname] = {
            lastVisited: Date.now().valueOf()
        }
        let cmp, csv

        switch (hostname) {
            case 'amazon.de':
                await handleAmazon(cbgr, 'amazon.de');
                break;
            case 'www.amazon.de':
                await handleAmazon(cbgr, 'www.amazon.de');
                break;
            case 'www.heise.de':
                cmp = await handleHeise();
                csv = cmp.vendors.map(({ name, policyUrl }) => {
                    const { hostname } = new URL(policyUrl);
                    return [ name, policyUrl, hostname ];
                });
                cbgr[hostname].vendors = csv;
                break;
            case 'www.paypal.com':
                await handlePaypal(cbgr, 'www.paypal.com');
                break;
            case 'www.spiegel.de':
                cmp = await handleSpiegel();
                csv = cmp.vendors.map(({ name, policyUrl }) => {
                    const { hostname } = new URL(policyUrl);
                    return [ name, policyUrl, hostname ];
                });
                cbgr[hostname].vendors = csv;
                break;
            default:
                // Do nothing
        }

        await chrome.storage.session.set({ cbgr });
    }
});

chrome.runtime.onMessage.addListener(async function (message, sender, sendResponse) {
    if (message.msg !== 'popup-get-partners') {
      return false;
    }

    const { hostname } = new URL(message.data);
    const { cbgr } = await chrome.storage.session.get(["cbgr"]);
    sendResponse(cbgr[hostname] || null);
})

async function getCurrentTab() {
  let queryOptions = { active: true, lastFocusedWindow: true };
  // `tab` will either be a `tabs.Tab` instance or `undefined`.
  let [ tab ] = await chrome.tabs.query(queryOptions);
  return tab;
}

async function hasOffscreenDocument(path) {
  if ('getContexts' in chrome.runtime) {
    // Newer API
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [path]
    });
    return Boolean(contexts.length);
  } else {
    // Older API
    const matchedClients = await clients.matchAll();
    return await matchedClients.some((client) => {
        client.url.endsWith(path);
    });
  }
}

let creating; // A global promise to avoid concurrency issues
async function setupOffscreenDocument(path) {
  // Check all windows controlled by the service worker to see if one
  // of them is the offscreen document with the given path
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create offscreen document
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Need to parse the partners from the document.',
    });
    await creating;
    creating = null;
  }
}

async function handleTcf(hostname, messageId) {
    const response1 = await fetch(`https://${hostname}/mms/v2/message?message_id=${messageId}`)
    const consentManagementPlatform = await response1.json();
    const consentManagement = JSON.parse(consentManagementPlatform.message_json);
    const response2 = await fetch(`https://${hostname}/consent/tcfv2/privacy-manager/privacy-manager-view?siteId=${consentManagementPlatform.site_id}&vendorListId=${consentManagement.settings.vendorList}`)
    const consents = await response2.json();

    return consents
}

// This might be refactored after handling more sites
async function handleHeise() {
    return handleTcf('cmp.heise.de', '756676');
}

// This might be refactored after handling more sites
async function handleSpiegel() {
    return handleTcf('sp-spiegel-de.spiegel.de', '756676');
}

async function handleAmazon(cbgr, hostname) {
    await setupOffscreenDocument('/amazon.html')
    const onDone = async (cmp) => {
        const csv = cmp.map(({ policyUrl, name }) => {
          if (policyUrl === null) {
              return [ name, null, null ]
          }
          const { hostname } = new URL(policyUrl);
          return [ name, policyUrl, hostname ];
        });
        cbgr[hostname].vendors = csv;

        await chrome.storage.session.set({ cbgr });
        chrome.runtime.onMessage.removeListener(onDone);
    };

    chrome.runtime.onMessage.addListener(onDone);
    chrome.runtime.sendMessage({
      type: 'parse-amazon-partners',
      target: 'offscreen'
    });
}

async function handlePaypal(cbgr, hostname) {
    await setupOffscreenDocument('/paypal.html')
    const onDone = async (cmp) => {
        const csv = cmp.map(({ policyUrl, name }) => {
          const { hostname } = new URL(policyUrl);
          return [ name, policyUrl, hostname ];
        });
        cbgr[hostname].vendors = csv;

        await chrome.storage.session.set({ cbgr });
        chrome.runtime.onMessage.removeListener(onDone);
    };

    chrome.runtime.onMessage.addListener(onDone);
    chrome.runtime.sendMessage({
      type: 'parse-paypal-partners',
      target: 'offscreen'
    });
}
