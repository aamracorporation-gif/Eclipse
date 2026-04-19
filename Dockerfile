FROM node:20-alpine

WORKDIR /app

# Copy backend package files and install production dependencies
COPY backend/package.json backend/package-lock.json ./backend/

RUN cd backend && npm ci --omit=dev

# Copy backend source code
COPY backend/src ./backend/src

# Expose the port Railway will assign (default 3000)
EXPOSE 3000

# Start the Express API
CMD ["node", "backend/src/index.js"]
