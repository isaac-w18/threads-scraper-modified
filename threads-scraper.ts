import puppeteer from "puppeteer-core";
import { writeToPath } from "@fast-csv/format";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { ThreadsAnalyzer, Thread } from "./ThreadsAnalyzer.js";
import chromium from "@sparticuz/chromium";
dotenv.config();

export async function scrapeThreads() {
  const keyword = process.env.KEYWORD || "javascript";
  const maxThreads = parseInt(process.env.MAX_THREADS || "50", 10);
  const headless = process.env.HEADLESS !== "false";
  const runAnalysis = process.env.RUN_ANALYSIS === "true";
  const maxAnalysisThreads = parseInt(process.env.MAX_ANALYSIS_THREADS || "10", 10); // Limit analysis to avoid rate limits

  console.log(`🔍 Starting scraper for "${keyword}", up to ${maxThreads} posts`);
  if (runAnalysis) {
    console.log(`AI analysis will be performed on up to ${maxAnalysisThreads} threads`);
  }

  const debugDir = path.join(process.cwd(), "debug");
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

  let browser;
  let page;

  try {
    console.log("Attempting to launch browser with Chromium from @sparticuz/chromium");
    console.log(`Executable path: ${await chromium.executablePath()}`);
    console.log(`Chrome args: ${JSON.stringify(chromium.args)}`);
  // Launch browser
    const executablePath = await chromium.executablePath(process.env.AWS_EXECUTION_ENV? '/tmp/chromium': undefined);
    console.log("Chromium Executable Path: ", executablePath);
    browser = await puppeteer.launch({ 
      headless: headless,
      defaultViewport: {
        width: 1280,
        height: 800
      }, 
      args: [
        ...chromium.args,
        "--disable-gpu",
        "--single-process",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-zygote",
        "--disable-extensions"
      ],
      executablePath: executablePath,
      ignoreHTTPSErrors: true,
      timeout: 30000 // Increase timeout to 30 seconds
    });

  } catch(error) {
    console.error("Failed to launch browser:", error);
    throw error;
  }

  page = await browser.newPage();
  page.on("console", msg => {
    console.log("🖥️ BROWSER LOG:", msg.text());
  });

  page.on("error", err => {
    console.error("🔥 PAGE ERROR:", err);
  });

  page.on("pageerror", err => {
    console.error("⚠️ UNCAUGHT ERROR:", err);
  });

  page.on("requestfailed", req => {
    console.warn("❌ REQUEST FAILED:", req.url(), req.failure());
  });

  page.on("response", res => {
    if (!res.ok()) {
      console.warn(`⚠️ NON-OK RESPONSE: ${res.status()} ${res.url()}`);
    }
  });
  
  // Set a realistic user agent
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9",
  });

  // Add this before navigation to check network connectivity
  try {
    const networkInfo = await page.evaluate(() => {
      return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        cookiesEnabled: navigator.cookieEnabled,
        online: navigator.onLine
      };
    });
    console.log("Browser network info:", networkInfo);
  } catch (err) {
    console.error("Failed to get network info:", err);
  }

  // page.on("error", err => console.error("❗ Page crashed:", err));
  // page.on("pageerror", err => console.error("❗ Runtime error:", err));
  // browser.on("disconnected", () => console.error("❗ Browser disconnected"));
  await page.screenshot({ path: path.join(debugDir, 'first-test.png') });
  try {
          await page.goto(`https://example.com`, {
            timeout: 60000,
            waitUntil: ['load', 'networkidle0', 'domcontentloaded']
          });
      }
      catch (err) {
          console.error("Failed Example URL:", err);
      }
      await page.screenshot({ path: path.join(debugDir, 'first-test.png') });

  try {
      await page.goto(`https://www.lavuelta.es/en/rankings/stage-4`, {
          waitUntil: "domcontentloaded",
          timeout: 60000
      });
  }
  catch (err) {
      console.error("Failed to load Lavuelta URL:", err);
  }
  await page.screenshot({ path: path.join(debugDir, 'first-test.png') });


  const threadsMap = new Map<string, Thread>();
  
  try {
    // Navigate to search page
    console.log(`Navigating to search page for "${keyword}"...`);
    await page.setDefaultNavigationTimeout(90000); // 90 seconds
    // Use a less strict wait condition
    try {
        await page.goto(`https://www.threads.net/search?q=${encodeURIComponent(keyword)}`, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });
    } catch (err) {
        console.error("Failed to load Threads URL:", err);
    }
    
    // Take a screenshot for debugging
    await page.screenshot({ path: path.join(debugDir, 'search-page.png') });
    
    // Wait for content to load - reduced from 5000 to 2000
    await page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), 2000);
    
    // Extract all JSON scripts from the page
    console.log("Extracting JSON data from the page...");
    
    const extractAndProcessJsonScripts = async () => {
      const scripts = await page.evaluate(() => {
        const scriptElements = Array.from(document.querySelectorAll('script[type="application/json"]'));
        return scriptElements.map((script, index) => {
          try {
            return {
              index,
              content: (script as HTMLScriptElement).textContent || ""
            };
          } catch (e) {
            return { index, error: String(e) };
          }
        });
      });
      
      console.log(`Found ${scripts.length} JSON scripts on the page`);
      
      // Save all scripts for debugging
      for (let i = 0; i < scripts.length; i++) {
        try {
          if (scripts[i].content) {
            const jsonData = JSON.parse(scripts[i].content);
            fs.writeFileSync(
              path.join(debugDir, `script-${i}.json`), 
              JSON.stringify(jsonData, null, 2)
            );
            
            // Extract threads from this JSON data
            const extractedThreads = await page.evaluate((data, kw) => {
              const threads: any[] = [];
              const seen = new Set<string>();
              
              // Function to recursively search for thread data
              const searchForThreads = (obj: any, path = '') => {
                if (!obj || typeof obj !== 'object') return;
                
                // Check if this is a thread item
                if (
                  (obj.user?.username || obj.username) && 
                  (obj.caption?.text || obj.text || obj.content) && 
                  (obj.code || obj.id || obj.shortcode)
                ) {
                  const username = obj.user?.username || obj.username || '';
                  const content = obj.caption?.text || obj.text || obj.content || '';
                  let url = '';
                  
                  if (obj.permalink) {
                    url = obj.permalink.startsWith("http")
                      ? obj.permalink
                      : `https://www.threads.net${obj.permalink}`;
                  } else if (obj.code || obj.id || obj.shortcode) {
                    url = `https://www.threads.net/t/${obj.code || obj.id || obj.shortcode}`;
                  }
                  
                  if (!url || seen.has(url)) return;
                  seen.add(url);
                  
                  const likes = String(
                    obj.like_count || 
                    obj.likes || 
                    obj.edge_liked_by?.count || 
                    obj.edge_media_preview_like?.count || 
                    0
                  );
                  
                  let timestamp = '';
                  if (obj.taken_at) {
                    timestamp = new Date(obj.taken_at * 1000).toISOString();
                  } else if (obj.created_at) {
                    timestamp = new Date(obj.created_at * 1000).toISOString();
                  } else if (obj.timestamp) {
                    const ts = typeof obj.timestamp === 'number' 
                      ? obj.timestamp 
                      : parseInt(obj.timestamp, 10);
                    if (!isNaN(ts)) {
                      timestamp = new Date(ts * 1000).toISOString();
                    }
                  }
                  
                  threads.push({
                    Username: username,
                    Content: content,
                    Likes: likes,
                    Timestamp: timestamp,
                    Url: url,
                    Keyword: kw
                  });
                }
                
                // Check for thread_items, items, or edges arrays
                if (obj.thread_items && Array.isArray(obj.thread_items)) {
                  for (const item of obj.thread_items) {
                    searchForThreads(item, `${path}.thread_items`);
                  }
                }
                
                if (obj.items && Array.isArray(obj.items)) {
                  for (const item of obj.items) {
                    searchForThreads(item, `${path}.items`);
                  }
                }
                
                if (obj.edges && Array.isArray(obj.edges)) {
                  for (const edge of obj.edges) {
                    searchForThreads(edge.node || edge, `${path}.edges`);
                  }
                }
                
                // Special case for Threads.net data structure
                if (obj.data?.xdt_api__v1__feed__timeline__connection) {
                  searchForThreads(obj.data.xdt_api__v1__feed__timeline__connection, `${path}.xdt_api`);
                }
                
                // Recursively search through nested objects
                if (Array.isArray(obj)) {
                  for (let i = 0; i < obj.length; i++) {
                    searchForThreads(obj[i], `${path}[${i}]`);
                  }
                } else if (typeof obj === 'object') {
                  for (const key in obj) {
                    searchForThreads(obj[key], `${path}.${key}`);
                  }
                }
              };
              
              // Start the search from the root
              searchForThreads(data);
              
              return threads;
            }, jsonData, keyword);
            
            // Only log when threads are found to reduce noise
            if (extractedThreads.length > 0) {
              console.log(`Found ${extractedThreads.length} threads in script ${i}`);
            }
            
            // Add extracted threads to the map
            for (const thread of extractedThreads) {
              if (!threadsMap.has(thread.Url)) {
                threadsMap.set(thread.Url, thread);
                console.log(`Added thread: ${thread.Url}`);
              }
            }
          }
        } catch (error) {
          console.error(`Error processing script ${i}:`, error);
          if (scripts[i].content) {
            fs.writeFileSync(
              path.join(debugDir, `script-${i}-raw.txt`), 
              scripts[i].content
            );
          }
        }
      }
    };
    
    // Extract and process JSON scripts initially
    await extractAndProcessJsonScripts();
    
    // Scroll and extract more if needed
    let previousSize = threadsMap.size;
    let emptyScrolls = 0;
    
    while (threadsMap.size < maxThreads && emptyScrolls < 10) {
      console.log(`Scrolling to load more threads... (${threadsMap.size}/${maxThreads})`);
      
      // Scroll multiple times before checking for new content - reduced delay from 2000 to 1000
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), 1000);
      }
      
      // Take a screenshot after scrolling
      await page.screenshot({ path: path.join(debugDir, `after-scroll-${emptyScrolls}.png`) });
      
      // Extract and process JSON scripts again
      await extractAndProcessJsonScripts();
      
      if (threadsMap.size === previousSize) {
        emptyScrolls++;
        console.log(`No new threads found after scrolling (${emptyScrolls}/10)`);
      } else {
        const newThreads = threadsMap.size - previousSize;
        console.log(`Found ${newThreads} new threads after scrolling, total: ${threadsMap.size}`);
        previousSize = threadsMap.size;
        emptyScrolls = 0;
      }
      
      // Add a longer wait between scroll batches - reduced from 3000 to 1500
      await page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), 1500);
    }
  } catch (error) {
    console.error('Error during scraping:', error);
  } finally {
    await browser.close();
  }
  
  console.log(`✅ Done: ${threadsMap.size} threads collected.`);

  let rows = Array.from(threadsMap.values());
  if (!rows.length) {
    console.warn("⚠️ No threads to write.");
    return;
  }
  
  // Run AI analysis if enabled
  if (runAnalysis) {
    try {
      // Limit the number of threads to analyze to avoid rate limits
      const threadsToAnalyze = rows.slice(0, maxAnalysisThreads);
      console.log(`Running AI analysis on ${threadsToAnalyze.length} threads...`);
      
      const analyzer = new ThreadsAnalyzer();
      const analyzedThreads = await analyzer.analyzeThreads(threadsToAnalyze);
      
      // Merge analyzed threads back with the original set
      if (threadsToAnalyze.length < rows.length) {
        const analyzedUrls = new Set(analyzedThreads.map(t => t.Url));
        const remainingThreads = rows.filter(t => !analyzedUrls.has(t.Url));
        rows = [...analyzedThreads, ...remainingThreads];
      } else {
        rows = analyzedThreads;
      }
      
      console.log("AI analysis completed successfully");
    } catch (error) {
      console.error("Error during AI analysis:", error);
    }
  }

  // Write CSV
  const fn = `threads_${keyword}_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  const filePath = path.join('Results', fn);

  writeToPath(filePath, rows, { headers: true })
    .on("finish", () => console.log(`📁 Saved: ${fn}`))
    .on("error", e => console.error("CSV write error:", e));
}
export default scrapeThreads;

// scrapeThreads().catch(e => {
//   console.error("Fatal:", e);
//   process.exit(1);
// });
