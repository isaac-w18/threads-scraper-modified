FROM public.ecr.aws/lambda/nodejs:20

RUN dnf install -y \
    alsa-lib atk cups-libs gtk3 ipa-gothic-fonts \
    libXcomposite libXcursor libXdamage libXext libXi \
    libXrandr libXScrnSaver libXtst pango \
    xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi \
    xorg-x11-fonts-cyrillic xorg-x11-fonts-misc \
    xorg-x11-fonts-Type1 xorg-x11-utils \
    nspr \
    && dnf clean all
# Install dependencies for Puppeteer
# RUN yum install -y \
#     alsa-lib atk cups-libs gtk3 ipa-gothic-fonts \
#     libXcomposite libXcursor libXdamage libXext libXi \
#     libXrandr libXScrnSaver libXtst pango \
#     xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi \
#     xorg-x11-fonts-cyrillic xorg-x11-fonts-misc \
#     xorg-x11-fonts-Type1 xorg-x11-utils \
#     nspr \
#     && yum clean all
# RUN dnf install -y \
#     alsa-lib atk cups-libs gtk3 ipa-gothic-fonts \
#     libXcomposite libXcursor libXdamage libXext libXi \
#     libXrandr libXScrnSaver libXtst pango \
#     xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi \
#     xorg-x11-fonts-cyrillic xorg-x11-fonts-misc \
#     xorg-x11-fonts-Type1 xorg-x11-utils \
#     curl unzip \
#     nspr \
#     && dnf clean all
# RUN yum install -y \
#     alsa-lib atk cups-libs gtk3 ipa-gothic-fonts \
#     libXcomposite libXcursor libXdamage libXext libXi \
#     libXrandr libXScrnSaver libXtst pango \
#     xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi \
#     xorg-x11-fonts-cyrillic xorg-x11-fonts-misc \
#     xorg-x11-fonts-Type1 xorg-x11-utils \
#     curl unzip \
#     && yum clean all

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy everything and install dependencies
COPY package*.json ./

# Set env var to skip downloading Chromium
# ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install puppeteer (with Chromium download skipped)
RUN npm install
# RUN npm install @sparticuz/chromium@114.0.0 --platform=linux --arch=arm64

# Decompress the Brotli .br file to a usable binary
# RUN yum install -y brotli && \
#     brotli --decompress node_modules/@sparticuz/chromium/bin/chromium.br -o node_modules/@sparticuz/chromium/bin/chromium && \
#     chmod +x node_modules/@sparticuz/chromium/bin/chromium && \
#     yum clean all
# RUN npm ci --omit=dev

# Download Chromium for Lambda
# RUN npm install @sparticuz/chromium@135.0.0-next.3

# Did not work: cannot use a dynamic linker in Lambda environments.
# RUN mkdir -p /opt/chrome && \
#     curl -SL https://github.com/Sparticuz/chromium/releases/download/v135.0.0-next.3/chromium-v135.0.0-next.3-layer.x64.zip -o /tmp/chromium.zip && \
#     unzip /tmp/chromium.zip -d /opt/chrome && \
#     rm /tmp/chromium.zip && \
#     chmod -R 755 /opt/chrome

# Confirm actual path (DEBUG)
# RUN find /opt/ -type f -executable -name "chromium"

# Puppeteer will use this path
# ENV PUPPETEER_EXECUTABLE_PATH=/var/task/node_modules/@sparticuz/chromium/bin/chromium
# ENV PUPPETEER_EXECUTABLE_PATH=/var/task/node_modules/@sparticuz/chromium/bin/chromium.br



# Kind of worked with ZIP download: ENV PUPPETEER_EXECUTABLE_PATH=/opt/chrome/nodejs/node_modules/@sparticuz/chromium/bin/chromium.br
# Old Path: ENV PUPPETEER_EXECUTABLE_PATH=/opt/chrome/chromium

# Copy source files
COPY . .

# Compile TypeScript
RUN npm run build

# Compile TypeScript to JavaScript
# RUN tsc

# Optional: prune devDependencies to slim down the image
RUN npm prune --omit=dev

# Create output folders if needed
RUN mkdir -p Results debug

# Set Lambda handler (ESM default export)
CMD ["dist/index.default"]
