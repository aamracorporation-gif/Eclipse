FROM node:20-alpine

WORKDIR /app

# Copy backend package files and install production dependencies
COPY backend/package.json backend/package-lock.json ./backend/

RUN cd backend && npm ci --omit=dev

# Copy backend source code
COPY backend/src ./backend/src

# Expose the port the API listens on
EXPOSE 8081

# Start the Express API via npm script
CMD ["npm", "run", "api"]
