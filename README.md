## Web Scraper Typescript - Threads
This scraper goes through recent Threads related to Oen Tech by intercepting <script> HTML tags. It then analyzes the content using sentiment analysis with HuggingFace tabularisai/multilingual-sentiment-analysis model, storing the content in a CSV.

To run:
- Navigate to scraper: cd web-scraper-typescript
- Compile using: npx tsc
- Run: node dist/threads-scraper.js
