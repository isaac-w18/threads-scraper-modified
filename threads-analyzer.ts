import * as dotenv from "dotenv";
import { setTimeout } from "timers/promises";
import fetch from "node-fetch";

dotenv.config();

export type Thread = {
  Username: string;
  Content: string;
  Likes: string;
  Timestamp: string;
  Url: string;
  Keyword: string;
  Sentiment?: string;  // Number of Classes: 5 (Very Negative, Negative, Neutral, Positive, Very Positive)
};

// Define type for Hugging Face API sentiment response
type SentimentResponse = Array<Array<{label: string, score: number}>>;

export class ThreadsAnalyzer {
  private huggingFaceToken: string;
  private rateLimitDelay = 2000; // 2 seconds between API calls
  private maxRetries = 5;
  private sentimentModelEndpoint = "tabularisai/multilingual-sentiment-analysis"; // Good for sentiment analysis

  constructor() {
    this.huggingFaceToken = process.env.HUGGINGFACE_API_KEY || "";
    if (!this.huggingFaceToken) {
      throw new Error("HUGGINGFACE_API_KEY is required in .env file");
    }
  }

  /**
   * Analyzes a batch of threads for sentiment
   */
  async analyzeThreads(threads: Thread[]): Promise<Thread[]> {
    console.log(`🧠 Starting sentiment analysis of ${threads.length} threads...`);
    
    const analyzedThreads: Thread[] = [];
    
    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      console.log(`Analyzing thread ${i+1}/${threads.length}: ${thread.Url.substring(0, 50)}...`);
      
      try {
        const sentiment = await this.analyzeSentimentWithRetry(thread.Content);
        analyzedThreads.push({
          ...thread,
          Sentiment: sentiment
        });
        
        // Add delay between API calls to respect rate limits
        if (i < threads.length - 1) {
          console.log(`Waiting ${this.rateLimitDelay/1000} seconds before next analysis...`);
          await setTimeout(this.rateLimitDelay);
        }
      } catch (error) {
        console.error(`Error analyzing thread ${thread.Url}:`, error);
        // Skip this thread if analysis fails
        analyzedThreads.push({
          ...thread,
          Sentiment: "Unknown" // Mark failed analyses as Unknown
        });
      }
    }
    
    console.log(`✅ Sentiment analysis complete for ${analyzedThreads.length} threads`);
    return analyzedThreads;
  }

  /**
   * Analyzes sentiment with retry logic
   */
  private async analyzeSentimentWithRetry(content: string, retryCount = 0): Promise<string> {
    try {
      return await this.analyzeSentiment(content);
    } catch (error: any) {
      if (retryCount < this.maxRetries && (error.status === 429 || error.status === 503)) {
        const waitTime = Math.pow(2, retryCount) * 1000 + 4000; // Exponential backoff
        console.log(`Rate limit hit, waiting for ${waitTime/1000} seconds before retry ${retryCount + 1}/${this.maxRetries}...`);
        await setTimeout(waitTime);
        return this.analyzeSentimentWithRetry(content, retryCount + 1);
      }
      
      // If we get a 403 error, it's likely an API key issue
      if (error.message && error.message.includes("403")) {
        const error = new Error("API key error (403 Forbidden). Check your HUGGINGFACE_API_KEY in .env file.");
      }
      
      throw error;
    }
  }

  /**
   * Analyzes sentiment of content using Hugging Face model
   */
  private async analyzeSentiment(content: string): Promise<string> {
    if (!content || content.trim().length === 0) {
      return "Neutral";
    }

    // Truncate content if it's too long (Hugging Face models typically have token limits)
    const truncatedContent = content.length > 500 ? content.substring(0, 500) + "..." : content;

    const filteredContent = this.filterURL(truncatedContent); 
    console.log(`Filtered content: ${filteredContent}`);

    // Add context to help the model understand we're looking for sentiment towards Oen Tech
    //  change based on ENV
    // const contextualContent = `This is likely a comment about Oen Tech (@oen.tw): "${truncatedContent}"`;
    // const contextualContent = `This is likely a comment about (@oen.tw): "${truncatedContent}"`;
    const contextualContent = `This is likely a comment about Oen Tech (@oen.tw): "${filteredContent}"`;

    // Verify token is set
    if (!this.huggingFaceToken) {
      throw new Error("No Hugging Face API token provided");
    }
    
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${this.sentimentModelEndpoint}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.huggingFaceToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inputs: contextualContent })
      }
    );

    if (!response.ok) {
      const error = new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
      (error as any).status = response.status;
      throw error;
    }

    const data = await response.json() as SentimentResponse;
    const data_subarray = data[0];
    
    // Map sentiment labels to sentiment categories
    if (Array.isArray(data) && data_subarray.length > 0) {
      console.log(data);
      let max_score = data_subarray[0].score;
      let sentiment = data_subarray[0].label;
      for(let i = 1; i < data.length; i++) {
        if (data_subarray[i].score > max_score) {
          max_score = data_subarray[i].score;
          sentiment = data_subarray[i].label;
        }
      }

      // this is returning undefined for some reason
      console.log("Sentiment: " + sentiment);
      console.log("Max Score: " + max_score);

      return sentiment;
    }
    
    // Default to Unknown if we can't determine
    return "Unknown";
  }

  private filterURL(content: string): string {
    // Define a regular expression to match URLs
    const oenURL = /(https?:\/\/[^\s]*oen.tw\/[^\s]*)/g;
    const unrelatedURL = /(https?:\/\/[^\s]*)/g;

    // Replace URLs with a placeholder
    const filteredContentOen = content.replace(oenURL, "(oen.tw)");
    const filteredContentFinal = filteredContentOen.replace(unrelatedURL, "[URL]");

    return filteredContentFinal;
  }
}
