# Base image: a pre-built Linux image with Node 20
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Build tools needed to compile native packages like argon2 (C++ code)
RUN apk add --no-cache python3 make g++

# Install dependencies (skip devDependencies)
RUN npm ci --omit=dev

# Copy the rest of the source
COPY . .

# The app listens on port 4000
EXPOSE 4000

# Start the app
CMD ["node", "api/src/app.js"]