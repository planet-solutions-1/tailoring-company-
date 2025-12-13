FROM node:18-alpine

WORKDIR /app

# Copy Server Deps
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install

WORKDIR /app

# Copy Application Code
COPY . .

# Move back to server dir to run
WORKDIR /app/server

# Expose Port
EXPOSE 3000

# Environment Variables default
ENV PORT=3000
ENV NODE_ENV=production

# Start Command
CMD ["node", "server.js"]
