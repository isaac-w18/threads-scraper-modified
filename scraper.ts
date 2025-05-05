//Inspired by: https://www.zenrows.com/blog/web-scraping-typescript#scrape-multiple-pages

import axios from "axios"
import { load } from "cheerio"
import { writeToPath } from "@fast-csv/format"

//Product type for storing information.
type Product = {
    Url?: string
    Image?: string
    Name?: string
    Price?: string
}

async function scrapeSite() {
    //Where to store the scraped data.
    const products: Product[] = []

    //The first page to visit.
    const firstPage = "https://www.scrapingcourse.com/ecommerce/page/1/"

    //Support data structures for web crawling.
    const pagesToScrape = [firstPage]
    const pagesDiscovered = [firstPage]

    //Page counter.
    let i = 1

    //Max number of pages to scrape.
    const limit = 5

    while (pagesToScrape.length !== 0 && i <= limit) {
        //Retrieve the current page to scrape.
        const pageURL = pagesToScrape.shift()

        //Perform HTTP GET request to the target page.
        if(pageURL) {
            try {
        const response = await axios.get(pageURL)

        //Get the HTML from the server response.
        const html = response.data

        //Parse the HTML content.
        const $ = load(html)

        //Crawling logic.
        $("a.page-numbers").each((j, paginationHTMLElement) => {
            //Get the pagination link URL.
            const paginationURL = $(paginationHTMLElement).attr("href")

            if(paginationURL && !pagesDiscovered.includes(paginationURL)) {
                pagesDiscovered.push(paginationURL)

            if(!pagesToScrape.includes(paginationURL)) {
                pagesToScrape.push(paginationURL)
            }
            }
        })
//Select all product elements on the page, and iterate over them.
$("li.product").each((i, productHTMLElement) => {
    //Extract the data of interest from the product node
    const url = $(productHTMLElement).find(
    "a").first().attr("href")
    const image = $(productHTMLElement).find("img").first().attr("src")
    const name = $(productHTMLElement).find("h2").first().text()
    const price = $(productHTMLElement).find("span").first().text()

    //Initialize a Product object with the scraped data, and add it to the list.
    const product: Product = {
        Url: url,
        Image: image,
        Name: name,
        Price: price,
    }
    products.push(product)
})
console.log(`Scraped page ${i}: ${pageURL}`)
i++
    } catch (error) {
        console.error(`Error scraping ${pageURL}:`, error)
    }
}
    }

    //Export the scraped data to CSV.
    writeToPath("products.csv", products, { headers: true}).on("error", error => console.error(error));
}

scrapeSite()