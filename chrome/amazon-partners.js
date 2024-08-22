async function main() {
    const response = await fetch('https://www.amazon.de/privacyprefs/retail/partners')
    const html = await response.text()
    const parser = new DOMParser();
    const dom = parser.parseFromString(html, 'text/html');
    const rows = Array.from(dom.querySelectorAll('tr > td > .a-row'));
    const partners = rows.filter((_, index) => index % 2 === 0);
    const consents = partners.map((partner) => {
        const policyUrl = partner.nextElementSibling.querySelector('.a-link-normal')
        return {
            name: partner.textContent.trim(),
            policyUrl: policyUrl.getAttribute('href') !== '#' ? policyUrl.getAttribute('href') : null
        };
    })
    chrome.runtime.sendMessage(consents);
}

chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.target !== 'offscreen') {
        // Not meant for this offscreen document
        return false;
    }

    if (msg.type !== 'parse-amazon-partners') {
        console.warn('Unexpected message type', msg.type);
        return false;
    }

    main();
});
