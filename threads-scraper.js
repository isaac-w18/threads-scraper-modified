import puppeteer from "puppeteer";
import { writeToPath } from "@fast-csv/format";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config();
async function scrapeThreads() {
    const keyword = process.env.KEYWORD || "javascript";
    const maxThreads = parseInt(process.env.MAX_THREADS || "50", 10);
    const headless = process.env.HEADLESS !== "false";
    console.log(`🔍 Starting scraper for "${keyword}", up to ${maxThreads} posts`);
    const screenshotsDir = path.join(process.cwd(), "screenshots");
    if (!fs.existsSync(screenshotsDir))
        fs.mkdirSync(screenshotsDir);
    const browser = await puppeteer.launch({ headless, defaultViewport: null, args: ["--window-size=1280,800"] });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/91.0.4472.124 Safari/537.36");
    await page.goto(`https://www.threads.net/search?q=${encodeURIComponent(keyword)}`, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("body", { timeout: 15000 });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const threadsMap = new Map();
    async function extractOnce() {
        // 1) script-based extraction
        const fromScripts = await page.$$eval('script[type="application/json"][data-sjs]', (scripts, kw) => {
            const out = [];
            const seen = new Set();
            for (const s of scripts) {
                let js;
                try {
                    js = JSON.parse(s.textContent);
                }
                catch {
                    continue;
                }
                if (!js.ScheduledServerJS)
                    continue;
                const buckets = js.thread_items || js.props?.pageProps?.thread_items;
                if (!Array.isArray(buckets))
                    continue;
                for (const bucket of buckets) {
                    if (!Array.isArray(bucket))
                        continue;
                    for (const obj of bucket) {
                        const user = obj.user?.username || obj.username || "";
                        const text = obj.caption?.text || obj.text || obj.content || "";
                        let url = "";
                        if (obj.permalink) {
                            url = obj.permalink.startsWith("http")
                                ? obj.permalink
                                : `https://www.threads.net${obj.permalink}`;
                        }
                        else if (obj.code || obj.id) {
                            url = `https://www.threads.net/t/${obj.code || obj.id}`;
                        }
                        if (!/^https:\/\/www\.threads\.net\/t\//.test(url))
                            continue;
                        if (!user && !text)
                            continue;
                        if (seen.has(url))
                            continue;
                        seen.add(url);
                        const likes = (obj.like_count ??
                            obj.likes ??
                            obj.edge_media_preview_like?.count ??
                            0).toString();
                        const ts = obj.taken_at || obj.created_at || obj.timestamp;
                        const timestamp = ts ? new Date(ts * 1000).toISOString() : "";
                        out.push({ Username: user, Content: text, Likes: likes, Timestamp: timestamp, Url: url, Keyword: kw });
                    }
                }
            }
            return out;
        }, keyword);
        // 2) fallback DOM extraction if scripts found nothing
        const fromDOM = fromScripts.length
            ? []
            : await page.$$eval("article", (articles, kw) => {
                const out = [];
                for (const a of articles) {
                    const user = a.querySelector('a[href^="/@"]')?.textContent?.trim() || "";
                    const content = a.querySelector('div[dir="auto"]')?.textContent?.trim() || "";
                    const spans = Array.from(a.querySelectorAll("a[href*='/t/'] ~ div span"));
                    const likes = spans[0]?.textContent?.trim() || "";
                    const timeEl = a.querySelector("time");
                    const timestamp = timeEl?.getAttribute("datetime")?.trim() || timeEl?.textContent?.trim() || "";
                    const href = a.querySelector("a[href*='/t/']")?.getAttribute("href") || "";
                    const url = href.startsWith("http")
                        ? href
                        : `https://www.threads.net${href}`;
                    if ((user || content) && url) {
                        out.push({ Username: user, Content: content, Likes: likes, Timestamp: timestamp, Url: url, Keyword: kw });
                    }
                }
                return out;
            }, keyword);
        const batch = fromScripts.length ? fromScripts : fromDOM;
        console.log(`→ extracted ${batch.length} this pass (scripts/dom)`);
        for (const t of batch) {
            if (threadsMap.size >= maxThreads)
                break;
            if (!threadsMap.has(t.Url)) {
                threadsMap.set(t.Url, t);
            }
        }
    }
    // initial wait + extract
    await sleep(3000);
    await extractOnce();
    console.log(`→ Collected ${threadsMap.size} so far`);
    // scroll + extract loop
    let prev = threadsMap.size, empty = 0;
    while (threadsMap.size < maxThreads && empty < 10) {
        await page.evaluate(() => window.scrollBy(0, innerHeight));
        await sleep(2000);
        await extractOnce();
        if (threadsMap.size === prev)
            empty++;
        else {
            prev = threadsMap.size;
            empty = 0;
        }
        console.log(`→ Collected ${threadsMap.size} so far (empty streak=${empty})`);
    }
    await browser.close();
    console.log(`✅ Done: ${threadsMap.size} threads collected.`);
    const rows = Array.from(threadsMap.values());
    if (!rows.length) {
        console.warn("⚠️ No threads to write.");
        return;
    }
    const fn = `threads_${keyword}_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    writeToPath(fn, rows, { headers: true })
        .on("finish", () => console.log(`📁 Saved: ${fn}`))
        .on("error", e => console.error("CSV write error:", e));
}
scrapeThreads().catch(e => {
    console.error("Fatal:", e);
    process.exit(1);
});
