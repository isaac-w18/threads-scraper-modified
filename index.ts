import {Handler} from "aws-lambda";
import { scrapeThreads } from "./threads-scraper.js";

const handler: Handler = async () => {
    try {
        await scrapeThreads();
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Scrape completed"})
        };
    } catch (error) {
        console.error("Error in Lambda handler:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Scrape failed."})
        };
    }
};

export default handler;