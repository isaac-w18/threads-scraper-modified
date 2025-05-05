"use strict";
//Inspired by: https://www.zenrows.com/blog/web-scraping-typescript#scrape-multiple-pages
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = require("cheerio");
const format_1 = require("@fast-csv/format");
function scrapeSite() {
    return __awaiter(this, void 0, void 0, function* () {
        //Where to store the scraped data.
        const products = [];
        //The first page to visit.
        const firstPage = "https://www.scrapingcourse.com/ecommerce/page/1/";
        //Support data structures for web crawling.
        const pagesToScrape = [firstPage];
        const pagesDiscovered = [firstPage];
        //Page counter.
        let i = 1;
        //Max number of pages to scrape.
        const limit = 5;
        while (pagesToScrape.length !== 0 && i <= limit) {
            //Retrieve the current page to scrape.
            const pageURL = pagesToScrape.shift();
            //Perform HTTP GET request to the target page.
            if (pageURL) {
                try {
                    const response = yield axios_1.default.get(pageURL);
                    //Get the HTML from the server response.
                    const html = response.data;
                    //Parse the HTML content.
                    const $ = (0, cheerio_1.load)(html);
                    //Crawling logic.
                    $("a.page-numbers").each((j, paginationHTMLElement) => {
                        //Get the pagination link URL.
                        const paginationURL = $(paginationHTMLElement).attr("href");
                        if (paginationURL && !pagesDiscovered.includes(paginationURL)) {
                            pagesDiscovered.push(paginationURL);
                            if (!pagesToScrape.includes(paginationURL)) {
                                pagesToScrape.push(paginationURL);
                            }
                        }
                    });
                    //Select all product elements on the page, and iterate over them.
                    $("li.product").each((i, productHTMLElement) => {
                        //Extract the data of interest from the product node
                        const url = $(productHTMLElement).find("a").first().attr("href");
                        const image = $(productHTMLElement).find("img").first().attr("src");
                        const name = $(productHTMLElement).find("h2").first().text();
                        const price = $(productHTMLElement).find("span").first().text();
                        //Initialize a Product object with the scraped data, and add it to the list.
                        const product = {
                            Url: url,
                            Image: image,
                            Name: name,
                            Price: price,
                        };
                        products.push(product);
                    });
                    console.log(`Scraped page ${i}: ${pageURL}`);
                    i++;
                }
                catch (error) {
                    console.error(`Error scraping ${pageURL}:`, error);
                }
            }
        }
        //Export the scraped data to CSV.
        (0, format_1.writeToPath)("products.csv", products, { headers: true }).on("error", error => console.error(error));
    });
}
scrapeSite();
