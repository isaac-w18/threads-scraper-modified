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
  Emotion?: string;
  Importance?: string;
};

// Define types for Hugging Face API responses
type EmotionResponse = Array<{label: string, score: number}> | Array<Array<{label: string, score: number}>>;
type ImportanceResponse = {
  labels: string[];
  scores: number[];
  sequence: string;
};

export class ThreadsAnalyzer {
  private huggingFaceToken: string;
  private rateLimitDelay = 2000; // 2 seconds between API calls
  private maxRetries = 3;
  private emotionModelEndpoint = "SamLowe/roberta-base-go_emotions"; // Good emotion model
  private classificationModelEndpoint = "facebook/bart-large-mnli"; // Good for text classification
  private useLocalFallback = true; // Use local analysis if API fails

  constructor() {
    this.huggingFaceToken = process.env.HUGGINGFACE_API_KEY || "";
    if (!this.huggingFaceToken) {
      console.warn("⚠️ No HUGGINGFACE_API_KEY found in .env file. Using local fallback analysis.");
      this.useLocalFallback = true;
    }
  }

  /**
   * Analyzes a batch of threads for emotion and importance
   */
  async analyzeThreads(threads: Thread[]): Promise<Thread[]> {
    console.log(`🧠 Starting AI analysis of ${threads.length} threads...`);
    
    if (this.useLocalFallback) {
      console.log("Using local analysis (no API calls) due to missing or invalid API key");
    } else {
      console.log("Using Hugging Face API for analysis");
    }
    
    const analyzedThreads: Thread[] = [];
    
    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      console.log(`Analyzing thread ${i+1}/${threads.length}: ${thread.Url.substring(0, 50)}...`);
      
      try {
        const analysis = await this.analyzeContentWithRetry(thread.Content);
        analyzedThreads.push({
          ...thread,
          Emotion: analysis.emotion,
          Importance: analysis.importance
        });
        
        // Add delay between API calls to respect rate limits (only if using API)
        if (!this.useLocalFallback && i < threads.length - 1) {
          console.log(`Waiting ${this.rateLimitDelay/1000} seconds before next analysis...`);
          await setTimeout(this.rateLimitDelay);
        }
      } catch (error) {
        console.error(`Error analyzing thread ${thread.Url}:`, error);
        
        // Use local fallback for this thread
        const fallbackAnalysis = this.localAnalyzeContent(thread.Content);
        analyzedThreads.push({
          ...thread,
          Emotion: fallbackAnalysis.emotion,
          Importance: fallbackAnalysis.importance
        });
        
        // If we're still trying to use the API but getting errors, switch to local fallback
        if (!this.useLocalFallback) {
          console.log("Switching to local fallback analysis for all remaining threads");
          this.useLocalFallback = true;
        }
      }
    }
    
