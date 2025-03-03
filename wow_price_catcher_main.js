import Apify from 'apify';
import { PuppeteerCrawler } from 'crawlee';

Apify.Actor.main(async () => {
    const input = await Apify.Actor.getInput();
    const startUrls = input?.startUrls?.map(urlObj => (typeof urlObj === 'string' ? urlObj : urlObj.url)) || [];
    const maxItems = input?.maxItems;

    const requestQueue = await Apify.Actor.openRequestQueue();

    const crawler = new PuppeteerCrawler({
        requestQueue,
        launchContext: {
            launchOptions: {
                headless: true,
                args: ['--disable-blink-features=AutomationControlled'] // Helps prevent bot detection
            },
        },
        maxRequestsPerCrawl: maxItems || undefined,
        requestHandler: async ({ page, request }) => {
            console.log(`Scraping: ${request.url}`);

            // Wait for the product tiles to load (try wc-product-tile)
            await page.waitForSelector('wc-product-tile', { timeout: 15000 });

            // Scroll down to load more products (if lazy-loaded)
            await page.evaluate(async () => {
                await new Promise(resolve => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            // Extract data using shadow DOM handling
            const extractedData = await page.evaluate(() => {
                const productTiles = Array.from(document.querySelectorAll('wc-product-tile'));

                return productTiles.map(tile => {
                    const shadowRoot = tile.shadowRoot || tile; // Some elements use shadow DOM
                    const titleElement = shadowRoot.querySelector('.title a');
                    const title = titleElement ? titleElement.textContent.trim() : null;

                    const priceElement = shadowRoot.querySelector('.product-tile-price .primary');
                    const price = priceElement ? priceElement.textContent.trim() : null;

                    const promotionElement = shadowRoot.querySelector('.product-tile-promo-info .html-content span');
                    const promotion = promotionElement ? promotionElement.textContent.trim() : null;

                    const linkElement = titleElement;
                    const url = linkElement ? new URL(linkElement.href, document.location.origin).href : null;

                    const imageElement = shadowRoot.querySelector('.product-tile-image a img');
                    const imgUrl = imageElement ? imageElement.src : null;

                    return {
                        title,
                        price,
                        promotion,
                        url,
                        imgUrl,
                        requestUrl: document.location.href,
                    };
                });
            });

            if (Array.isArray(extractedData) && extractedData.length > 0) {
                for (const item of extractedData) {
                    await Apify.Actor.pushData(item);
                }
            } else {
                console.warn("No data extracted. The page may have changed its structure.");
            }
        },
        failedRequestHandler: async ({ request }) => {
            console.log(`Request ${request.url} failed.`);
        },
    });

    // Validate and add URLs to request queue
    for (const url of startUrls) {
        if (typeof url === 'string' && url.startsWith('http')) {
            await requestQueue.addRequest({ url });
        } else {
            console.warn(`Skipping invalid URL: ${JSON.stringify(url)}`);
        }
    }

    await crawler.run();

    console.log('Crawler finished.');
});
