FROM public.ecr.aws/lambda/nodejs:18

# Install dependencies for Puppeteer
RUN yum install -y \
    alsa-lib atk cups-libs gtk3 ipa-gothic-fonts \
    libXcomposite libXcursor libXdamage libXext libXi \
    libXrandr libXScrnSaver libXtst pango \
    xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi \
    xorg-x11-fonts-cyrillic xorg-x11-fonts-misc \
    xorg-x11-fonts-Type1 xorg-x11-utils \
    && yum clean all

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy everything and install dependencies
COPY package*.json ./

# Set env var to skip downloading Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install puppeteer (with Chromium download skipped)
RUN npm ci --omit=dev

# Download Chromium for Lambda
RUN mkdir -p /opt/chrome && \
    curl -SL https://github.com/Sparticuz/chromium/releases/download/v114.0.0/chromium-v114.0.0-lambda-layer.zip -o /tmp/chromium.zip && \
    unzip /tmp/chromium.zip -d /opt/chrome && \
    rm /tmp/chromium.zip && \
    chmod -R 755 /opt/chrome

# Puppeteer will use this path
ENV PUPPETEER_EXECUTABLE_PATH=/opt/chrome/chromium

# Copy source files
COPY . .

# Compile TypeScript
RUN npm install && npm run build

# Compile TypeScript to JavaScript
RUN tsc

# Create output folders if needed
RUN mkdir -p Results debug

# Set Lambda handler (ESM default export)
CMD ["dist/index.default"]