    console.log(`✅ AI analysis complete for ${analyzedThreads.length} threads`);
    return analyzedThreads;
  }

  /**
   * Analyzes content with retry logic
   */
  private async analyzeContentWithRetry(content: string, retryCount = 0): Promise<{ emotion: string; importance: string }> {
    // If we're using local fallback, don't even try the API
    if (this.useLocalFallback) {
      return this.localAnalyzeContent(content);
    }
    
    try {
      return await this.analyzeContent(content);
    } catch (error: any) {
      if (retryCount < this.maxRetries && (error.status === 429 || error.status === 503)) {
        const waitTime = (retryCount + 1) * 5000; // Exponential backoff
        console.log(`Rate limit hit, waiting for ${waitTime/1000} seconds before retry ${retryCount + 1}/${this.maxRetries}...`);
        await setTimeout(waitTime);
        return this.analyzeContentWithRetry(content, retryCount + 1);
      }
      
      // If we get a 403 error, it's likely an API key issue
      if (error.message && error.message.includes("403")) {
        console.error("API key error (403 Forbidden). Check your HUGGINGFACE_API_KEY in .env file.");
        this.useLocalFallback = true;
        return this.localAnalyzeContent(content);
      }
      
      throw error;
    }
  }

  /**
   * Local fallback analysis without API calls
   */
  private localAnalyzeContent(content: string): { emotion: string; importance: string } {
    if (!content || content.trim().length === 0) {
      return { emotion: "Neutral", importance: "Low" };
    }
    
    // Simple keyword-based emotion detection
    const text = content.toLowerCase();
    let emotion = "Neutral";
    
    // Happy keywords
    if (/great|happy|awesome|love|excellent|amazing|joy|glad|excited|wonderful/i.test(text)) {
      emotion = "Happy";
    } 
    // Sad keywords
    else if (/sad|disappointed|sorry|unfortunate|regret|miss|loss|bad|terrible|fail/i.test(text)) {
      emotion = "Sad";
    }
    // Angry keywords
    else if (/angry|mad|furious|annoyed|irritated|upset|hate|terrible|awful|worst/i.test(text)) {
      emotion = "Angry";
    }
    // Surprised keywords
    else if (/wow|omg|surprised|unexpected|shocking|amazed|astonished|unbelievable/i.test(text)) {
      emotion = "Surprised";
    }
    
    // Simple importance detection based on content length and keywords
    let importance = "Medium";
    
    // Longer content tends to be more important
    if (content.length > 300) {
      importance = "High";
    } else if (content.length < 100) {
      importance = "Low";
    }
    
    // Important keywords override
    if (/important|urgent|attention|must|critical|essential|significant|key|major/i.test(text)) {
      importance = "High";
    }
    
    return { emotion, importance };
  }

  /**
   * Analyzes a single thread's content using Hugging Face models
   */
  private async analyzeContent(content: string): Promise<{ emotion: string; importance: string }> {
    if (!content || content.trim().length === 0) {
      return { emotion: "Neutral", importance: "Low" };
    }

    // Truncate content if it's too long (Hugging Face models typically have token limits)
    const truncatedContent = content.length > 500 ? content.substring(0, 500) + "..." : content;

    // Get emotion using emotion classification model
    const emotion = await this.getEmotion(truncatedContent);
    
    // Get importance using text classification model
    const importance = await this.getImportance(truncatedContent);
    
    return {
      emotion,
      importance
    };
  }

  /**
   * Get emotion from content using Hugging Face emotion model
   */
  private async getEmotion(content: string): Promise<string> {
    try {
      // Verify token is set
      if (!this.huggingFaceToken) {
        throw new Error("No Hugging Face API token provided");
      }
      
      const response = await fetch(
        `https://api-inference.huggingface.co/models/${this.emotionModelEndpoint}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.huggingFaceToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ inputs: content })
        }
      );

      if (!response.ok) {
        throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as EmotionResponse;
      
      // Handle different response formats
      if (Array.isArray(data) && data.length > 0) {
        // Format 1: Array of label/score objects
        if (Array.isArray(data[0])) {
          // Sort by score and get the highest one
          const sortedEmotions = [...data[0]].sort((a, b) => b.score - a.score);
          return this.mapEmotionLabel(sortedEmotions[0].label);
        } 
        // Format 2: Array of objects with label/score
        else if ('label' in data[0]) {
          return this.mapEmotionLabel(data[0].label);
        }
      }
      
      // Default to Neutral if we can't parse the response
      return "Neutral";
    } catch (error) {
      console.error("Error getting emotion:", error);
      throw error; // Re-throw to trigger fallback
    }
  }

  /**
   * Map raw emotion labels to standardized ones
   */
  private mapEmotionLabel(label: string): string {
    // Map specific emotion labels to more general categories
    const emotionMap: Record<string, string> = {
      // Common emotion labels from Hugging Face models
      "admiration": "Happy",
      "amusement": "Happy",
      "anger": "Angry",
      "annoyance": "Angry",
      "approval": "Happy",
      "caring": "Happy",
      "confusion": "Confused",
      "curiosity": "Curious",
      "desire": "Excited",
      "disappointment": "Sad",
      "disapproval": "Angry",
      "disgust": "Angry",
      "embarrassment": "Sad",
      "excitement": "Excited",
      "fear": "Fearful",
      "gratitude": "Happy",
      "grief": "Sad",
      "joy": "Happy",
      "love": "Happy",
      "nervousness": "Anxious",
      "optimism": "Happy",
      "pride": "Happy",
      "realization": "Surprised",
      "relief": "Happy",
      "remorse": "Sad",
      "sadness": "Sad",
      "surprise": "Surprised",
      // MNLI model specific labels
      "LABEL_0": "Neutral",
      "LABEL_1": "Happy",
      "LABEL_2": "Sad",
      "entailment": "Happy",
      "contradiction": "Angry",
      "neutral": "Neutral"
    };

    // Convert to lowercase for case-insensitive matching
    const normalizedLabel = label.toLowerCase();
    
    // Return mapped emotion or the original if not found
    return emotionMap[normalizedLabel] || 
           (normalizedLabel.includes("positive") ? "Happy" : 
           (normalizedLabel.includes("negative") ? "Sad" : "Neutral"));
  }

  /**
   * Get importance from content using Hugging Face classification model
   */
  private async getImportance(content: string): Promise<string> {
    try {
      // Verify token is set
      if (!this.huggingFaceToken) {
        throw new Error("No Hugging Face API token provided");
      }
      
      // For importance, we'll use a zero-shot classification approach
      const response = await fetch(
        `https://api-inference.huggingface.co/models/${this.classificationModelEndpoint}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.huggingFaceToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            inputs: content,
            parameters: {
              candidate_labels: ["important information", "somewhat important", "not important"]
            }
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as ImportanceResponse;
      
      // Parse the response to get the most likely importance level
      if (data && Array.isArray(data.labels) && Array.isArray(data.scores)) {
        const highestScoreIndex = data.scores.indexOf(Math.max(...data.scores));
        const label = data.labels[highestScoreIndex];
        
        // Map the label to High/Medium/Low
        if (label.includes("important information")) {
          return "High";
        } else if (label.includes("somewhat important")) {
          return "Medium";
        } else {
          return "Low";
        }
      }
      
      // Default to Medium if we can't parse the response
      return "Medium";
    } catch (error) {
      console.error("Error getting importance:", error);
      throw error; // Re-throw to trigger fallback
    }
  }
}
